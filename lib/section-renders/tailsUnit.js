/**
 * [tailsUnit.js] - TailsUnit（$Def_TailsUnit）専用の value wrapper / セクションレンダラー
 *
 * `TailsUnit` フィールド（`$Def_TailsUnit[]|#Null`）を、汎用の `AppearanceDetail` カタログとは
 * 独立した専用の構造化型として扱う。
 * - `tailsUnitSummary`（`CharacterValueWrapperRegistry`）: `$Def_TailsUnit` 単体を
 *   「キツネ型: 4本」/ "Fox type: 4 tails" のような一行サマリーへ整形する。
 * - `tailsUnitSection`（`CharacterSectionRendererRegistry`）: `TailsUnit[]` 配列全体を
 *   標準セクションとして描画する（形状・本数・節数・分岐方向・分岐内訳・補足を1エントリずつブロック表示）。
 *
 * dict 解決の方針は `lib/section-renders/appearanceDetail.js` と同様、
 * `$EnumDef_TailShapeType` / `$EnumDef_Laterality` をグローバル/作品ローカルでマージして直参照する。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterValueWrapperRegistry (wrapper-common.js), CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const wrapperRegistry = globalThis.CharacterValueWrapperRegistry;
	const sectionRegistry = globalThis.CharacterSectionRendererRegistry;
	if (!wrapperRegistry?.registerWrapper || !sectionRegistry?.registerSectionRenderer) return;

	/**
	 * グローバルと作品ローカルの `$EnumDef_*` をマージして返す。
	 * ローカルが存在すればグローバルへ追加・上書きする形とする。
	 * @param {object} varsDef - 作品ローカルの $VarsDef
	 * @param {object} globalVarsDef - グローバルの $VarsDef
	 * @param {string} enumDefKey - '$EnumDef_TailShapeType' 等
	 * @returns {object|null}
	 */
	function getMergedEnumDef(varsDef, globalVarsDef, enumDefKey) {
		const local = varsDef?.[enumDefKey];
		const global = globalVarsDef?.[enumDefKey];
		if (!local && !global) return null;
		if (!local || typeof local !== 'object' || Array.isArray(local)) return global || null;
		if (!global || typeof global !== 'object' || Array.isArray(global)) return local;
		return { ...global, ...local };
	}

	/**
	 * `#TailShapeType_Fox` 等の hash キーを `$EnumDef_*` から解決してラベルを返す。
	 * @param {string} rawValue
	 * @param {object} varsDef
	 * @param {object} globalVarsDef
	 * @param {string} enumDefKey
	 * @param {string} fieldBase - 'TailShapeType' / 'Laterality' 等
	 * @param {string} lang - 'jp' | 'en'
	 * @returns {string}
	 */
	function resolveFromEnumDef(rawValue, varsDef, globalVarsDef, enumDefKey, fieldBase, lang) {
		if (!rawValue) return '';
		const enumDef = getMergedEnumDef(varsDef, globalVarsDef, enumDefKey);
		if (enumDef && typeof enumDef === 'object' && !Array.isArray(enumDef)) {
			const entry = Object.prototype.hasOwnProperty.call(enumDef, rawValue)
				? enumDef[rawValue]
				: Object.values(enumDef).find((e) => e && e[fieldBase] === rawValue);
			if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
				return lang === 'en'
					? (entry[`${fieldBase}_EN`] || entry[`${fieldBase}_JP`] || String(rawValue).trim())
					: (entry[`${fieldBase}_JP`] || entry[`${fieldBase}_EN`] || String(rawValue).trim());
			}
		}
		return String(rawValue).trim();
	}

	/**
	 * typeSources（複数の typedef コンテナ候補）から $VarsDef / グローバル $VarsDef を取り出す。
	 * @param {object} context
	 * @returns {{varsDef: object, globalVarsDef: object}}
	 */
	function pickVarsDefs(context) {
		const varsDef = context?.workMeta?.General?.$VarsDef || {};
		const globalVarsDef = context?.globalDefType?.General?.$VarsDef || {};
		return { varsDef, globalVarsDef };
	}

	/**
	 * `Branches[]` の1件を「上: 2本×3束」/ "upper: 2 tails x3 clusters" 形式の文字列へ整形する。
	 * @param {object} branch
	 * @param {object} varsDef
	 * @param {object} globalVarsDef
	 * @param {string} lang
	 * @returns {string}
	 */
	function formatBranch(branch, varsDef, globalVarsDef, lang) {
		if (!branch || typeof branch !== 'object') return '';
		const latLabel = branch.Laterality
			? resolveFromEnumDef(branch.Laterality, varsDef, globalVarsDef, '$EnumDef_Laterality', 'Laterality', lang)
			: '';
		const tail = branch.TailCount;
		const cluster = branch.ClusterCount;
		if (tail == null || cluster == null) return '';
		const pair = lang === 'en' ? `${tail} tails x${cluster} clusters` : `${tail}本×${cluster}束`;
		return latLabel ? `${latLabel}: ${pair}` : pair;
	}

	/**
	 * `LayoutDirection`（`{LayoutFrom, LayoutTo}`）を「上から下に向かって」/ "From Upper to Lower" 形式へ整形する。
	 * @param {object} layoutDirection
	 * @param {object} varsDef
	 * @param {object} globalVarsDef
	 * @param {string} lang
	 * @returns {string}
	 */
	function formatLayoutDirection(layoutDirection, varsDef, globalVarsDef, lang) {
		if (!layoutDirection || typeof layoutDirection !== 'object') return '';
		const fromLabel = resolveFromEnumDef(layoutDirection.LayoutFrom, varsDef, globalVarsDef, '$EnumDef_Laterality', 'Laterality', lang);
		const toLabel = resolveFromEnumDef(layoutDirection.LayoutTo, varsDef, globalVarsDef, '$EnumDef_Laterality', 'Laterality', lang);
		if (!fromLabel || !toLabel) return '';
		return lang === 'en' ? `From ${fromLabel} to ${toLabel}` : `${fromLabel}から${toLabel}に向かって`;
	}

	/**
	 * `$Def_TailsUnit` 単体オブジェクトを一行サマリー文字列へ整形する。
	 * @param {object} value
	 * @param {object} context
	 * @returns {string}
	 */
	function formatTailsUnitSummary(value, context) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
		const lang = String(context?.pageLang || 'jp');
		const { varsDef, globalVarsDef } = pickVarsDefs(context);

		const shapeLabel = resolveFromEnumDef(value.TailShapeType, varsDef, globalVarsDef, '$EnumDef_TailShapeType', 'TailShapeType', lang);
		if (!shapeLabel) return '';

		const parts = [lang === 'en' ? `${shapeLabel}: ${value.Count} tails` : `${shapeLabel}: ${value.Count}本`];

		if (value.Segment != null) {
			parts.push(lang === 'en' ? `(${value.Segment} segments)` : `(${value.Segment}節)`);
		}
		// 方向句（LayoutDirection）は Branch内訳と同じ括弧内へ、区切り文字（JP:「、」/ EN:", "）でまとめる
		// 例: "(上から下に向かって、上: 1本×3束, ...)" / "(From Upper to Lower, Upper: 1 tails x3 clusters, ...)"
		const directionText = formatLayoutDirection(value.LayoutDirection, varsDef, globalVarsDef, lang);
		if (Array.isArray(value.Branches) && value.Branches.length) {
			const branchTexts = value.Branches
				.map((b) => formatBranch(b, varsDef, globalVarsDef, lang))
				.filter(Boolean);
			if (branchTexts.length) {
				const groupSegments = directionText ? [directionText, branchTexts.join(', ')] : [branchTexts.join(', ')];
				const groupSep = lang === 'en' ? ', ' : '、';
				parts.push(`(${groupSegments.join(groupSep)})`);
			}
		}

		return parts.join(' ');
	}

	wrapperRegistry.registerWrapper('tailsUnitSummary', {
		match: (context) => wrapperRegistry.helpers?.schemaTypeIncludes?.(context?.schemaType, '$Def_TailsUnit'),
		format: formatTailsUnitSummary
	});

	sectionRegistry.registerSectionRenderer('tailsUnitSection', {
		match: (context) => {
			const display = context?.display ?? context?.item?.display ?? {};
			return display?.sectionWrapper === 'tailsUnitSection';
		},

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				isEmptyValueLoose,
				wrapStandaloneSection,
				getCurrentPageLanguage,
				preWrapText,
				isPlainObject,
				buildTailsUnitImageUrl,
				createGalleryImageItem
			} = context.helpers || {};
			const { workMeta: metaForLookup, globalDefType } = context;

			const rawValue = item?.value;
			if (rawValue == null || isEmptyValueLoose?.(rawValue)) return null;

			const tailsItems = Array.isArray(rawValue)
				? rawValue
				: isPlainObject?.(rawValue)
					? [rawValue]
					: null;
			if (!tailsItems?.length) return null;

			const lang = getCurrentPageLanguage ? getCurrentPageLanguage() : 'jp';
			const varsDef = metaForLookup?.General?.$VarsDef || {};
			const globalVarsDef = globalDefType?.General?.$VarsDef || {};

			// TailsUnit_PNGName の格納先は $subfolder（スキーマ宣言）を正とする
			const tailsUnitTypeSources = [metaForLookup, globalDefType].filter(Boolean);
			const tailsUnitDefEntries = wrapperRegistry.helpers?.resolveTypeDefEntries?.(tailsUnitTypeSources, '$Def_TailsUnit') || [];
			const imgFieldDef = tailsUnitDefEntries.find((e) => e?.hashTag === 'TailsUnit_PNGName');
			const imgSubfolder = typeof imgFieldDef?.$subfolder === 'string' ? imgFieldDef.$subfolder.trim() : '';

			const entryNodes = [];
			for (const t of tailsItems) {
				if (!isPlainObject?.(t)) continue;

				const shapeLabel = resolveFromEnumDef(t.TailShapeType, varsDef, globalVarsDef, '$EnumDef_TailShapeType', 'TailShapeType', lang);
				if (!shapeLabel) continue;

				const headerTags = [el('div', { class: 'tag' }, [shapeLabel])];

				const rows = [];
				rows.push(el('div', { class: 'tailsunit__attr-row' }, [
					lang === 'en' ? `Count: ${t.Count}` : `本数: ${t.Count}`
				]));
				if (t.Segment != null) {
					rows.push(el('div', { class: 'tailsunit__attr-row' }, [
						lang === 'en' ? `Segment: ${t.Segment}` : `節数: ${t.Segment}`
					]));
				}
				const directionText = formatLayoutDirection(t.LayoutDirection, varsDef, globalVarsDef, lang);
				if (directionText) {
					rows.push(el('div', { class: 'tailsunit__attr-row' }, [directionText]));
				}
				if (Array.isArray(t.Branches)) {
					for (const b of t.Branches) {
						const branchText = formatBranch(b, varsDef, globalVarsDef, lang);
						if (branchText) rows.push(el('div', { class: 'tailsunit__attr-row' }, [branchText]));
					}
				}

				const note = lang === 'en' ? (t.Note_EN || t.Note_JP) : (t.Note_JP || t.Note_EN);
				const noteText = note ? String(note).trim() : '';
				const noteNode = noteText
					? el('div', { class: 'tailsunit__note' }, [preWrapText ? preWrapText(noteText) : noteText])
					: null;

				const imgFileName = typeof t.TailsUnit_PNGName === 'string' ? t.TailsUnit_PNGName.trim() : '';
				let imageNode = null;
				if (imgFileName && buildTailsUnitImageUrl && createGalleryImageItem) {
					const imageUrl = buildTailsUnitImageUrl(imgFileName, imgSubfolder);
					if (imageUrl) {
						const altText = lang === 'en'
							? `Branch layout reference - ${shapeLabel}`
							: `${shapeLabel} 分岐配置の参考画像`;
						// レイアウト（幅・余白）は SASS 側の共通クラス（.subfield-entry__reference-image）で制御する
						imageNode = el('div', { class: 'tailsunit__reference-image subfield-entry__reference-image' }, [
							createGalleryImageItem({ url: imageUrl, alt: altText, caption: '' })
						]);
					}
				}

				// テキスト情報（ヘッダー/属性/ノート）を左カラムにまとめ、参考画像を右隣に小さく並べる
				// （SASS: subFields 系共通の .subfield-entry / __main / __reference-image）
				const mainChildren = [
					el('div', {
						class: 'tailsunit__entry-header',
						style: 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;'
					}, headerTags),
					el('div', { class: 'tailsunit__attrs', style: 'padding-left: 4px;' }, rows),
					noteNode
				].filter(Boolean);

				const children = [
					el('div', { class: 'tailsunit__entry-main subfield-entry__main' }, mainChildren),
					imageNode
				].filter(Boolean);

				entryNodes.push(el('div', { class: 'tailsunit__entry subfield-entry' }, children));
			}

			if (!entryNodes.length) return null;

			const outerBlock = el('div', { style: 'margin-bottom: 10px;' }, entryNodes);
			return wrapStandaloneSection(item, [outerBlock]);
		}
	});
})();
