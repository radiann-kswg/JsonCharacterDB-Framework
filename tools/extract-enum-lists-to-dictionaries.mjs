#!/usr/bin/env node
/**
 * #List_*（enum/list相当）を作品別 Dictionaries/dict_*.json へ切り出す補助ツール
 *
 * 目的:
 * - DataBases/db_meta.json に散在する #List_* を dict_*.json へ寄せる
 * - Service Worker の既存合流処理（#Dict_* / #List_* 互換）で全作品に適用できる形を生成する
 *
 * 既定動作:
 * - dry-run（ファイルは変更しない）
 *
 * オプション:
 * - --write   : Dictionaries/db_meta.json と dict_*.json を実際に書き込む
 * - --prune   : DataBases/db_meta.json から抽出した #List_* を削除（--write必須）
 * - --work=Works_NumberTales : 単一作品だけ処理
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataRoot = path.join(repoRoot, 'data');

const args = new Set(process.argv.slice(2));
const writeMode = args.has('--write');
const pruneMode = args.has('--prune');
const workArg = process.argv.slice(2).find((a) => a.startsWith('--work='));
const workFilter = workArg ? workArg.replace('--work=', '').trim() : '';

if (pruneMode && !writeMode) {
	console.error('[ERROR] --prune は --write と一緒に使ってください。');
	process.exit(1);
}

function toJsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath, fallback = null) {
	try {
		const txt = await fs.readFile(filePath, 'utf8');
		return JSON.parse(txt);
	} catch {
		return fallback;
	}
}

function isPlainObject(v) {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

function collectListNodes(node, trail = [], out = []) {
	if (Array.isArray(node)) {
		node.forEach((item, i) => collectListNodes(item, trail.concat(String(i)), out));
		return out;
	}
	if (!isPlainObject(node)) return out;

	for (const [k, v] of Object.entries(node)) {
		if (k.startsWith('#List_') && Array.isArray(v)) {
			out.push({
				listKey: k,
				listName: k.replace(/^#List_/, '').trim(),
				path: trail.concat(k),
				rows: v,
			});
			continue;
		}
		collectListNodes(v, trail.concat(k), out);
	}
	return out;
}

function normalizeDictRows(rows, listName) {
	return rows.map((row) => {
		if (isPlainObject(row)) return row;
		return { [listName]: row };
	});
}

function ensureDictionaryCatalog(meta, listName) {
	if (!isPlainObject(meta)) meta = {};
	if (!isPlainObject(meta.Dictionaries)) meta.Dictionaries = {};

	const dictKey = `#Dict_${listName}`;
	const existing = isPlainObject(meta.Dictionaries[dictKey]) ? meta.Dictionaries[dictKey] : {};

	meta.Dictionaries[dictKey] = {
		DB_Label: existing.DB_Label || `${listName}辞書`,
		DB_Label_EN: existing.DB_Label_EN || `${listName} Dictionary`,
		keyField: existing.keyField || listName,
		compatListKey: existing.compatListKey || `#List_${listName}`,
		...existing,
	};

	return meta;
}

function removePath(root, pathParts) {
	if (!pathParts.length) return;
	let cur = root;
	for (let i = 0; i < pathParts.length - 1; i++) {
		const key = pathParts[i];
		if (Array.isArray(cur)) {
			const idx = Number(key);
			if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return;
			cur = cur[idx];
			continue;
		}
		if (!isPlainObject(cur) || !Object.prototype.hasOwnProperty.call(cur, key)) return;
		cur = cur[key];
	}

	const last = pathParts[pathParts.length - 1];
	if (Array.isArray(cur)) {
		const idx = Number(last);
		if (Number.isInteger(idx) && idx >= 0 && idx < cur.length) cur.splice(idx, 1);
		return;
	}
	if (isPlainObject(cur)) delete cur[last];
}

async function listWorkDirs() {
	const entries = await fs.readdir(dataRoot, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory() && e.name.startsWith('Works_'))
		.map((e) => e.name)
		.filter((name) => (!workFilter || name === workFilter))
		.sort((a, b) => a.localeCompare(b));
}

async function processWork(workDir) {
	const dbMetaPath = path.join(dataRoot, workDir, 'DataBases', 'db_meta.json');
	const dbMeta = await readJson(dbMetaPath, null);
	if (!isPlainObject(dbMeta)) {
		return { workDir, skipped: true, reason: 'db_meta.json not found' };
	}

	const nodes = collectListNodes(dbMeta);
	const usable = nodes.filter((n) => n.listName && n.rows.length > 0);
	if (!usable.length) {
		return { workDir, skipped: true, reason: 'no #List_* arrays found' };
	}

	const dictRoot = path.join(dataRoot, workDir, 'Dictionaries');
	const dictMetaPath = path.join(dictRoot, 'db_meta.json');
	const dictMeta = await readJson(dictMetaPath, {});
	const nextDictMeta = isPlainObject(dictMeta) ? { ...dictMeta } : {};

	const filesToWrite = [];
	for (const node of usable) {
		const listName = node.listName;
		const dictFileName = `dict_${listName}.json`;
		const dictFilePath = path.join(dictRoot, dictFileName);
		const rows = normalizeDictRows(node.rows, listName);
		filesToWrite.push({ filePath: dictFilePath, content: rows, listKey: node.listKey, path: node.path });
		ensureDictionaryCatalog(nextDictMeta, listName);
	}

	if (writeMode) {
		await fs.mkdir(dictRoot, { recursive: true });

		for (const item of filesToWrite) {
			await fs.writeFile(item.filePath, toJsonText(item.content), 'utf8');
		}
		await fs.writeFile(dictMetaPath, toJsonText(nextDictMeta), 'utf8');

		if (pruneMode) {
			const nextDbMeta = JSON.parse(JSON.stringify(dbMeta));
			for (const item of filesToWrite) {
				removePath(nextDbMeta, item.path);
			}
			await fs.writeFile(dbMetaPath, toJsonText(nextDbMeta), 'utf8');
		}
	}

	return {
		workDir,
		skipped: false,
		listCount: usable.length,
		fileCount: filesToWrite.length + 1,
		wrote: writeMode,
		pruned: writeMode && pruneMode,
		lists: usable.map((u) => u.listKey),
	};
}

async function main() {
	const works = await listWorkDirs();
	if (!works.length) {
		console.log('[INFO] 対象作品が見つかりませんでした。');
		return;
	}

	console.log(`[INFO] mode=${writeMode ? 'write' : 'dry-run'} prune=${pruneMode ? 'on' : 'off'} works=${works.length}`);

	const results = [];
	for (const workDir of works) {
		results.push(await processWork(workDir));
	}

	let migratedWorks = 0;
	let totalLists = 0;
	let totalFiles = 0;

	for (const r of results) {
		if (r.skipped) {
			console.log(`- ${r.workDir}: skip (${r.reason})`);
			continue;
		}
		migratedWorks += 1;
		totalLists += r.listCount;
		totalFiles += r.fileCount;
		console.log(`- ${r.workDir}: lists=${r.listCount} files=${r.fileCount} ${r.wrote ? '(written)' : '(planned)'}`);
	}

	console.log('---');
	console.log(`[SUMMARY] works=${migratedWorks}/${results.length} lists=${totalLists} files=${totalFiles} mode=${writeMode ? 'write' : 'dry-run'} prune=${pruneMode ? 'on' : 'off'}`);
}

main().catch((err) => {
	console.error('[ERROR]', err?.stack || err?.message || String(err));
	process.exit(1);
});
