/**
 * [render.mjs] - ロールプレイプロンプト生成用の軽量テンプレートエンジン（自前・最小 mustache 風）
 * @description
 *   `roleplay-prompt.tpl.md` の差し込み口を、DB レコード値＋合成変数で置換する純関数群。
 *   LLM は一切呼ばず、既存の充填済み値を機械的に組み立てるだけ（CLAUDE.md「会話パターン情報の
 *   運用制約」準拠）。DOM・ファイル I/O には触れない。
 *
 *   記法:
 *   - `{{Path.To.Field}}`            … ドットパス置換（record → vars）。`@Name` は合成変数
 *   - `{{Field | filter}}`           … フィルタ（nospace / oneline / trim）
 *   - `{{#Field}} … {{/Field}}`      … 条件ブロック（非空で出力・空なら除去）
 *   - `{{^Field}} … {{/Field}}`      … 反転条件（空で出力）
 *   - `{{#each Path}} … {{/each}}`   … 配列反復（要素を record に、整形済み `@dialogue` を提供）
 *
 *   改行コード: 入力（テンプレ・DB 値）に CRLF が混ざっても内部処理は LF に正規化する。
 *   CRLF のまま整形すると `finalizeText` の畳み込み（`\n{3,}` 等）が素通りして空行が余分に残るため。
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies なし（Node.js >= 18・標準機能のみ）
 */

/**
 * 改行コードを LF へ正規化する（CRLF / CR → LF）。
 *
 * @description
 *   Windows のワークツリー（`core.autocrlf=true` ＋ `.gitattributes` の `* text=auto`）では、
 *   チェックアウト時に `.md` が CRLF になる。CRLF のまま整形処理へ流すと改行系の正規表現が
 *   一致せず、空行の畳み込みが効かなくなる。入口で必ずこの関数を通すこと。
 * @param {any} text
 * @returns {string} LF へ揃えたテキスト
 */
export function normalizeEol(text) {
	return String(text == null ? '' : text).replace(/\r\n?/g, '\n');
}

/**
 * 値が「空」か判定する（null/undefined/空文字/空白のみ/空配列/空オブジェクト）。
 * `{ hideText: '...' }` は意図的マスクで値があるため空扱いしない。
 * @param {any} v
 * @returns {boolean}
 */
export function isEmpty(v) {
	if (v === null || v === undefined) return true;
	if (typeof v === 'string') return v.trim() === '';
	if (Array.isArray(v)) return v.length === 0;
	if (typeof v === 'object') {
		if (typeof v.hideText === 'string' && v.hideText.trim()) return false;
		return Object.keys(v).length === 0;
	}
	return false;
}

/**
 * ドットパスでコンテキストから値を解決する。
 * `@Name` は合成変数（ctx.vars）から、それ以外は ctx.record からドット辿りで取得する。
 * @param {{record?: any, vars?: any}} ctx
 * @param {string} path
 * @returns {any}
 */
export function resolvePath(ctx, path) {
	const p = String(path == null ? '' : path).trim();
	if (!p) return undefined;
	if (p.startsWith('@')) return ctx?.vars?.[p.slice(1)];
	const segs = p.split('.');
	let cur = ctx?.record;
	for (const seg of segs) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = cur[seg];
	}
	// hideText マスク（非公開情報）はプロンプトに出さず省略する（値は解決しない）
	if (cur && typeof cur === 'object' && !Array.isArray(cur) && typeof cur.hideText === 'string') return undefined;
	return cur;
}

/**
 * `{ value, about_JP, about_EN }` 形式のオブジェクト値を、表示用のプリミティブへ解きほぐす。
 *
 * @description
 *   `Height_cm` / `Weight_kg` / `ConceptAge` / `GenderType` などは、素の数値のほかに
 *   「値＋補足」を持つオブジェクト形式を取りうる。テンプレから素で参照すると `String(obj)` が
 *   `[object Object]` になるため、表示経路では必ずこの関数を通す。
 *
 *   解決規則（**value 優先・無ければ補足**）:
 *   1. `hideText` を持つものは意図的マスクなので `undefined`（＝出力しない）
 *   2. `value` を持てばそれを返す（`0` も有効値として扱う）
 *   3. `value` が無ければ `about_JP` / `about_EN`（lang に応じて）を返す。
 *      補足は改行を含みうる（例:「可変\n(球体化姿時は…)」）ため 1 行へ畳む
 *   4. いずれも無ければ `undefined`
 *
 *   オブジェクト以外（数値・文字列・配列）はそのまま返す。配列要素の解決は呼び出し側で行う。
 * @param {any} v - 解決対象の値
 * @param {string} [lang] - 'jp'（既定）| 'en'
 * @returns {any} プリミティブ値、または解決不能なら undefined
 * @example
 * unwrapValueLike({ value: 43, about_JP: '推定' })      // => 43
 * unwrapValueLike({ about_JP: '不詳' })                  // => '不詳'
 * unwrapValueLike({ hideText: '非公開' })                // => undefined
 * unwrapValueLike(158)                                   // => 158
 */
