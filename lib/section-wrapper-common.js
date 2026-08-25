/**
 * subFields 用セクションレンダラー共通レジストリ
 *
 * `pages/characters.js` などから利用する、standalone section 描画用の registry です。
 * 値整形専用の `wrapper-common.js` とは分離し、subField ごとの独自描画ディスパッチだけを担います。
 *
 * @fileoverview subFields standalone section renderer registry
 * @author 100BeautiesLab Creations Database Team
 * @version 1.0.0
 */

(function initializeCharacterSectionRendererRegistry(root) {
	const globalObject = root || globalThis;
	if (globalObject.CharacterSectionRendererRegistry) return;

	const rendererMap = new Map();

	function isPlainObject(value) {
		return value && typeof value === 'object' && !Array.isArray(value);
	}

	/**
	 * section renderer 名を context から解決する
	 *
	 * schema の `$display.sectionWrapper` と呼び出し側の明示指定の両方を受け付け、
	 * `pages/characters.js` などの main code から renderer 名の決定責務を外す。
	 *
	 * @param {Object} context
	 * @returns {string}
	 */
	function resolveSectionRendererName(context = {}) {
		const explicitName = String(
			context?.sectionRendererName
			|| context?.rendererName
			|| context?.wrapperName
			|| ''
		).trim();
		if (explicitName) return explicitName;

		const displayName = String(
			context?.display?.sectionWrapper
			|| context?.schemaDisplay?.sectionWrapper
			|| context?.item?.display?.sectionWrapper
			|| ''
		).trim();
		if (displayName) return displayName;

		return '';
	}

	/**
	 * schemaType ツリー内に指定トークンが含まれるかを判定する
	 *
	 * relation comment のように object / array / `$type` ネストを含む schema でも
	 * `#Dialogue` などの表示ヒントを拾えるようにする shared helper。
	 *
	 * @param {*} t
	 * @param {string} needle
	 * @param {number} depth
	 * @returns {boolean}
	 */
	function schemaTypeIncludes(t, needle, depth = 0) {
		if (!needle) return false;
		if (depth > 6) return false;
		if (t === null || t === undefined) return false;
		if (typeof t === 'string') return t.includes(needle);
		if (Array.isArray(t)) return t.some((entry) => schemaTypeIncludes(entry, needle, depth + 1));
		if (typeof t === 'object') {
			if (Object.prototype.hasOwnProperty.call(t, '$type')) {
				return schemaTypeIncludes(t.$type, needle, depth + 1);
			}
			return Object.values(t).some((entry) => schemaTypeIncludes(entry, needle, depth + 1));
		}
		return false;
	}

	/**
	 * section renderer を共通 context 付きで呼び出す
	 *
	 * registry 側で `helpers.isPlainObject` を必ず注入し、呼び出し側が追加した helper を
	 * そのまま上乗せする。built-in / custom renderer の双方で同じ呼び出し形を維持するための薄い adapter。
	 *
	 * @param {{render?: Function}|null} renderer
	 * @param {Object} item
	 * @param {Object} context
	 * @returns {*}
	 */
	function callSectionRenderer(renderer, item, context = {}) {
		if (!renderer || typeof renderer.render !== 'function') return null;

		return renderer.render(item, {
			...context,
			item,
			helpers: {
				isPlainObject,
				...(context?.helpers && typeof context.helpers === 'object' ? context.helpers : {})
			}
		}) ?? null;
	}

	/**
	 * section renderer を登録する
	 * @param {string} name
	 * @param {{match?: Function, render: Function}} definition
	 * @returns {{name: string, match: (Function|null), render: Function}}
	 */
	function registerSectionRenderer(name, definition) {
		const rendererName = String(name || '').trim();
		if (!rendererName) throw new Error('Section renderer name is required');
		if (!definition || typeof definition.render !== 'function') {
			throw new Error(`Section renderer "${rendererName}" requires a render function`);
		}

		rendererMap.set(rendererName, {
			name: rendererName,
			match: typeof definition.match === 'function' ? definition.match : null,
			render: definition.render
		});
		return rendererMap.get(rendererName);
	}

	/**
	 * 登録済み renderer を名前で取得する
	 * @param {string} name
	 * @returns {{name: string, match: (Function|null), render: Function}|null}
	 */
	function getSectionRenderer(name) {
		return rendererMap.get(String(name || '').trim()) || null;
	}

	/**
	 * 登録済み renderer のメタ情報一覧を返す
	 * @returns {{name: string, hasMatcher: boolean}[]}
	 */
	function getRegisteredSectionRenderers() {
		return Array.from(rendererMap.values()).map((renderer) => ({
			name: renderer.name,
			hasMatcher: typeof renderer.match === 'function'
		}));
	}

	/**
	 * context から最適な section renderer を探す
	 *
	 * 明示名があればそれを優先し、無ければ `match()` を持つ renderer を順に評価する。
	 *
	 * @param {Object} context
	 * @returns {{name: string, match: (Function|null), render: Function}|null}
	 */
	function findMatchingSectionRenderer(context = {}) {
		const resolvedName = resolveSectionRendererName(context);
		if (resolvedName) return getSectionRenderer(resolvedName);

		for (const renderer of rendererMap.values()) {
			if (typeof renderer.match !== 'function') continue;
			if (renderer.match(context)) return renderer;
		}
		return null;
	}

	/**
	 * 名前指定で built-in / custom section renderer を明示的に実行する
	 *
	 * main code 側で「subField matcher ではなく、この renderer を再利用したい」ケース用の API。
	 * 例: top-level `Relation` を standalone subField 以外からも同じ built-in renderer で描画する。
	 *
	 * @param {string} name
	 * @param {Object} item
	 * @param {Object} context
	 * @returns {*}
	 */
	function renderNamedSectionRenderer(name, item, context = {}) {
		return callSectionRenderer(getSectionRenderer(name), item, context);
	}

	/**
	 * context から renderer を自動解決して実行する
	 * @param {Object} item
	 * @param {Object} context
	 * @returns {*}
	 */
	function renderWithRegisteredSectionRenderer(item, context = {}) {
		const renderer = findMatchingSectionRenderer({ ...context, item });
		return callSectionRenderer(renderer, item, context);
	}

	// plain object な subField を generic structured section へ流す built-in renderer
	// *_DBLink フィールドは suffix-based な dbLinkSection が担当するため除外する
	registerSectionRenderer('structuredObjectSection', {
		match: (context) => (
			isPlainObject(context?.item?.value)
			&& !/^.+_DBLink$/.test(String(context?.item?.key || ''))
			&& typeof context?.helpers?.renderStructuredObjectSection === 'function'
		),
		render: (item, context) => context.helpers.renderStructuredObjectSection(item, context)
	});

	// relationSection / statsSection / thisMastersSection は lib/section-renders/ に移動済み
	// characters.js が import したタイミングで登録される

	globalObject.CharacterSectionRendererRegistry = {
		registerSectionRenderer,
		getSectionRenderer,
		getRegisteredSectionRenderers,
		resolveSectionRendererName,
		findMatchingSectionRenderer,
		renderNamedSectionRenderer,
		renderWithRegisteredSectionRenderer,
		helpers: {
			isPlainObject,
			schemaTypeIncludes
		}
	};
})(typeof globalThis !== 'undefined' ? globalThis : self);
