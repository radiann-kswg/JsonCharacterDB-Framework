/**
 * 画像参照のリンク切れ検査（大小文字を区別する）
 *
 * @description `data/**` の JSON が持つ画像参照が、実ファイルと**大小文字まで一致**することを検証する。
 *
 * ## なぜ専用のテストが要るのか
 *
 * 既存の `tests/data.shape.test.js` の実在チェックには 2 つの盲点があった。
 *
 * 1. **`existsSync()` は Windows では大小文字を区別しない。**
 *    ローカル（Windows / NTFS）では通るのに GitHub Pages（Linux）でだけ 404 になる欠陥を取り逃がす。
 * 2. **検査範囲が `AppearanceDetail[].img_PNGName` だけ**で、`Images.*` 配下の大多数を見ていなかった。
 *
 * 2026-08-02 の監査で、この盲点をすり抜けていた本番限定の欠陥が実際に 3 系統見つかっている。
 *
 * | 欠陥 | すり抜けた理由 |
 * | --- | --- |
 * | `cnsp-fg_NTscorefolder`（実体は `cnsp-fg_NTsCoreFolder.png`） | ベース名の大小文字違い。`existsSync` が Windows で true を返す |
 * | 大文字拡張子 `.PNG` 8 件 | 解決側は必ず小文字 `.png` を補うため実体と食い違う |
 * | `cnsp_imgNTS-115RZ-image`（実体が `DB_SelfSecondary` 配下） | 参照元 DB と別ディレクトリに置かれていた |
 *
 * ## 検査方法
 *
 * `readdirSync()` で実ディレクトリを走査して**実際の綴りのまま**索引を作り、参照値と突き合わせる。
 * `existsSync()` は使わない。
 *
 * folderHint（`concept` / `conceptAlt` 等のサブフォルダ）は typedef 由来で本テストからは解決しないため、
 * 「作品の Images ツリー内にベース名が存在するか」＋「参照元 DB のディレクトリ配下にあるか」の
 * 2 段で検査する。パス解決そのものの正しさは `tests/enrich.dbcrosslinkpath.test.js` が担う。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

/** 画像として扱う拡張子（すべて小文字で持つ） */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

/** 画像参照を持つフィールド名の接尾辞（`#PNGFileName` / `#PNGFilePath` 系） */
const IMAGE_FIELD_SUFFIX = /(_PNGName|_PNGPath)$/;

/**
 * ディレクトリを再帰的に走査してファイルの相対パスを列挙する
 * @param {string} absDir @param {string} [base=absDir] @returns {string[]} `base` からの相対パス（`/` 区切り）
 */
