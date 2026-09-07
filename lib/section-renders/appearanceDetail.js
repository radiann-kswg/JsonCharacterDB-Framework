/**
 * @fileoverview AppearanceDetail ($Def_AppearanceDetail[]) 専用セクションレンダラー。
 *
 * Formation ごとにグループ化し、各エントリを
 * 「デザイン要素・部位タグ ＋ 属性リスト ＋ 補足テキスト」として描画する。
 * `CharacterSectionRendererRegistry` に `'appearanceDetailSection'` を登録する。
 *
 * dict 解決の方針:
 * - `BodyPart` / `DesignElement` / `Laterality` / `AttrLabel` は
 *   `context.workMeta.General.$VarsDef` の `$EnumDef_*` から直接ルックアップする。
 *   （`resolveVarsDefLabelPack` はフィールド名から `$EnumDef_<FieldName>` を探すが、
 *   実際のキーは `$EnumDef_DesignBodyPart` 等と名称が異なるため、直参照に切り替えている。）
 * - `Formation` は `formatValueForDisplay` に委譲する。
 *   （Formation 辞書は SW が `$VarsDef` に合流済みなので既存ルートで解決できる。）
 *
 * @author 100BeautiesLab.
 * @version 1.1.0
 * @dependencies CharacterSectionRendererRegistry (section-wrapper-common.js)
 */
