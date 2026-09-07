/**
 * [keyedDialogue.js] - キー付き台詞リスト（`$Def_MotifCommentary` / `$Def_TouchReaction`）の共通整形
 *
 * @description
 *   「辞書コードのキー項目 ＋ 和英の台詞本文 ＋ 補足」という形の配列要素を、
 *   `キー：台詞（補足）` の 1 行テキストへ整形するための純関数群です。DOM には触れません。
 *
 *   同じ整形関数が `ConversationPattern.DialogueExamples`（キー項目を持たない従来型）にも使われます。
 *   キー項目が無い要素は接頭辞を付けずに返すため、既存フィールドの表示は変わりません。
 *
 *   **field 名に依存した分岐は持ちません**。どの子要素がキーかは schema 側の宣言だけで決まります。
 *
 *   - `$display.role: "dialogueKey"`      … 辞書コードを持つキー項目（`$dict` で辞書名を宣言）
 *   - `$display.role: "dialogueKeyValue"` … キーへ連結する数値・識別子（例: ライフパス「3」）
 *   - `value_JP` / `value_EN`             … 台詞・解説の本文（ページ言語で選択）
 *   - `about_JP` / `about_EN`             … 補足（本文の後ろへ `（…）` で付記）
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies DefObjectRenderer (basic-renders/def-object-common.js), CharacterValueWrapperRegistry (wrapper-common.js) — registry は任意
 * @see docs/wrapper-summary-registry.md（keyedDialogueSummary）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : self;
	const D = root.DefObjectRenderer;
	if (!D) return;

	const WRAPPER_NAME = 'keyedDialogueSummary';
	const { isPlainObject, trimStr, stripArraySuffix } = D;

	/** 日本語文字（ひらがな/カタカナ/漢字）を含むか。和英が混在した生文字列の振り分けに使う */
	const hasJapaneseChars = (text) => /[\u3040-\u30ff\u3400-\u9fff]/.test(String(text || ''));

	/**
	 * `$Def_*` コンテナの子要素を `$display.role` で引く
	 * @param {Object|null} container - `$Def_*` コンテナ
	 * @param {string} role - 探す role 名
	 * @returns {Object|null}
	 */
	function findEntryByRole(container, role) {
		const entries = Array.isArray(container?.$DefType) ? container.$DefType : [];
		return entries.find((entry) => trimStr(entry?.$display?.role) === role) || null;
	}

	/**
	 * キー接頭辞（辞書ラベル ＋ 付随する値）を組み立てる
	 * - 例: `{ Topic: 'LifePath', TopicValue: 3 }` → `ライフパス3` / `Life Path 3`
	 * - 例: `{ Action: 'pat' }` → `なでる` / `Pat`
	 * @param {any} item - 配列 1 要素
	 * @param {Object|null} container - `$Def_*` コンテナ
	 * @param {Object} context - wrapper context（typeSources / workMeta / globalDefType / pageLang）
	 * @returns {string} キー接頭辞（キー項目が無ければ空文字）
	 */
	function buildKeyLabel(item, container, context) {
		if (!isPlainObject(item) || !container) return '';

		const keyEntry = findEntryByRole(container, 'dialogueKey');
		if (!keyEntry) return '';

		// 本文は `mix`（和英併記）でも JP 優先で 1 本だけ出るため、接頭辞も JP へ寄せて 1 行の言語を揃える
		// （辞書ラベルの既定は mix で `JP / EN` 併記だが、ここで併記すると `なでる / Pat：<JPの台詞>` になる）
		const pageLang = String(context?.pageLang || 'jp').toLowerCase() === 'en' ? 'en' : 'jp';
		const keyName = trimStr(keyEntry.hashTag);
		const code = trimStr(item[keyName]);
		if (!code) return '';

		const dictName = trimStr(keyEntry.$dict) || keyName;
		const row = D.resolveDictRow(dictName, code, context);
		const label = D.pickDictLabel(row, dictName, code, pageLang);
		if (!label) return '';

		// キーへ連結する値（ライフパス「3」など）。EN はラベルと数値の間に半角スペースを入れる
		const valueEntry = findEntryByRole(container, 'dialogueKeyValue');
		if (!valueEntry) return label;
		const rawValue = item[trimStr(valueEntry.hashTag)];
		if (rawValue === null || rawValue === undefined || rawValue === '') return label;

		const isEn = String(pageLang).toLowerCase() === 'en';
		return `${label}${isEn ? ' ' : ''}${String(rawValue).trim()}`;
	}

	/**
	 * 台詞リストの 1 要素を「キー：本文（補足）」形式のテキストへ整形する
	 *
	 * 対応する要素の形は 3 通り（`DialogueExamples` の実データに合わせる）:
	 *   1. 生文字列 … ページ言語と日本語文字の有無で採否を決める
	 *   2. `{ value, about }` … 移行途上の旧形式
	 *   3. `{ value_JP, value_EN, about_JP, about_EN }`（＋ キー項目）
	 *
	 * @param {any} item - 配列 1 要素
	 * @param {Object} context - `{ pageLang, schemaType, defName, typeSources, workMeta, globalDefType, fallbackFormat }`
	 * @returns {string} 整形済みテキスト（表示対象外なら空文字）
	 */
	function formatKeyedDialogueItem(item, context = {}) {
		if (item === null || item === undefined || item === '') return '';

		const lang = String(context?.pageLang || 'jp').toLowerCase();

		// 1) 生文字列 … ページ言語に合う方だけを残す（和英が要素単位で混在する旧データ向け）
		if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
			const text = String(item).trim();
			if (!text) return '';
			if (lang === 'jp') return hasJapaneseChars(text) ? text : '';
			if (lang === 'en') return hasJapaneseChars(text) ? '' : text;
			return text;
		}

		if (!isPlainObject(item)) return '';

		// `{ hideText }` は意図的マスクなので、この整形では扱わず呼び出し側の表示に委ねる
		if (trimStr(item.hideText)) return '';

		// キー接頭辞は schema 宣言（`$Def_*` コンテナ）がある場合だけ付く
		let container = null;
		for (const defName of D.collectDefNames(context)) {
			const found = D.resolveContainer(defName, context);
			if (found) {
				container = found;
				break;
			}
		}
		const keyLabel = buildKeyLabel(item, container, context);
		const withKey = (body) => {
			if (!body) return '';
			if (!keyLabel) return body;
			return lang === 'en' ? `${keyLabel}: ${body}` : `${keyLabel}：${body}`;
		};

		const valueJP = trimStr(item.value_JP);
		const valueEN = trimStr(item.value_EN);
		const valueRaw = trimStr(item.value);
		const aboutJP = trimStr(item.about_JP);
		const aboutEN = trimStr(item.about_EN);

		if (lang === 'jp') {
			const base = valueJP || (hasJapaneseChars(valueRaw) ? valueRaw : '');
			if (!base) return '';
			return withKey(aboutJP ? `${base}（${aboutJP}）` : base);
		}

		if (lang === 'en') {
			const base = valueEN || (!hasJapaneseChars(valueRaw) ? valueRaw : '');
			if (!base) return '';
			return withKey(aboutEN ? `${base} (${aboutEN})` : base);
		}

		// mix（和英併記）は呼び出し側の汎用整形へ委ねる。キー接頭辞だけこちらで付ける
		const fallback = (typeof context?.fallbackFormat === 'function') ? trimStr(context.fallbackFormat(item)) : '';
		return withKey(fallback);
	}

	/**
	 * 「キー付き台詞リスト」として整形すべき配列型かを schema 宣言から判定する
	 * - `#Dialogue` を含む配列型（`ConversationPattern.DialogueExamples`）
	 * - `$display.wrapper: "keyedDialogueSummary"` を宣言した `$Def_*` の配列型
	 * @param {any} schemaType - 子要素の `$type`
	 * @param {Object} context - `$Def_*` 解決用 context（typeSources / workMeta / globalDefType）
	 * @returns {boolean}
	 */
	function isKeyedDialogueListType(schemaType, context = {}) {
		if (typeof schemaType !== 'string') return false;
		if (!/\[\]/.test(schemaType)) return false;
		if (schemaType.includes('#Dialogue')) return true;

		for (const token of schemaType.split('|')) {
			const name = stripArraySuffix(token);
			if (!name.startsWith('$Def_')) continue;
			const container = D.resolveContainer(name, { ...context, defName: name });
			if (trimStr(container?.$display?.wrapper) === WRAPPER_NAME) return true;
		}
		return false;
	}

	// 値 wrapper としても登録しておく（`value_JP` を持たない部分入力の要素は
	// `formatValueForDisplay` の bilingual 分岐に掛からず、この registry 経由で整形される）
	const registry = root.CharacterValueWrapperRegistry;
	if (registry && typeof registry.registerWrapper === 'function') {
		registry.registerWrapper(WRAPPER_NAME, {
			match: (context) => D.collectDefNames(context)
				.some((name) => trimStr(D.resolveContainer(name, context)?.$display?.wrapper) === WRAPPER_NAME),
			format: (value, context = {}) => {
				let container = null;
				for (const defName of D.collectDefNames(context)) {
					const found = D.resolveContainer(defName, context);
					if (found) {
						container = found;
						break;
					}
				}
				if (!container) return '';
				return D.joinByArrayLayout(value, container, (fitem) => formatKeyedDialogueItem(fitem, context));
			}
		});
	}

	root.KeyedDialogueRenderer = {
		WRAPPER_NAME,
		formatKeyedDialogueItem,
		isKeyedDialogueListType,
		buildKeyLabel,
	};
})();
