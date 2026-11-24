/** 画像の AI 除外指定を検証する純粋関数。表示・配色抽出の許否には使わない。 */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Images_AIOptout のキーと値を、合流済み Images.$type と元の Images に照合する。
 * @param {object} record 元レコード（画像をフィルタする前）
 * @param {object[]} imageFields 合流済みの画像フィールド定義
 * @throws {Error} 型不正、未宣言フィールド、元画像にない除外値
 */
export function validateImageOptouts(record, imageFields) {
  if (!object(record) || !Array.isArray(imageFields)) throw new Error('画像ポリシーの入力が不正です');
  for (const target of [record, ...imageFields]) {
    if (!object(target) || (own(target, 'AI_Optout') && typeof target.AI_Optout !== 'boolean')) {
      throw new Error('AI_Optout は boolean で指定してください');
    }
  }
  const optouts = record.Images_AIOptout;
  if (optouts == null) return;
  if (!object(optouts)) throw new Error('Images_AIOptout は画像フィールドごとのオブジェクトです');
  const declared = new Set(imageFields.map(field => field.hashTag));
  for (const [field, excluded] of Object.entries(optouts)) {
    if (!declared.has(field) || !object(record.Images) || !own(record.Images, field)) {
      throw new Error(`Images_AIOptout: 未定義の画像フィールド ${field}`);
    }
    if (!Array.isArray(excluded) || !excluded.length || excluded.some(value => typeof value !== 'string' || !value)) {
      throw new Error(`Images_AIOptout.${field}: 空でない文字列配列が必要です`);
    }
    const original = Array.isArray(record.Images[field]) ? record.Images[field] : [record.Images[field]];
    for (const value of excluded) {
      if (!original.includes(value)) throw new Error(`Images_AIOptout.${field}: 元画像にありません: ${value}`);
    }
  }
}

/**
 * validateImageOptouts 後に呼ぶ。上位の不許可や共有画像の deny は呼出元で合成する。
 * @param {object} record 元レコード
 * @param {object[]} imageFields 合流済み Images.$type
 * @param {string} fieldName 画像フィールド名
 * @param {unknown} rawValue Images に格納された未解決の値
 * @returns {boolean} AI 利用から除外するか。不明なフィールドも除外する。
 */
export function isImageOptedOut(record, imageFields, fieldName, rawValue) {
  const fields = imageFields.filter(def => def.hashTag === fieldName);
  return !fields.length || record.AI_Optout === true || fields.some(field => field.AI_Optout === true)
    || (record.Images_AIOptout?.[fieldName]?.includes(rawValue) ?? false);
}

/** 公開配信URLも同じ画像キーへ正規化し、未知のオリジン・親参照は許可しない。 */
export function canonicalAIImagePath(value) {
  if (typeof value !== 'string') return null;
  let candidate = value;
  if (/^https?:\/\//i.test(candidate)) {
    let url;
    try { url = new URL(candidate); } catch { return null; }
    if (url.origin === 'https://database.numbertales-radiann.net') candidate = url.pathname.slice(1);
    else if (url.origin === 'https://radiann-kswg.github.io') candidate = url.pathname.replace(/^\/100BeautiesLab_CreationsDB\//, '');
    else return null;
  }
  try { candidate = decodeURIComponent(candidate); } catch { return null; }
  candidate = candidate.replace(/^creations-db\//, '');
  return candidate.startsWith('data/') && !candidate.split('/').some(p => p === '..' || p === '.') && !candidate.includes('\\')
    ? candidate : null;
}

/** 連名画像は読み取り順にかかわらず拒否を優先し、根拠のない画像も除外する。 */
export function createImagePermissionIndex() {
  const allowed = new Set();
  const denied = new Set();
  return {
    add(value, permitted) {
      const key = canonicalAIImagePath(value);
      if (key) (permitted === true ? allowed : denied).add(key);
    },
    has(value) {
      const key = canonicalAIImagePath(value);
      return key !== null && allowed.has(key) && !denied.has(key);
    },
    paths() {
      return [...allowed].filter(key => !denied.has(key));
    },
  };
}

/** AIHintsの本文は保ち、reference_imagesだけを確定した許可集合で絞る。 */
export function filterAIImageReferences(hints, permitted) {
  const references = value => {
    if (value === null) return null;
    if (typeof value === 'string') return permitted(value) ? value : undefined;
    if (Array.isArray(value)) return value.map(references).filter(v => v !== undefined);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [key, references(child)]).filter(([, child]) => child !== undefined));
    return undefined;
  };
  if (Array.isArray(hints)) return hints.map(v => filterAIImageReferences(v, permitted));
  if (!hints || typeof hints !== 'object') return hints;
  return Object.fromEntries(Object.entries(hints).map(([key, value]) => [key,
    key === 'reference_images' ? (references(value) ?? null) : filterAIImageReferences(value, permitted),
  ]));
}


/** 辞書で除外した衣装の構造化項目と、その衣装を示すAIHintsの文を除く。 */
export function filterCostumeOptouts(record, costumeRows) {
  for (const row of costumeRows) {
    if (Object.hasOwn(row, 'AI_Optout') && typeof row.AI_Optout !== 'boolean') throw new Error('Costume.AI_Optout は boolean が必要です');
  }
  const rejected = costumeRows.filter(row => row.AI_Optout === true);
  if (!rejected.length) return record;
  if (rejected.some(row => typeof row.Costume !== 'string' || !row.Costume)) throw new Error('除外するCostumeのコードがありません');
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const codes = new Set(rejected.map(row => row.Costume));
  const appearance = Array.isArray(record.AppearanceDetail) ? record.AppearanceDetail : [];
  const attrText = entries => entries.flatMap(entry => (entry.Attrs ?? []).flatMap(attr =>
    Object.entries(attr).filter(([key, value]) => /_(JP|EN)$/.test(key) && typeof value === 'string').map(([, value]) => normalize(value))));
  const commonText = new Set(attrText(appearance.filter(entry => !codes.has(entry.Costume))));
  const phrases = new Set(attrText(appearance.filter(entry => codes.has(entry.Costume)))
    .filter(text => text.length >= 8 && !commonText.has(text)));
  for (const row of rejected) {
    for (const value of [row.Costume_JP, row.Costume_EN]) if (typeof value === 'string' && value.trim()) phrases.add(normalize(value));
    for (const value of [row.Costume, row.Costume_EN]) {
      if (typeof value !== 'string') continue;
      const base = normalize(value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+(costume|outfit)$/i, ''));
      phrases.add(`${base} costume`); phrases.add(`${base} outfit`);
    }
  }
  const blockedText = value => {
    const text = normalize(value);
    return [...phrases].some(phrase => text.includes(phrase))
      || [...codes].some(code => text === normalize(code) || text.includes(`(${normalize(code)})`));
  };
  const filter = value => {
    if (typeof value === 'string') return blockedText(value) ? undefined : value;
    if (Array.isArray(value)) return value.map(filter).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    if (codes.has(value.Costume) || codes.has(value.costume)) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !codes.has(key))
      .map(([key, item]) => [key, filter(item) ?? null]));
  };
  const result = { ...record };
  if (Array.isArray(record.AppearanceDetail)) result.AppearanceDetail = appearance.filter(entry => !codes.has(entry.Costume));
  if (record.AIHints) result.AIHints = filter(record.AIHints) ?? null;
  return result;
}

