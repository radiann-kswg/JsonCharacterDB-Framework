/**
 * @fileoverview ColorPalette ($Def_ColorPalette[]) 専用セクションレンダラー。
 *
 * 配色エントリを「色見本 + 役割 + HEX + 適用部位」のカードとして描画する。
 * `CharacterSectionRendererRegistry` に `colorPaletteSection` を登録し、
 * `ColorPalette` キー（または `$Def_ColorPalette` 型）を自動マッチさせる。
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

	const normalizeHexColor = (hex) => {
		const raw = String(hex || '').trim();
		if (!HEX_PATTERN.test(raw)) return null;
		if (raw.length === 4) {
			const r = raw[1];
			const g = raw[2];
			const b = raw[3];
			return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
		}
		return raw.toUpperCase();
	};

	const getReadableTextColor = (hex) => {
		const normalized = normalizeHexColor(hex);
		if (!normalized) return '#F8FAFC';
		const r = Number.parseInt(normalized.slice(1, 3), 16);
		const g = Number.parseInt(normalized.slice(3, 5), 16);
		const b = Number.parseInt(normalized.slice(5, 7), 16);
		const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
		return luminance >= 160 ? '#0F172A' : '#F8FAFC';
	};

	registry.registerSectionRenderer('colorPaletteSection', {
		match: (context) => {
			const key = String(context?.item?.key || '').trim();
			const type = String(context?.item?.type || '').trim();
			return Array.isArray(context?.item?.value) && (key === 'ColorPalette' || type.includes('$Def_ColorPalette'));
		},

		render: (item, context) => {
			const {
				el,
				preWrapText,
				isPlainObject,
				wrapStandaloneSection,
				createDetailTagGrid,
				formatValueForDisplay,
				pickSchemaType,
				pickSchemaDisplay,
				isEmptyValueLoose,
				getCurrentPageLanguage,
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!el || !wrapStandaloneSection || !Array.isArray(item?.value) || item.value.length === 0) return null;
			const basePath = String(item.key || 'ColorPalette');
			const lang = getCurrentPageLanguage ? getCurrentPageLanguage() : 'jp';

			const varsDef = (metaForLookup?.General && typeof metaForLookup.General === 'object' && metaForLookup.General.$VarsDef)
				? metaForLookup.General.$VarsDef
				: {};
			const globalVarsDef = (globalDefType?.General && typeof globalDefType.General === 'object' && globalDefType.General.$VarsDef)
				? globalDefType.General.$VarsDef
				: {};

			const getMergedEnumDef = (enumDefKey) => {
				const local = varsDef?.[enumDefKey];
				const global = globalVarsDef?.[enumDefKey];
				if (!local && !global) return null;
				if (!local || typeof local !== 'object' || Array.isArray(local)) return global || null;
				if (!global || typeof global !== 'object' || Array.isArray(global)) return local;
				return { ...global, ...local };
			};

			const resolveFromEnumDef = (rawValue, enumDefKey, fieldBase) => {
				const raw = String(rawValue || '').trim();
				if (!raw) return '';

				const enumDef = getMergedEnumDef(enumDefKey);
				if (!enumDef || typeof enumDef !== 'object' || Array.isArray(enumDef)) return raw;

				const entry = Object.prototype.hasOwnProperty.call(enumDef, raw)
					? enumDef[raw]
					: Object.values(enumDef).find((itemDef) => itemDef && itemDef[fieldBase] === raw);

				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return raw;

				if (lang === 'en') {
					return String(entry[`${fieldBase}_EN`] || entry[`${fieldBase}_JP`] || entry[fieldBase] || raw).trim();
				}
				return String(entry[`${fieldBase}_JP`] || entry[fieldBase] || entry[`${fieldBase}_EN`] || raw).trim();
			};

			const resolveRoleLabel = (rawValue) => resolveFromEnumDef(rawValue, '$EnumDef_ColorRole', 'ColorRole');
			const resolveBodyPartLabel = (rawValue) => resolveFromEnumDef(rawValue, '$EnumDef_DesignBodyPart', 'BodyPart');

			const formatByPath = (raw, path, fallbackType = null) => {
				if (isEmptyValueLoose?.(raw)) return '';
				return String(formatValueForDisplay?.(raw, fieldLabelMap, metaForLookup, globalDefType, {
					schemaType: pickSchemaType?.(path) || fallbackType,
					display: pickSchemaDisplay?.(path),
					fieldKey: path,
					recordContext: context?.recordContext || null,
				}) || '').trim();
			};

			const cards = item.value
				.filter((entry) => isPlainObject?.(entry))
				.map((entry, index) => {
					const roleText = resolveRoleLabel(entry.Role)
						|| formatByPath(entry.Role, `${basePath}.Role`, '#ListIndex')
						|| `Color ${index + 1}`;
					const hexRaw = String(entry.Hex || '').trim();
					const hexText = HEX_PATTERN.test(hexRaw) ? hexRaw.toUpperCase() : hexRaw;
					const swatchColor = HEX_PATTERN.test(hexRaw) ? hexRaw : '#808080';
					const hexTextColor = getReadableTextColor(swatchColor);
					const colorName = lang === 'en'
						? (String(entry.ColorName_EN || entry.ColorName_JP || '').trim())
						: (String(entry.ColorName_JP || entry.ColorName_EN || '').trim());
					const appliesTo = Array.isArray(entry.AppliesTo)
						? entry.AppliesTo
							.map((value) => resolveBodyPartLabel(value) || formatByPath(value, `${basePath}.AppliesTo`, '#ListIndex'))
							.filter(Boolean)
						: [];
					const formationText = formatByPath(entry.Formation, `${basePath}.Formation`, '#DictIndex');
					const noteText = lang === 'en'
						? String(entry.Note_EN || entry.Note_JP || '').trim()
						: String(entry.Note_JP || entry.Note_EN || '').trim();

					const detailTags = [];
					if (hexText) {
						detailTags.push(el('span', {
							class: 'tag',
							style: `background:${swatchColor}; color:${hexTextColor}; border:1px solid rgba(15,23,42,0.35); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); font-weight:700; letter-spacing:0.02em;`
						}, [hexText]));
					}
					if (colorName) detailTags.push(el('span', { class: 'tag' }, [colorName]));
					if (formationText) detailTags.push(el('span', { class: 'tag' }, [formationText]));
					if (appliesTo.length) {
						detailTags.push(el('span', { class: 'tag' }, [
							`${lang === 'en' ? 'Applies To' : '適用部位'}: ${appliesTo.join('・')}`
						]));
					}

					return el('div', {
						style: 'border:1px solid var(--border); border-radius:10px; padding:10px; background:rgba(255,255,255,0.02);'
					}, [
						el('div', {
							style: 'display:flex; align-items:center; gap:10px; margin-bottom:8px;'
						}, [
							el('span', {
								style: `display:inline-block; width:18px; height:18px; border-radius:999px; border:1px solid rgba(255,255,255,0.35); background:${swatchColor}; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25);`
							}),
							el('strong', {}, [roleText]),
						]),
						detailTags.length ? createDetailTagGrid(detailTags) : null,
						noteText
							? el('div', { style: 'margin-top:8px;' }, [
								preWrapText ? preWrapText(noteText) : noteText
							])
							: null
					]);
				})
				.filter(Boolean);

			if (!cards.length) return null;

			return wrapStandaloneSection(item, [
				createDetailTagGrid ? createDetailTagGrid(cards) : el('div', {}, cards)
			]);
		}
	});
})();
