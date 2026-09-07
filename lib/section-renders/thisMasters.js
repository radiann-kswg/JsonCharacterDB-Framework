/**
 * ThisMasters ($Def_ThisMastersEntry[]) 専用セクションレンダラー。
 * characters.js から import されると CharacterSectionRendererRegistry に 'thisMastersSection' を登録する。
 * 描画に必要なユーティリティはすべて context.helpers / context から受け取る。
 * entry に _DBLink がある場合、about タグをリンク化して参照キャラクターのページへ遷移できるようにする。
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	/** セッション内フェッチキャッシュ（workId|dbName → Promise） */
	const _fetchCache = new Map();

	/**
	 * worksTitle → '#Works_XXX' 形式に正規化
	 * @param {string} title
	 * @returns {string}
	 */
	function normalizeWorkKey(title) {
		const s = String(title || '').trim();
		if (!s) return '';
		if (s.startsWith('#Works_')) return s;
		if (s.startsWith('Works_')) return `#${s}`;
		return `#Works_${s}`;
	}

	/** $Def_DBLinkRef 形式でインデックス以外のフィールドを識別するセンチネルキーセット */
	const SENTINEL_KEYS = new Set(['_DB', '_Work', 'label_JP', 'label_EN']);

	/**
	 * ネストオブジェクト内で最初の数値サブフィールドを探す。なければ空でない文字列フィールドを使う。
	 * @param {Object} obj @returns {{ subKey: string, subValue: string }|null}
	 */
	function findSubKeyForHref(obj) {
		if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
		for (const k of Object.keys(obj)) {
			if (typeof obj[k] === 'number') return { subKey: k, subValue: String(obj[k]) };
		}
		for (const k of Object.keys(obj)) {
			if (typeof obj[k] === 'string' && obj[k] !== '') return { subKey: k, subValue: obj[k] };
		}
		return null;
	}

	/**
	 * ネストインデックスの subset match（idxRaw の全キーが recordVal に存在して値一致するか）。
	 * @param {*} recordVal @param {Object} idxRaw @returns {boolean}
	 */
	function isSubsetMatch(recordVal, idxRaw) {
		if (recordVal == null || idxRaw == null) return false;
		if (typeof recordVal !== 'object' || typeof idxRaw !== 'object') return false;
		return Object.keys(idxRaw).every((k) => {
			const rv = recordVal[k];
			const qv = idxRaw[k];
			if (typeof qv === 'object' && qv !== null) return isSubsetMatch(rv, qv);
			return String(rv) === String(qv);
		});
	}

	/**
	 * entry._DBLink（$Def_DBLinkRef 形式）に基づき参照先キャラクターを非同期解決してリンク化する。
	 * - _Work: 参照先ワーク（省略時は現在ワーク）
	 * - _DB: 参照先DB（必須）
	 * - 非センチネル最初のキー: インデックスキー（スカラー/ネストオブジェクト対応）
	 * @param {HTMLAnchorElement} anchorEl @param {Object} dbLink @param {Object} relationApi
	 */
	function hydrateThisMastersLink(anchorEl, dbLink, relationApi) {
		if (!dbLink || typeof dbLink !== 'object') { anchorEl.removeAttribute('href'); return; }

		const targetWorkRaw = typeof dbLink._Work === 'string' ? dbLink._Work.trim() : '';
		const targetDB = typeof dbLink._DB === 'string' ? dbLink._DB.trim() : '';
		if (!targetDB) { anchorEl.removeAttribute('href'); return; }

		let idxKey = null;
		let idxRaw;
		for (const k of Object.keys(dbLink)) {
			if (SENTINEL_KEYS.has(k)) continue;
			idxKey = k;
			idxRaw = dbLink[k];
			break;
		}
		if (!idxKey || idxRaw == null) { anchorEl.removeAttribute('href'); return; }

		const state = relationApi.getCharState?.() || {};
		const currentWorkId = String(state?.workId || '').trim();
		const targetWorkId = targetWorkRaw ? normalizeWorkKey(targetWorkRaw) : currentWorkId;

		const cacheKey = `${targetWorkId}|${targetDB}`;
		let fetchPromise = _fetchCache.get(cacheKey);
		if (!fetchPromise) {
			fetchPromise = Promise.resolve()
				.then(() => relationApi.fetchDbRecords(targetWorkId, targetDB))
				.then((result) => {
					const all = Array.isArray(result) ? result : (result && Array.isArray(result.records) ? result.records : []);
					return all.filter((r) => r != null && !r.isPrivate);
				})
				.catch(() => []);
			_fetchCache.set(cacheKey, fetchPromise);
		}

		const isNested = typeof idxRaw === 'object' && !Array.isArray(idxRaw);

		fetchPromise.then((records) => {
			const found = isNested
				? records.find((r) => r != null && isSubsetMatch(r[idxKey], idxRaw))
				: records.find((r) => r != null && String(r[idxKey]) === String(idxRaw));

			if (!found) { anchorEl.removeAttribute('href'); return; }

			let idxKeyPath, idxValue;
			if (isNested) {
				const sub = findSubKeyForHref(idxRaw);
				if (!sub) { anchorEl.removeAttribute('href'); return; }
				idxKeyPath = `${idxKey}.${sub.subKey}`;
				idxValue = sub.subValue;
			} else {
				idxKeyPath = idxKey;
				idxValue = String(idxRaw);
			}

			const href = relationApi.buildViewerNavigationHref?.(targetWorkId, targetDB, {
				idx: idxValue, idxKey: idxKeyPath, num: idxValue
			});
			if (!href) { anchorEl.removeAttribute('href'); return; }

			anchorEl.href = href;
			if (typeof relationApi.openViewerNavigation === 'function') {
				anchorEl.onclick = async (e) => {
					try { e.preventDefault(); } catch (_) {}
					await relationApi.openViewerNavigation(targetWorkId, targetDB, {
						idx: idxValue, idxKey: idxKeyPath, num: idxValue
					});
				};
			}
		}).catch(() => {});
	}

	registry.registerSectionRenderer('thisMastersSection', {
		match: (context) => (
			Array.isArray(context?.item?.value)
			&& String(context?.item?.type || '').includes('$Def_ThisMastersEntry')
		),
		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				preWrapText,
				isPlainObject,
				wrapStandaloneSection,
				getCurrentPageLanguage,
				relationApi
			} = context.helpers || {};

			if (!el || !wrapStandaloneSection || !item?.value?.length) return null;

			const lang = getCurrentPageLanguage ? getCurrentPageLanguage() : 'jp';
			const canLink = relationApi
				&& typeof relationApi.fetchDbRecords === 'function'
				&& typeof relationApi.buildViewerNavigationHref === 'function';

			/** about フィールドが string / {hideText} オブジェクト のどちらでも文字列に変換する */
			const resolveText = (raw) => {
				if (!raw && raw !== 0) return '';
				if (typeof raw === 'string') return raw;
				if (isPlainObject?.(raw) && raw.hideText != null) return String(raw.hideText);
				return String(raw);
			};

			const blocks = item.value
				.map((entry) => {
					if (!isPlainObject?.(entry)) return null;

					const valueKey = lang === 'en' ? 'value_EN' : 'value_JP';
					const aboutKey = lang === 'en' ? 'about_EN' : 'about_JP';

					// 指定言語フィールド未設定の場合は反対言語にフォールバック
					const rawValue = (entry[valueKey] !== undefined && entry[valueKey] !== null)
						? entry[valueKey]
						: (lang === 'en' ? entry['value_JP'] : (entry['value_EN'] ?? null));
					const rawAbout = (entry[aboutKey] !== undefined && entry[aboutKey] !== null)
						? entry[aboutKey]
						: (lang === 'en' ? entry['about_JP'] : (entry['about_EN'] ?? null));

					const aboutText = resolveText(rawAbout);
					const valueText = rawValue != null ? String(rawValue).trim() : '';

					if (!valueText && !aboutText) return null;

					// _DBLink がある場合は value テキストをリンク化して参照キャラクターページへ遷移可能にする
					const hasDbLink = canLink && isPlainObject?.(entry._DBLink);

					// about が null で value のみの場合（専属契約不可 など）
					if (!aboutText) {
						if (hasDbLink) {
							const valueNode = el('a', { href: '#' }, [valueText]);
							hydrateThisMastersLink(valueNode, entry._DBLink, relationApi);
							return el('div', { style: 'margin-bottom: 10px;' }, [valueNode]);
						}
						return el('div', { style: 'margin-bottom: 10px;' }, [preWrapText(valueText)]);
					}

					let valueNode = null;
					if (valueText) {
						if (hasDbLink) {
							valueNode = el('a', { href: '#' }, [valueText]);
							hydrateThisMastersLink(valueNode, entry._DBLink, relationApi);
						} else {
							valueNode = preWrapText(valueText);
						}
					}

					return el('div', { style: 'margin-bottom: 10px;' }, [
						el('div', { class: 'tag', style: 'margin-bottom: 6px;' }, [aboutText]),
						valueNode
					].filter(Boolean));
				})
				.filter(Boolean);

			if (!blocks.length) return null;

			const outerBlock = el('div', { style: 'margin-bottom: 10px;' }, [
				el('div', { class: 'tag', style: 'margin-bottom: 6px;' }, [item.label]),
				el('div', {}, blocks)
			]);

			return wrapStandaloneSection(item, [outerBlock]);
		}
	});
})();