export function unwrapValueLike(v, lang = 'jp') {
	if (v == null || typeof v !== 'object' || Array.isArray(v)) return v;
	if (typeof v.hideText === 'string') return undefined;
	if ('value' in v && v.value != null && v.value !== '') return v.value;
	const isEn = String(lang).toLowerCase() === 'en';
	const about = isEn
		? (v.about_EN ?? v.about ?? v.about_JP)
		: (v.about_JP ?? v.about ?? v.about_EN);
	if (about == null || String(about).trim() === '') return undefined;
	// 補足の改行は 1 行へ畳む（プロンプトは 1 項目 1 行を前提にしているため）
	return normalizeEol(about).split('\n').map((x) => x.trim()).filter(Boolean).join('');
}

/** 文分割時に深度を数える開き括弧（半角/全角/鉤括弧/隅付き括弧） */
const SENTENCE_OPENERS = '(（「『【〈《［[｛{';
/** 文分割時に深度を戻す閉じ括弧（`SENTENCE_OPENERS` と同順の対） */
const SENTENCE_CLOSERS = ')）」』】〉》］]｝}';
/** 文末に「。」を補わない末尾文字（既に句点/閉じ括弧/終止記号で閉じているもの） */
const SENTENCE_TERMINALS = /[。．！？!?…‥、]$|[)）」』】〉》］\]｝}]$/;

/**
 * 日本語テキストを「。」で文へ分割する（括弧内の「。」では切らない）。
 *
 * @description
 *   `ConversationNotes_JP` のような補足文には `(… と明るく返す。)` のように括弧内で完結する
 *   文が混ざる。単純な `split('。')` では閉じ括弧だけが次の文へ落ちて `- )。` という壊れた行に
 *   なるため、括弧の深度を数えて括弧内の句点を文末とみなさない。閉じ括弧が過剰な壊れた入力でも
 *   深度は 0 未満へ落とさず、最悪でも「分割しすぎない」側へ倒す。
 * @param {any} text - 分割対象（改行を含まない 1 段落を想定）
 * @returns {string[]} 句点を保持したままの文配列（前後空白は除去・空要素は除外）
 * @example
 * splitSentences('しない。(慕い、返す。)') // => ['しない。', '(慕い、返す。)']
 */
export function splitSentences(text) {
	const s = normalizeEol(text);
	const out = [];
	let buf = '';
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		buf += ch;
		if (SENTENCE_OPENERS.includes(ch)) { depth++; continue; }
		if (SENTENCE_CLOSERS.includes(ch)) { depth = Math.max(0, depth - 1); continue; }
		if (ch !== '。') continue;
		if (depth > 0) continue; // 括弧内の句点は文末ではない
		if (SENTENCE_CLOSERS.includes(s[i + 1] || '')) continue; // 「。）」は閉じ括弧まで 1 文
		out.push(buf);
		buf = '';
	}
	if (buf) out.push(buf);
	return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * 文字列フィルタを適用する。
 * @param {any} value
 * @param {string} name - 'nospace'（空白除去）/ 'oneline'（先頭行のみ）/ 'trim'
 * @returns {string}
 */
