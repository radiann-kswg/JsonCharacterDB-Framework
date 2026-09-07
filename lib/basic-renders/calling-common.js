/**
 * [calling-common.js] - `*Calling` 系フィールドの呼称 DSL を解析・整形する純関数ライブラリ
 * @description
 *   ThirdPersonCalling / FirstPersonCalling / SecondPersonCalling / ForMasterCalling /
 *   For79thDealerCalling / For80thDealerCalling 等、`[A-Za-z]Calling` サフィックスを持つ
 *   フィールドの値を、言語非依存の「トークンモデル」へ解析する（parseCalling）。
 *   デリミタ階層は `\n`（文脈区切り）> `;`（カテゴリ区切り）> `/` `,`（同カテゴリ内の代替候補）。
 *   `*xxx` こそあど記法・`[※xxx]`（JP）/ `[*xxx]`（EN）参照記法を人間可読ラベルへ展開する。
 *
 *   本ファイルは DOM に一切触れない純関数のみを持ち、UI 描画（`lib/section-renders/calling.js`）は
 *   このモデルを受け取って `el()` で描画する。これにより UI / Service Worker / pkg(Node) /
 *   ロールプレイプロンプト生成ツールが同一のデコードを共用できる。
 *
 *   `彼/彼女` は GenderType 非依存であり、`/` 区切りの並列候補として両方を保持する（正典準拠）。
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies なし（純関数。`globalThis.CallingCommon` として公開）
 * @see docs/localization-en-rules.md §3-3・§4（呼称 DSL 文法の正典）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : this;
	if (root.CallingCommon) return;

	/** JP `*xxx` こそあど記法の展開マップ */
	const STAR_EXPAND_JP = {
		'*いつ': 'あいつ/こいつ系（人称・物質）',
		'*イツ': 'あいつ/こいつ系（人称・物質）',
		'*れ': 'あれ/それ系（物質のみ）',
		'*レ': 'あれ/それ系（物質のみ）',
		'*の子': 'その子/この子系',
		'*のこ': 'その子/この子系',
		'*のコ': 'その子/この子系',
		'*っち': 'そっち/こっち系',
		'*の人': 'その人/この人系',
		'*の者': 'その者系（格式）',
		'*の方': 'その方（丁寧）',
		'*ちら': 'そちら/こちら系（丁寧）',
		'*やつ': 'そいつ系（粗野）',
		'*奴': 'そいつ系（粗野）',
	};

	/** JP `[※xxx]` 参照ラベルの展開マップ */
	const REF_EXPAND_JP = {
		'[※名前呼び]': '名前呼び',
		'[※二人称]': '二人称と同じ',
		'[※三人称]': '三人称と同じ',
		'[※その時により変わる]': 'その時による',
		'[※主人の趣向に応じる]': '主人の趣向に応じる',
	};

	/** EN `[*xxx]` 参照ラベルの展開マップ（正規形 + レガシー互換） */
	const REF_EXPAND_EN = {
		'[*by name]': 'by name',
		'[*second-person calling]': 'same as second-person',
		'[*third-person calling]': 'same as third-person',
		'[*Varies depending on the situation]': 'varies by situation',
		"[*Adapts to the master's preferences]": "adapts to master's preferences",
		// レガシー表記（旧データとの互換）
		'[*changes by situation]': 'varies by situation',
		'[*third-person form]': 'same as third-person',
		'[*same as second-person]': 'same as second-person',
		'[*same as third-person]': 'same as third-person',
	};

	/**
	 * 括弧の深さを考慮してトップレベルのセパレータで分割する。
	 * 例: splitTopLevel("he/she; (a/b); c", ';') → ["he/she", "(a/b)", "c"]
	 * @param {string} s
	 * @param {string} sep - 1文字のセパレータ
	 * @returns {string[]}
	 */
	function splitTopLevel(s, sep) {
		const parts = [];
		let depth = 0;
		let cur = '';
		for (const c of s) {
			if (c === '(') {
				depth++;
				cur += c;
				continue;
			}
			if (c === ')') {
				depth = Math.max(0, depth - 1);
				cur += c;
				continue;
			}
			if (c === sep && depth === 0) {
				const p = cur.trim();
				if (p) parts.push(p);
				cur = '';
				continue;
			}
			cur += c;
		}
		const last = cur.trim();
		if (last) parts.push(last);
		return parts;
	}

	/**
	 * 文字列末尾の「 ※〜」注釈を抽出する。
	 * @param {string} s
	 * @returns {{ main: string, note: string|null }}
	 */
	function extractNote(s) {
		const m = s.match(/\s※(.+)$/);
		if (!m) return { main: s.trim(), note: null };
		return { main: s.slice(0, m.index).trim(), note: m[1].trim() };
	}

	/**
	 * トークン文字列 1 件を { text, raw, type } に変換する。
	 * type は 'ref' | 'demo' | 'plain' のいずれか。
	 * @param {string} raw - トリム済みの 1 トークン
	 * @param {boolean} isJP
	 * @returns {{ text: string, raw: string, type: string }|null}
	 */
	function tokenize(raw, isJP) {
		const t = raw.trim();
		if (!t) return null;

		// JP: [※xxx] 参照記法
		if (isJP && /^\[※/.test(t)) {
			return { raw: t, text: REF_EXPAND_JP[t] ?? t.slice(2, -1), type: 'ref' };
		}
		// EN: [*xxx] 参照記法
		if (!isJP && /^\[\*/.test(t)) {
			return { raw: t, text: REF_EXPAND_EN[t] ?? t.slice(2, -1), type: 'ref' };
		}
		// JP: *xxx こそあど記法（後続テキストを除いてマップキーを特定）
		if (isJP && /^\*/.test(t)) {
			const key = Object.keys(STAR_EXPAND_JP).find(
				(k) => t === k || t.startsWith(`${k}(`) || t.startsWith(`${k}（`)
			);
			if (key) return { raw: t, text: STAR_EXPAND_JP[key], type: 'demo' };
		}
		return { raw: t, text: t, type: 'plain' };
	}

	/**
	 * カテゴリ文字列（`;` 区切り単位）を token モデル配列へ解析する（DOM 非依存）。
	 * `/` と `,` を代替表現セパレータとして扱い、各 token の直後の区切り文字を `sepAfter` に残す。
	 * @param {string} catStr
	 * @param {boolean} isJP
	 * @returns {Array<{text:string, raw:string, type:string, sepAfter:string|null}>}
	 */
	function parseCategory(catStr, isJP) {
		const tokens = [];
		let depth = 0;
		let cur = '';

		const flush = (sep) => {
			const p = cur.trim();
			cur = '';
			if (!p) return;
			const tok = tokenize(p, isJP);
			if (!tok) return;
			tokens.push({ ...tok, sepAfter: sep || null });
		};

		for (let i = 0; i < catStr.length; i++) {
			const c = catStr[i];
			if (c === '(') {
				depth++;
				cur += c;
				continue;
			}
			if (c === ')') {
				depth = Math.max(0, depth - 1);
				cur += c;
				continue;
			}
			if (depth === 0 && (c === '/' || c === ',')) {
				flush(c);
				continue;
			}
			cur += c;
		}
		flush(null);
		return tokens;
	}

	/**
	 * 言語フラグを 'jp'|'en'|boolean から isJP(boolean) へ正規化する。
	 * @param {string|boolean} lang
	 * @returns {boolean}
	 */
	function toIsJP(lang) {
		if (typeof lang === 'boolean') return lang;
		return String(lang || 'jp').toLowerCase() !== 'en';
	}

	/**
	 * 呼称 DSL 文字列を言語非依存のトークンモデルへ解析する。
	 * @param {string} raw - 呼称フィールドの生値
	 * @param {{lang?: string|boolean}} [options] - lang: 'jp'（既定）| 'en'。boolean は isJP として扱う
	 * @returns {{contexts: Array<{note: string|null, categories: Array<{tokens: Array<{text:string, raw:string, type:string, sepAfter:string|null}>}>}>}}
	 */
	function parseCalling(raw, options = {}) {
		if (typeof raw !== 'string') return { contexts: [] };
		const trimmed = raw.trim();
		if (!trimmed) return { contexts: [] };
		const isJP = toIsJP(options.lang);

		const contexts = trimmed
			.split('\n')
			.map((line) => {
				const t = line.trim();
				if (!t) return null;

				const { main, note } = extractNote(t);
				if (!main) return null;

				const categories = splitTopLevel(main, ';')
					.map((cat) => {
						const c = cat.trim();
						if (!c) return null;
						const tokens = parseCategory(c, isJP);
						if (!tokens.length) return null;
						return { tokens };
					})
					.filter(Boolean);

				if (!categories.length) return null;
				return { note: note || null, categories };
			})
			.filter(Boolean);

		return { contexts };
	}

	/**
	 * parseCalling のモデルをプレーンテキストへ整形する（プロンプト生成・サマリー用途）。
	 * DOM は生成しない。カテゴリ内の代替候補は元の区切り（`/` `,`）を保つ。
	 * @param {object} parsed - parseCalling の返り値
	 * @param {{catSep?: string, ctxSep?: string}} [options] - catSep: カテゴリ間区切り（既定 '・'）/ ctxSep: 文脈間区切り（既定 ' ／ '）
	 * @returns {string}
	 */
	function formatCallingText(parsed, options = {}) {
		if (!parsed || !Array.isArray(parsed.contexts) || !parsed.contexts.length) return '';
		const catSep = typeof options.catSep === 'string' ? options.catSep : '・';
		const ctxSep = typeof options.ctxSep === 'string' ? options.ctxSep : ' ／ ';

		return parsed.contexts
			.map((ctx) => {
				const catText = ctx.categories
					.map((cat) => cat.tokens.map((tk) => `${tk.text}${tk.sepAfter || ''}`).join(''))
					.filter(Boolean)
					.join(catSep);
				if (!catText) return '';
				return ctx.note ? `${catText}（※${ctx.note}）` : catText;
			})
			.filter(Boolean)
			.join(ctxSep);
	}

	/**
	 * 生値から直接プレーンテキストへ整形するショートカット（parseCalling → formatCallingText）。
	 * @param {string} raw
	 * @param {{lang?: string|boolean, catSep?: string, ctxSep?: string}} [options]
	 * @returns {string}
	 */
	function decodeCallingToText(raw, options = {}) {
		return formatCallingText(parseCalling(raw, options), options);
	}

	root.CallingCommon = {
		STAR_EXPAND_JP,
		REF_EXPAND_JP,
		REF_EXPAND_EN,
		splitTopLevel,
		extractNote,
		tokenize,
		parseCategory,
		toIsJP,
		parseCalling,
		formatCallingText,
		decodeCallingToText,
	};
})();
