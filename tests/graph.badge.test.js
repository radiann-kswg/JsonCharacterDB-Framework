/**
 * lib/graph/graph-badge.js（インデックスバッジ）の単体テスト
 *
 * バッジは相関図のノード内に出す「57」「M16」のような短い識別子。
 * `Works_Code`（作品コード）と `$IndexDef.$badge`（連結規則）の**宣言だけ**から組み立てる。
 *
 * 守りたい性質:
 * 1. **宣言駆動** — field 名や作品名でコードを分岐しないこと
 * 2. **実データで一意かつ非空** — 全 9 作品・全 DB で衝突しないこと。
 *    バッジは Index から機械導出できない（作品ごとに体系が違い、規則外の変換も実在する）ため、
 *    宣言が実データと合っているかはテストでしか担保できない
 * 3. **辞書引きの失敗で壊れない** — 辞書行が無い値は生値へフォールバックする
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import {
	normalizeDictCell,
	getWorksCode,
	normalizeBadgeSpec,
	buildBadgeBody,
	buildBadge,
	createDictCellLookup
} from '../lib/graph/graph-badge.js';
import { resolveIndexDef, extractIndexPairs } from '../lib/graph/graph-model.js';

const repoRoot = process.cwd();
const readJson = (p) => JSON.parse(readFileSync(path.resolve(repoRoot, p), 'utf-8'));

describe('normalizeDictCell', () => {
	it('スカラーはそのまま文字列化', () => {
		expect(normalizeDictCell(13)).toBe('13');
		expect(normalizeDictCell('M')).toBe('M');
	});

	it('`#Number_withAbout` 形式は value を採る', () => {
		expect(normalizeDictCell({ value: 13, about_JP: '便宜上' })).toBe('13');
	});

	it('配列は先頭の有効な要素を採る（dict_Beast.json の Cat / Dog）', () => {
		expect(normalizeDictCell([
			{ value: 13, about_JP: '便宜上' },
			{ value: 3, about_JP: '種族上' }
		])).toBe('13');
	});

	it('先頭が空なら次の要素へ進む（Dog は value: null が混ざる）', () => {
		expect(normalizeDictCell([{ value: null }, { value: 11 }])).toBe('11');
	});

	it('空値は空文字', () => {
		expect(normalizeDictCell(null)).toBe('');
		expect(normalizeDictCell(undefined)).toBe('');
		expect(normalizeDictCell('  ')).toBe('');
		expect(normalizeDictCell([])).toBe('');
	});
});

describe('getWorksCode', () => {
	const meta = { CreationWorks: { '#Works_NumberTales': { Works_Code: 'NTS' }, '#Works_X': {} } };

	it('宣言があれば返す', () => {
		expect(getWorksCode(meta, '#Works_NumberTales')).toBe('NTS');
	});

	it('未宣言・未知の作品は空文字', () => {
		expect(getWorksCode(meta, '#Works_X')).toBe('');
		expect(getWorksCode(meta, '#Works_Unknown')).toBe('');
		expect(getWorksCode(null, '#Works_NumberTales')).toBe('');
	});
});

describe('normalizeBadgeSpec', () => {
	it('文字列の keys をオブジェクトへ揃える', () => {
		const spec = normalizeBadgeSpec({ hashTag: 'Num', $badge: { keys: ['Num'] } });
		expect(spec.keys).toEqual([{ key: 'Num' }]);
		expect(spec.separator).toBe('-');
	});

	it('separator を上書きできる', () => {
		expect(normalizeBadgeSpec({ hashTag: 'Card', $badge: { keys: ['Suit'], separator: '' } }).separator).toBe('');
	});

	it('宣言が無ければ複合 Index の先頭サブキーへフォールバック', () => {
		const spec = normalizeBadgeSpec({ hashTag: 'Card', $type: [{ hashTag: 'Suit' }, { hashTag: 'Num' }] });
		expect(spec.keys).toEqual([{ key: 'Suit' }]);
	});

	it('宣言が無いスカラー Index は root キーへフォールバック', () => {
		expect(normalizeBadgeSpec({ hashTag: 'Num', $type: '#Number' }).keys).toEqual([{ key: 'Num' }]);
	});
});

describe('buildBadgeBody', () => {
	const cardIndexDef = {
		hashTag: 'Card',
		$type: [{ hashTag: 'Suit', $dict: 'Suit' }, { hashTag: 'SuitNum' }, { hashTag: 'Num' }],
		$badge: {
			keys: [
				{ key: 'Suit', codeFrom: 'Suit_Code' },
				{ key: 'SuitNum' },
				{ key: 'Num', whenMissing: 'SuitNum' }
			],
			separator: ''
		}
	};
	const suitLookup = (key, value, column) => {
		const table = { Major: { Suit_Code: 'M' }, Dealer: { Suit_Code: 'D' } };
		return table[value]?.[column] || '';
	};

	it('辞書の短縮コードと数値を連結する', () => {
		expect(buildBadgeBody({ Suit: 'Major', SuitNum: '16', Num: '16' }, cardIndexDef, suitLookup)).toBe('M16');
	});

	it('`whenMissing` は指定サブキーが無いときだけ使われる', () => {
		// SuitNum があるので Num は使われない
		expect(buildBadgeBody({ Suit: 'Major', SuitNum: '0', Num: '22' }, cardIndexDef, suitLookup)).toBe('M0');
		// SuitNum が無いので Num が使われる（Dealer の 79 / 80 を区別できる）
		expect(buildBadgeBody({ Suit: 'Dealer', Num: '79' }, cardIndexDef, suitLookup)).toBe('D79');
		expect(buildBadgeBody({ Suit: 'Dealer', Num: '80' }, cardIndexDef, suitLookup)).toBe('D80');
	});

	it('辞書行が無い値は生値へフォールバックする', () => {
		expect(buildBadgeBody({ Suit: 'FireWands', SuitNum: '1' }, cardIndexDef, suitLookup)).toBe('FireWands1');
	});

	it('lookup が渡されなければ生値を使う', () => {
		expect(buildBadgeBody({ Suit: 'Major', SuitNum: '16' }, cardIndexDef, null)).toBe('Major16');
	});

	it('`prefix` を挟める', () => {
		const def = { hashTag: 'Chronos', $badge: { keys: [{ key: 'Gen', prefix: 'G' }], separator: '' } };
		expect(buildBadgeBody({ Gen: '3' }, def)).toBe('G3');
	});

	it('同じキーを別の辞書列で 2 回引ける（PastDivers の Num + Generation）', () => {
		const def = {
			hashTag: 'Chronos',
			$type: [{ hashTag: 'Lunar', $dict: 'Lunar' }],
			$badge: {
				keys: [
					{ key: 'Lunar', codeFrom: 'Num' },
					{ key: 'Lunar', codeFrom: 'Generation', prefix: 'G' }
				],
				separator: ''
			}
		};
		const lookup = (key, value, column) => ({ Yayoi: { Num: 3, Generation: 3 } })[value]?.[column] ?? '';
		expect(buildBadgeBody({ Lunar: 'Yayoi' }, def, lookup)).toBe('3G3');
	});

	it('値の取れない要素は飛ばす', () => {
		const def = { hashTag: 'X', $badge: { keys: ['A', 'B'], separator: '-' } };
		expect(buildBadgeBody({ A: '1' }, def)).toBe('1');
		expect(buildBadgeBody({ B: '2' }, def)).toBe('2');
	});

	it('何も取れなければ空文字', () => {
		expect(buildBadgeBody({}, { hashTag: 'X', $badge: { keys: ['A'] } })).toBe('');
		expect(buildBadgeBody(null, { hashTag: 'X', $badge: { keys: ['A'] } })).toBe('');
	});
});

describe('レコードのフィールドを参照するバッジ（NumberTales の Num_Badge）', () => {
	// インデックス（`Num`）とは別に用意した短縮コード用フィールドを宣言だけで使えること。
	// インデックスフィールド自体は読むだけで書き換えない
	const def = {
		hashTag: 'Num',
		$type: '#Number|#String',
		$badge: { keys: ['Num_Badge', { key: 'Num', whenMissing: 'Num_Badge' }] }
	};

	it('`Num_Badge` があればそれを使う', () => {
		expect(buildBadgeBody({ Num: '101-mp' }, def, null, { Num: '101-mp', Num_Badge: '101MP' })).toBe('101MP');
	});

	it('`Num_Badge` が無ければ `Num` へフォールバックする', () => {
		expect(buildBadgeBody({ Num: '57' }, def, null, { Num: 57 })).toBe('57');
	});

	it('レコードを渡さなくても `Num` で成立する（後方互換）', () => {
		expect(buildBadgeBody({ Num: '57' }, def)).toBe('57');
	});

	it('`buildBadge` へ record を渡せる', () => {
		const r = buildBadge({
			pairs: { Num: '222-alt' }, indexDef: def, worksCode: 'NTS',
			record: { Num: '222-alt', Num_Badge: '222B' }
		});
		expect(r.badge).toBe('222B');
		expect(r.full).toBe('NTS-222B');
	});
});

describe('buildBadge', () => {
	const def = { hashTag: 'Num', $badge: { keys: ['Num'] } };

	it('既定ではノード内表示用にバッジ本体のみ返す', () => {
		expect(buildBadge({ pairs: { Num: '57' }, indexDef: def, worksCode: 'NTS' }).badge).toBe('57');
	});

	it('`full` は作品コード付き', () => {
		expect(buildBadge({ pairs: { Num: '57' }, indexDef: def, worksCode: 'NTS' }).full).toBe('NTS-57');
	});

	it('`withWorkCode` で作品コード付きを badge へ出せる', () => {
		expect(buildBadge({ pairs: { Num: '57' }, indexDef: def, worksCode: 'NTS', withWorkCode: true }).badge)
			.toBe('NTS-57');
	});

	it('作品コードが無ければバッジ本体だけ', () => {
		expect(buildBadge({ pairs: { Num: '57' }, indexDef: def }).full).toBe('57');
	});
});

describe('createDictCellLookup', () => {
	const indexDef = { hashTag: 'Card', $type: [{ hashTag: 'Suit', $dict: 'Suit' }] };
	const vars = {
		'#List_Suit': [
			{ Suit: 'Major', Suit_JP: 'メジャーズ(大アルカナ)', Suit_Code: 'M' },
			{ Suit: 'Dealer', Suit_JP: '采配者(ディーラー)', Suit_Code: 'D' }
		]
	};

	it('`$dict` 宣言から辞書名を引いて別列の値を返す', () => {
		expect(createDictCellLookup(vars, indexDef)('Suit', 'Major', 'Suit_Code')).toBe('M');
	});

	it('該当行が無ければ空文字（呼び出し側が生値へフォールバックする）', () => {
		expect(createDictCellLookup(vars, indexDef)('Suit', 'Unknown', 'Suit_Code')).toBe('');
	});

	it('`$dict` 宣言が無ければサブキー名を辞書名とみなす', () => {
		const noDict = { hashTag: 'X', $type: [{ hashTag: 'Suit' }] };
		expect(createDictCellLookup(vars, noDict)('Suit', 'Major', 'Suit_Code')).toBe('M');
	});

	it('辞書が無くても落ちない', () => {
		expect(createDictCellLookup({}, indexDef)('Suit', 'Major', 'Suit_Code')).toBe('');
		expect(createDictCellLookup(null, indexDef)('Suit', 'Major', 'Suit_Code')).toBe('');
	});
});

/* ========================================================================
   実データ不変条件
   ======================================================================== */