(() => {
	const registry = globalThis.CharacterSectionRendererRegistry;
	if (!registry?.registerSectionRenderer) return;

	registry.registerSectionRenderer('appearanceDetailSection', {
		match: (context) => (
			Array.isArray(context?.item?.value)
			&& String(context?.item?.type || '').includes('$Def_AppearanceDetail')
		),

		/** @param {object} item @param {object} context */
		render: (item, context) => {
			const {
				el,
				preWrapText,
				isPlainObject,
				wrapStandaloneSection,
				getCurrentPageLanguage,
				formatValueForDisplay,
				pickSchemaType,
				isEmptyValueLoose,
				buildAppearanceDetailImageUrl,
				createGalleryImageItem,
			} = context.helpers || {};
			const { fieldLabelMap, workMeta: metaForLookup, globalDefType } = context;

			if (!el || !wrapStandaloneSection || !item?.value?.length) return null;

			const lang = getCurrentPageLanguage ? getCurrentPageLanguage() : 'jp';
			const basePath = item.key;

			// --- $EnumDef_* 直参照ルックアップ ---
			// characters.js の $VarsDef マージは浅いスプレッドのため、作品ローカルの $EnumDef_* が
			// グローバル定義を丸ごと上書きしてしまう（例: NT ローカルの $EnumDef_DesignAttrLabel が
			// グローバルの Shape/Color/Count 等のエントリを隠す）。
			// globalDefType（data/db_meta.json + data/db_type.json の完全な合流）をベースに
			// 作品ローカルでオーバーライドする形でマージして使用する。
			const varsDef = metaForLookup?.General?.$VarsDef || {};
			const globalVarsDef = globalDefType?.General?.$VarsDef || {};

			/**
			 * グローバルとローカルの $EnumDef_* をマージして返す。
			 * グローバルをベースにローカルが追加・上書きする形とし、
			 * どちらか一方だけ存在する場合はそちらをそのまま返す。
			 * @param {string} enumDefKey - '$EnumDef_DesignAttrLabel' 等
			 * @returns {object|null}
			 */
			function getMergedEnumDef(enumDefKey) {
				const local = varsDef[enumDefKey];
				const global = globalVarsDef[enumDefKey];
				if (!local && !global) return null;
				if (!local || typeof local !== 'object' || Array.isArray(local)) return global || null;
				if (!global || typeof global !== 'object' || Array.isArray(global)) return local;
				return { ...global, ...local };
			}

			/**
			 * `$EnumDef_*` を直接参照してラベルを解決する。
			 * グローバル定義と作品ローカル定義をマージして探索する。
			 * @param {string} rawValue - '#BodyPart_Tail' 等の hash キー
			 * @param {string} enumDefKey - '$EnumDef_DesignBodyPart' 等
			 * @param {string} fieldBase - 'BodyPart' 等（JP/EN サフィックスのベース名）
			 * @returns {string}
			 */
			function resolveFromEnumDef(rawValue, enumDefKey, fieldBase) {
				if (!rawValue) return '';
				const enumDef = getMergedEnumDef(enumDefKey);
				if (enumDef && typeof enumDef === 'object' && !Array.isArray(enumDef)) {
					// hash キー直引き（例: '#BodyPart_Tail'）
					const entry = Object.prototype.hasOwnProperty.call(enumDef, rawValue)
						? enumDef[rawValue]
						: Object.values(enumDef).find((e) => e && e[fieldBase] === rawValue);
					if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
						return lang === 'en'
							? (entry[`${fieldBase}_EN`] || entry[`${fieldBase}_JP`] || entry[fieldBase] || String(rawValue).trim())
							: (entry[`${fieldBase}_JP`] || entry[fieldBase] || entry[`${fieldBase}_EN`] || String(rawValue).trim());
					}
				}
				// enum 定義が見つからない場合は raw をそのまま返す
				return String(rawValue).trim();
			}

			/**
			 * Formation を `formatValueForDisplay` に委譲して解決する
			 * @param {string} rawFormation
			 * @returns {string}
			 */
			function resolveFormationLabel(rawFormation) {
				if (!rawFormation || !formatValueForDisplay) return String(rawFormation || '').trim();
				const schemaType = (pickSchemaType && pickSchemaType(`${basePath}.Formation`, 'Formation')) || '#DictIndex';
				const resolved = String(
					formatValueForDisplay(rawFormation, fieldLabelMap, metaForLookup, globalDefType, {
						schemaType,
						fieldKey: `${basePath}.Formation`
					}) ?? ''
				).trim();
				return resolved || String(rawFormation).trim();
			}

			/**
			 * Costume を formatValueForDisplay に委譲して解決する（resolveFormationLabel と同一パターン）
			 * @param {string} rawCostume
			 * @returns {string}
			 */
			function resolveCostumeLabel(rawCostume) {
				if (!rawCostume || !formatValueForDisplay) return String(rawCostume || '').trim();
				const schemaType = (pickSchemaType && pickSchemaType(`${basePath}.Costume`, 'Costume')) || '#DictIndex';
				const resolved = String(
					formatValueForDisplay(rawCostume, fieldLabelMap, metaForLookup, globalDefType, {
						schemaType,
						fieldKey: `${basePath}.Costume`
					}) ?? ''
				).trim();
				return resolved || String(rawCostume).trim();
			}

			/**
			 * エントリ先頭のタグ群（DesignElement / BodyPart[] / Laterality / Costume）を生成する
			 * @param {object} entry
			 * @returns {HTMLElement[]}
			 */
			function buildHeaderTags(entry) {
				const tags = [];

				if (entry.DesignElement) {
					const label = resolveFromEnumDef(entry.DesignElement, '$EnumDef_DesignElement', 'DesignElement');
					if (label) tags.push(el('div', { class: 'tag' }, [label]));
				}

				const parts = Array.isArray(entry.BodyPart)
					? entry.BodyPart
					: (entry.BodyPart ? [entry.BodyPart] : []);
				for (const bp of parts) {
					if (!bp) continue;
					const label = resolveFromEnumDef(bp, '$EnumDef_DesignBodyPart', 'BodyPart');
					if (label) tags.push(el('div', { class: 'tag' }, [label]));
				}

				if (entry.Laterality) {
					const label = resolveFromEnumDef(entry.Laterality, '$EnumDef_Laterality', 'Laterality');
					if (label) tags.push(el('div', { class: 'tag' }, [label]));
				}

				if (entry.Costume) {
					const label = resolveCostumeLabel(entry.Costume);
					if (label) tags.push(el('div', { class: 'tag' }, [label]));
				}

				return tags;
			}

			/**
			 * `vdict_{DictName}` キーを `$EnumDef_{DictName}` から解決してラベルを返す
			 * @param {string} rawKey
			 * @param {string} dictName
			 * @returns {string}
			 */
			function resolveVdict(rawKey, dictName) {
				if (!rawKey || !dictName) return '';
				return resolveFromEnumDef(rawKey, `$EnumDef_${dictName}`, dictName);
			}

			/**
			 * `Attrs` 配列から表示行ノードを生成する。
			 * 規約駆動フィールド（vdict_* / value_* / about_*）を処理する。
			 * - vdict_{DictName}: `$EnumDef_{DictName}` から表示ラベルを解決（正式な表示値）
			 * - value_Num_1 + value_Num_2: "N × M" 形式でペア表示（Branch 等）
			 * - value_Num: 数値表示（Count / Segment 等）
			 * - value_JP / value_EN: vdict_* キーが存在しない場合のみ表示（フォールバック）
			 * - about_JP / about_EN: 補足テキスト（括弧付きで追記）
			 *
			 * vdict_* と value_JP/EN の関係:
			 * vdict_* が存在する場合、value_JP/EN は DB 側で省略可能。
			 * vdict_* が解決に失敗した場合は生キー（例: "#TailShapeType_Fox"）をそのまま表示する。
			 * @param {Array} attrs
			 * @returns {HTMLElement[]}
			 */
			function buildAttrRows(attrs) {
				if (!Array.isArray(attrs)) return [];
				return attrs.flatMap((attr) => {
					if (!isPlainObject?.(attr)) return [];

					const attrLabel = attr.AttrLabel
						? resolveFromEnumDef(attr.AttrLabel, '$EnumDef_DesignAttrLabel', 'AttrLabel')
						: '';

					const vdictLabels = [];
					const numPairs = [];
					let hasVdictKeys = false;
					let numVal = null;
					let textJP = '', textEN = '';
					let aboutJP = '', aboutEN = '';

					for (const [k, v] of Object.entries(attr)) {
						if (k === 'AttrLabel' || v === null || v === undefined) continue;
						const sv = String(v).trim();
						if (!sv) continue;

						if (k.startsWith('vdict_')) {
							hasVdictKeys = true;
							const label = resolveVdict(sv, k.slice(6));
							vdictLabels.push(label || sv);
						} else if (/^value_Num_\d+$/.test(k)) {
							numPairs.push([k, v]);
						} else if (k === 'value_Num') {
							numVal = v;
						} else if (k === 'value_JP' || k === 'Value_JP') {
							if (!textJP) textJP = sv;
						} else if (k === 'value_EN' || k === 'Value_EN') {
							if (!textEN) textEN = sv;
						} else if (k === 'about_JP') {
							if (!aboutJP) aboutJP = sv;
						} else if (k === 'about_EN') {
							if (!aboutEN) aboutEN = sv;
						}
					}

					const parts = [];

					if (vdictLabels.length) parts.push(vdictLabels.join('・'));

					// value_Num_1 × value_Num_2 ペア（Branch 等で使用）
					if (numPairs.length >= 2) {
						numPairs.sort((a, b) => a[0].localeCompare(b[0]));
						parts.push(`${numPairs[0][1]} × ${numPairs[1][1]}`);
					} else if (numPairs.length === 1) {
						parts.push(String(numPairs[0][1]));
					}

					if (numVal !== null) parts.push(String(numVal));

					// value_JP/EN: vdict_* キーが存在する場合はスキップ（vdict が正式な表示値）
					const textVal = lang === 'en' ? (textEN || textJP) : (textJP || textEN);
					if (textVal && !hasVdictKeys) parts.push(textVal);

					const aboutVal = lang === 'en' ? (aboutEN || aboutJP) : (aboutJP || aboutEN);
					if (aboutVal) parts.push(`(${aboutVal})`);

					if (!parts.length) return [];

					const text = attrLabel ? `${attrLabel}: ${parts.join(' ')}` : parts.join(' ');
					return [el('div', { class: 'appearance-detail__attr-row' }, [text])];
				});
			}

			/**
			 * エントリ 1 件をノードに変換する
			 * @param {object} entry
			 * @returns {HTMLElement|null}
			 */
			function buildEntryNode(entry) {
				if (!isPlainObject?.(entry)) return null;

				const headerTags = buildHeaderTags(entry);
				const attrRows = buildAttrRows(entry.Attrs);

				const note = lang === 'en'
					? (entry.Note_EN || entry.Note_JP)
					: (entry.Note_JP || entry.Note_EN);
				const noteText = note ? String(note).trim() : '';
				const noteNode = noteText
					? el('div', { class: 'appearance-detail__note' }, [
						preWrapText ? preWrapText(noteText) : noteText
					  ])
					: null;

				const imgFileName = typeof entry.img_PNGName === 'string' ? entry.img_PNGName.trim() : '';
				let imageNode = null;
				if (imgFileName && buildAppearanceDetailImageUrl && createGalleryImageItem) {
					const imageUrl = buildAppearanceDetailImageUrl(imgFileName, entry);
					if (imageUrl) {
						const designLabel = entry.DesignElement
							? resolveFromEnumDef(entry.DesignElement, '$EnumDef_DesignElement', 'DesignElement')
							: '';
						const bodyParts = Array.isArray(entry.BodyPart)
							? entry.BodyPart
							: (entry.BodyPart ? [entry.BodyPart] : []);
						const bodyPartLabel = bodyParts.length
							? resolveFromEnumDef(bodyParts[0], '$EnumDef_DesignBodyPart', 'BodyPart')
							: '';
						const altText = [designLabel, bodyPartLabel].filter(Boolean).join(' - ')
							|| (lang === 'en' ? 'Appearance detail reference image' : '外見詳細の参考画像');
						// レイアウト（幅・余白）は SASS 側の共通クラス（.subfield-entry__reference-image）で制御する
						imageNode = el('div', { class: 'appearance-detail__reference-image subfield-entry__reference-image' }, [
							createGalleryImageItem({ url: imageUrl, alt: altText, caption: '' })
						]);
					}
				}

				// テキスト情報（ヘッダー/属性/ノート）を左カラムにまとめ、参考画像を右隣に小さく並べる
				// （SASS: subFields 系共通の .subfield-entry / __main / __reference-image）
				const mainChildren = [
					headerTags.length
						? el('div', {
							class: 'appearance-detail__entry-header',
							style: 'display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px;'
						  }, headerTags)
						: null,
					attrRows.length
						? el('div', { class: 'appearance-detail__attrs', style: 'padding-left: 4px;' }, attrRows)
						: null,
					noteNode,
				].filter(Boolean);

				if (!mainChildren.length && !imageNode) return null;
				const children = [
					mainChildren.length
						? el('div', { class: 'appearance-detail__entry-main subfield-entry__main' }, mainChildren)
						: null,
					imageNode,
				].filter(Boolean);
				return el('div', { class: 'appearance-detail__entry subfield-entry' }, children);
			}

			// --- Formation でグループ化（出現順を維持）---
			const NO_FORMATION = '\x00';
			const groupOrder = [];
			const groupMap = new Map();

			for (const entry of item.value) {
				if (!isPlainObject?.(entry)) continue;
				const fKey = entry.Formation || NO_FORMATION;
				if (!groupMap.has(fKey)) {
					groupOrder.push(fKey);
					groupMap.set(fKey, { formation: entry.Formation || null, entries: [] });
				}
				groupMap.get(fKey).entries.push(entry);
			}

			const groupNodes = groupOrder.flatMap((fKey) => {
				const group = groupMap.get(fKey);
				const entryNodes = group.entries.map(buildEntryNode).filter(Boolean);
				if (!entryNodes.length) return [];

				const formationLabel = group.formation
					? resolveFormationLabel(group.formation)
					: null;

				const groupChildren = [
					formationLabel
						? el('div', { class: 'tag', style: 'margin-bottom: 6px;' }, [formationLabel])
						: null,
					el('div', { class: 'appearance-detail__group-entries' }, entryNodes),
				].filter(Boolean);

				return [
					el('div', { class: 'appearance-detail__group', style: 'margin-bottom: 12px;' }, groupChildren)
				];
			});

			if (!groupNodes.length) return null;

			const outerBlock = el('div', { style: 'margin-bottom: 10px;' }, [
				el('div', { class: 'tag', style: 'margin-bottom: 6px;' }, [item.label]),
				el('div', {}, groupNodes),
			]);

			return wrapStandaloneSection(item, [outerBlock]);
		},
	});
})();