function listFilesRecursive(absDir, base = absDir) {
	let entries;
	try {
		entries = readdirSync(absDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const out = [];
	for (const e of entries) {
		const abs = join(absDir, e.name);
		if (e.isDirectory()) out.push(...listFilesRecursive(abs, base));
		else out.push(relative(base, abs).split(sep).join('/'));
	}
	return out;
}

/** @param {string} p @returns {boolean} */
function isDir(p) {
	try { return statSync(p).isDirectory(); } catch { return false; }
}

/**
 * JSON から画像参照の文字列を再帰的に集める
 *
 * @description `hideText` wrapper（`{hideText: '...'}`）と `_DBCrossLinkPath` wrapper は対象外。
 * 前者は意図的なマスク、後者は別 DB / 別作品を指すため本テストの帰属検査に乗らない。
 * @param {*} node @param {string[]} [out=[]] @param {string|null} [fieldName=null] @returns {string[]}
 */
function collectImageRefs(node, out = [], fieldName = null) {
	if (node === null || node === undefined) return out;
	if (typeof node === 'string') {
		if (fieldName && IMAGE_FIELD_SUFFIX.test(fieldName) && node.trim()) out.push(node.trim());
		return out;
	}
	if (Array.isArray(node)) {
		for (const item of node) collectImageRefs(item, out, fieldName);
		return out;
	}
	if (typeof node === 'object') {
		// wrapper object はスキップ（値そのものではない）
		if ('hideText' in node || '_DBCrossLinkPath' in node) return out;
		for (const [k, v] of Object.entries(node)) collectImageRefs(v, out, k);
		return out;
	}
	return out;
}

/**
 * 参照値からベース名（拡張子なし・ディレクトリなし）を取り出す
 * @param {string} value @returns {string}
 */
function refBaseName(value) {
	const last = value.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
	const ext = extname(last).toLowerCase();
	return IMAGE_EXTS.has(ext) ? last.slice(0, -ext.length) : last;
}

/** 作品ディレクトリ（`Works_*` と共有 `References`）を列挙する */
function listWorkDirs() {
	const dataRoot = join(repoRoot, 'data');
	return readdirSync(dataRoot, { withFileTypes: true })
		.filter((e) => e.isDirectory() && (e.name.startsWith('Works_') || e.name === 'References'))
		.map((e) => e.name);
}

/**
 * 作品の画像ルート（`Images/` または共有作品の `GeneralImages/`）を返す
 * @param {string} workDir @returns {string|null} 絶対パス
 */
function imagesRootOf(workDir) {
	const candidates = [
		join(repoRoot, 'data', workDir, 'Images'),
		// #Works_CommonReferences は Works_ImagesDir: 'GeneralImages'（data/db_meta.json）
		join(repoRoot, 'data', 'GeneralImages')
	];
	for (const c of candidates) if (isDir(c)) return c;
	return null;
}

describe('画像参照のリンク切れ（大小文字を区別）', () => {
	it('data/**/Images/** の拡張子はすべて小文字', () => {
		// 解決側は必ず小文字 `.png` を補う（lib/data-common.js の buildCrossLinkImageAbsolutePath /
		// pages/characters.js の pickDefaultExtension）。実体が `.PNG` だと Linux でだけ 404 になる。
		const offenders = [];
		for (const workDir of [...listWorkDirs(), 'GeneralImages']) {
			const root = workDir === 'GeneralImages'
				? join(repoRoot, 'data', 'GeneralImages')
				: imagesRootOf(workDir);
			if (!root || !isDir(root)) continue;
			for (const rel of listFilesRecursive(root)) {
				const ext = extname(rel);
				if (!ext) continue;
				if (IMAGE_EXTS.has(ext.toLowerCase()) && ext !== ext.toLowerCase()) {
					offenders.push(`${workDir}/${rel}`);
				}
			}
		}
		expect(offenders, `大文字拡張子のファイル:\n${offenders.join('\n')}`).toHaveLength(0);
	});

	it('DB が参照する画像のベース名が、その作品の Images ツリーに大小文字まで一致して存在する', () => {
		const missing = [];
		let checked = 0;

		for (const workDir of listWorkDirs()) {
			const imagesRoot = imagesRootOf(workDir);
			if (!imagesRoot) continue;

			// 実ファイル索引: ベース名（拡張子なし）-> 相対パスの配列。実際の綴りのまま持つ
			const byBaseName = new Map();
			for (const rel of listFilesRecursive(imagesRoot)) {
				const ext = extname(rel).toLowerCase();
				if (!IMAGE_EXTS.has(ext)) continue;
				const key = basename(rel, extname(rel));
				if (!byBaseName.has(key)) byBaseName.set(key, []);
				byBaseName.get(key).push(rel);
			}

			// DB / 資料系 JSON を走査
			for (const sub of ['DataBases', 'References']) {
				const subDir = join(repoRoot, 'data', workDir, sub);
				if (!isDir(subDir)) continue;
				for (const file of readdirSync(subDir)) {
					if (!/^(db|ref)_.+\.json$/.test(file)) continue;
					// db_meta.json / db_type.json はスキーマであってレコードではない
					if (/^db_(meta|type)\.json$/.test(file)) continue;
					// `*_temp.json` は .gitignore 対象のローカル作業ファイル
					if (/_temp\.json$/.test(file)) continue;

					let json;
					try {
						json = JSON.parse(readFileSync(join(subDir, file), 'utf-8'));
					} catch {
						continue;
					}

					for (const ref of collectImageRefs(json)) {
						// VRM は画像パイプラインと別系統（buildVrmAssetUrl が解決する）
						if (/\.vrm$/i.test(ref)) continue;
						checked += 1;
						const base = refBaseName(ref);
						if (!byBaseName.has(base)) {
							missing.push(`${workDir}/${sub}/${file}: "${ref}" → ベース名 "${base}" が見つからない`);
						}
					}
				}
			}
		}

		expect(checked).toBeGreaterThan(500); // 走査が空回りしていないこと
		expect(missing, `リンク切れ ${missing.length} 件:\n${missing.join('\n')}`).toHaveLength(0);
	});

	it('db_<DbName>.json が参照する画像は Images/DB_<DbName>/ 配下にある', () => {
		// 参照元 DB と別ディレクトリに実体があると、どのパス解決経路でも当たらない
		// （例: db_Secondary から参照される画像が DB_SelfSecondary 配下にあった 2026-08-02 の事例）
		const misplaced = [];

		for (const workDir of listWorkDirs()) {
			const imagesRoot = imagesRootOf(workDir);
			const dbDir = join(repoRoot, 'data', workDir, 'DataBases');
			if (!imagesRoot || !isDir(dbDir)) continue;

			const byBaseName = new Map();
			for (const rel of listFilesRecursive(imagesRoot)) {
				const ext = extname(rel).toLowerCase();
				if (!IMAGE_EXTS.has(ext)) continue;
				const key = basename(rel, extname(rel));
				if (!byBaseName.has(key)) byBaseName.set(key, []);
				byBaseName.get(key).push(rel);
			}

			for (const file of readdirSync(dbDir)) {
				const m = /^db_(.+)\.json$/.exec(file);
				if (!m) continue;
				const dbName = m[1];
				if (/^(meta|type)$/.test(dbName) || dbName === 'temp') continue;

				let json;
				try {
					json = JSON.parse(readFileSync(join(dbDir, file), 'utf-8'));
				} catch {
					continue;
				}

				const expectedDir = `DB_${dbName}/`;
				for (const ref of collectImageRefs(json)) {
					if (/\.vrm$/i.test(ref)) continue;
					// `../` を含む値は意図的に別ツリー（General 等）を指すので帰属検査の対象外
					if (ref.includes('../')) continue;
					const paths = byBaseName.get(refBaseName(ref));
					if (!paths) continue; // 不在は前のテストが報告する
					if (!paths.some((p) => p.startsWith(expectedDir))) {
						misplaced.push(`${workDir}/DataBases/${file}: "${ref}" → 実体は ${paths.join(' / ')}（期待: ${expectedDir}…）`);
					}
				}
			}
		}

		expect(misplaced, `DB 配置ずれ ${misplaced.length} 件:\n${misplaced.join('\n')}`).toHaveLength(0);
	});
});
