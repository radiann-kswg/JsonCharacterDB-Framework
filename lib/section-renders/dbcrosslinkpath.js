/**
 * @fileoverview `_DBCrossLinkPath` ラッパー解決ヘルパー
 *
 * `#PNGFilePath`/`#PNGFileName` フィールド専用の、DB/Work横断「パス参照」機構。
 * `_DBLink`（対象レコードをインデックスで検索してフィールド値を穴埋めするレコード参照機構）とは異なり、
 * `_DBCrossLinkPath` は対象Work/DBの画像フォルダ内の相対パスを直接指すだけで、対象レコードの検索・照合を
 * 一切行わない。そのため fetch/セッションキャッシュ/曖昧一致ガード/isPrivateレコード除外といった
 * レコード照合まわりの仕組みは本ファイルには存在しない。
 *
 * `{ "_DBCrossLinkPath": { "_DB": "...", "_Work": "...", "_Field": "...", "_IsoPath": "..." } }` の形で、
 * `#PNGFilePath[]` 等の配列要素、または単体フィールドの値として出現する（$type 自体は変更しない値レベルの
 * ダックタイピング）。
 *
 * 画像ギャラリー/ポスター構築（pages/characters.js の buildImageGallery / resolveImageFromFields）は
 * CharacterSectionRendererRegistry の汎用フィールドdispatchを経由しないハードコード実装のため、
 * 本ファイルは registry へ登録せず globalThis.DBCrossLinkPathResolver として直接公開し、
 * pages/characters.js から呼び出される。
 */

(() => {
	/**
	 * `$Def_DBCrossLinkPath` エントリにおける「センチネルキー」（それ以外は将来拡張用に無視する）
	 */
	const SENTINEL_KEYS = new Set(['_DB', '_Work', '_Field', '_IsoPath']);

	/**
	 * worksTitle の各種形式を '#Works_XXX' の workKey 形式に正規化（lib/section-renders/dblink.js と同一パターン）
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

	/**
	 * 値が `{ _DBCrossLinkPath: {...} }` ラッパーかを判定
	 * @param {*} value
	 * @returns {boolean}
	 */
	function isDBCrossLinkPathWrapper(value) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
		const entry = value._DBCrossLinkPath;
		return !!entry && typeof entry === 'object' && !Array.isArray(entry);
	}

	/**
	 * `_DBCrossLinkPath` の中身から解決に必要な情報を取り出す。
	 * `_DB`（必須）/`_IsoPath`（必須・単一パス文字列）が欠落・空文字列の場合は null を返す。
	 * @param {Object} entry - `value._DBCrossLinkPath`
	 * @returns {{targetWork:string|null, targetDB:string, targetField:string|null, isoPath:string}|null}
	 */
	function extractCrossLinkEntry(entry) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

		const targetDB = typeof entry._DB === 'string' ? entry._DB.trim() : '';
		if (!targetDB) return null;

		const isoPath = typeof entry._IsoPath === 'string' ? entry._IsoPath.trim() : '';
		if (!isoPath) return null;

		const targetWork = typeof entry._Work === 'string' && entry._Work.trim() ? entry._Work.trim() : null;
		const targetField = typeof entry._Field === 'string' && entry._Field.trim() ? entry._Field.trim() : null;

		return { targetWork, targetDB, targetField, isoPath };
	}

	/**
	 * `_DBCrossLinkPath` wrapper を解決し、絶対画像URLを返す（解決できなければ null）。
	 * - `_Work` 省略時は現在Work、`_Field` 省略時は wrapper が出現したフィールドと同名を対象とする。
	 * - `ctx.isTargetHidden` で `Works_Hidden`/`DB_Hidden` を確認し、非公開なら解決しない。
	 * - `ctx.resolveTargetImageField` で対象フィールドが対象Workの schema で画像型として宣言されているかを
	 *   検証し（未宣言なら安全側で解決しない）、folderHint 等のメタを取得する。
	 * - 最終的な絶対パス構築は `ctx.buildPath` に委譲する（クライアント側/SW側で実装が異なるため）。
	 * @param {Object} wrapperValue - `{ _DBCrossLinkPath: {...} }`
	 * @param {Object} ctx
	 * @param {string} ctx.currentWorkId - wrapper が出現しているレコードの作品ID（'#Works_XXX'形式）
	 * @param {string} ctx.currentDbName - wrapper が出現しているレコードのDB名
	 * @param {string} ctx.currentFieldName - wrapper が出現しているフィールド名（`_Field` 省略時の既定値）
	 * @param {(targetWorkId:string, targetDB:string, targetField:string) => Promise<{folderHint:string|null,type:string,category:string,layer:string}|null>} ctx.resolveTargetImageField
	 *   対象フィールドの画像型宣言を検証し、folderHint 等に加え対象DB自身のレイヤー（References等）も返す
	 * @param {(targetWorkId:string, targetDB:string) => Promise<boolean>} ctx.isTargetHidden
	 * @param {(targetWorkId:string, targetDB:string, fieldMeta:Object, isoPath:string, layer:string) => string} ctx.buildPath
	 * @returns {Promise<string|null>}
	 */
	async function resolveDBCrossLinkPath(wrapperValue, ctx) {
		if (!isDBCrossLinkPathWrapper(wrapperValue)) return null;
		const parsed = extractCrossLinkEntry(wrapperValue._DBCrossLinkPath);
		if (!parsed) return null;

		const targetWorkId = parsed.targetWork ? normalizeWorkKey(parsed.targetWork) : ctx.currentWorkId;
		const targetField = parsed.targetField || ctx.currentFieldName;
		if (!targetWorkId || !targetField) return null;

		if (typeof ctx.isTargetHidden === 'function') {
			const hidden = await ctx.isTargetHidden(targetWorkId, parsed.targetDB);
			if (hidden) return null;
		}

		if (typeof ctx.resolveTargetImageField !== 'function') return null;
		const fieldMeta = await ctx.resolveTargetImageField(targetWorkId, parsed.targetDB, targetField);
		if (!fieldMeta) return null;

		if (typeof ctx.buildPath !== 'function') return null;
		const url = ctx.buildPath(targetWorkId, parsed.targetDB, fieldMeta, parsed.isoPath, fieldMeta.layer || '');
		return url || null;
	}

	globalThis.DBCrossLinkPathResolver = {
		isDBCrossLinkPathWrapper,
		extractCrossLinkEntry,
		resolveDBCrossLinkPath
	};
})();
