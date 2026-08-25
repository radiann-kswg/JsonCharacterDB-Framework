/**
 * [type-common.js] - `$VarsDef`（`$EnumDef_*` / `#List_*` / `#Dict_*`）による enum/辞書コードのラベル解決
 * @description
 *   GenderType / RaceType / TailShapeType 等の enum コードや辞書コード（`#FemaleNeutral` 等）を、
 *   db_meta.json / db_type.json の `$VarsDef`・`$Def_*` コンテナ・Dictionaries カタログから
 *   人間可読な JP/EN ラベルへ解決する純関数群。DOM に一切触れず、引数（辞書ソース）だけで完結する。
 *
 *   これにより UI（pages/characters.js）・Service Worker・pkg(Node)・ロールプレイプロンプト生成
 *   ツールが同一のラベル解決を共用できる。従来 pages/characters.js に閉じていたロジックを
 *   `lib/basic-renders/` へ集約したもの（DOM 描画・現在言語依存の整形は呼び出し側に残す）。
 *
 *   公開 API（`globalThis.TypeResolver`）:
 *   - `resolveVarsDefLabel(fieldName, rawValue, globalDefType, metaForLookup, fieldKey)` → JP優先の単一文字列
 *   - `resolveVarsDefLabelPack(fieldName, rawValue, globalDefType, metaForLookup, fieldKey, recordContext)` → `{jp,en,raw}`
 *   - `mergeVarsDefLayers(...sources)` → 配列連結＋object浅マージで $VarsDef 層を合成
 *   - `findDictScopeCondition(dictionariesCatalog, listKeyCandidates)` → scopeField 条件
 *   - `normalizeVarsDefKey(k)` → `GenderType_JP` → `GenderType` の言語サフィックス除去
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies なし（純関数。`globalThis.TypeResolver` として公開）
 * @see docs/schema-meta-processing.md §3.4（$VarsDef 合成）
 */