/**
 * 作品の辞書束（`#List_*` / `#Dict_*`）を組み立てる
 *
 * @description enum/list 辞書は `Dictionaries/dict_*.json` だけでなく
 * `db_meta.json(General.$VarsDef)` と `db_type.json($VarsDef)` からも合成される
 * （AGENTS.md「辞書の実行時合流」）。VirtuesUs の `#List_Virtues`（`Virtues_Num` を持つ）は
 * `DataBases/db_meta.json` 側にしか無いため、両方を積まないとバッジが解決できない。
 * @param {string} workDir @returns {Object}
 */
function loadVarsDef(workDir) {
	const vars = {};

	// (1) 作品・グローバルの db_meta.json / db_type.json の $VarsDef
	for (const p of [
		'data/db_meta.json',
		`data/${workDir}/DataBases/db_meta.json`,
		`data/${workDir}/DataBases/db_type.json`
	]) {
		const abs = path.resolve(repoRoot, p);
		if (!existsSync(abs)) continue;
		let doc;
		try { doc = JSON.parse(readFileSync(abs, 'utf-8')); } catch { continue; }
		for (const src of [doc?.General?.$VarsDef, doc?.$VarsDef, doc?.General?.$VersDef, doc?.$VersDef]) {
			if (!src || typeof src !== 'object') continue;
			for (const [k, v] of Object.entries(src)) {
				if (Array.isArray(v)) vars[k] = v;
			}
		}
	}

	// (2) 辞書ファイル
	for (const d of ['data/Dictionaries', `data/${workDir}/Dictionaries`]) {
		const abs = path.resolve(repoRoot, d);
		if (!existsSync(abs)) continue;
		const metaPath = path.join(abs, 'db_meta.json');
		const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : null;
		for (const f of globSync(`${d}/*.json`, { cwd: repoRoot })) {
			const base = path.basename(f);
			if (base === 'db_meta.json' || base === 'db_type.json') continue;
			let rows;
			try { rows = readJson(f); } catch { continue; }
			if (!Array.isArray(rows)) continue;
			const name = base.replace(/^(dict_|sec_)/, '').replace(/\.json$/, '');
			vars[`#List_${name}`] = rows;
			vars[`#Dict_${name}`] = rows;
			const cat = meta?.Dictionaries?.[`#Dict_${name}`];
			if (cat?.compatListKey) vars[cat.compatListKey] = (vars[cat.compatListKey] || []).concat(rows);
		}
	}
	return vars;
}

