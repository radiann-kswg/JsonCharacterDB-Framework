/**
 * pronoun-normalize.mjs - GenderType に基づく代名詞の確定的正規化・簡易警告検知
 * @description DeepL は LLM ではなく NMT のため、翻訳結果の代名詞は「指示」で確実に統一できない。
 *   このモジュールは `docs/localization-en-rules.md` §1（代名詞ルール）をコードに落とし込み、
 *   レコードの `GenderType` に基づいて DeepL の生訳文から代名詞トークンを機械的に正規化する。
 *   あわせて、自動修正が危険な 2 種類の不整合（一人称の混入・呼称の不一致）は
 *   書き換えず「検知して警告するだけ」に留める（文法崩壊やレコード固有の呼称誤爆を避けるため）。
 *   `tools/deepl/draft-translate.mjs` から利用する。ネットワーク I/O は行わない純粋関数のみ。
 * @author 100BeautiesLab.
 * @version 1.0.0
 */

/**
 * GenderType から代名詞ポリシーを決定する（`docs/localization-en-rules.md` §1 準拠）。
 * @param {string|undefined} genderType
 * @returns {'she'|'he'|'ze'|'avoid'}
 */
export function pronounPolicyForGenderType(genderType) {
  switch (genderType) {
    case "FemaleNeutral":
    case "Female":
      return "she";
    case "MaleNeutral":
    case "Male":
      return "he";
    case "Neutral":
      return "ze";
    default:
      return "avoid";
  }
}

/**
 * 代名詞トークン → 文法役割。`her` / `zir` は目的格・所有格で綴りが同じため ambiguous とする。
 * `they/them/their/theirs/themselves`（singular they）も対象に含める。
 * `docs/localization-en-rules.md` §1「Neutral は they/them・he/she・him/her を使わない」に
 * 従い、Neutral（`ze` ポリシー）では they 系も ze/zir へ強制変換する。
 */
const ROLE_OF = {
  he: "subject",
  him: "object",
  his: "possessive",
  himself: "reflexive",
  she: "subject",
  her: "ambiguous",
  hers: "possessive-standalone",
  herself: "reflexive",
  they: "subject",
  them: "object",
  their: "possessive",
  theirs: "possessive-standalone",
  themselves: "reflexive",
  ze: "subject",
  zir: "ambiguous",
  zirself: "reflexive",
};

/** 文法役割 → ポリシー別トークン（`docs/localization-en-rules.md` §1-1 の ze/zir 活用表準拠）。 */
const FORMS = {
  he: { subject: "he", object: "him", possessive: "his", "possessive-standalone": "his", reflexive: "himself" },
  she: { subject: "she", object: "her", possessive: "her", "possessive-standalone": "hers", reflexive: "herself" },
  ze: { subject: "ze", object: "zir", possessive: "zir", "possessive-standalone": "zir", reflexive: "zirself" },
};

const TOKEN_RE =
  /\b(he|him|his|himself|she|her|hers|herself|they|them|their|theirs|themselves|ze|zir|zirself)('s|'ll|'d|'re|'ve)?\b/gi;

/** 直後の語から `her` / `zir` の目的格・所有格を簡易推定する（辞書的ヒューリスティック）。 */
function resolveAmbiguousRole(text, afterIndex) {
  const after = text.slice(afterIndex);
  const m = after.match(/^\s*([A-Za-z][A-Za-z'-]*)/);
  if (!m) return "object";
  const nextWord = m[1].toLowerCase();
  // be/have/do 系の助動詞・引用動詞が続く場合は「〜は」（主語相当の目的格用法）とみなす
  const VERB_LIKE = new Set([
    "is", "was", "will", "would", "has", "had", "did", "does",
    "said", "says", "asked", "told", "looked", "smiled", "seemed",
  ]);
  if (VERB_LIKE.has(nextWord)) return "object";
  return "possessive";
}

function capitalizeLike(sample, word) {
  if (sample && /[a-zA-Z]/.test(sample[0]) && sample[0] === sample[0].toUpperCase()) {
    return word[0].toUpperCase() + word.slice(1);
  }
  return word;
}

/**
 * 英文中の代名詞トークンを targetPolicy へ強制変換する。
 * `avoid` の場合は変換せずそのまま返す（代名詞を避けるルールは自動書き換えでは実現できないため）。
 *
 * **既知の制約**: `they/them`（singular they）を主語として変換した場合、対応する be/have/do 動詞
 * （are→is 等）の一致は自動修正しない（"they" が本当に複数を指している可能性を捨てきれず、
 * 誤った文法修正で意味を変えるリスクの方が高いため）。この場合 `theySubjectConverted: true` を返すので、
 * 呼び出し側（`draft-translate.mjs`）はこれを警告として提示し、動詞一致は人間が確認すること。
 * @param {string} text
 * @param {'she'|'he'|'ze'|'avoid'} targetPolicy
 * @returns {{text: string, changed: boolean, theySubjectConverted: boolean}}
 */
export function normalizePronouns(text, targetPolicy) {
  if (targetPolicy === "avoid" || typeof text !== "string" || !text) {
    return { text, changed: false, theySubjectConverted: false };
  }
  let changed = false;
  let theySubjectConverted = false;
  const out = text.replace(TOKEN_RE, (full, base, suffix, offset) => {
    const lower = base.toLowerCase();
    let role = ROLE_OF[lower];
    if (role === "ambiguous") {
      role = resolveAmbiguousRole(text, offset + base.length);
    }
    if (lower === "they" && role === "subject") theySubjectConverted = true;
    const forms = FORMS[targetPolicy];
    const replacement = forms[role] || forms.object;
    const cased = capitalizeLike(base, replacement) + (suffix || "");
    if (cased.toLowerCase() !== full.toLowerCase()) changed = true;
    return cased;
  });
  return { text: out, changed, theySubjectConverted };
}

/**
 * 一人称の混入トークンを検知する（書き換えはしない。文法崩壊のリスクがあるため人手確認に回す）。
 * @param {string} text
 * @returns {string[]} 見つかった一人称トークン（重複除去）
 */
export function detectFirstPersonLeakage(text) {
  if (typeof text !== "string") return [];
  const hits = new Set();
  const re = /\b(I|my|me|mine|myself)\b/g;
  let m;
  while ((m = re.exec(text))) hits.add(m[1]);
  return [...hits];
}

const CALLING_MARKER_WORDS = [
  "big", "bro", "sis", "brother", "sister",
  "master", "boss", "leader", "senpai", "sensei",
];

/**
 * 訳文に、そのキャラの確定済み呼称（例: `ForMasterCalling_EN`）に含まれない
 * 呼称語（bro/sis 等）が現れていないかを検知する簡易ヒューリスティック。
 * 誤検知はあり得るため「候補提示」用途に限定し、自動置換はしない。
 * @param {string} text
 * @param {string|undefined} establishedEN
 * @returns {string[]} 訳文中に見つかったが established 側に無かった語
 */
export function detectCallingTermMismatch(text, establishedEN) {
  if (typeof text !== "string" || !text || !establishedEN) return [];
  const establishedLower = establishedEN.toLowerCase();
  const hits = [];
  for (const w of CALLING_MARKER_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(text) && !establishedLower.includes(w)) hits.push(w);
  }
  return hits;
}
