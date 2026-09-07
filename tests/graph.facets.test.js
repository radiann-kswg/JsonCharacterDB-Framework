/**
 * lib/graph/graph-facets.js（相関図のグルーピング軸）の単体テスト
 *
 * 守りたい性質:
 * 1. **宣言駆動** — 軸は `$display.facet` 宣言からのみ集める。field 名で分岐しない
 * 2. **形の違いを吸収** — `Belonging[]`（object 配列）/ `Class[]`（文字列配列）/
 *    `FromArea`（単一 object）/ `Progress`（スカラー）を同じ経路で扱う
 * 3. **多値は組み合わせ専用グループへ** — 1 キャラが複数値を持つ場合、A・B 両方の値を持つなら
 *    「A」「B」ではなく「A,B」という専用グループへ 1 回だけ属する（1 キャラ = 1 グループ、重複配置しない）
 * 4. **`hideText` を値にしない** — 意図的マスクはグループを作らない
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';
import {
	collectFacets,
	buildHierarchy,
	collectMapPartition,
	classifyMapPartition,
	extractFacetValues,
	resolveFacetLabel,
	groupNodesByFacet,
	selectUsableFacets,
	comboKeyForValues,
	UNSET_GROUP_KEY
} from '../lib/graph/graph-facets.js';

const repoRoot = process.cwd();
const readJson = (p) => JSON.parse(readFileSync(path.resolve(repoRoot, p), 'utf-8'));

const FACET_BELONGING = { key: 'Belonging', path: 'Faction', maxGroups: 12 };
const FACET_CLASS = { key: 'Class', path: '', maxGroups: 12 };
const FACET_AREA = { key: 'FromArea', path: 'Area', maxGroups: 12 };

describe('collectFacets', () => {
	const globalTypeDef = {
		$DefType: [
			{ hashTag: 'Belonging', $dict: 'Faction', hashTag_JP: '所属', $display: { facet: { path: 'Faction', order: 10 } } },
			{ hashTag: 'Class', $dict: 'Class', hashTag_JP: 'クラス名', $display: { facet: { order: 30, maxGroups: 5 } } },
			{ hashTag: 'Name_JP', $display: { section: 'basic' } },
			{ $slot: '#Index', $slotMatch: { $type: '#Index' } }
		],
		$MetaType: {
			$Def_SecondaryMeta: [{ hashTag: 'sec_Category', hashTag_JP: '二次創作分類', $display: { facet: { order: 90 } } }]
		}
	};

	it('`$display.facet` を持つフィールドだけを集める', () => {
		const facets = collectFacets(globalTypeDef);
		expect(facets.map(f => f.key)).toEqual(['Belonging', 'Class', 'sec_Category']);
	});

	it('`order` の昇順に並ぶ', () => {
		expect(collectFacets(globalTypeDef).map(f => f.order)).toEqual([10, 30, 90]);
	});

	it('`path` / `maxGroups` / ラベルを宣言から取る', () => {
		const [belonging, cls] = collectFacets(globalTypeDef);
		expect(belonging.path).toBe('Faction');
		expect(belonging.label_JP).toBe('所属');
		expect(belonging.maxGroups).toBe(12);
		expect(cls.path).toBe('');
		expect(cls.maxGroups).toBe(5);
	});

	it('`$MetaType` 配下（`$slotExpand` で展開されるもの）も拾う', () => {
		expect(collectFacets(globalTypeDef).some(f => f.key === 'sec_Category')).toBe(true);
	});

	it('作品別 typedef の宣言も拾い、グローバル宣言を上書きしない', () => {
		const workTypeDefs = {
			'#Works_X': {
				$DefType: [
					{ hashTag: 'Belonging', $display: { facet: { order: 999 } } },
					{ hashTag: 'Branch', hashTag_JP: '岐路(ブランチ)', $display: { facet: { order: 5 } } }
				]
			}
		};
		const facets = collectFacets(globalTypeDef, workTypeDefs);
		expect(facets.find(f => f.key === 'Belonging').order).toBe(10); // グローバル優先
		expect(facets[0].key).toBe('Branch');                            // 宣言だけで軸が増える
	});

	it('宣言が無ければ空配列', () => {
		expect(collectFacets({ $DefType: [{ hashTag: 'X' }] })).toEqual([]);
		expect(collectFacets(null)).toEqual([]);
	});
});

describe('extractFacetValues', () => {
	it('object 配列から `path` の子要素を取る（Belonging）', () => {
		const rec = { Belonging: [{ Faction: '百花繚乱研究所' }, { Faction: '夜月機関' }] };
		expect(extractFacetValues(rec, FACET_BELONGING)).toEqual(['百花繚乱研究所', '夜月機関']);
	});

	it('文字列配列はそのまま（Class）', () => {
		expect(extractFacetValues({ Class: ['1桁番(ユニデジッツ)', '試験用個体'] }, FACET_CLASS))
			.toEqual(['1桁番(ユニデジッツ)', '試験用個体']);
	});

	it('単一 object から `path` を取る（FromArea）', () => {
		expect(extractFacetValues({ FromArea: { Area: '九蓮国', BaseAreaAbout_JP: '自称' } }, FACET_AREA))
			.toEqual(['九蓮国']);
	});

	it('スカラーはそのまま（Progress）', () => {
		expect(extractFacetValues({ Progress: 'released' }, { key: 'Progress', path: '' })).toEqual(['released']);
	});

	it('`#DictIndex_withAbout` 形式は value を取る', () => {
		expect(extractFacetValues({ RaceType: { value: 'Human', about_JP: '補足' } }, { key: 'RaceType', path: '' }))
			.toEqual(['Human']);
	});

	it('`hideText` は値にしない（意図的マスクを尊重する）', () => {
		expect(extractFacetValues({ Belonging: { hideText: '削除済み' } }, FACET_BELONGING)).toEqual([]);
		expect(extractFacetValues({ Class: [{ hideText: '？？？' }] }, FACET_CLASS)).toEqual([]);
	});

	it('重複を除く', () => {
		expect(extractFacetValues({ Class: ['A', 'A', 'B'] }, FACET_CLASS)).toEqual(['A', 'B']);
	});

	it('値が無ければ空配列', () => {
		expect(extractFacetValues({}, FACET_BELONGING)).toEqual([]);
		expect(extractFacetValues({ Belonging: [] }, FACET_BELONGING)).toEqual([]);
		expect(extractFacetValues({ Belonging: null }, FACET_BELONGING)).toEqual([]);
		expect(extractFacetValues(null, FACET_BELONGING)).toEqual([]);
	});
});

describe('resolveFacetLabel', () => {
	it('辞書引き関数があればそれを使う', () => {
		const resolveLabel = () => ({ jp: '百花繚乱研究所', en: 'HundredBeauties Laboratory' });
		expect(resolveFacetLabel(FACET_BELONGING, 'x', { resolveLabel }))
			.toEqual({ jp: '百花繚乱研究所', en: 'HundredBeauties Laboratory' });
	});

	it('辞書引きが空なら生値へフォールバック', () => {
		expect(resolveFacetLabel(FACET_BELONGING, '夜月機関', { resolveLabel: () => null }))
			.toEqual({ jp: '夜月機関', en: '夜月機関' });
	});

	it('EN が無ければ JP で埋める', () => {
		expect(resolveFacetLabel(FACET_BELONGING, 'x', { resolveLabel: () => ({ jp: '和名' }) }).en).toBe('和名');
	});

	it('空値は (未設定)', () => {
		expect(resolveFacetLabel(FACET_BELONGING, '').jp).toBe('(未設定)');
	});
});

describe('groupNodesByFacet', () => {
	const nodes = [
		{ key: 'a', record: { Belonging: [{ Faction: 'X' }] } },
		{ key: 'b', record: { Belonging: [{ Faction: 'X' }, { Faction: 'Y' }] } },
		{ key: 'c', record: { Belonging: [{ Faction: 'Y' }] } },
		{ key: 'd', record: {} }
	];

	it('値ごとにノードを束ね、件数の多い順に並べる（同数は組み合わせキーの昇順）', () => {
		const { groups } = groupNodesByFacet(nodes, FACET_BELONGING, { includeUnset: false });
		// a→X, b→X,Y（組み合わせ専用グループ）, c→Y。3 グループとも 1 件ずつなので
		// 件数タイの場合は value の文字列昇順（'X' < 'X,Y' < 'Y'）
		expect(groups.map(g => g.value)).toEqual(['X', 'X,Y', 'Y']);
		expect(groups.find(g => g.value === 'X').members).toEqual(['a']);
		expect(groups.find(g => g.value === 'Y').members).toEqual(['c']);
	});

	it('複数値のノードは組み合わせ専用グループへ 1 回だけ属する（重複配置しない）', () => {
		const { groups, byNode, multiValued } = groupNodesByFacet(nodes, FACET_BELONGING, { includeUnset: false });
		expect(multiValued).toBe(true);
		expect(byNode.get('b')).toEqual(['X', 'Y']);
		// 「X」「Y」それぞれの単独グループには b が含まれない（重複配置の廃止）
		expect(groups.find(g => g.value === 'X').members).not.toContain('b');
		expect(groups.find(g => g.value === 'Y').members).not.toContain('b');
		// b は「X,Y」という専用グループへだけ属する
		const combo = groups.find(g => g.value === 'X,Y');
		expect(combo).toBeTruthy();
		expect(combo.members).toEqual(['b']);
		expect(combo.combo).toBe(true);
		// ラベルは各値のラベルを × で結合したもの（辞書解決なしなら生値のまま）
		expect(combo.label_JP).toBe('X×Y');
	});

	it('値が無いノードは (未設定) グループへ入り、末尾に置かれる', () => {
		const { groups } = groupNodesByFacet(nodes, FACET_BELONGING);
		expect(groups[groups.length - 1].value).toBe(UNSET_GROUP_KEY);
		expect(groups[groups.length - 1].members).toEqual(['d']);
	});

	it('`includeUnset: false` なら (未設定) を作らない', () => {
		const { groups } = groupNodesByFacet(nodes, FACET_BELONGING, { includeUnset: false });
		expect(groups.some(g => g.value === UNSET_GROUP_KEY)).toBe(false);
	});

	it('どの値の組み合わせでも、同じキャラが複数グループのメンバーに現れることはない', () => {
		const { groups } = groupNodesByFacet(nodes, FACET_BELONGING);
		const seen = new Set();
		for (const g of groups) {
			for (const key of g.members) {
				expect(seen.has(key), `${key} が複数グループに重複配置されている`).toBe(false);
				seen.add(key);
			}
		}
	});

	it('統計を返す（多値判定と被覆率。組み合わせも 1 つの値として数える）', () => {
		const { stats } = groupNodesByFacet(nodes, FACET_BELONGING);
		expect(stats.nodeCount).toBe(4);
		expect(stats.valueCount).toBe(3); // X / X,Y / Y の 3 グループ
		expect(stats.multiValuedNodes).toBe(1);
		expect(stats.unsetNodes).toBe(1);
		expect(stats.coverage).toBeCloseTo(0.75);
	});

	it('空入力でも落ちない', () => {
		const { groups, stats } = groupNodesByFacet([], FACET_BELONGING);
		expect(groups).toEqual([]);
		expect(stats.coverage).toBe(0);
	});
});

describe('comboKeyForValues', () => {
	it('単一値ならその値のまま', () => {
		expect(comboKeyForValues(['A'])).toBe('A');
	});

	it('複数値は重複除去・ソートしてから `,` で結合する（並び順に依存しない）', () => {
		expect(comboKeyForValues(['B', 'A'])).toBe('A,B');
		expect(comboKeyForValues(['A', 'B'])).toBe('A,B');
		expect(comboKeyForValues(['A', 'A', 'B'])).toBe('A,B'); // 重複除去
	});

	it('値が無ければ UNSET_GROUP_KEY', () => {
		expect(comboKeyForValues([])).toBe(UNSET_GROUP_KEY);
		expect(comboKeyForValues(null)).toBe(UNSET_GROUP_KEY);
	});
});

describe('selectUsableFacets', () => {
	const facets = [
		{ key: 'Good', path: '', maxGroups: 12 },
		{ key: 'OneValue', path: '', maxGroups: 12 },
		{ key: 'Rare', path: '', maxGroups: 12 }
	];
	const nodes = Array.from({ length: 100 }, (_, i) => ({
		key: `n${i}`,
		record: {
			Good: i % 2 === 0 ? 'A' : 'B',
			OneValue: 'same',                 // 値が 1 種しかない → 図が変わらない
			...(i < 2 ? { Rare: `R${i}` } : {}) // 被覆率 2% → 低すぎる
		}
	}));

	it('値が 1 種しかない軸を落とす', () => {
		expect(selectUsableFacets(facets, nodes).some(f => f.key === 'OneValue')).toBe(false);
	});

	it('被覆率が低すぎる軸を落とす', () => {
		expect(selectUsableFacets(facets, nodes).some(f => f.key === 'Rare')).toBe(false);
	});

	it('使える軸には stats が付く', () => {
		const good = selectUsableFacets(facets, nodes).find(f => f.key === 'Good');
		expect(good.stats.valueCount).toBe(2);
		expect(good.stats.coverage).toBe(1);
	});

	it('しきい値を上書きできる', () => {
		expect(selectUsableFacets(facets, nodes, { minCoverage: 0.01 }).some(f => f.key === 'Rare')).toBe(true);
	});
});

describe('collectMapPartition / classifyMapPartition', () => {
	const globalTypeDef = {
		$MetaType: {
			$Def_SecondaryMeta: [{
				hashTag: 'sec_DesignedBy',
				$dict: 'DesignedBy',
				$display: { mapPartition: { ownerFlag: 'isOwner', sharedLabel_JP: '共同二次創作' } }
			}]
		}
	};
	const partition = collectMapPartition(globalTypeDef);
	// 本人フラグは辞書行に立てる（コードへ人名を埋め込まない）
	const rows = [{ DesignedBy: 'RadianN', isOwner: true }, { DesignedBy: 'Atast' }];
	const lookup = (field, value, column) => rows.find(r => r.DesignedBy === value)?.[column];

	it('宣言を集められる', () => {
		expect(partition.field).toBe('sec_DesignedBy');
		expect(partition.ownerFlag).toBe('isOwner');
		expect(partition.sharedLabel_JP).toBe('共同二次創作');
	});

	it('本人だけなら own', () => {
		expect(classifyMapPartition({ sec_DesignedBy: ['RadianN'] }, partition, lookup)).toBe('own');
	});

	it('他者が 1 人でも混ざれば shared', () => {
		expect(classifyMapPartition({ sec_DesignedBy: ['Atast'] }, partition, lookup)).toBe('shared');
		expect(classifyMapPartition({ sec_DesignedBy: ['RadianN', 'Atast'] }, partition, lookup)).toBe('shared');
	});

	it('値が無ければ own（一次創作など）', () => {
		expect(classifyMapPartition({}, partition, lookup)).toBe('own');
		expect(classifyMapPartition({ sec_DesignedBy: null }, partition, lookup)).toBe('own');
	});

	it('辞書で本人と確認できない値は shared 側へ倒す（安全側）', () => {
		expect(classifyMapPartition({ sec_DesignedBy: ['Unknown'] }, partition, lookup)).toBe('shared');
	});

	it('宣言が無ければ常に own', () => {
		expect(classifyMapPartition({ sec_DesignedBy: ['Atast'] }, null, lookup)).toBe('own');
	});

	it('実データの `sec_DesignedBy` 辞書に本人フラグが立っている', () => {
		const dict = readJson('data/Dictionaries/sec_DesignedBy.json');
		const owners = dict.filter(r => r.isOwner === true);
		expect(owners.length, '本人フラグ（isOwner: true）を持つ行が無い').toBeGreaterThan(0);
		expect(dict.some(r => r.isOwner !== true), '他者の行が無いと分割の意味が無い').toBe(true);
	});

	it('実データの typedef に `mapPartition` が宣言されている', () => {
		const real = collectMapPartition(readJson('data/db_type.json'));
		expect(real).toBeTruthy();
		expect(real.field).toBe('sec_DesignedBy');
	});
});

describe('実データ不変条件', () => {
	const globalTypeDef = readJson('data/db_type.json');
	const workTypeDefs = {};
	for (const p of globSync('data/Works_*/DataBases/db_type.json', { cwd: repoRoot })) {
		const workDir = p.split(/[/\\]/)[1];
		workTypeDefs[`#Works_${workDir.replace('Works_', '')}`] = readJson(p);
	}
	const facets = collectFacets(globalTypeDef, workTypeDefs);

	it('グローバルの 6 軸が宣言されている', () => {
		const globalKeys = facets.filter(f => f.scope === 'global').map(f => f.key);
		expect(globalKeys).toEqual(['Belonging', 'FromArea', 'Class', 'Progress', 'RaceType', 'GenderType']);
	});

	it('`$IndexDef` の子要素も軸になる（作品ごとの Index 別グルーピング）', () => {
		const indexFacets = facets.filter(f => f.key.includes('.'));
		expect(indexFacets.map(f => f.key)).toContain('Card.Suit');           // FLI78 のカード種別
		expect(indexFacets.map(f => f.key)).toContain('Model.ModelSeries');   // UnauthedLogica の型式
		// `key` は `<root>.<sub>` だが、レコード上のフィールドは root
		expect(indexFacets.find(f => f.key === 'Card.Suit').field).toBe('Card');
		expect(indexFacets.find(f => f.key === 'Card.Suit').path).toBe('Suit');
	});

	it('世代（`AlphaGen` / `Chronos.Generation`）は軸として宣言していない', () => {
		// 値の種類が 2〜3 しか無く、区画に分けても視覚的な違いが乏しいため
		// 宣言ごと外している（User 判断）。宣言を消すだけで軸が消えるのがスキーマ駆動の狙い
		expect(facets.map(f => f.key)).not.toContain('Letter.AlphaGen');
		expect(facets.map(f => f.key)).not.toContain('Chronos.Generation');
	});

	it('階層（`hierarchy`）を宣言した軸だけがドリルダウンの段になる', () => {
		const levels = buildHierarchy(facets, { scope: '#Works_FLInvestigator78' });
		expect(levels[0].kind).toBe('work');
		expect(levels.map(l => l.key)).toEqual(['work', 'Belonging', 'Card.Suit', 'Class']);
		// DB 別は宣言していないので階層に出ない
		expect(levels.some(l => l.key === 'db')).toBe(false);
		// 階層を宣言していない軸（グルーピング専用）も出ない
		expect(levels.some(l => l.key === 'Progress')).toBe(false);
	});

	it('作品ごとに階層が変わる（宣言のスコープに従う）', () => {
		const ual = buildHierarchy(facets, { scope: '#Works_UnauthedLogica' }).map(l => l.key);
		const nts = buildHierarchy(facets, { scope: '#Works_NumberTales' }).map(l => l.key);
		expect(ual).toContain('Model.ModelSeries');
		expect(nts).not.toContain('Model.ModelSeries');
		expect(nts).not.toContain('Card.Suit');
	});

	it('構造型の軸には `path` が宣言されている（コード側で子要素名を決め打ちしないため）', () => {
		expect(facets.find(f => f.key === 'Belonging').path).toBe('Faction');
		expect(facets.find(f => f.key === 'FromArea').path).toBe('Area');
	});

	it('多値ノードは組み合わせ専用グループへ入り、上位クラスと混ざらない（`groupNodesByFacet` との統合確認）', () => {
		// `Class` は 1 キャラが最大 5 個持つ。2026-08-04 の「その他」撤去後は、
		// 上位クラス単独のグループへレアな組み合わせのキャラが紛れ込まないことを確認する
		// （複数値は専用の組み合わせグループへ 1 回だけ配置されるため、単独グループには現れない）。
		const facet = { key: 'Class', field: 'Class', label_JP: 'クラス', label_EN: 'Class' };
		const nodes = [
			{ key: 'a1', record: { Class: ['A'] } },
			{ key: 'a2', record: { Class: ['A'] } },
			{ key: 'b1', record: { Class: ['B'] } },
			// 上位(A)とレア(rare1)の両方を持つ。「A」単独グループには入らない
			{ key: 'mixed', record: { Class: ['A', 'rare1'] } },
			{ key: 'only1', record: { Class: ['rare1'] } }
		];

		const { groups } = groupNodesByFacet(nodes, facet, { includeUnset: false });
		expect(groups.find(g => g.value === 'A').members).not.toContain('mixed');
		expect(groups.find(g => g.value === 'A,rare1').members).toEqual(['mixed']);
		expect(groups.find(g => g.value === 'rare1').members).toEqual(['only1']);
	});

	it('`Class` は値の種類が多いので `maxGroups` が宣言されている（2026-08-04 以降は集計に未使用の互換フィールド）', () => {
		expect(facets.find(f => f.key === 'Class').maxGroups).toBeLessThanOrEqual(12);
	});

	it('生レコードでも各軸が値を取り出せる（宣言と実データの形が合っている）', () => {
		const nodes = [];
		for (const p of globSync('data/Works_*/DataBases/db_*.json', { cwd: repoRoot })) {
			const base = path.basename(p);
			if (/^db_(meta|type)\.json$/.test(base)) continue;
			let recs;
			try { recs = readJson(p); } catch { continue; }
			if (!Array.isArray(recs)) continue;
			recs.forEach((r, i) => nodes.push({ key: `${p}|${i}`, record: r }));
		}
		expect(nodes.length).toBeGreaterThan(1000);

		const dead = [];
		for (const f of facets) {
			// `dictRef` の軸はレコードに値が無く辞書行から引くため、辞書を渡さないこのケースでは対象外
			if (f.dictRef) continue;
			const { stats } = groupNodesByFacet(nodes, f, { includeUnset: false });
			// 生レコード（_Commons 未適用）でも 1 件以上は値が取れるはず。
			// 0 なら宣言の `path` が実データの形と食い違っている
			if (stats.valueCount === 0) dead.push(f.key);
		}
		expect(dead, `実データから値を 1 件も取り出せない軸: ${dead.join(', ')}`).toEqual([]);
	});

	it('`dictRef` の軸は辞書を渡せば値が取れる', () => {
		// `dictRef` は「兄弟の辞書コードが指す辞書行の値で束ねる」機構。
		// 実データでの唯一の利用箇所だった PastDivers の月暦の世代は
		// 「値の種類が少なく区画に分けても違いが乏しい」ため軸の宣言を外したので、
		// **機構そのものは合成データで押さえる**（データ側の都合でカバレッジが落ちないように）
		const facet = {
			key: 'Chronos.Generation', field: 'Chronos', path: 'Generation',
			dictRef: { from: 'Lunar', field: 'Generation' },
			label_JP: '月暦の世代', label_EN: 'Generation'
		};
		const dict = [
			{ Lunar: 'Mutsuki', Generation: 1 },
			{ Lunar: 'Kisaragi', Generation: 1 },
			{ Lunar: 'Yayoi', Generation: 2 }
		];
		const lookup = (key, value, column) => dict.find(r => r.Lunar === value)?.[column];

		const nodes = [
			{ key: 'a', record: { Chronos: { Lunar: 'Mutsuki' } } },
			{ key: 'b', record: { Chronos: { Lunar: 'Kisaragi' } } },
			{ key: 'c', record: { Chronos: { Lunar: 'Yayoi' } } }
		];

		const { groups, stats } = groupNodesByFacet(nodes, facet, { includeUnset: false, lookupDictCell: lookup });
		expect(stats.valueCount).toBe(2);           // 世代 1 と 2
		expect(stats.coverage).toBe(1);
		expect(groups.find(g => String(g.value) === '1').members.sort()).toEqual(['a', 'b']);
	});
});
