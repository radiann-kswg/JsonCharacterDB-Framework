/**
 * @fileoverview Relation section renderer
 *
 * `Relation` / `RelationTo_{DBName}` フィールドの描画を担当する。
 * - `Relation`: 同DB内キャラクターとの関係（getCharState().records から解決）
 * - `RelationTo_{DBName}`: 同作品内の他DBキャラクターとの関係（SW fetch + DOM 非同期ハイドレーション）
 *
 * このモジュールは lib/section-wrapper-common.js が初期化した後に import することで、
 * `relationSection` renderer を上書き登録する。
 */

(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	/** @param {*} value */
	function isPlainObject(value) {
		return value !== null && typeof value === 'object' && !Array.isArray(value);
	}

	/**
	 * pageLang に応じてレコード表示名を選択する
	 * - JP表示時は Name_JP 系を優先
	 * - EN表示時は Name_EN 系を優先
	 * - 旧データ互換で Name / ModelName もフォールバックに含める
	 * @param {Object} record
	 * @param {string} pageLang
	 * @returns {string}
	 */
	function pickRelationRecordName(record, pageLang = 'jp') {
		if (!record || typeof record !== 'object') return '';
		const lang = String(pageLang || 'jp').trim().toLowerCase();
		const jpOrder = [
			record?.Name_JP,
			record?.FormalName_JP,
			record?.ModelName_JP,
			record?.Title_JP,
			record?.Term_JP,
			record?.Name,
			record?.FormalName,
			record?.ModelName,
			record?.Name_EN,
			record?.FormalName_EN,
			record?.ModelName_EN,
			record?.Title_EN,
			record?.Term_EN
		];
		const enOrder = [
			record?.Name_EN,
			record?.FormalName_EN,
			record?.ModelName_EN,
			record?.Title_EN,
			record?.Term_EN,
			record?.Name,
			record?.FormalName,
			record?.ModelName,
			record?.Name_JP,
			record?.FormalName_JP,
			record?.ModelName_JP,
			record?.Title_JP,
			record?.Term_JP
		];
		const picked = (lang === 'en' ? enOrder : jpOrder)
			.find((value) => typeof value === 'string' && value.trim());
		return String(picked || '').trim();
	}

	/**
	 * schemaType ツリー内に指定トークンが含まれるかを判定する
	 * @param {*} t @param {string} needle @param {number} depth
	 */
	function schemaTypeIncludes(t, needle, depth = 0) {
		if (!needle || depth > 6 || t === null || t === undefined) return false;
		if (typeof t === 'string') return t.includes(needle);
		if (Array.isArray(t)) return t.some((e) => schemaTypeIncludes(e, needle, depth + 1));
		if (typeof t === 'object') {
			if (Object.prototype.hasOwnProperty.call(t, '$type')) return schemaTypeIncludes(t.$type, needle, depth + 1);
			return Object.values(t).some((e) => schemaTypeIncludes(e, needle, depth + 1));
		}
		return false;
	}

	/**
	 * RelationLabel 入力値から辞書参照用コードを取り出す
	 * @param {*} value @returns {string}
	 */
	function pickRelationLabelCode(value) {
		if (value === null || value === undefined) return '';
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
		if (!isPlainObject(value)) return '';
		const jp = value.RelationLabel_JP || value.relationLabel_JP;
		const raw = value.RelationLabel || value.relationLabel;
		const en = value.RelationLabel_EN || value.relationLabel_EN;
		const picked = (typeof jp === 'string' && jp.trim()) ? jp
			: (typeof raw === 'string' && raw.trim()) ? raw
			: (typeof en === 'string' && en.trim()) ? en : '';
		return String(picked || '').trim();
	}

	/**
	 * RelationLabel 配列を varsdef と display 設定に従ってローカライズする
	 * @param {Array} labels @param {Object} context @param {Object} relationApi @param {string} containerKey
	 * @returns {string[]}
	 */
	function localizeRelationLabels(labels, context, relationApi, containerKey) {
		const pathKey = `${containerKey}.Related.RelationLabel`;
		const displayOpt = (context?.fieldDisplayMap && typeof context.fieldDisplayMap === 'object')
			? (context.fieldDisplayMap[pathKey] || context.fieldDisplayMap.RelationLabel || null)
			: null;
		const values = Array.isArray(labels) ? labels : [];
		return values
			.map((value) => {
				const raw = pickRelationLabelCode(value);
				if (!raw) return '';
				const pack = relationApi.resolveVarsDefLabelPack?.(
					'RelationLabel', raw, context?.globalDefType, context?.workMeta, pathKey
				);
				return relationApi.formatBilingualLabel?.(pack, raw, displayOpt) || raw;
			})
			.filter(Boolean);
	}

	/**
	 * Relation エントリの表示用インデックステキストを組み立てる
	 *
	 * 複合条件の `value` は JSON ペイロードになるため、そのままでは画面に出せない。
	 * クロスDB のハイドレーション待ち（プレースホルダ）や、参照先を解決できなかったときの
	 * フォールバック表示にはこちらを使う。
	 *
	 * `collectIndexEntries()` の並びは priority 順（主要サブフィールドが先頭）だが、
	 * 表示は typedef の宣言順（`Alphabet` → `AlphaGen`）のほうが読めるので index で並べ直す。
	 *
	 * @param {Array<Object>} entries - collectIndexEntries() のエントリ
	 * @returns {string} 例: `A2`（`Letter: { Alphabet: 'A', AlphaGen: 2 }`）
	 */
	function buildRelationIndexText(entries) {
		return (Array.isArray(entries) ? entries : [])
			.slice()
			.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0))
			.map((entry) => String(entry?.value || '').trim())
			.filter(Boolean)
			.join('');
	}

	/**
	 * Relation エントリから index 直リンク用 identifier を抽出する
	 *
	 * オブジェクト型 Index（`Letter: { Alphabet, AlphaGen }` 等）では、サブフィールドを 1 つだけ
	 * 選んでも参照先が一意にならない（`AlphaGen: 2` は A/I/O… すべての第2世代に当たってしまう）。
	 * そこで `collectIndexEntries()` + `buildIndexIdentifier()` を通し、エントリに書かれた
	 * サブフィールドをすべて含む複合条件（`__conditions__` + JSON）へ正規化して、
	 * `recordMatchesIndexQuery()` と直リンク（圧縮ロケータ）の subset match 経路へ合流させる。
	 *
	 * @param {Object} record - Relation の 1 エントリ（Index 部分だけを持つ疑似レコード）
	 * @param {Object|null} indexDef - 作品の `$IndexDef`
	 * @param {Object} relationApi - main code から渡される Index ヘルパー群
	 * @returns {{keyPath: string, value: string, text: string}|null}
	 */
	function getIndexIdentifierFromRelation(record, indexDef, relationApi) {
		if (!record || typeof record !== 'object') return null;
		if (!indexDef || typeof indexDef !== 'object') return null;
		const rootKey = (typeof indexDef.hashTag === 'string') ? indexDef.hashTag.trim() : '';
		if (!rootKey) return null;

		const subDefs = relationApi.getIndexSubDefs?.(indexDef) || [];
		const hasSubDefs = Array.isArray(subDefs) && subDefs.length > 0;

		if (typeof relationApi.collectIndexEntries === 'function'
			&& typeof relationApi.buildIndexIdentifier === 'function') {
			// オブジェクト型 Index は `context: 'value'`（`record[rootKey]` → `record` 自身の順で
			// フォールバック）を使い、root 付き・root 省略のどちらの書き方でも拾えるようにする。
			// スカラー型 Index は `context: 'record'`（`record.Num` フォールバック込み）で従来どおり。
			// エイリアス Index は参照先の特定に使わないので skipAliases で外す。
			const entries = (relationApi.collectIndexEntries(record, indexDef, null, null, {
				context: hasSubDefs ? 'value' : 'record',
				skipAliases: true
			}) || []).filter((entry) => !entry?.isNullKey && !entry?.isAlias
				&& String(entry?.keyPath || '').trim()
				&& String(entry?.value || '').trim())
				// collectIndexEntries() は priority 順（`#Number` サブフィールドが先頭）で返すが、
				// 直リンクは typedef の宣言順＝カテゴリキー先頭（`Alphabet:A,AlphaGen:2`）に揃える。
				// レコード側の getIndexIdentifierFromRecord() が出す形と一致させるため
				.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0));

			const identifier = relationApi.buildIndexIdentifier(entries, rootKey);
			if (identifier) {
				return {
					keyPath: String(identifier.keyPath || ''),
					value: String(identifier.value || ''),
					text: buildRelationIndexText(entries)
				};
			}
		}

		// Index ヘルパー未提供（旧 main code とのキャッシュ差分）向けの最小フォールバック。
		// 単一サブフィールドしか載せられないため一意にならないことがある点は許容する。
		if (hasSubDefs) {
			const rootObject = isPlainObject(record?.[rootKey]) ? record[rootKey] : record;
			if (!isPlainObject(rootObject)) return null;
			const primarySub = relationApi.pickPrimaryIndexSubDef?.(subDefs) || null;
			const candidates = primarySub ? [primarySub, ...subDefs.filter((e) => e !== primarySub)] : subDefs;
			for (const sub of candidates) {
				const subKey = sub?.hashTag;
				if (!subKey || typeof subKey !== 'string') continue;
				const rawValue = rootObject[subKey];
				if (rawValue === null || rawValue === undefined || rawValue === '') continue;
				const valueText = String(rawValue).trim();
				return { keyPath: `${rootKey}.${subKey}`, value: valueText, text: valueText };
			}
			return null;
		}
		const rawValue = (record?.[rootKey] === null || record?.[rootKey] === undefined || record?.[rootKey] === '')
			? record?.Num
			: record?.[rootKey];
		const valueText = (rawValue === null || rawValue === undefined) ? '' : String(rawValue).trim();
		if (!valueText) return null;
		return { keyPath: rootKey, value: valueText, text: valueText };
	}

	/**
	 * Relation comment を typedef-driven に整形する
	 * @param {*} commentsRaw @param {boolean} withLabels @param {Object} context @param {Object} relationApi @param {string} containerKey
	 * @returns {{text: string, node: (*|null), isDialogue: boolean}}
	 */
	function formatRelationComments(commentsRaw, withLabels, context, relationApi, containerKey) {
		if (commentsRaw === null || commentsRaw === undefined || commentsRaw === '') {
			return { text: '', node: null, isDialogue: false };
		}
		const pathKey = `${containerKey}.${withLabels ? 'Related' : 'Commented'}.Comments`;
		const schemaType = context?.fieldTypeMap?.[pathKey] ?? null;
		const displayOpt = (context?.fieldDisplayMap && typeof context.fieldDisplayMap === 'object')
			? (context.fieldDisplayMap[pathKey] || context.fieldDisplayMap.Comments || null)
			: null;
		const formatted = relationApi.formatValueForDisplay?.(
			commentsRaw, context?.fieldLabelMap, context?.workMeta, context?.globalDefType,
			{ schemaType, display: displayOpt, fieldKey: pathKey }
		);
		const text = String(formatted ?? commentsRaw ?? '').trim();
		const isDialogue = schemaTypeIncludes(schemaType, '#Dialogue');
		const node = (!text) ? null
			: (isDialogue || text.includes('\n'))
			? (relationApi.dialogueBodyText?.(text) ?? text)
			: text;
		return { text, node, isDialogue };
	}

	// RelationTo_{DBName} フェッチ結果のインメモリキャッシュ（セッション内）
	const _crossDbFetchCache = new Map();

	/**
	 * 関係セクションの本体レンダラー
	 *
	 * `Relation` / `RelationTo_{DBName}` のどちらでも扱える。
	 * `RelationTo_{DBName}` の場合は SW fetch で対象DB のレコードを取得し、
	 * キャラクター名をアンカー要素に非同期でハイドレーションする。
	 *
	 * @param {Object} item @param {Object} context @returns {*}
	 */
	function renderBuiltInRelationSection(item, context = {}) {
		const relationApi = context?.helpers?.relationApi;
		if (!relationApi || typeof relationApi.createElement !== 'function' || typeof relationApi.createDetailTagGrid !== 'function') {
			if (typeof context?.helpers?.renderRelationSection === 'function') {
				return context.helpers.renderRelationSection(item, context);
			}
			return null;
		}

		const containerKey = String(context?.containerKey || item?.key || 'Relation').trim() || 'Relation';
		const relationValue = isPlainObject(item?.value) ? item.value : {};
		const related = Array.isArray(relationValue.Related) ? relationValue.Related : [];
		const commented = Array.isArray(relationValue.Commented) ? relationValue.Commented : [];
		if (!related.length && !commented.length) return null;

		const state = relationApi.getCharState?.() || null;
		const workId = String(state?.workId || context?.workId || '').trim();
		const currentDb = String(state?.db || context?.dbName || '').trim();

		// `RelationTo_{DBName}` / `RelationOriginalTo_{DBName}` からターゲットDB名を抽出
		const relationToMatch = /^Relation(?:Original)?To_(.+)$/.exec(containerKey);
		const targetDbName = relationToMatch?.[1] ?? null;
		const relationTargetDb = targetDbName ?? currentDb;
		const isRelationToOtherDb = targetDbName !== null;

		const indexDef = workId ? relationApi.getWorkIndexField?.(workId, context?.workMeta) : null;

		const findRecordByIndex = (identifier) => {
			if (!identifier || typeof identifier !== 'object') return null;
			if (!state || !Array.isArray(state.records) || typeof relationApi.recordMatchesIndexQuery !== 'function') return null;
			const idxValue = String(identifier.value || '').trim();
			const idxKeyPath = String(identifier.keyPath || '').trim();
			if (!idxValue) return null;
			return state.records.find((record) => relationApi.recordMatchesIndexQuery(
				record, indexDef, idxValue, idxKeyPath, idxKeyPath === 'Num' ? idxValue : ''
			)) || null;
		};

		const buildIndexHref = (identifier, targetDb = currentDb) => relationApi.buildViewerNavigationHref?.(workId, targetDb, {
			idx: String(identifier?.value || ''),
			idxKey: String(identifier?.keyPath || ''),
			num: (identifier?.keyPath === 'Num') ? String(identifier?.value || '') : ''
		}) || '#';

		const hasNewline = (text) => (typeof text === 'string' && text.includes('\n'));
		const createElement = relationApi.createElement;

		/**
		 * 対象DBのレコード一覧を取得する（キャッシュ付き）
		 * @param {string} wId @param {string} dbName @returns {Promise<Array>}
		 */
		const fetchCrossDbRecords = async (wId, dbName) => {
			if (typeof relationApi.fetchDbRecords !== 'function') return [];
			const key = `${wId}|${dbName}`;
			if (_crossDbFetchCache.has(key)) return _crossDbFetchCache.get(key);
			const promise = Promise.resolve()
				.then(() => relationApi.fetchDbRecords(wId, dbName))
				.then((result) => {
					// SW レスポンスは { records: [...], ... } 形式 or 配列直接
					if (Array.isArray(result)) return result;
					if (result && Array.isArray(result.records)) return result.records;
					return [];
				})
				.catch(() => []);
			_crossDbFetchCache.set(key, promise);
			return promise;
		};

		/**
		 * DOM 要素に対してキャラクター名をハイドレーションする（非同期）
		 * @param {*} anchorEl @param {*} namePlaceholderEl @param {string} idxValue @param {string} keyPath @param {string} wId @param {string} dbName
		 */
		const hydrateCharacterName = (anchorEl, namePlaceholderEl, idxValue, keyPath, wId, dbName) => {
			fetchCrossDbRecords(wId, dbName).then((records) => {
				if (!Array.isArray(records)) return;
				const found = records.find((r) => relationApi.recordMatchesIndexQuery(
					r, indexDef, String(idxValue), keyPath, keyPath === 'Num' ? String(idxValue) : ''
				));
				const _hnLang = String(state?.pageLang || 'jp');
				if (!found) {
					// フォールバック: Num フィールドを直接比較
					// （複合条件は JSON ペイロードなので Num との単純比較は成立しない。除外する）
					const fallback = String(idxValue || '').trim()[0] === '{'
						? null
						: records.find((r) => r != null && String(r?.Num) === String(idxValue));
					if (fallback) {
						const name = pickRelationRecordName(fallback, _hnLang);
						if (name && namePlaceholderEl && typeof namePlaceholderEl.textContent === 'string') {
							namePlaceholderEl.textContent = name;
						}
						if (name && anchorEl && typeof anchorEl.title === 'string') {
							anchorEl.title = `開く: ${name}`;
						}
					}
					return;
				}
				const name = pickRelationRecordName(found, _hnLang);
				if (!name) return;
				// DOM 要素の場合のみ更新（テスト環境では skip）
				if (namePlaceholderEl && typeof namePlaceholderEl.textContent === 'string') {
					namePlaceholderEl.textContent = name;
				}
				if (anchorEl && typeof anchorEl.title === 'string') {
					anchorEl.title = `開く: ${name}`;
				}
			}).catch(() => {});
		};

		const renderRelationTag = (prefix, relationRecord, withLabels) => {
			const commentsText = (state?.pageLang === 'en' && relationRecord?.Comments_EN)
				? relationRecord.Comments_EN
				: relationRecord?.Comments;
			const comments = formatRelationComments(commentsText, withLabels, context, relationApi, containerKey);
			const labels = withLabels ? localizeRelationLabels(relationRecord?.RelationLabel, context, relationApi, containerKey) : [];
			const labelText = labels.length ? labels.join(', ') : '';

			const identifier = getIndexIdentifierFromRelation(relationRecord, indexDef, relationApi);
			const target = identifier && !isRelationToOtherDb ? findRecordByIndex(identifier) : null;
			const canNavigateCrossDb = isRelationToOtherDb && identifier && workId && relationTargetDb;
			const relationLang = String(state?.pageLang || 'jp');

			const children = [`${prefix} `];

			if ((identifier && target) || canNavigateCrossDb) {
				const name = pickRelationRecordName(target, relationLang);
				const idxValue = String(identifier?.value || '');
				const idxKey = String(identifier?.keyPath || '');
				// 複合条件では idxValue が JSON ペイロードになるため、画面表示には text を使う
				const idxText = String(identifier?.text || '') || idxValue;
				const targetDb = canNavigateCrossDb ? relationTargetDb : currentDb;

				const anchorProps = {
					href: buildIndexHref(identifier, targetDb),
					title: name ? `開く: ${name}` : (canNavigateCrossDb ? `${targetDbName} のキャラクターを開く` : '開く')
				};

				const canOpenDetail = target && typeof relationApi.openDetail === 'function';
				const canNavigate = (target || canNavigateCrossDb) && typeof relationApi.openViewerNavigation === 'function';
				if (canOpenDetail || canNavigate) {
					anchorProps.onclick = async (event) => {
						try { event.preventDefault(); } catch (_) { /* no-op */ }
						if (canOpenDetail) { await relationApi.openDetail(target); return; }
						if (canNavigate) {
							await relationApi.openViewerNavigation(workId, targetDb, {
								idx: idxValue, idxKey, num: idxKey === 'Num' ? idxValue : ''
							});
						}
					};
				}

				if (canNavigateCrossDb && typeof relationApi.fetchDbRecords === 'function') {
					// クロスDB: placeholder + 非同期ハイドレーション
					const namePlaceholder = createElement('span', {}, [idxText]);
					const anchor = createElement('a', anchorProps, [namePlaceholder]);
					hydrateCharacterName(anchor, namePlaceholder, idxValue, idxKey, workId, targetDbName);
					children.push(anchor);
				} else {
					children.push(createElement('a', anchorProps, [name || idxText]));
				}
			} else {
				const num = (relationRecord?.Num === null || relationRecord?.Num === undefined) ? '' : String(relationRecord.Num).trim();
				children.push(num || String(identifier?.text || identifier?.value || '') || '?');
			}

			if (labelText) children.push(`: ${labelText}`);

			if (comments.text && !(comments.isDialogue || hasNewline(comments.text))) {
				children.push(`${labelText ? ' ' : ': '}- ${comments.text}`);
				return createElement('div', { class: 'tag' }, children);
			}
			if (!comments.text) return createElement('div', { class: 'tag' }, children);
			return createElement('div', { class: 'tag' }, [
				createElement('div', {}, children),
				createElement('div', { style: 'margin-top: 4px;' }, [comments.node])
			]);
		};

		const relationGrid = relationApi.createDetailTagGrid([
			...related.map((record) => renderRelationTag('⇒', record, true)),
			...commented.map((record) => renderRelationTag('→', record, false))
		]);
		if (!relationGrid) return null;

		if (context?.isStandaloneSubField === true && typeof context?.helpers?.wrapStandaloneSection === 'function') {
			const section = context.helpers.wrapStandaloneSection(item, [relationGrid]);
			if (section && item?.display?.open === true) section.open = true;
			return section;
		}

		if (context?.wrapInSection === false) return relationGrid;

		const fallbackTitle = isRelationToOtherDb ? `${targetDbName}との関係` : '関係';
		const sectionTitle = relationApi.getFieldLabel?.(
			containerKey, context?.fieldLabelMap, context?.workMeta, context?.globalDefType, fallbackTitle
		) || fallbackTitle;

		return createElement('div', { class: 'section' }, [
			createElement('h3', {}, [sectionTitle]),
			relationGrid
		]);
	}

	// section-wrapper-common.js の built-in 登録を上書きして cross-DB Relation 対応版に差し替える
	// match: RelationTo_* / RelationOriginalTo_* のサフィックスを自動検出
	registry.registerSectionRenderer('relationSection', {
		match: (ctx) => {
			const key = String(ctx?.item?.key || '');
			if (!/^Relation(?:Original)?To_/.test(key)) return false;
			const val = ctx?.item?.value;
			return val != null && typeof val === 'object' && !Array.isArray(val)
				&& (Array.isArray(val.Related) || Array.isArray(val.Commented));
		},
		render: (item, context) => renderBuiltInRelationSection(item, context)
	});
})();
