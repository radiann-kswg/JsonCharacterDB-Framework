#!/usr/bin/env node
/**
 * tools/sync-upstream.mjs — 上流リポジトリとの同期点検 / ベンダーブランチ更新
 *
 * 仕様の正典: docs/fork-sync.md
 * 設定: .sync/upstream.json
 *
 * 3 つのリポジトリは git 上は無関係な履歴を持つため、上流をそのまま merge できません。
 * そこで「ベンダーブランチ」方式を採ります:
 *
 *   上流/develop --(マニフェストでパス絞り込み)--> 下流の upstream/<name> ブランチ --(通常の merge)--> develop
 *
 * 本スクリプトが行うのは **ベンダーブランチの更新と差分の報告だけ** です。
 * develop への merge は User が手動で実行します（勝手に作業ツリーを触りません）。
 *
 * 使い方:
 *   node tools/sync-upstream.mjs --check    # 差分の点検のみ（ref を書き換えない / CI 向け・差分ありで exit 1）
 *   node tools/sync-upstream.mjs --update   # ベンダーブランチを更新し、merge コマンドを表示
 *   node tools/sync-upstream.mjs --check --markdown   # Markdown レポートを stdout へ
 *
 * オプション:
 *   --no-fetch    git fetch を省略（オフライン / 既に fetch 済みのとき）
 *   --ref <ref>   上流 ref を明示指定（既定: <remote>/<branch>）
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, '.sync', 'upstream.json');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
};

const MODE = has('--update') ? 'update' : 'check';
const MARKDOWN = has('--markdown');
const NO_FETCH = has('--no-fetch');

// --------------------------------------------------------------------------
// git ヘルパー
// --------------------------------------------------------------------------

function git(args, opts = {}) {
	return execFileSync('git', args, {
		cwd: ROOT,
		encoding: 'utf-8',
		maxBuffer: 256 * 1024 * 1024,
		...opts,
	}).replace(/\n$/, '');
}

function gitOk(args, opts = {}) {
	try {
		git(args, { stdio: ['pipe', 'pipe', 'pipe'], ...opts });
		return true;
	} catch {
		return false;
	}
}

// --------------------------------------------------------------------------
// glob マッチャ
//
// 対応するのは `**` / `*` / `?` のみ。git のパススペックではなく本スクリプト内で
// 完結させることで、「マニフェストが選んだ集合」と「diff の対象」を必ず一致させます。
// --------------------------------------------------------------------------

export function globToRegExp(glob) {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*' && glob[i + 1] === '*') {
			// `**/` はディレクトリ 0 段以上、末尾 `**` は残り全部
			if (glob[i + 2] === '/') {
				re += '(?:.*/)?';
				i += 2;
			} else {
				re += '.*';
				i += 1;
			}
		} else if (c === '*') {
			re += '[^/]*';
		} else if (c === '?') {
			re += '[^/]';
		} else {
			re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

export function makeMatcher({ include = [], exclude = [] }) {
	const inc = include.map(globToRegExp);
	const exc = exclude.map(globToRegExp);
	return (p) => inc.some((re) => re.test(p)) && !exc.some((re) => re.test(p));
}

// --------------------------------------------------------------------------
// ベンダーツリーの構築
//
// 作業ツリーには一切触れません。一時 index（`.cache/`）の上で
// read-tree → 対象外パスを force-remove → write-tree するだけです。
// blob は上流のオブジェクトをそのまま使うため、改行コード（CRLF/LF）の差で
// 偽の差分が出ることもありません。
// --------------------------------------------------------------------------

function buildVendorTree(ref, keep) {
	// 一時 index は `.cache/`（AGENTS.md「一時ファイルは ./.cache/ 配下」）。
	// 後始末に失敗しても点検自体は続行させる（ネットワークドライブ等で unlink できない環境がある）。
	const indexFile = path.join(ROOT, '.cache', `sync-upstream.${process.pid}.index`);
	const cleanup = () => {
		try {
			rmSync(indexFile, { force: true });
		} catch {
			/* 後始末は best-effort */
		}
	};
	mkdirSync(path.dirname(indexFile), { recursive: true });
	cleanup();
	const env = { ...process.env, GIT_INDEX_FILE: indexFile };
	try {
		git(['read-tree', ref], { env });
		const all = git(['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean);
		const drop = all.filter((p) => !keep.has(p));
		if (drop.length > 0) {
			git(['update-index', '--force-remove', '-z', '--stdin'], {
				env,
				input: `${drop.join('\0')}\0`,
			});
		}
		return git(['write-tree'], { env });
	} finally {
		cleanup();
	}
}

// --------------------------------------------------------------------------
// 本体
// --------------------------------------------------------------------------

function main() {
	if (!existsSync(MANIFEST_PATH)) {
		console.error(`同期マニフェストが見つかりません: ${path.relative(ROOT, MANIFEST_PATH)}`);
		console.error('docs/fork-sync.md を参照して .sync/upstream.json を作成してください。');
		process.exit(2);
	}
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
	const { name, repo, remote = 'upstream', branch = 'develop' } = manifest;
	const vendorBranch = manifest.vendorBranch ?? `upstream/${name}`;

	// 1. upstream remote を用意して fetch
	if (!NO_FETCH) {
		if (!gitOk(['remote', 'get-url', remote])) {
			git(['remote', 'add', remote, repo]);
			console.error(`remote '${remote}' を追加しました: ${repo}`);
		} else if (git(['remote', 'get-url', remote]) !== repo) {
			git(['remote', 'set-url', remote, repo]);
			console.error(`remote '${remote}' の URL を更新しました: ${repo}`);
		}
		try {
			git(['fetch', '--quiet', remote, branch], { stdio: ['pipe', 'pipe', 'inherit'] });
		} catch {
			console.error(`fetch に失敗しました（${remote}/${branch}）。--no-fetch で既存の ref を使えます。`);
			process.exit(2);
		}
	}

	const ref = valueOf('--ref') ?? `${remote}/${branch}`;
	if (!gitOk(['rev-parse', '--verify', `${ref}^{commit}`])) {
		console.error(`上流 ref が解決できません: ${ref}`);
		process.exit(2);
	}
	const upstreamSha = git(['rev-parse', ref]);

	// 2. マニフェストで同期対象を決める
	const matches = makeMatcher(manifest);
	const upstreamPaths = git(['ls-tree', '-r', '--name-only', '-z', ref]).split('\0').filter(Boolean);
	const keep = new Set(upstreamPaths.filter(matches));
	if (keep.size === 0) {
		console.error('同期対象が 0 件です。.sync/upstream.json の include を確認してください。');
		process.exit(2);
	}

	// 3. ベンダーツリーを組み立て、HEAD と比べる
	const tree = buildVendorTree(ref, keep);
	const raw = git(['diff', '--name-status', '-z', 'HEAD', tree]).split('\0').filter(Boolean);

	const changes = [];
	let downstreamOnly = 0;
	for (let i = 0; i < raw.length; i += 2) {
		const status = raw[i];
		const file = raw[i + 1];
		if (file === undefined) break;
		if (!keep.has(file)) {
			// ベンダーツリーに無い＝下流だけが持つファイル。同期対象外なので無視する。
			downstreamOnly += 1;
			continue;
		}
		changes.push({ status, file });
	}
	changes.sort((a, b) => a.file.localeCompare(b.file));

	// 4. 報告
	const header = {
		repo,
		branch,
		sha: upstreamSha.slice(0, 7),
		targets: keep.size,
		drift: changes.length,
		downstreamOnly,
	};
	if (MARKDOWN) {
		printMarkdown(header, changes, vendorBranch);
	} else {
		printText(header, changes, vendorBranch);
	}

	// 5. --update ならベンダーブランチを進める
	if (MODE === 'update') {
		updateVendorBranch({ vendorBranch, tree, ref, repo, branch, upstreamSha });
	}

	process.exit(MODE === 'check' && changes.length > 0 ? 1 : 0);
}

function updateVendorBranch({ vendorBranch, tree, repo, branch, upstreamSha }) {
	const exists = gitOk(['rev-parse', '--verify', `refs/heads/${vendorBranch}`]);
	const parent = exists ? git(['rev-parse', `refs/heads/${vendorBranch}`]) : null;

	if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) {
		console.log(`\nベンダーブランチ ${vendorBranch} は最新です（更新なし）。`);
		return;
	}

	const message = [
		`sync(${branch}): 上流 ${upstreamSha.slice(0, 7)} を取り込み`,
		'',
		'tools/sync-upstream.mjs による自動生成コミットです。直接編集しないでください。',
		'',
		`Upstream-Repo: ${repo}`,
		`Upstream-Ref: ${branch}`,
		`Upstream-Commit: ${upstreamSha}`,
	].join('\n');

	const args = ['commit-tree', tree, '-m', message];
	if (parent) args.splice(2, 0, '-p', parent);
	const commit = git(args);
	git(['update-ref', `refs/heads/${vendorBranch}`, commit]);

	if (parent) {
		console.log(`\nベンダーブランチ ${vendorBranch} を更新しました（${commit.slice(0, 7)}）。`);
		console.log('取り込むには:');
		console.log(`  git merge ${vendorBranch}`);
	} else {
		console.log(`\nベンダーブランチ ${vendorBranch} を新規作成しました（${commit.slice(0, 7)}）。`);
		console.log('初回のみ、履歴を接ぐ操作が必要です。どちらかを選んでください:');
		console.log('');
		console.log('  A) 現在の下流の内容を正として履歴だけ接ぐ（推奨・作業ツリーは変わらない）');
		console.log(`     git merge -s ours --allow-unrelated-histories ${vendorBranch}`);
		console.log('     ※ 現時点の差分は「下流が意図的に持っている差」として据え置かれます。');
		console.log('       上流側の修正を取り込みたい場合は、この後で個別に cherry-pick してください。');
		console.log('');
		console.log('  B) 差分をすべてコンフリクトとして出し、その場で突き合わせる');
		console.log(`     git merge --allow-unrelated-histories ${vendorBranch}`);
		console.log('');
		console.log('  いずれの場合も 2 回目以降は `git merge ' + vendorBranch + '` だけで済みます。');
	}
}

function printText(h, changes, vendorBranch) {
	console.log(`上流   : ${h.repo} @ ${h.branch} (${h.sha})`);
	console.log(`同期対象: ${h.targets} ファイル`);
	console.log('');
	if (changes.length === 0) {
		console.log('差分なし。上流と同期できています。');
	} else {
		console.log(`差分あり: ${h.drift} 件  (A=上流で新規 / M=内容差 / D=下流で削除済み)`);
		for (const c of changes) console.log(`  ${c.status.padEnd(3)}${c.file}`);
		console.log('');
		console.log('取り込み手順:');
		console.log('  npm run sync:update');
		console.log(`  git merge ${vendorBranch}`);
	}
	if (h.downstreamOnly > 0) {
		console.log('');
		console.log(`（同期対象外の下流独自ファイル ${h.downstreamOnly} 件は無視しました）`);
	}
}

function printMarkdown(h, changes, vendorBranch) {
	console.log(`**上流**: \`${h.repo}\` @ \`${h.branch}\` (\`${h.sha}\`)  `);
	console.log(`**同期対象**: ${h.targets} ファイル / **差分**: ${h.drift} 件`);
	console.log('');
	if (changes.length === 0) {
		console.log('差分なし。上流と同期できています。');
		return;
	}
	console.log('| 状態 | ファイル |');
	console.log('| --- | --- |');
	const LIMIT = 100;
	for (const c of changes.slice(0, LIMIT)) console.log(`| \`${c.status}\` | \`${c.file}\` |`);
	if (changes.length > LIMIT) console.log(`| … | ほか ${changes.length - LIMIT} 件 |`);
	console.log('');
	console.log('取り込み手順:');
	console.log('');
	console.log('```sh');
	console.log('npm run sync:update');
	console.log(`git merge ${vendorBranch}`);
	console.log('```');
}

// テストからは matcher だけを import したいので、直接実行時のみ main を呼ぶ。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