(() => {
	'use strict';
	const root = typeof globalThis !== 'undefined' ? globalThis : this;
	if (root.TypeResolver) return;

	/**
	 * VarsDef（$EnumDef_* / #List_* / #Dict_*）参照のために、言語サフィックスを除去してベースキーへ正規化する
	 * - fieldKey が 'GenderType_JP' 等でも $EnumDef_GenderType を参照できるようにする
	 * @param {string} k
	 * @returns {string}
	 */
	function normalizeVarsDefKey(k) {
		const s = String(k || '').trim();
		const m = s.match(/^(.*)_(JP|EN)$/);
		return (m && m[1]) ? m[1] : s;
	}

	/**
	 * $VarsDef層（global/localization/work等）を「配列は連結・objectは浅いマージ」で合成する
	 * - 単純な object spread による上書きだと、同名の #List_* / #Dict_* が複数レイヤーに存在する場合
	 *   （例: 所属別クラス辞書と作品共通クラス辞書が両方 #List_Class を名乗るケース）に片方が丸ごと
	 *   消えてしまう。docs/schema-meta-processing.md 3.4 の「両方から合成される」前提に合わせる。
	 * @param {...(Object|null)} sources - 優先度の低い順に並べる（object値は後方のキーが優先）
	 * @returns {Object}
	 */
	function mergeVarsDefLayers(...sources) {
		const result = {};
		for (const src of sources) {
			if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
			for (const [key, val] of Object.entries(src)) {
				if (Array.isArray(val)) {
					const prev = Array.isArray(result[key]) ? result[key] : [];
					result[key] = prev.concat(val);
				} else if (val && typeof val === 'object') {
					const prev = (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) ? result[key] : {};
					result[key] = { ...prev, ...val };
				} else {
					result[key] = val;
				}
			}
		}
		return result;
	}

	/**
	 * Dictionaries カタログ（#Dict_*）から、指定した辞書リストキーに対応する scopeField 条件を探す
	 * - scopeField は「その辞書ファイル1本まるごとが、どのフィールド＝値のキャラクター向けか」を
	 *   宣言する任意プロパティ（例: { "Belonging": "シンフォニー.XVI(ゼクズィン)" }）。
	 *   行ごとの手書きタグは不要で、読み込み時（sw-common.js / characters.js 双方のローダー）に
	 *   辞書の全行へ自動合成される。
	 * @param {Object|null} dictionariesCatalog - metaForLookup.Dictionaries
	 * @param {string[]} listKeyCandidates - 例: ['#List_Class', '#Dict_Class']
	 * @returns {Object|null} scopeField条件（{ フィールド名: 値, ... }。無ければ null）
	 */
	function findDictScopeCondition(dictionariesCatalog, listKeyCandidates) {
		if (!dictionariesCatalog || typeof dictionariesCatalog !== 'object') return null;
		const candidates = new Set((listKeyCandidates || []).filter(Boolean));
		if (!candidates.size) return null;
		for (const [catalogKey, info] of Object.entries(dictionariesCatalog)) {
			if (!info || typeof info !== 'object') continue;
			const scopeField = (info.scopeField && typeof info.scopeField === 'object' && !Array.isArray(info.scopeField))
				? info.scopeField
				: null;
			if (!scopeField || !Object.keys(scopeField).length) continue;
			const dictName = String(catalogKey || '').replace(/^#Dict_/, '').trim();
			const keyField = typeof info.keyField === 'string' ? info.keyField.trim() : '';
			const derivedName = dictName || keyField;
			const compatListKey = typeof info.compatListKey === 'string' && info.compatListKey.trim()
				? info.compatListKey.trim()
				: `#List_${derivedName}`;
			const ownDictKey = String(catalogKey || '').startsWith('#Dict_') ? catalogKey : `#Dict_${derivedName}`;
			if (candidates.has(compatListKey) || candidates.has(ownDictKey)) return scopeField;
		}
		return null;
	}

	/**
	 * db_meta.json の $VarsDef / $Def_* / Dictionaries から、カテゴリ値の「JP優先の単一表示名」を解決する
	 * @param {string} fieldName - 例: 'GenderType' / 'RaceType'
	 * @param {any} rawValue - 解決したいコード値（例: 'Neutral' / '#FemaleNeutral'）
	 * @param {Object|null} globalDefType - グローバル db_type.json 相当
	 * @param {Object|null} metaForLookup - 作品別 db_meta.json 相当
	 * @param {string|null} fieldKey - schemaPath（例: 'ArcanumspecStats.SpecType.ActionType.KinematicOrStatic'）
	 * @returns {string} 解決したラベル（無ければ raw をそのまま返す）
	 */
	function resolveVarsDefLabel(fieldName, rawValue, globalDefType = null, metaForLookup = null, fieldKey = null) {
		const fn = String(fieldName || '').trim();
		if (!fn) return '';

		if (rawValue === null || rawValue === undefined || rawValue === '') return '';
		const rv = String(rawValue).trim();
		if (!rv) return '';

		/** @type {any[]} */
		const varsDefRoots = [];

		/**
		 * General 配下の `$Def_*` コンテナも探索対象に含める
		 * - 例: Works_NumberTales の General.$Def_Relations.#List_RelationLabel
		 * @param {any} general
		 */
		const pushGeneralDefContainers = (general) => {
			if (!general || typeof general !== 'object' || Array.isArray(general)) return;
			for (const [k, v] of Object.entries(general)) {
				if (!k || typeof k !== 'string') continue;
				if (!k.startsWith('$Def_')) continue;
				if (!v || typeof v !== 'object') continue;
				varsDefRoots.push(v);
			}
		};

		if (metaForLookup?.General && typeof metaForLookup.General === 'object') {
			if (metaForLookup.General.$VarsDef && typeof metaForLookup.General.$VarsDef === 'object') varsDefRoots.push(metaForLookup.General.$VarsDef);
			pushGeneralDefContainers(metaForLookup.General);
		}
		if (metaForLookup?.$VarsDef && typeof metaForLookup.$VarsDef === 'object') varsDefRoots.push(metaForLookup.$VarsDef);

		// 作品ごとの Commons（Databases 配下）も参照対象に含める
		// - 例: Works_ShouArRiders の Databases.#DB_Primary._Commons.#List_Beast
		if (metaForLookup?.Databases && typeof metaForLookup.Databases === 'object') {
			for (const dbMeta of Object.values(metaForLookup.Databases)) {
				if (!dbMeta || typeof dbMeta !== 'object') continue;
				const commons = dbMeta._Commons;
				if (commons && typeof commons === 'object') varsDefRoots.push(commons);
			}
		}

		if (globalDefType?.General && typeof globalDefType.General === 'object') {
			if (globalDefType.General.$VarsDef && typeof globalDefType.General.$VarsDef === 'object') varsDefRoots.push(globalDefType.General.$VarsDef);
			pushGeneralDefContainers(globalDefType.General);
		}

		// 参照が同一のケースを除外
		const uniqRoots = [];
		for (const r of varsDefRoots) {
			if (!r || typeof r !== 'object') continue;
			if (uniqRoots.includes(r)) continue;
			uniqRoots.push(r);
		}
		if (!uniqRoots.length) return rv;

		const fk = String(fieldKey || '').trim();
		const fkSegs = fk ? fk.split('.').map(s => String(s || '').trim()).filter(Boolean) : [];

		/**
		 * $VarsDef のネストから指定キー（#List_XXX 等）を探索
		 * @param {any} obj
		 * @param {string} key
		 * @param {number} depth
		 * @returns {any}
		 */
		const findNestedKey = (obj, key, depth = 0) => {
			if (!obj || typeof obj !== 'object') return null;
			if (depth > 8) return null;
			if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];

			if (Array.isArray(obj)) {
				for (const it of obj) {
					const found = findNestedKey(it, key, depth + 1);
					if (found) return found;
				}
				return null;
			}

			for (const v of Object.values(obj)) {
				if (!v || typeof v !== 'object') continue;
				const found = findNestedKey(v, key, depth + 1);
				if (found) return found;
			}
			return null;
		};

		/**
		 * fieldKey（schemaPath）を手がかりに `$Def_<Segment>` を辿って「その周辺の VarsDef コンテキスト」を集める
		 * - 例: ArcanumspecStats.SpecType.ActionType.KinematicOrStatic
		 *   → $Def_ArcanumspecStats → $Def_SpecType → $Def_ActionType
		 * @param {any} varsDefRoot
		 * @returns {any[]}
		 */
		const collectVarsDefContexts = (varsDefRoot) => {
			/** @type {any[]} */
			const contexts = [varsDefRoot];
			if (!fkSegs.length) return contexts;
			let cur = varsDefRoot;
			// leaf 自体は $Def を持たないことが多いので、最後は探索対象にしない（Material 等は親に #List がある）
			const upto = Math.max(0, fkSegs.length - 1);
			for (let i = 0; i < upto; i++) {
				const seg = fkSegs[i];
				const key = `$Def_${seg}`;
				if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, key) && cur[key] && typeof cur[key] === 'object') {
					cur = cur[key];
					contexts.push(cur);
				} else {
					// 途中で切れても、以降は辿れない
					break;
				}
			}
			return contexts;
		};

		const pickLabel = (item) => {
			if (!item || typeof item !== 'object') return '';
			const jp = item[`${fn}_JP`];
			const raw = item[fn];
			const en = item[`${fn}_EN`];
			const labelJp = item[`${fn}Text_JP`];
			const labelRaw = item[`${fn}Text`];
			const labelEn = item[`${fn}Text_EN`];
			if (typeof jp === 'string' && jp.trim()) return jp.trim();
			if (typeof labelJp === 'string' && labelJp.trim()) return labelJp.trim();
			if (typeof labelRaw === 'string' && labelRaw.trim()) return labelRaw.trim();
			if (typeof raw === 'string' && raw.trim()) return raw.trim();
			if (typeof labelEn === 'string' && labelEn.trim()) return labelEn.trim();
			if (typeof en === 'string' && en.trim()) return en.trim();
			return '';
		};

		const pickLabelFlexible = (item, preferredKey) => {
			if (!item || typeof item !== 'object') return '';

			// まずは preferredKey（例: RaceType）ベースで「値が一致する場合のみ」拾う
			const pk = String(preferredKey || '').trim();
			if (pk) {
				const jp = item[`${pk}_JP`];
				const raw = item[pk];
				const en = item[`${pk}_EN`];
				const hit = [jp, raw, en].some(v => (typeof v === 'string' && v.trim() === rv));
				if (hit) {
					if (typeof jp === 'string' && jp.trim()) return jp.trim();
					if (typeof raw === 'string' && raw.trim()) return raw.trim();
					if (typeof en === 'string' && en.trim()) return en.trim();
				}
			}

			// 次に「値が一致するキー」を探索して、その *_JP を返す（例: #List_DualizePattern の Pattern）
			for (const [k, v] of Object.entries(item)) {
				if (!k || typeof k !== 'string') continue;
				if (k.endsWith('_JP') || k.endsWith('_EN')) continue;
				if (k.startsWith('_')) continue;
				if (typeof v !== 'string') continue;
				if (v.trim() !== rv) continue;
				const jp = item[`${k}_JP`];
				if (typeof jp === 'string' && jp.trim()) return jp.trim();
				return v.trim();
			}
			return '';
		};

		for (const varsDef of uniqRoots) {
			if (!varsDef || typeof varsDef !== 'object') continue;

			// $EnumDef_XXX は { '#XXX1': { XXX:'...', XXX_JP:'...' }, ... } 形式
			// - 作品別 meta では $Def_* 配下にネストしているケースがあるため、list と同様に探索する
			const enumKey = `$EnumDef_${fn}`;
			/** @type {any|null} */
			let enumDef = null;

			// context-first
			if (fkSegs.length) {
				const contexts = collectVarsDefContexts(varsDef);
				for (let i = contexts.length - 1; i >= 0; i--) {
					const ctx = contexts[i];
					if (ctx && typeof ctx === 'object' && ctx[enumKey] && typeof ctx[enumKey] === 'object' && !Array.isArray(ctx[enumKey])) {
						enumDef = ctx[enumKey];
						break;
					}
				}
			}
			// direct
			if (!enumDef && varsDef[enumKey] && typeof varsDef[enumKey] === 'object' && !Array.isArray(varsDef[enumKey])) {
				enumDef = varsDef[enumKey];
			}
			// nested fallback
			if (!enumDef) {
				const found = findNestedKey(varsDef, enumKey);
				if (found && typeof found === 'object' && !Array.isArray(found)) enumDef = found;
			}

			if (enumDef && typeof enumDef === 'object') {
				for (const v of Object.values(enumDef)) {
					if (!v || typeof v !== 'object') continue;
					const raw = v[fn];
					const jp = v[`${fn}_JP`];
					const en = v[`${fn}_EN`];
					if ((typeof raw === 'string' && raw.trim() === rv) || (typeof jp === 'string' && jp.trim() === rv) || (typeof en === 'string' && en.trim() === rv)) {
						return pickLabel(v) || rv;
					}
				}
			}

			// #List_XXX は [{ ... }, ...] 形式
			// - work 側では `$Def_*` のネスト配下にあることがあるため、fieldKey を手がかりに「その周辺」→ 無ければ再帰探索
			const listKey = `#List_${fn}`;
			/** @type {any[]|null} */
			let listDef = null;

			// context-first
			if (fkSegs.length) {
				const contexts = collectVarsDefContexts(varsDef);
				for (let i = contexts.length - 1; i >= 0; i--) {
					const ctx = contexts[i];
					if (ctx && typeof ctx === 'object' && Array.isArray(ctx[listKey])) {
						listDef = ctx[listKey];
						break;
					}
				}
			}
			// direct
			if (!listDef && Array.isArray(varsDef[listKey])) listDef = varsDef[listKey];
			// nested fallback
			if (!listDef) {
				const found = findNestedKey(varsDef, listKey);
				if (Array.isArray(found)) listDef = found;
			}

			if (Array.isArray(listDef)) {
				for (const item of listDef) {
					if (!item || typeof item !== 'object') continue;
					const raw = item[fn];
					const jp = item[`${fn}_JP`];
					const en = item[`${fn}_EN`];
					const hit = (
						(typeof raw === 'string' && raw.trim() === rv)
						|| (typeof jp === 'string' && jp.trim() === rv)
						|| (typeof en === 'string' && en.trim() === rv)
					);
					if (hit) return pickLabel(item) || rv;

					// フィールド名が一致しないケース（DualizePattern: Pattern を持つ等）
					const flex = pickLabelFlexible(item, fn);
					if (flex) return flex;
				}
			}
		}

		return rv;
	}

	/**
	 * db_meta.json の $VarsDef（$EnumDef_* / #List_* / #Dict_*）から、カテゴリ値のJP/ENペアを取得する
	 * - 既存の resolveVarsDefLabel() は「JP優先の単一文字列」だが、
	 *   こちらは「JP/EN両方の表示」に利用するための薄い補助。
	 * - EN は *_EN を優先し、無い場合は raw（コード）をフォールバックとして返す。
	 *
	 * @param {string} fieldName
	 * @param {any} rawValue
	 * @param {Object|null} globalDefType
	 * @param {Object|null} metaForLookup
	 * @param {string|null} fieldKey
	 * @param {Object|null} recordContext - 同一レコードの他フィールド値（scopeField による辞書行の絞り込みに使う。省略時は従来通りスコープ無視）
	 * @returns {{ jp?: string, en?: string, raw?: string } | null}
	 */
	function resolveVarsDefLabelPack(fieldName, rawValue, globalDefType = null, metaForLookup = null, fieldKey = null, recordContext = null) {
		const fn = String(fieldName || '').trim();
		if (!fn) return null;
		if (rawValue === null || rawValue === undefined || rawValue === '') return null;

		const normalizeKnownEnumCode = (field, code) => {
			const f = String(field || '').trim();
			const c = String(code || '').trim();
			if (!f || !c) return c;
			return c;
		};

		const rvRaw = String(rawValue).trim();
		const rv = normalizeKnownEnumCode(fn, rvRaw);
		if (!rv) return null;

		// '#FemaleNeutral' のような「#付きコード」でも解決できるように正規化
		// - UI 側の schemaType が欠ける経路や、値が参照キーのまま流れてくる経路でも
		//   JP/EN 表示名解決が外れて raw のまま残るのを避ける
		const rvStripped = rv.startsWith('#') ? rv.slice(1).trim() : rv;
		const rvCandidates = [rv, rvStripped].filter(Boolean);

		const trimStr = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : '';
		const normalizeBaseKey = (v) => normalizeVarsDefKey(String(v || '').trim());

		const findDictNameInSchema = (node, targetKey, depth = 0) => {
			if (!targetKey || !node || typeof node !== 'object') return '';
			if (depth > 8) return '';

			if (Array.isArray(node)) {
				for (const item of node) {
					const found = findDictNameInSchema(item, targetKey, depth + 1);
					if (found) return found;
				}
				return '';
			}

			if (node.hashTag === targetKey && typeof node.$dict === 'string' && node.$dict.trim()) {
				return node.$dict.trim();
			}

			for (const value of Object.values(node)) {
				if (!value || typeof value !== 'object') continue;
				const found = findDictNameInSchema(value, targetKey, depth + 1);
				if (found) return found;
			}
			return '';
		};

		/** @type {any[]} */
		const varsDefRoots = [];

		/** @param {any} general */
		const pushGeneralDefContainers = (general) => {
			if (!general || typeof general !== 'object' || Array.isArray(general)) return;
			for (const [k, v] of Object.entries(general)) {
				if (!k || typeof k !== 'string') continue;
				if (!k.startsWith('$Def_')) continue;
				if (!v || typeof v !== 'object') continue;
				varsDefRoots.push(v);
			}
		};

		if (metaForLookup?.General && typeof metaForLookup.General === 'object') {
			if (metaForLookup.General.$VarsDef && typeof metaForLookup.General.$VarsDef === 'object') varsDefRoots.push(metaForLookup.General.$VarsDef);
			pushGeneralDefContainers(metaForLookup.General);
		}
		if (metaForLookup?.$VarsDef && typeof metaForLookup.$VarsDef === 'object') varsDefRoots.push(metaForLookup.$VarsDef);
		if (metaForLookup?.Databases && typeof metaForLookup.Databases === 'object') {
			for (const dbMeta of Object.values(metaForLookup.Databases)) {
				if (!dbMeta || typeof dbMeta !== 'object') continue;
				const commons = dbMeta._Commons;
				if (commons && typeof commons === 'object') varsDefRoots.push(commons);
			}
		}
		if (globalDefType?.General && typeof globalDefType.General === 'object') {
			if (globalDefType.General.$VarsDef && typeof globalDefType.General.$VarsDef === 'object') varsDefRoots.push(globalDefType.General.$VarsDef);
			pushGeneralDefContainers(globalDefType.General);
		}

		const uniqRoots = [];
		for (const r of varsDefRoots) {
			if (!r || typeof r !== 'object') continue;
			if (uniqRoots.includes(r)) continue;
			uniqRoots.push(r);
		}
		if (!uniqRoots.length) return null;

		const fk = String(fieldKey || '').trim();
		const fkSegs = fk ? fk.split('.').map(s => String(s || '').trim()).filter(Boolean) : [];
		const keyBase = fkSegs.length ? normalizeBaseKey(fkSegs[fkSegs.length - 1]) : '';
		const dictLookupName = (() => {
			const candidates = Array.from(new Set([keyBase, normalizeBaseKey(fn)].filter(Boolean)));
			for (const candidate of candidates) {
				const found = findDictNameInSchema(globalDefType, candidate);
				if (found) return found;
			}
			return '';
		})();

		// #List_XXX / #Dict_XXX 探索で使う候補名（辞書カタログの scopeField 解決にも流用する）
		const lookupNames = Array.from(new Set([dictLookupName, fn, keyBase].filter(Boolean)));
		const scopeCondition = findDictScopeCondition(
			metaForLookup?.Dictionaries,
			lookupNames.flatMap((name) => ([`#List_${name}`, `#Dict_${name}`]))
		);
		const scopeKeys = scopeCondition ? Object.keys(scopeCondition) : [];

		/** 行が scopeField（読み込み時に辞書全行へ合成済み）を持つか */
		const rowHasScopeTag = (item) => scopeKeys.length > 0 && item && typeof item === 'object'
			&& scopeKeys.some((k) => Object.prototype.hasOwnProperty.call(item, k) && item[k] !== null && item[k] !== undefined && item[k] !== '');

		/**
		 * レコード側の値から、scopeField 照合に使えるスカラー候補を取り出す
		 * - `Belonging: [{ Faction: '白の六芒星' }]` のような構造化値（$Def_* 型）でも照合が効くよう、
		 *   object 要素は配下のスカラー値まで展開する（`_` 始まりの内部キーは除外）
		 * @param {any} x
		 * @returns {string[]}
		 */
		const scopeValueCandidates = (x) => {
			if (x === null || x === undefined) return [];
			if (Array.isArray(x)) return x.flatMap(scopeValueCandidates);
			if (typeof x === 'object') {
				return Object.entries(x)
					.filter(([k]) => typeof k === 'string' && !k.startsWith('_'))
					.flatMap(([, v]) => scopeValueCandidates(v));
			}
			const s = String(x).trim();
			return s ? [s] : [];
		};

		/** 行の scopeField 値が recordContext 側の同名フィールド値と一致するか（AND条件） */
		const rowMatchesRecordScope = (item) => {
			if (!scopeKeys.length || !recordContext || typeof recordContext !== 'object') return false;
			if (!item || typeof item !== 'object') return false;
			return scopeKeys.every((k) => {
				const rowVal = item[k];
				if (rowVal === null || rowVal === undefined || rowVal === '') return false;
				const recVal = recordContext[k];
				if (recVal === null || recVal === undefined || recVal === '') return false;
				const target = String(rowVal).trim();
				const recArr = Array.isArray(recVal) ? recVal : [recVal];
				return recArr.some((x) => scopeValueCandidates(x).includes(target));
			});
		};

		const findNestedKey = (obj, key, depth = 0) => {
			if (!obj || typeof obj !== 'object') return null;
			if (depth > 8) return null;
			if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];

			if (Array.isArray(obj)) {
				for (const it of obj) {
					const found = findNestedKey(it, key, depth + 1);
					if (found) return found;
				}
				return null;
			}

			for (const v of Object.values(obj)) {
				if (!v || typeof v !== 'object') continue;
				const found = findNestedKey(v, key, depth + 1);
				if (found) return found;
			}
			return null;
		};

		const collectVarsDefContexts = (varsDefRoot) => {
			/** @type {any[]} */
			const contexts = [varsDefRoot];
			if (!fkSegs.length) return contexts;
			let cur = varsDefRoot;
			const upto = Math.max(0, fkSegs.length - 1);
			for (let i = 0; i < upto; i++) {
				const seg = fkSegs[i];
				const key = `$Def_${seg}`;
				if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, key) && cur[key] && typeof cur[key] === 'object') {
					cur = cur[key];
					contexts.push(cur);
				} else {
					break;
				}
			}
			return contexts;
		};

		const makePack = (item, keyName) => {
			const k = String(keyName || fn).trim();
			const raw = trimStr(item?.[k]);
			const jp = trimStr(item?.[`${k}_JP`]);
			const en = trimStr(item?.[`${k}_EN`]);
			const labelRaw = trimStr(item?.[`${k}Text`]);
			const labelJp = trimStr(item?.[`${k}Text_JP`]);
			const labelEn = trimStr(item?.[`${k}Text_EN`]);
			return {
				raw: raw || rv,
				// NOTE: #Dict_Faction のように「ベースキーがJP文字列」で *_JP が無いケースを許容する
				// - *_JP が無い場合は raw（ベース値）を JP とみなす
				jp: jp || labelJp || labelRaw || raw || '',
				en: en || labelEn || labelRaw || raw || rv
			};
		};

		for (const varsDef of uniqRoots) {
			if (!varsDef || typeof varsDef !== 'object') continue;

			// $EnumDef_XXX
			const enumKey = `$EnumDef_${fn}`;
			let enumDef = null;

			if (fkSegs.length) {
				const contexts = collectVarsDefContexts(varsDef);
				for (let i = contexts.length - 1; i >= 0; i--) {
					const ctx = contexts[i];
					if (ctx && typeof ctx === 'object' && ctx[enumKey] && typeof ctx[enumKey] === 'object' && !Array.isArray(ctx[enumKey])) {
						enumDef = ctx[enumKey];
						break;
					}
				}
			}
			if (!enumDef && varsDef[enumKey] && typeof varsDef[enumKey] === 'object' && !Array.isArray(varsDef[enumKey])) {
				enumDef = varsDef[enumKey];
			}
			if (!enumDef) {
				const found = findNestedKey(varsDef, enumKey);
				if (found && typeof found === 'object' && !Array.isArray(found)) enumDef = found;
			}

			if (enumDef && typeof enumDef === 'object') {
				// 可能ならキー直引き（#FemaleNeutral 等）を優先して高速・確実に解決する
				// NOTE: この形式は db_meta.json の $EnumDef_* が採用している典型形
				const directKeys = Array.from(new Set([
					rv.startsWith('#') ? rv : `#${rv}`,
					rvStripped ? `#${rvStripped}` : '',
				].filter(Boolean)));

				for (const directKey of directKeys) {
					if (!Object.prototype.hasOwnProperty.call(enumDef, directKey)) continue;
					const item = enumDef[directKey];
					if (item && typeof item === 'object' && !Array.isArray(item)) {
						return makePack(item, fn);
					}
				}

				for (const v of Object.values(enumDef)) {
					if (!v || typeof v !== 'object') continue;
					const raw = trimStr(v[fn]);
					const jp = trimStr(v[`${fn}_JP`]);
					const en = trimStr(v[`${fn}_EN`]);
					const labelRaw = trimStr(v[`${fn}Text`]);
					const labelJp = trimStr(v[`${fn}Text_JP`]);
					const labelEn = trimStr(v[`${fn}Text_EN`]);
					const hit = [raw, jp, en, labelRaw, labelJp, labelEn].some(x => x && rvCandidates.includes(x));
					if (hit) return makePack(v, fn);
				}
			}

			// #List_XXX / #Dict_XXX（lookupNames はループ外で算出済み・scopeField解決とも共用）
			const listSpecs = lookupNames.flatMap((name) => ([
				{ listKey: `#List_${name}`, valueKey: name },
				{ listKey: `#Dict_${name}`, valueKey: name }
			]));
			let listDef = null;
			let listValueKey = fn;

			if (fkSegs.length) {
				const contexts = collectVarsDefContexts(varsDef);
				for (let i = contexts.length - 1; i >= 0; i--) {
					const ctx = contexts[i];
					if (!ctx || typeof ctx !== 'object') continue;
					for (const spec of listSpecs) {
						if (!Array.isArray(ctx[spec.listKey])) continue;
						listDef = ctx[spec.listKey];
						listValueKey = spec.valueKey;
						break;
					}
					if (listDef) break;
				}
			}
			if (!listDef) {
				for (const spec of listSpecs) {
					if (!Array.isArray(varsDef[spec.listKey])) continue;
					listDef = varsDef[spec.listKey];
					listValueKey = spec.valueKey;
					break;
				}
			}
			if (!listDef) {
				for (const spec of listSpecs) {
					const found = findNestedKey(varsDef, spec.listKey);
					if (!Array.isArray(found)) continue;
					listDef = found;
					listValueKey = spec.valueKey;
					break;
				}
			}

			if (Array.isArray(listDef)) {
				// 1行ずつ value 一致を探す（preferred key優先 → フィールド名が一致しないケースの順）
				const matchInList = (candidateList) => {
					for (const item of candidateList) {
						if (!item || typeof item !== 'object') continue;

						const raw = trimStr(item[listValueKey]);
						const jp = trimStr(item[`${listValueKey}_JP`]);
						const en = trimStr(item[`${listValueKey}_EN`]);
						const hit = [raw, jp, en].some(x => x && rvCandidates.includes(x));
						if (hit) return makePack(item, listValueKey);

						// フィールド名が一致しないケース（DualizePattern: Pattern など）
						for (const [k, v] of Object.entries(item)) {
							if (!k || typeof k !== 'string') continue;
							if (k.endsWith('_JP') || k.endsWith('_EN')) continue;
							if (k.startsWith('_')) continue;
							if (typeof v !== 'string') continue;
							if (!rvCandidates.includes(v.trim())) continue;
							return makePack(item, k);
						}
					}
					return null;
				};

				if (scopeKeys.length && recordContext) {
					// scopeField（辞書カタログ側の条件。例: { Belonging: '...' }）が同一レコードと一致する行を優先
					const scopedItems = listDef.filter((item) => rowMatchesRecordScope(item));
					const scopedHit = matchInList(scopedItems);
					if (scopedHit) return scopedHit;

					// 一致するスコープ行が無ければ、scopeField を持たない共通行へフォールバック
					const commonItems = listDef.filter((item) => !rowHasScopeTag(item));
					const commonHit = matchInList(commonItems);
					if (commonHit) return commonHit;
				} else {
					const hit = matchInList(listDef);
					if (hit) return hit;
				}
			}
		}

		return null;
	}

	/**
	 * `$VarsDef` 探索の起点（辞書コンテナ）を集める
	 * - `resolveVarsDefLabel*` が内部で組み立てているものと同じ優先順（作品メタ → グローバル）
	 * - `resolveDictRow()` は「ラベル 1 個」ではなく辞書行まるごとを必要とするため、この関数を共用する
	 * @param {Object|null} globalDefType - グローバル db_type.json 相当
	 * @param {Object|null} metaForLookup - 作品別 db_meta.json 相当（Dictionaries 合流済み）
	 * @returns {any[]} 重複を除いた $VarsDef ルート配列
	 */
	function collectVarsDefRoots(globalDefType = null, metaForLookup = null) {
		/** @type {any[]} */
		const roots = [];

		const pushGeneralDefContainers = (general) => {
			if (!general || typeof general !== 'object' || Array.isArray(general)) return;
			for (const [k, v] of Object.entries(general)) {
				if (!k || typeof k !== 'string') continue;
				if (!k.startsWith('$Def_')) continue;
				if (!v || typeof v !== 'object') continue;
				roots.push(v);
			}
		};

		if (metaForLookup?.General && typeof metaForLookup.General === 'object') {
			if (metaForLookup.General.$VarsDef && typeof metaForLookup.General.$VarsDef === 'object') roots.push(metaForLookup.General.$VarsDef);
			pushGeneralDefContainers(metaForLookup.General);
		}
		if (metaForLookup?.$VarsDef && typeof metaForLookup.$VarsDef === 'object') roots.push(metaForLookup.$VarsDef);

		if (globalDefType?.General && typeof globalDefType.General === 'object') {
			if (globalDefType.General.$VarsDef && typeof globalDefType.General.$VarsDef === 'object') roots.push(globalDefType.General.$VarsDef);
			pushGeneralDefContainers(globalDefType.General);
		}
		if (globalDefType?.$VarsDef && typeof globalDefType.$VarsDef === 'object') roots.push(globalDefType.$VarsDef);

		const uniq = [];
		for (const r of roots) {
			if (!r || typeof r !== 'object') continue;
			if (uniq.includes(r)) continue;
			uniq.push(r);
		}
		return uniq;
	}

	/**
	 * 辞書（`#Dict_*` / `#List_*`）から、値に一致する **行オブジェクトそのもの** を解決する
	 * - `resolveVarsDefLabelPack()` は表示ラベル（jp/en/raw）だけを返すため、行の付随情報
	 *   （例: `#Dict_Faction[*].FactionsBaseArea`）を参照したい `$dictRef` 解決ではこちらを使う。
	 * @param {string} dictName - 辞書名（`$dict` 宣言の値。例: 'Faction'）
	 * @param {any} rawValue - 突き合わせるコード値（例: '百花繚乱研究所'）
	 * @param {Object|null} globalDefType - グローバル db_type.json 相当
	 * @param {Object|null} metaForLookup - 作品別 db_meta.json 相当
	 * @returns {Object|null} 一致した辞書行（無ければ null）
	 */
	function resolveDictRow(dictName, rawValue, globalDefType = null, metaForLookup = null) {
		const name = String(dictName || '').trim();
		if (!name) return null;
		if (rawValue === null || rawValue === undefined || rawValue === '') return null;
		const rv = String(rawValue).trim();
		if (!rv) return null;

		const keyCandidates = [name, `${name}_JP`, `${name}_EN`, `${name}Text`, `${name}Text_JP`, `${name}Text_EN`];
		const matches = (row) => {
			if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
			return keyCandidates.some((k) => {
				const v = row[k];
				return typeof v === 'string' && v.trim() === rv;
			});
		};

		for (const root of collectVarsDefRoots(globalDefType, metaForLookup)) {
			for (const listKey of [`#Dict_${name}`, `#List_${name}`]) {
				const rows = Array.isArray(root?.[listKey]) ? root[listKey] : null;
				if (!rows) continue;
				const hit = rows.find(matches);
				if (hit) return hit;
			}
		}
		return null;
	}

	root.TypeResolver = {
		normalizeVarsDefKey,
		mergeVarsDefLayers,
		findDictScopeCondition,
		collectVarsDefRoots,
		resolveDictRow,
		resolveVarsDefLabel,
		resolveVarsDefLabelPack,
	};
})();
