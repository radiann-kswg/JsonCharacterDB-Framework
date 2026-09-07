/**
 * 値整形ラッパー共通レジストリ
 *
 * UI / Service Worker の双方から利用できる、特殊 summary formatter の登録基盤です。
 * JSON 側へ任意コードを持ち込まず、schema で宣言した型に対して既知の formatter を割り当てます。
 *
 * @fileoverview Day / Era / StoryEra などの特殊整形を shared 層で扱う registry
 * @author 100BeautiesLab Creations Database Team
 * @version 1.0.0
 */

(function initializeCharacterValueWrapperRegistry(root) {
	const globalObject = root || globalThis;
	if (globalObject.CharacterValueWrapperRegistry) return;

	const wrapperMap = new Map();

	function isPlainObject(value) {
		return value && typeof value === 'object' && !Array.isArray(value);
	}

	function splitSchemaTypeTokens(schemaType) {
		if (Array.isArray(schemaType)) return [];
		return String(schemaType || '')
			.split('|')
			.map((token) => token.trim())
			.filter(Boolean);
	}

	function schemaTypeIncludes(schemaType, token) {
		return splitSchemaTypeTokens(schemaType).includes(String(token || '').trim());
	}

	function uniqueTypeSources(typeSources) {
		if (!Array.isArray(typeSources)) return [];
		return typeSources.filter((source, index, list) => source && list.indexOf(source) === index);
	}

	function resolveTypeDefContainer(typeSources, defName) {
		const name = String(defName || '').trim();
		if (!name) return null;

		const sources = uniqueTypeSources(typeSources);
		for (const source of sources) {
			const metaContainer = source?.$MetaType?.[name];
			if (isPlainObject(metaContainer)) return metaContainer;

			const generalVarsContainer = source?.General?.$VarsDef?.[name];
			if (isPlainObject(generalVarsContainer)) return generalVarsContainer;

			const varsContainer = source?.$VarsDef?.[name];
			if (isPlainObject(varsContainer)) return varsContainer;
		}

		return null;
	}

	function resolveTypeDefEntries(typeSources, defName) {
		return resolveTypeDefContainer(typeSources, defName)?.$DefType || [];
	}

	function getRoleEntries(typeSources, defName, role) {
		const targetRole = String(role || '').trim();
		if (!targetRole) return [];

		return resolveTypeDefEntries(typeSources, defName).filter((entry) => {
			const entryRole = entry?.$display?.role;
			return typeof entryRole === 'string' && entryRole.trim() === targetRole;
		});
	}

	function getRoleRawValues(objectValue, typeSources, defName, role) {
		if (!isPlainObject(objectValue)) return [];
		return getRoleEntries(typeSources, defName, role)
			.map((entry) => objectValue?.[entry?.hashTag])
			.filter((raw) => raw !== undefined && raw !== null && raw !== '');
	}

	function pickRoleRawValue(objectValue, typeSources, defName, role) {
		return getRoleRawValues(objectValue, typeSources, defName, role)[0];
	}

	function pickAboutText(raw) {
		if (raw == null) return '';
		if (isPlainObject(raw)) {
			if (typeof raw.hideText === 'string' && raw.hideText.trim()) return raw.hideText.trim();
			return '';
		}
		return String(raw).trim();
	}

	function formatEraSummary(point, context) {
		if (!isPlainObject(point)) return '';

		const typeSources = context?.typeSources || [];
		const _eraLang = String(context?.pageLang || 'jp');
		// EN モードは Alt（EN 側）のロールを優先して引く
		const about = pickAboutText(
			_eraLang === 'en'
				? (pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'pointLabelAlt')
					?? pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'pointLabel')
					?? point.about_EN ?? point.about_JP ?? point.about)
				: (pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'pointLabel')
					?? pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'pointLabelAlt')
					?? point.about_JP ?? point.about_EN ?? point.about)
		);
		if (about) return about;

		const eraGeneration = pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'eraGeneration') ?? point.EraGen;
		const eraYear = pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'eraYear') ?? point.YearInEra;
		const realYear = pickRoleRawValue(point, typeSources, '$Def_StoryEra', 'realYear') ?? point.byRealYear;

		const eraText = [];
		if (eraGeneration !== null && eraGeneration !== undefined && eraGeneration !== '') {
			eraText.push(_eraLang === 'en' ? `Gen.${String(eraGeneration).trim()}` : `第${String(eraGeneration).trim()}創世紀`);
		}
		if (eraYear !== null && eraYear !== undefined && eraYear !== '') {
			eraText.push(_eraLang === 'en' ? `Year ${String(eraYear).trim()}` : `${String(eraYear).trim()}年`);
		}

		const realYearText = (realYear !== null && realYear !== undefined && realYear !== '')
			? (_eraLang === 'en' ? `${String(realYear).trim()} CE` : `西暦${String(realYear).trim()}年`)
			: '';
		const primaryText = eraText.join(_eraLang === 'en' ? ' ' : '');

		if (primaryText && realYearText) return `${primaryText} / ${realYearText}`;
		return primaryText || realYearText;
	}

	function formatEraSummaryList(points, context) {
		if (!Array.isArray(points)) return '';
		return points.map((point) => formatEraSummary(point, context)).filter(Boolean).join(' / ');
	}

	function formatStoryEraCatalog(value, context) {
		if (!isPlainObject(value)) return '';

		const typeSources = context?.typeSources || [];
		const _eraLang = String(context?.pageLang || 'jp');
		// EN モードは Alt（EN 側）のロールを優先して引く
		const about = pickAboutText(
			_eraLang === 'en'
				? (pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'preferredLabelAlt')
					?? pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'preferredLabel')
					?? value.about_EN ?? value.about_JP ?? value.about)
				: (pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'preferredLabel')
					?? pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'preferredLabelAlt')
					?? value.about_JP ?? value.about_EN ?? value.about)
		);
		if (about) return about;

		const representativePoint = formatEraSummaryList(
			pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'representativePoint') ?? value.InEra,
			context
		);
		if (representativePoint) return representativePoint;

		const fromEra = formatEraSummaryList(
			pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'rangeStart') ?? value.FromEra,
			context
		);
		const toEra = formatEraSummaryList(
			pickRoleRawValue(value, typeSources, '$Def_StoryEraCatalog', 'rangeEnd') ?? value.ToEra,
			context
		);

		if (fromEra && toEra) return _eraLang === 'en' ? `From: ${fromEra} / To: ${toEra}` : `開始: ${fromEra} / 終了: ${toEra}`;
		if (fromEra) return _eraLang === 'en' ? `From: ${fromEra}` : `開始: ${fromEra}`;
		if (toEra) return _eraLang === 'en' ? `To: ${toEra}` : `終了: ${toEra}`;
		return '';
	}

	function formatDaySummary(value, context) {
		if (!isPlainObject(value)) return '';
		const _dayLang = String(context?.pageLang || 'jp');

		const typeSources = context?.typeSources || [];
		const dayValue = isPlainObject(value.Day) ? value.Day : value;
		const rawMonth = pickRoleRawValue(dayValue, typeSources, '$Def_Day', 'month') ?? dayValue.Month;
		const rawDayOfMonth = pickRoleRawValue(dayValue, typeSources, '$Def_Day', 'dayOfMonth') ?? dayValue.DayOfMonth;
		const month = rawMonth != null ? String(rawMonth).trim() : '';
		const dayOfMonth = rawDayOfMonth != null ? String(rawDayOfMonth).trim() : '';

		const dayContainer = resolveTypeDefContainer(typeSources, '$Def_Day');
		const monthList = Array.isArray(dayContainer?.['#List_Month']) ? dayContainer['#List_Month'] : [];
		const monthDef = monthList.find((entry) => {
			const m = entry?.Month;
			return m != null && String(m).trim() === month;
		}) || null;

		const monthNum = Number(month);
		const fallbackMonthEn = (Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12)
			? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthNum - 1]
			: '';
		const monthEn = (() => {
			const candidate = monthDef?.Month_EN;
			if (candidate != null && String(candidate).trim()) return String(candidate).trim();
			if (fallbackMonthEn) return fallbackMonthEn;
			if (month) return month;
			return '';
		})();

		const jpDate = (month && dayOfMonth) ? `${month}月${dayOfMonth}日` : (month || dayOfMonth);
		const enDate = (monthEn && dayOfMonth) ? `${monthEn}.${dayOfMonth}` : (monthEn || dayOfMonth);
		const dateText = _dayLang === 'en' ? enDate : jpDate;
		// EN モードは annotationAlt（DayAbout_EN 対応ロール）を先に引く
		const aboutValue = _dayLang === 'en'
			? (pickRoleRawValue(value, typeSources, '$Def_Day', 'annotationAlt')
				?? pickRoleRawValue(value, typeSources, '$Def_Day', 'annotation')
				?? value.DayAbout_EN ?? value.DayAbout_JP
				?? value.about_EN ?? value.about_JP ?? value.about)
			: (pickRoleRawValue(value, typeSources, '$Def_Day', 'annotation')
				?? pickRoleRawValue(value, typeSources, '$Def_Day', 'annotationAlt')
				?? value.DayAbout_JP ?? value.DayAbout_EN
				?? value.about_JP ?? value.about_EN ?? value.about);
		const aboutText = pickAboutText(aboutValue);

		if (dateText && aboutText) return `${dateText}（${aboutText}）`;
		return dateText;
	}

	function resolveWrapperName(context = {}) {
		const explicitName = String(context?.wrapperName || '').trim();
		if (explicitName) return explicitName;

		const defNames = [];
		const contextDefName = String(context?.defName || '').trim();
		if (contextDefName) defNames.push(contextDefName);

		for (const token of splitSchemaTypeTokens(context?.schemaType)) {
			if (token.startsWith('$Def_')) defNames.push(token);
		}

		const typeSources = context?.typeSources || [];
		const uniqueDefNames = defNames.filter((name, index, list) => name && list.indexOf(name) === index);
		for (const defName of uniqueDefNames) {
			const wrapperName = resolveTypeDefContainer(typeSources, defName)?.$display?.wrapper;
			if (typeof wrapperName === 'string' && wrapperName.trim()) return wrapperName.trim();
		}

		return '';
	}

	function registerWrapper(name, definition) {
		const wrapperName = String(name || '').trim();
		if (!wrapperName) throw new Error('Wrapper name is required');
		if (!definition || typeof definition.format !== 'function') {
			throw new Error(`Wrapper "${wrapperName}" requires a format function`);
		}

		wrapperMap.set(wrapperName, {
			name: wrapperName,
			match: typeof definition.match === 'function' ? definition.match : null,
			format: definition.format
		});
		return wrapperMap.get(wrapperName);
	}

	function getWrapper(name) {
		return wrapperMap.get(String(name || '').trim()) || null;
	}

	function getRegisteredWrappers() {
		return Array.from(wrapperMap.values()).map((wrapper) => ({
			name: wrapper.name,
			hasMatcher: typeof wrapper.match === 'function'
		}));
	}

	function findMatchingWrapper(context = {}) {
		const resolvedWrapperName = resolveWrapperName(context);
		if (resolvedWrapperName) return getWrapper(resolvedWrapperName);

		for (const wrapper of wrapperMap.values()) {
			if (typeof wrapper.match !== 'function') continue;
			if (wrapper.match(context)) return wrapper;
		}
		return null;
	}

	function formatWithRegisteredWrapper(value, context = {}) {
		const wrapper = findMatchingWrapper(context);
		if (!wrapper || typeof wrapper.format !== 'function') return '';

		/**
		 * Wrapper handler signature:
		 * - value: formatting target
		 * - context.schemaType / context.defName: declared type information
		 * - context.typeSources: merged typedef containers used for role / wrapper resolution
		 * - context.helpers: shared helper set for role lookup and text normalization
		 * Returns a non-empty string to take over formatting, otherwise caller falls back.
		 */
		const formatted = wrapper.format(value, {
			...context,
			helpers: {
				isPlainObject,
				splitSchemaTypeTokens,
				schemaTypeIncludes,
				resolveTypeDefContainer,
				resolveTypeDefEntries,
				getRoleEntries,
				getRoleRawValues,
				pickRoleRawValue,
				pickAboutText
			}
		});

		return typeof formatted === 'string' ? formatted : '';
	}

	registerWrapper('storyEraSummary', {
		match: (context) => schemaTypeIncludes(context?.schemaType, '$Def_StoryEraCatalog'),
		format: formatStoryEraCatalog
	});

	registerWrapper('eraSummary', {
		match: (context) => schemaTypeIncludes(context?.schemaType, '$Def_StoryEra'),
		format: formatEraSummary
	});

	registerWrapper('daySummary', {
		match: (context) => schemaTypeIncludes(context?.schemaType, '$Def_Day'),
		format: formatDaySummary
	});

	globalObject.CharacterValueWrapperRegistry = {
		registerWrapper,
		getWrapper,
		getRegisteredWrappers,
		resolveWrapperName,
		findMatchingWrapper,
		formatWithRegisteredWrapper,
		helpers: {
			isPlainObject,
			splitSchemaTypeTokens,
			schemaTypeIncludes,
			resolveTypeDefContainer,
			resolveTypeDefEntries,
			getRoleEntries,
			getRoleRawValues,
			pickRoleRawValue,
			pickAboutText
		}
	};
})(typeof globalThis !== 'undefined' ? globalThis : self);