export function applyFilter(value, name) {
	const s = normalizeEol(value);
	switch (String(name || '').trim()) {
		case 'nospace': return s.replace(/[\s　]+/g, '');
		case 'oneline': return (s.split('\n')[0] || '').trim();
		// 改行区切りを読点で連結。各行末の句点は落とす（テンプレ側が「。」「である一方、」等を
		// 続けるため、残すと `…接しやすい。。` のように句点が二重化する）
		case 'commas': return s.split('\n').map((x) => x.trim().replace(/。+$/, '')).filter(Boolean).join('、');
		case 'bullets': return s.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join('\n');
		// 改行区切りの複数名を「または」で連結（orjoin=空白維持 / altnames=空白除去し表示名向け）
		case 'orjoin': return s.split('\n').map((x) => x.trim()).filter(Boolean).join(' または ');
		case 'altnames': return s.split('\n').map((x) => x.trim().replace(/[\s　]+/g, '')).filter(Boolean).join(' または ');
		// 名前の並列を 1 名ずつ鉤括弧で括る形へ（`「A」または「B」`）。外側の `「` `」` はテンプレ側が
		// 持つため、ここでは名の間だけを `」または「` で繋ぐ（orquote=空白維持 / altquote=空白除去）
		case 'orquote': return s.split('\n').map((x) => x.trim()).filter(Boolean).join('」または「');
		case 'altquote': return s.split('\n').map((x) => x.trim().replace(/[\s　]+/g, '')).filter(Boolean).join('」または「');
		// 長文を文単位の箇条書きへ細分化する（改行も段落の区切りとして扱う）
		case 'sentences': return s.split('\n')
			.map((x) => x.trim())
			.filter(Boolean)
			.flatMap((para) => splitSentences(para))
			.map((x) => (SENTENCE_TERMINALS.test(x) ? `- ${x}` : `- ${x}。`))
			.join('\n');
		case 'trim': return s.trim();
		default: return s;
	}
}

/**
 * 台詞リストの 1 要素を「キー：台詞（補足）」形式のテキストへ整形する。
 * 3 形式（plain string / `{value, about}` / `{value_JP, value_EN, about_JP, about_EN}`）に対応。
 *
 * `keyLabel` は `TouchReactions`（行為）/ `MotifCommentaries`（モチーフ）のように
 * キー項目を持つリスト向けの接頭辞。呼び出し側が辞書解決して渡す（このモジュールは
 * schema / 辞書を知らない純関数のままにする）。空なら従来どおり本文だけを返す。
 * @param {any} item
 * @param {string} [lang] - 'jp'（既定）| 'en'
 * @param {string} [keyLabel] - 解決済みのキーラベル（例: 'なでる' / 'Life Path 3'）
 * @returns {string}
 */
export function formatDialogueItem(item, lang = 'jp', keyLabel = '') {
	const isEn = String(lang).toLowerCase() === 'en';
	const key = String(keyLabel || '').trim();
	const withKey = (body) => (key ? (isEn ? `${key}: ${body}` : `${key}：${body}`) : body);

	if (typeof item === 'string') {
		const text = item.trim();
		return text ? withKey(text) : '';
	}
	if (!item || typeof item !== 'object') return '';
	const value = isEn
		? (item.value_EN || item.value || item.value_JP || '')
		: (item.value_JP || item.value || item.value_EN || '');
	const about = isEn
		? (item.about_EN || item.about || item.about_JP || '')
		: (item.about_JP || item.about || item.about_EN || '');
	const v = String(value || '').trim();
	if (!v) return '';
	const a = String(about || '').trim();
	return withKey(a ? `${v}（${a}）` : v);
}

/**
 * `{{#each Path}} … {{/each}}` を展開する。
 * 配列各要素を record に、整形済み台詞を `@dialogue` に載せて内側を再帰レンダする。
 * @param {string} tpl
 * @param {{record?: any, vars?: any}} ctx
 * @param {object} opts
 * @returns {string}
 */
