/**
 * @fileoverview *Calling_JP / *Calling_EN フィールド専用セクションレンダラー
 *
 * ThirdPersonCalling / FirstPersonCalling / SecondPersonCalling / ForMasterCalling /
 * For79thDealerCalling / For80thDealerCalling 等、`[A-Za-z]Calling` サフィックスを持つ
 * フィールドを対象とし、呼称 DSL を人間が読みやすい形式に展開して描画する。
 *
 * 解析ロジック（デリミタ階層 `\n` > `;` > `/` `,`・`*xxx` こそあど記法・`[※]`/`[*]` 参照記法の展開）は
 * `lib/basic-renders/calling-common.js` の純関数 `parseCalling()` に委譲し、本ファイルはそのトークン
 * モデルを DOM へ描画することに専念する。これにより UI / Service Worker / pkg(Node) /
 * ロールプレイプロンプト生成ツールが同一のデコードを共用する。
 *
 * - $display.section: 'sub' で sub バケットに流れ、standalone section として描画される
 * - 展開仕様は docs/localization-en-rules.md §4 準拠
 *
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js), CallingCommon (basic-renders/calling-common.js)
 */

(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	/**
	 * 属性値が undefined / null / '' の場合は付与しないようにする el ラッパー。
	 * @param {Function} elFn
	 * @param {string} tag
	 * @param {Object} attrs
	 * @param {Node[]|string[]} children
	 * @returns {Node}
	 */
	function make(elFn, tag, attrs, children) {
		const clean = {};
		for (const [k, v] of Object.entries(attrs || {})) {
			if (v !== undefined && v !== null && v !== '') clean[k] = v;
		}
		return elFn(tag, clean, children || []);
	}

	/**
	 * token モデル配列（`CallingCommon.parseCategory` の結果）を DOM span 配列へ描画する。
	 * token の raw と text が異なる場合は元表記を title 属性に残し、代替候補セパレータ（`/` `,`）は
	 * `calling-sep-alt` span として維持する。
	 * @param {Array<{text:string, raw:string, type:string, sepAfter:string|null}>} tokens
	 * @param {Function} elFn - context.helpers.el
	 * @returns {Node[]}
	 */
	function renderTokenNodes(tokens, elFn) {
		const nodes = [];
		for (const tok of tokens || []) {
			const attrs = { class: `calling-tok calling-tok--${tok.type}` };
			if (tok.raw !== tok.text) attrs.title = tok.raw;
			nodes.push(elFn('span', attrs, [tok.text]));
			if (tok.sepAfter) {
				nodes.push(elFn('span', { class: 'calling-sep-alt', 'aria-hidden': 'true' }, [tok.sepAfter]));
			}
		}
		return nodes;
	}

	registry.registerSectionRenderer('callingSection', {
		/**
		 * `*Calling_JP` / `*Calling_EN` サフィックス（または base キー）を持つ文字列値フィールドを
		 * 自動検出する。$display.section: 'sub' との組み合わせで standalone subField として描画される。
		 * @param {Object} ctx
		 */
		match: (ctx) =>
			/[A-Za-z]Calling(?:_(?:JP|EN))?$/.test(String(ctx?.item?.key || ''))
			&& typeof ctx?.item?.value === 'string'
			&& ctx.item.value.trim() !== '',

		/**
		 * @param {Object} item
		 * @param {Object} context
		 * @returns {Node|null}
		 */
		render: (item, context) => {
			const { el, preWrapText, wrapStandaloneSection, getCurrentPageLanguage } = context.helpers || {};
			if (!el || !item?.value || typeof item.value !== 'string') return null;

			const rawValue = item.value.trim();
			if (!rawValue) return null;

			// キー suffix（_JP/_EN）またはページ言語からパース対象言語を決定
			const keySuffix = String(item.key || '');
			const pageLang = getCurrentPageLanguage ? getCurrentPageLanguage() : '';
			const isJP = keySuffix.endsWith('_JP') || (pageLang === 'jp' && !keySuffix.endsWith('_EN'));

			const CallingCommon = globalThis.CallingCommon;

			// 言語が特定できない（base キーで lang='' の場合）、または純パーサ未ロード時は
			// プレーンテキストにフォールバックする（従来挙動を維持）
			const langUnresolved = !keySuffix.endsWith('_JP') && !keySuffix.endsWith('_EN') && pageLang === '';
			if (langUnresolved || !CallingCommon?.parseCalling) {
				const fallbackEl = preWrapText ? preWrapText(rawValue) : el('span', {}, [rawValue]);
				const valueEl = make(el, 'div', { class: 'calling-value' }, [
					make(el, 'div', { class: 'calling-ctx' }, [fallbackEl]),
				]);
				return wrapStandaloneSection
					? wrapStandaloneSection(item, [valueEl])
					: make(el, 'div', { class: 'section' }, [
						make(el, 'h3', {}, [item.label || keySuffix]),
						valueEl,
					]);
			}

			// 純パーサでトークンモデルへ解析し、DOM を描画する
			const parsed = CallingCommon.parseCalling(rawValue, { lang: isJP ? 'jp' : 'en' });

			const ctxEls = parsed.contexts
				.map((ctx) => {
					// ; でカテゴリに分割してノードを生成
					const catNodes = [];
					ctx.categories.forEach((cat, ci) => {
						const tokNodes = renderTokenNodes(cat.tokens, el);
						if (!tokNodes.length) return;
						catNodes.push(make(el, 'span', { class: 'calling-cat' }, tokNodes));
						// カテゴリ間セパレータ（最後以外）
						if (ci < ctx.categories.length - 1) {
							catNodes.push(make(el, 'span', { class: 'calling-sep-cat', 'aria-hidden': 'true' }, ['·']));
						}
					});
					if (!catNodes.length) return null;

					if (ctx.note) {
						return make(el, 'div', { class: 'calling-ctx calling-ctx--labeled' }, [
							make(el, 'span', { class: 'calling-ctx-label' }, [`※${ctx.note}`]),
							make(el, 'span', { class: 'calling-ctx-cats' }, catNodes),
						]);
					}
					return make(el, 'div', { class: 'calling-ctx' }, catNodes);
				})
				.filter(Boolean);

			if (!ctxEls.length) return null;

			const valueEl = make(el, 'div', { class: 'calling-value' }, ctxEls);

			if (context?.isStandaloneSubField === true && typeof wrapStandaloneSection === 'function') {
				return wrapStandaloneSection(item, [valueEl]);
			}

			if (context?.wrapInSection === false) return valueEl;

			return make(el, 'div', { class: 'section' }, [
				make(el, 'h3', {}, [item.label || String(item.key || '')]),
				valueEl,
			]);
		},
	});
})();
