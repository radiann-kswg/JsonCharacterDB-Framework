/**
 * [def-object-common.js] - `$Def_*` 構造化フィールドを basicFields 向け 1 行テキストへ整形する共通部品
 *
 * @description
 *   `$Def_BaseArea` / `$Def_Faction` のように「辞書参照の子要素 ＋ `*_JP` / `*_EN` の補足」を持つ
 *   構造化フィールドを、schema 宣言だけを頼りに整形するための純関数群です。DOM には触れません。
 *
 *   ここには **field 名に依存した分岐を置きません**。どの子要素が辞書コードかは `$type`（`#DictIndex` /
 *   `#ListIndex`）と `$dict` 宣言で判別し、補足テキストはキー末尾の `_JP` / `_EN` で振り分けます。
 *
 *   個別の wrapper（`lib/basic-renders/baseArea.js` / `faction.js`）はこのモジュールを土台にして、
 *   `CharacterValueWrapperRegistry` へ登録するだけの薄い実装になります。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterValueWrapperRegistry (wrapper-common.js) / TypeResolver (basic-renders/type-common.js) — いずれも任意
 * @see docs/wrapper-summary-registry.md（baseAreaSummary / factionSummary）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : self;
	if (root.DefObjectRenderer) return;

	const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
	const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');

	/** `$Def_Faction[]` のような型トークンから `[]` を落とす */
	const stripArraySuffix = (name) => String(name || '').trim().replace(/\[\]$/, '');

	/**
	 * context から `$Def_*` コンテナ名の候補を取り出す（配列サフィックスは除去）
	 * @param {Object} context - wrapper context
	 * @returns {string[]}
	 */
	function collectDefNames(context) {
		const names = [];
		const push = (n) => {
			const name = stripArraySuffix(n);
			if (name.startsWith('$Def_') && !names.includes(name)) names.push(name);
		};
		push(context?.defName);
		for (const token of String(context?.schemaType || '').split('|')) push(token);
		return names;
	}

	/**
	 * 型/メタの探索ソースを優先順に集める
	 * - UI は `workMeta`（グローバル db_meta と作品 db_meta の合成）に `$Def_*` と `#Dict_*` を持つ
	 * - SW（enrich）は `typeSources` に合成済み `$VarsDef` を持つ
	 * @param {Object} context - wrapper context
	 * @returns {any[]}
	 */
	function collectLookupSources(context) {
		const sources = [];
		for (const src of [context?.workMeta, context?.globalDefType, ...(context?.typeSources || [])]) {
			if (src && typeof src === 'object' && !sources.includes(src)) sources.push(src);
		}
		return sources;
	}

	/**
	 * `$Def_*` コンテナ（`$DefType` / `$display` / `$shorthand` を持つ宣言）を解決する
	 * @param {string} defName - 例: '$Def_BaseArea'
	 * @param {Object} context - wrapper context
	 * @returns {Object|null}
	 */
	function resolveContainer(defName, context) {
		const name = stripArraySuffix(defName);
		if (!name) return null;

		const registry = root.CharacterValueWrapperRegistry;
		const helpers = context?.helpers || registry?.helpers || {};
		if (typeof helpers.resolveTypeDefContainer === 'function') {
			const found = helpers.resolveTypeDefContainer(context?.typeSources || [], name);
			if (isPlainObject(found)) return found;
		}

		for (const src of collectLookupSources(context)) {
			const candidates = [src?.$MetaType?.[name], src?.General?.$VarsDef?.[name], src?.$VarsDef?.[name]];
			for (const candidate of candidates) {
				if (isPlainObject(candidate)) return candidate;
			}
		}
		return null;
	}

	/**
	 * 辞書行を解決する。TypeResolver が読み込まれていない環境では簡易探索へフォールバックする。
	 * @param {string} dictName - 辞書名（`$dict`）
	 * @param {any} code - 突き合わせるコード値
	 * @param {Object} context - wrapper context
	 * @returns {Object|null}
	 */
	function resolveDictRow(dictName, code, context) {
		const name = trimStr(dictName);
		const rv = trimStr(code);
		if (!name || !rv) return null;

		const sources = collectLookupSources(context);

		const TR = root.TypeResolver;
		if (TR && typeof TR.resolveDictRow === 'function') {
			for (const src of sources) {
				const hit = TR.resolveDictRow(name, rv, null, src);
				if (hit) return hit;
			}
			return null;
		}

		// フォールバック: $VarsDef 直下の #Dict_* / #List_* だけを見る簡易探索
		for (const src of sources) {
			const varsList = [src?.General?.$VarsDef, src?.$VarsDef].filter((v) => v && typeof v === 'object');
			for (const vars of varsList) {
				for (const listKey of [`#Dict_${name}`, `#List_${name}`]) {
					const rows = Array.isArray(vars[listKey]) ? vars[listKey] : null;
					if (!rows) continue;
					const hit = rows.find((row) => isPlainObject(row)
						&& [name, `${name}_JP`, `${name}_EN`].some((k) => trimStr(row[k]) === rv));
					if (hit) return hit;
				}
			}
		}
		return null;
	}

	/**
	 * JP / EN の候補からページ言語に応じた表示テキストを選ぶ
	 * @param {string} jp
	 * @param {string} en
	 * @param {string} pageLang - 'jp' | 'en'（それ以外は JP / EN 併記）
	 * @returns {string}
	 */
	function pickLangText(jp, en, pageLang) {
		const lang = String(pageLang || '').toLowerCase();
		if (lang === 'en') return en || jp;
		if (lang === 'jp' || lang === 'ja') return jp || en;
		if (jp && en && jp !== en) return `${jp} / ${en}`;
		return jp || en;
	}

	/**
	 * 辞書行から「コード名に対応する JP / EN ラベル」を取り出す
	 * @param {Object|null} row - 辞書行
	 * @param {string} dictName - 辞書名（行のベースキー）
	 * @param {string} code - 元のコード値（行が無い場合のフォールバック）
	 * @param {string} pageLang
	 * @returns {string}
	 */
	function pickDictLabel(row, dictName, code, pageLang) {
		const base = trimStr(row?.[dictName]) || code;
		const jp = trimStr(row?.[`${dictName}_JP`]) || base;
		const en = trimStr(row?.[`${dictName}_EN`]) || base;
		return pickLangText(jp, en, pageLang);
	}

	/**
	 * `$Def_*` 型オブジェクト（例: `$Def_BaseArea` の `{ Area, BaseAreaAbout_JP/EN }`）を
	 * 「辞書参照ラベル ＋ 補足」の 1 行テキストへ整形する（field 名非依存）
	 * @param {any} value - 対象オブジェクト
	 * @param {string} defName - `$Def_*` 名
	 * @param {Object} context - wrapper context（helpers / typeSources / pageLang）
	 * @param {{style?: 'inline'|'paren'}} [options] - 補足の繋ぎ方。'paren' は `ラベル（補足）`、既定 'inline' は `ラベル／補足`
	 * @returns {string}
	 */
	function formatDefObject(value, defName, context, options = {}) {
		if (!isPlainObject(value)) return trimStr(value);
		// `{ hideText }` は意図的マスクなので、この整形では扱わず呼び出し側の表示に委ねる
		if (trimStr(value.hideText)) return '';

		const pageLang = String(context?.pageLang || 'jp');
		const container = resolveContainer(defName, context);
		const entries = Array.isArray(container?.$DefType) ? container.$DefType : [];

		const labelParts = [];
		const aboutJp = [];
		const aboutEn = [];

		for (const entry of entries) {
			const key = trimStr(entry?.hashTag);
			if (!key) continue;
			const raw = value[key];
			if (raw === null || raw === undefined || raw === '') continue;
			const typeSpec = String(entry?.$type || '');

			// 辞書参照の子要素はラベル解決する（`$dict` 未指定なら field 名を辞書名とみなす）
			if (/#DictIndex|#ListIndex/.test(typeSpec)) {
				const dictName = trimStr(entry?.$dict) || key;
				const row = resolveDictRow(dictName, raw, context);
				const label = pickDictLabel(row, dictName, trimStr(raw), pageLang);
				if (label) labelParts.push(label);
				continue;
			}

			// `*_JP` / `*_EN` の補足はページ言語に応じて併記する
			const text = isPlainObject(raw) ? trimStr(raw.hideText) : trimStr(raw);
			if (!text) continue;
			if (/_EN$/.test(key)) aboutEn.push(text);
			else aboutJp.push(text);
		}

		// typedef に宣言が無い旧来の補足キー（`about_JP` / `about_EN` / `about`）も拾う
		if (!aboutJp.length && !aboutEn.length) {
			const legacyJp = trimStr(value.about_JP) || trimStr(value.about);
			const legacyEn = trimStr(value.about_EN);
			if (legacyJp) aboutJp.push(legacyJp);
			if (legacyEn) aboutEn.push(legacyEn);
		}

		if (!labelParts.length && !aboutJp.length && !aboutEn.length) return '';

		const isEn = String(pageLang).toLowerCase() === 'en';
		const about = pickLangText(aboutJp.join('・'), aboutEn.join(' / '), pageLang);
		const label = labelParts.join('・');
		if (!label) return about;
		if (!about) return label;

		if (String(options?.style || 'inline') === 'paren') {
			return isEn ? `${label} (${about})` : `${label}（${about}）`;
		}
		return `${label}${isEn ? ' / ' : '／'}${about}`;
	}

	/**
	 * 単体 / 配列のどちらでも受けられるよう、要素ごとの整形結果を schema 宣言に従って連結する
	 * @param {any} value - 対象値
	 * @param {Object|null} container - `$Def_*` コンテナ（`$display.arrayLayout` を見る）
	 * @param {(item: any) => string} formatItem - 1 要素の整形関数
	 * @returns {string}
	 */
	function joinByArrayLayout(value, container, formatItem) {
		if (!Array.isArray(value)) return formatItem(value);

		// 配列の連結方法は schema 宣言に従う（既定は 1 要素 1 行）
		const layout = trimStr(container?.$display?.arrayLayout) || 'multiline';
		const items = value.map((item) => formatItem(item)).filter(Boolean);
		if (!items.length) return '';
		return items.join(layout === 'inline' ? ', ' : '\n');
	}

	root.DefObjectRenderer = {
		isPlainObject,
		trimStr,
		stripArraySuffix,
		collectDefNames,
		collectLookupSources,
		resolveContainer,
		resolveDictRow,
		pickLangText,
		pickDictLabel,
		formatDefObject,
		joinByArrayLayout,
	};
})();