describe('実データ不変条件', () => {
	const globalMeta = readJson('data/db_meta.json');
	const workTypePaths = globSync('data/Works_*/DataBases/db_type.json', { cwd: repoRoot });

	it('全 9 作品に `Works_Code`（3 文字）が宣言されている', () => {
		const missing = [];
		for (const p of workTypePaths) {
			const workDir = p.split(/[/\\]/)[1];
			const workId = `#Works_${workDir.replace('Works_', '')}`;
			const code = getWorksCode(globalMeta, workId);
			if (!/^[A-Z]{3}$/.test(code)) missing.push(`${workId}=${code || '(未宣言)'}`);
		}
		expect(missing, `Works_Code が 3 文字の大文字でない: ${missing.join(', ')}`).toEqual([]);
	});

	it('`Works_Code` は作品間で重複しない', () => {
		const codes = Object.entries(globalMeta.CreationWorks || {})
			.map(([, v]) => v?.Works_Code)
			.filter(Boolean);
		expect(new Set(codes).size).toBe(codes.length);
	});

	it('NumberTales の全レコードが `Num_Badge` を持ち、6 文字以内である', () => {
		const long = [];
		const missing = [];
		for (const p of globSync('data/Works_NumberTales/DataBases/db_*.json', { cwd: repoRoot })) {
			if (/db_(meta|type)\.json$/.test(path.basename(p))) continue;
			const recs = readJson(p);
			if (!Array.isArray(recs)) continue;
			for (const r of recs) {
				if (r?.Num === undefined || r?.Num === null) continue;
				const b = r.Num_Badge;
				if (typeof b !== 'string' || !b) { missing.push(`${path.basename(p)} Num=${JSON.stringify(r.Num)}`); continue; }
				if (b.length > 6) long.push(`${b}(${b.length}) <- ${JSON.stringify(r.Num)}`);
			}
		}
		expect(missing, `Num_Badge が無い: ${missing.slice(0, 5).join(' / ')}`).toEqual([]);
		expect(long, `6 文字を超える: ${long.slice(0, 5).join(' / ')}`).toEqual([]);
	});

	it('`Num_Badge` はレコードのキー順で `Num` の直後にある', () => {
		const bad = [];
		for (const p of globSync('data/Works_NumberTales/DataBases/db_*.json', { cwd: repoRoot })) {
			if (/db_(meta|type)\.json$/.test(path.basename(p))) continue;
			const recs = readJson(p);
			if (!Array.isArray(recs)) continue;
			for (const r of recs) {
				const keys = Object.keys(r);
				const i = keys.indexOf('Num');
				if (i < 0 || !keys.includes('Num_Badge')) continue;
				if (keys[i + 1] !== 'Num_Badge') bad.push(`${path.basename(p)} Num=${JSON.stringify(r.Num)} -> ${keys[i + 1]}`);
			}
		}
		expect(bad, `Num の直後に無い: ${bad.slice(0, 5).join(' / ')}`).toEqual([]);
	});

	it('`Num` フィールドは侵食されていない（型と値がそのまま）', () => {
		// Num_Badge の導入で Num が文字列化されたりしていないこと
		const primary = readJson('data/Works_NumberTales/DataBases/db_Primary.json');
		const num57 = primary.find(r => r.Num === 57);
		expect(num57, 'Num=57（数値型）が見つからない').toBeTruthy();
		expect(typeof num57.Num).toBe('number');
		const alt = primary.find(r => r.Num === '2-alt');
		expect(alt, 'Num="2-alt"（文字列型）が見つからない').toBeTruthy();
		expect(alt.Num_Badge).toBe('2B');
	});

	for (const typePath of workTypePaths) {
		const workDir = typePath.split(/[/\\]/)[1];
		const workId = `#Works_${workDir.replace('Works_', '')}`;
		const typeDef = readJson(typePath);
		const dbPaths = globSync(`data/${workDir}/DataBases/db_*.json`, { cwd: repoRoot })
			.filter(p => !/db_(meta|type)\.json$/.test(path.basename(p)));

		for (const dbPath of dbPaths) {
			const dbName = /^db_(.+)\.json$/.exec(path.basename(dbPath))[1];

			it(`${workDir.replace('Works_', '')}/${dbName} のバッジが一意かつ非空`, () => {
				const recs = readJson(dbPath);
				if (!Array.isArray(recs) || recs.length === 0) return;

				const indexDef = resolveIndexDef(typeDef, dbName);
				if (!indexDef) return;

				const code = getWorksCode(globalMeta, workId);
				const lookup = createDictCellLookup(loadVarsDef(workDir), indexDef);

				const seen = new Map();
				const dups = [];
				const empties = [];
				for (const rec of recs) {
					const pairs = extractIndexPairs(rec, indexDef);
					if (!pairs) continue;
					const { badge } = buildBadge({ pairs, indexDef, worksCode: code, lookupDictCell: lookup, record: rec });
					const name = rec.Name_JP || rec.FormalName_JP || rec.Name || JSON.stringify(pairs);
					if (!badge) { empties.push(name); continue; }
					if (seen.has(badge)) dups.push(`${badge}（${seen.get(badge)} / ${name}）`);
					else seen.set(badge, name);
				}

				expect(empties, `バッジが空: ${empties.slice(0, 5).join(' / ')}`).toEqual([]);
				expect(dups, `バッジが重複: ${dups.slice(0, 5).join(' / ')}`).toEqual([]);
			});
		}
	}
});