function expandEach(tpl, ctx, opts) {
	return tpl.replace(/\{\{#each\s+([\w.@]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, path, inner) => {
		const arr = resolvePath(ctx, path);
		if (!Array.isArray(arr) || !arr.length) return '';
		const lang = ctx?.vars?.__lang || 'jp';
		// キー項目（行為 / モチーフ）を持つリストの接頭辞は、辞書を知る呼び出し側の
		// リゾルバへ委譲する（未提供なら従来どおり本文のみ）
		const resolveKeyLabel = ctx?.vars?.__dialogueKeyLabel;
		return arr
			.filter((item) => !isEmpty(item))
			.map((item) => {
				const itemRecord = (item && typeof item === 'object' && !Array.isArray(item)) ? item : { value: item };
				const keyLabel = (typeof resolveKeyLabel === 'function') ? resolveKeyLabel(item, lang) : '';
				const itemCtx = { record: itemRecord, vars: { ...ctx.vars, dialogue: formatDialogueItem(item, lang, keyLabel) } };
				return renderTemplate(inner, itemCtx, { ...opts, finalize: false });
			})
			.join('');
	});
}

/**
 * `{{#Field}}…{{/Field}}` / `{{^Field}}…{{/Field}}` 条件ブロックを展開する（ネスト対応・内側から反復）。
 * @param {string} tpl
 * @param {{record?: any, vars?: any}} ctx
 * @returns {string}
 */
function expandConditionals(tpl, ctx) {
	let prev;
	let out = tpl;
	let guard = 0;
	do {
		prev = out;
		out = out.replace(/\{\{#([\w.@]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, field, inner) =>
			isEmpty(resolvePath(ctx, field)) ? '' : inner);
		out = out.replace(/\{\{\^([\w.@]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_m, field, inner) =>
			isEmpty(resolvePath(ctx, field)) ? inner : '');
	} while (out !== prev && ++guard < 30);
	return out;
}

/**
 * `{{Path | filter}}` 単純置換を展開する。空値は onMissing に従い drop（既定）または error。
 * @param {string} tpl
 * @param {{record?: any, vars?: any}} ctx
 * @param {object} opts - { onMissing?: 'drop'|'error' }
 * @returns {string}
 */
function expandInterpolations(tpl, ctx, opts) {
	const onMissing = opts.onMissing || 'drop';
	return tpl.replace(/\{\{\s*([^#^/][^}]*?)\s*\}\}/g, (_m, expr) => {
		const parts = String(expr).split('|').map((s) => s.trim());
		const pathPart = parts[0];
		const filterName = parts[1];
		const val = resolvePath(ctx, pathPart);
		if (isEmpty(val)) {
			if (onMissing === 'error') throw new Error(`未解決プレースホルダ: {{${expr}}}`);
			return '';
		}
		// `{ value, about }` 形式は表示前に必ず解きほぐす（素で String() すると `[object Object]`）。
		// 単位付きの整形が要る項目（身長/体重/年齢）は build 側が合成変数を用意するが、
		// ここは全プレースホルダに効く最後の防波堤として置く。
		const lang = ctx?.vars?.__lang || 'jp';
		let s = Array.isArray(val)
			? val.map((x) => unwrapValueLike(x, lang)).filter((x) => !isEmpty(x)).map((x) => String(x)).join(', ')
			: String(unwrapValueLike(val, lang) ?? '');
		if (filterName) s = applyFilter(s, filterName);
		return s;
	});
}

/**
 * 出力テキストの体裁を整える（空箇条書き行の除去・連続空行の畳み込み・行末空白除去・末尾改行1個）。
 * @param {string} text
 * @returns {string}
 */
export function finalizeText(text) {
	// CRLF のままだと以降の畳み込み（`\n{3,}` 等）が一致せず空行が残るため、まず LF へ揃える
	const lines = normalizeEol(text)
		.split('\n')
		.filter((line) => !/^[ \t]*[-*]\s*$/.test(line));
	let out = lines.join('\n');
	out = out.replace(/[ \t]+$/gm, '');
	out = out.replace(/\n{3,}/g, '\n\n');
	// 条件省略の跡で箇条書き行の間に生じた空行を詰める（`- A` と `- B` の間の空行を除去）
	out = out.replace(/(-[^\n]*)\n\n(?=-)/g, '$1\n');
	out = out.replace(/\s+$/, '');
	return `${out}\n`;
}

/**
 * レンダ結果に未解決の `{{ … }}` が残っていないか判定する（タイポ検出用）。
 * @param {string} text
 * @returns {boolean}
 */
export function hasUnresolvedPlaceholders(text) {
	return /\{\{[\s\S]*?\}\}/.test(String(text == null ? '' : text));
}

/**
 * テンプレート文字列を、コンテキスト（record + 合成変数 vars）で展開する。
 * 処理順: {{#each}} → 条件ブロック → 単純置換 →（finalize 時のみ）体裁整形。
 * @param {string} tpl
 * @param {{record?: any, vars?: any}} ctx
 * @param {{onMissing?: 'drop'|'error', finalize?: boolean}} [opts]
 * @returns {string}
 */
export function renderTemplate(tpl, ctx, opts = {}) {
	const finalize = opts.finalize !== false;
	// テンプレが CRLF でチェックアウトされていても展開・整形が同じ結果になるよう入口で揃える
	let out = normalizeEol(tpl);
	out = expandEach(out, ctx, opts);
	out = expandConditionals(out, ctx);
	out = expandInterpolations(out, ctx, opts);
	if (finalize) out = finalizeText(out);
	return out;
}
