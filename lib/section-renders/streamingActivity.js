/**
 * [streamingActivity.js] - StreamingActivity 専用セクションレンダラー
 *
 * `streamingActivitySection` として登録し、配信活動情報を他の standalone subField と
 * 同じ構成（親ラベルタグ → 子ラベルタグ + 本文ブロックの縦積み）で表示する。
 * 汎用 `structuredObjectSection`（`pages/characters.js` の `buildObjectChildBlocks`）や
 * `thisMastersSection` / `appearanceDetailSection` と DOM 構成を揃えるのが目的で、
 * 本レンダラーが独自に担うのは「bilingual wrapper 子フィールドの JP/EN 2 列表示」だけ。
 *
 * `$display.sectionWrapper: "streamingActivitySection"` が指定されたフィールドに適用される。
 * `$display.langMode: "jp"` を持つ bilingual wrapper 子フィールド（例: ListenerNickname）では、
 * `_enrichment.bilingualWrapperFields` メタを参照して JP/EN 2 列レイアウトで表示する。
 *
 * @author 100BeautiesLab.
 * @version 2.0.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	/** standalone subField 共通のブロック余白（`buildObjectChildBlocks` と同値） */
	const BLOCK_STYLE = 'margin-bottom: 10px;';
	/** standalone subField 共通のラベルタグ余白（`buildObjectChildBlocks` と同値） */
	const LABEL_STYLE = 'margin-bottom: 6px;';

	registry.registerSectionRenderer('streamingActivitySection', {
		/**
		 * `$display.sectionWrapper: "streamingActivitySection"` を持つ平 object フィールドに一致する。
		 * rendererMap は sectionWrapper 名で直接引くため、この match は保険として機能する。
		 */
		match: (context) => {
			const item = context?.item;
			if (!item?.value || typeof item.value !== 'object' || Array.isArray(item.value)) return false;
			const display = context?.display ?? item?.display ?? {};
			return display?.sectionWrapper === 'streamingActivitySection';
		},

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				isEmptyValueLoose,
				pickSchemaPath,
				pickSchemaType,
				pickSchemaDisplay,
				getFieldLabel,
				formatValueForDisplay,
				wrapStandaloneSection,
				isPlainObject,
				getCurrentPageLanguage,
				preWrapText,
				bilingualColumnsText,
				resolveBilingualWrapperMeta
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (typeof el !== 'function' || typeof wrapStandaloneSection !== 'function') return null;
			if (!isPlainObject?.(item?.value)) return null;

			const pageLang = getCurrentPageLanguage?.() ?? 'jp';

			/**
			 * 子フィールド 1 件分のブロックを作る（他の subField と同じ「ラベルタグ + 本文」構成）
			 * @param {string} label
			 * @param {Node|null} bodyNode
			 * @returns {Node|null}
			 */
			const createLabeledBlock = (label, bodyNode) => {
				if (!label || !bodyNode) return null;
				return el('div', { style: BLOCK_STYLE }, [
					el('div', { class: 'tag', style: LABEL_STYLE }, [label]),
					bodyNode
				]);
			};

			/**
			 * bilingual wrapper 子フィールドを JP/EN 2 列ノードへ変換する
			 * （2 列にできる値が無ければ null を返し、汎用整形へフォールバックする）
			 * @param {string} childKey
			 * @param {any} childValue
			 * @param {string} schemaPath
			 * @returns {Node|null}
			 */
			const buildBilingualColumns = (childKey, childValue, schemaPath) => {
				const bilingualMeta = resolveBilingualWrapperMeta?.(`${item.key}.${childKey}`) ?? null;
				if (!bilingualMeta || !isPlainObject?.(childValue)) return null;
				if (typeof bilingualColumnsText !== 'function') return null;

				const keys = Object.keys(childValue);
				const jpKey = keys.find((key) => key.endsWith('_JP')) || '';
				const enKey = keys.find((key) => key.endsWith('_EN')) || '';
				if (!jpKey && !enKey) return null;

				const jpSchemaPath = jpKey ? `${schemaPath}.${jpKey}` : '';
				const enSchemaPath = enKey ? `${schemaPath}.${enKey}` : '';
				const effectiveType = (typeof bilingualMeta.effectiveBaseType === 'string' && bilingualMeta.effectiveBaseType)
					? bilingualMeta.effectiveBaseType
					: null;
				const jpValue = jpKey ? formatValueForDisplay?.(childValue[jpKey], fieldLabelMap, metaForLookup, globalDefType, {
					schemaType: effectiveType ?? pickSchemaType?.(jpSchemaPath),
					display: pickSchemaDisplay?.(jpSchemaPath, schemaPath, item.key),
					fieldKey: jpSchemaPath || schemaPath
				}) : '';
				const enValue = enKey ? formatValueForDisplay?.(childValue[enKey], fieldLabelMap, metaForLookup, globalDefType, {
					schemaType: effectiveType ?? pickSchemaType?.(enSchemaPath),
					display: pickSchemaDisplay?.(enSchemaPath, schemaPath, item.key),
					fieldKey: enSchemaPath || schemaPath
				}) : '';

				const jpText = String(jpValue ?? '').trim();
				const enText = String(enValue ?? '').trim();
				if (!jpText && !enText) return null;

				return bilingualColumnsText(jpText, enText);
			};

			const blocks = [];

			Object.entries(item.value).forEach(([k, v]) => {
				if (!k || typeof k !== 'string' || k.startsWith('_')) return;
				if (isEmptyValueLoose?.(v)) return;
				// 言語フィルタ: JP モードは _EN を、EN モードは _JP を非表示
				if (pageLang === 'jp' && k.endsWith('_EN')) return;
				if (pageLang === 'en' && k.endsWith('_JP')) return;

				const fallbackPath = `${item.key}.${k}`;
				const schemaPath = pickSchemaPath?.([fallbackPath], fallbackPath) ?? fallbackPath;
				const fieldLabel = String(
					getFieldLabel?.(schemaPath, fieldLabelMap, metaForLookup, globalDefType, k) ?? k
				).trim();
				if (!fieldLabel) return;

				// bilingual wrapper（例: StreamingActivity.ListenerNickname）は JP/EN 2 列で表示する
				let bodyNode = buildBilingualColumns(k, v, schemaPath);

				if (!bodyNode) {
					const displayValue = formatValueForDisplay?.(v, fieldLabelMap, metaForLookup, globalDefType, {
						schemaType: pickSchemaType?.(schemaPath),
						display: pickSchemaDisplay?.(schemaPath, item.key),
						fieldKey: schemaPath
					});
					const dv = String(displayValue ?? '').trim();
					if (!dv) return;
					// `#Summary` も配列系も改行保持の同一ルートへ寄せる（field 名の分岐は持たない）
					bodyNode = (typeof preWrapText === 'function') ? preWrapText(dv) : el('div', {}, [dv]);
				}

				const block = createLabeledBlock(fieldLabel, bodyNode);
				if (block) blocks.push(block);
			});

			if (!blocks.length) return null;

			const outerBlock = el('div', { style: BLOCK_STYLE }, [
				el('div', { class: 'tag', style: LABEL_STYLE }, [item.label]),
				el('div', {}, blocks)
			]);

			return wrapStandaloneSection(item, [outerBlock]);
		}
	});
})();
