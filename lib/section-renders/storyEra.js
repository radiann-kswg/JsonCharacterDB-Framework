/**
 * [storyEra.js] - StoryEra 専用セクションレンダラー
 *
 * `storyEraSection` として登録し、`$Def_StoryEraCatalog` 型の年代情報をレイアウトで表示する。
 * - FromEra / ToEra / InEra → 年代タグ（`formatValueForDisplay` で $Def_StoryEra として整形）
 * - StoryEraAbout_JP / EN → グリッド下部のプロズブロック
 *
 * `$display.sectionWrapper: "storyEraSection"` が指定されたフィールドに適用される。
 * 主な適用先: `$Def_DatabaseCatalog.$DefType[StoryEra]` / `$Def_SecondaryMeta.$DefType[StoryEra]`
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	/**
	 * 表示対象の年代範囲フィールド定義。
	 * 代表年代（InEra）→ 開始/終了（FromEra/ToEra）の優先順で表示する。
	 */
	const ERA_RANGE_FIELDS = [
		{ key: 'InEra', fallbackLabelJP: '代表年代', fallbackLabelEN: 'Representative Era' },
		{ key: 'FromEra', fallbackLabelJP: '開始年代', fallbackLabelEN: 'From Era' },
		{ key: 'ToEra', fallbackLabelJP: '終了年代', fallbackLabelEN: 'To Era' }
	];

	registry.registerSectionRenderer('storyEraSection', {
		/**
		 * `$display.sectionWrapper: "storyEraSection"` を持つフィールドに一致する。
		 * rendererMap は sectionWrapper 名で直接引くため、この match は保険として機能する。
		 */
		match: (context) => {
			const display = context?.display ?? context?.item?.display ?? {};
			return display?.sectionWrapper === 'storyEraSection';
		},

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				isEmptyValueLoose,
				getFieldLabel,
				formatValueForDisplay,
				createDetailTagGrid,
				wrapStandaloneSection,
				isPlainObject,
				getCurrentPageLanguage,
				preWrapText
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!isPlainObject?.(item?.value)) return null;

			const pageLang = getCurrentPageLanguage?.() ?? 'jp';
			const value = item.value;

			const tagNodes = [];

			for (const { key, fallbackLabelJP, fallbackLabelEN } of ERA_RANGE_FIELDS) {
				const raw = value[key];
				if (isEmptyValueLoose?.(raw)) continue;

				// FromEra / ToEra / InEra は $Def_StoryEra[] — 配列でない場合も正規化
				const points = Array.isArray(raw) ? raw : [raw];
				const formattedParts = points
					.map((pt) =>
						formatValueForDisplay?.(pt, fieldLabelMap, metaForLookup, globalDefType, {
							schemaType: '$Def_StoryEra',
							fieldKey: key
						})
					)
					.filter(Boolean)
					.join(' / ');

				if (!formattedParts) continue;

				const fieldLabel =
					getFieldLabel?.(
						`${item.key}.${key}`,
						fieldLabelMap,
						metaForLookup,
						globalDefType,
						key
					) ?? (pageLang === 'en' ? fallbackLabelEN : fallbackLabelJP);

				tagNodes.push(el?.('div', { class: 'tag' }, [`${fieldLabel}: ${formattedParts}`]) ?? null);
			}

			// StoryEraAbout_JP / EN → プロズブロック
			const aboutKey = pageLang === 'en' ? 'StoryEraAbout_EN' : 'StoryEraAbout_JP';
			const aboutAltKey = pageLang === 'en' ? 'StoryEraAbout_JP' : 'StoryEraAbout_EN';
			const aboutRaw = value[aboutKey] ?? value[aboutAltKey];

			const summaryBlocks = [];
			if (aboutRaw && !isEmptyValueLoose?.(aboutRaw)) {
				const aboutText =
					typeof aboutRaw === 'string'
						? aboutRaw.trim()
						: isPlainObject?.(aboutRaw)
							? (String(aboutRaw.hideText ?? '')).trim()
							: String(aboutRaw).trim();

				if (aboutText) {
					const fieldLabel =
						getFieldLabel?.(
							`${item.key}.${aboutKey}`,
							fieldLabelMap,
							metaForLookup,
							globalDefType,
							aboutKey
						) ?? (pageLang === 'en' ? 'Era Summary' : '年代概要');
					summaryBlocks.push({ label: fieldLabel, value: aboutText });
				}
			}

			const children = [];

			const validTags = tagNodes.filter(Boolean);
			if (validTags.length > 0) {
				children.push(createDetailTagGrid?.(validTags) ?? null);
			}

			summaryBlocks.forEach(({ label, value: dv }) => {
				const labelEl = el?.('p', { class: 'detail-prose__label' }, [label]);
				const bodyEl = preWrapText
					? preWrapText(dv)
					: el?.('p', { class: 'detail-prose__body' }, [dv]);
				if (labelEl || bodyEl) {
					children.push(
						el?.('div', { class: 'detail-prose' }, [labelEl, bodyEl].filter(Boolean)) ?? null
					);
				}
			});

			const filtered = children.filter(Boolean);
			if (!filtered.length) return null;
			return wrapStandaloneSection?.(item, filtered) ?? null;
		}
	});
})();
