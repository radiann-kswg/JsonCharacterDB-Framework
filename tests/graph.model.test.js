/**
 * lib/graph/graph-model.js（相関図のグラフモデル構築）の単体テスト
 *
 * 守りたい性質:
 * 1. **ノードキーの一意性** — 全サブキーをキー名昇順ソートして連結する方式が、
 *    実データ（各作品の `DataBases` 配下の `db_` レコードファイル）で衝突しないこと。
 *    「最初の非空サブキー 1 個」で識別する旧方式は 5 作品 8 DB で破綻する
 * 2. **スキーマ駆動のエッジ分類** — field 名ではなく宣言述語
 *    （`$display.sectionWrapper` / `$type` の `$Def_DBLinkRef` / `$enrich`）で判定すること
 * 3. **部分集合一致** — `_DBLink` ペイロードが対象より少ないキーしか持たなくても解決でき、
 *    かつ一意に定まらないときは**エッジを張らない**こと
 * 4. **相互参照の畳み込み** — a→b と b→a が 1 本の無向エッジ（`direction: 'mutual'`）になること
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import {
	EDGE_KINDS,
	normalizeWorkId,
	normalizeDbSuffix,
	resolveIndexDef,
	getIndexSubKeys,
	serializeIndexPairs,
	buildNodeKey,
	extractIndexPairs,
	extractDbLinkPairs,
	isPairsSubset,
	classifyRelationFields,
	pickRecordName,
	createUnionFind,
	buildGraph,
	computeWorkDensity
} from '../lib/graph/graph-model.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename));

/** NumberTales 相当（スカラー Index） */
const SCALAR_INDEX_DEF = { hashTag: 'Num', $type: '#Number|#String' };

/** FLInvestigator78 相当（複合 Index） */
const COMPOSITE_INDEX_DEF = {
	hashTag: 'Card',
	$type: [
		{ hashTag: 'Suit', $type: '#IndexListKey' },
		{ hashTag: 'SuitNum', $type: '#Number|#Null' },
		{ hashTag: 'Num', $type: '#Number' }
	]
};

describe('作品ID / DB名の正規化', () => {
	it('作品IDを `#Works_X` へ揃える', () => {
		expect(normalizeWorkId('NumberTales')).toBe('#Works_NumberTales');
		expect(normalizeWorkId('Works_NumberTales')).toBe('#Works_NumberTales');
		expect(normalizeWorkId('#Works_NumberTales')).toBe('#Works_NumberTales');
		expect(normalizeWorkId('')).toBe('');
	});

	it('DB名からメタ接頭辞を落として先頭を大文字にする', () => {
		expect(normalizeDbSuffix('#DB_Primary')).toBe('Primary');
		expect(normalizeDbSuffix('primaryMobs')).toBe('PrimaryMobs');
		expect(normalizeDbSuffix('#Ref_Vocabulary')).toBe('Vocabulary');
		expect(normalizeDbSuffix('')).toBe('');
	});
});

describe('resolveIndexDef', () => {
	const typeDef = {
		$IndexDef: { hashTag: 'Model', $type: [{ hashTag: 'ModelSeries' }, { hashTag: 'Num' }] },
		$IndexDef_PrimaryMobs: { hashTag: 'Logic', $type: [{ hashTag: 'LogicSeries' }, { hashTag: 'Num' }] }
	};

	it('既定は `$IndexDef`', () => {
		expect(resolveIndexDef(typeDef, 'Primary').hashTag).toBe('Model');
	});

	it('DB単位の上書き `$IndexDef_<DbNorm>` が優先される', () => {
		expect(resolveIndexDef(typeDef, 'PrimaryMobs').hashTag).toBe('Logic');
	});

	it('typedef が無ければ null', () => {
		expect(resolveIndexDef(null, 'Primary')).toBeNull();
		expect(resolveIndexDef({}, 'Primary')).toBeNull();
	});
});

describe('getIndexSubKeys', () => {
	it('複合ならサブキー名の配列', () => {
		expect(getIndexSubKeys(COMPOSITE_INDEX_DEF)).toEqual(['Suit', 'SuitNum', 'Num']);
	});

	it('スカラーなら null', () => {
		expect(getIndexSubKeys(SCALAR_INDEX_DEF)).toBeNull();
	});
});

describe('serializeIndexPairs（キー名昇順ソートが本体）', () => {
	it('キー順が違っても同じ文字列になる', () => {
		const a = serializeIndexPairs({ Suit: 'Major', SuitNum: 16, Num: 16 });
		const b = serializeIndexPairs({ Num: 16, Suit: 'Major', SuitNum: 16 });
		expect(a).toBe(b);
		expect(a).toBe('Num=16,Suit=Major,SuitNum=16');
	});

	it('JSON.stringify と違い入力順に依存しない', () => {
		// `_DBLink` ペイロードは Card{Suit,SuitNum} と Card{Suit,Num} で順序が揺れている
		const s1 = JSON.stringify({ Suit: 'Major', SuitNum: 16 });
		const s2 = JSON.stringify({ SuitNum: 16, Suit: 'Major' });
		expect(s1).not.toBe(s2); // JSON は揺れる
		expect(serializeIndexPairs({ Suit: 'Major', SuitNum: 16 }))
			.toBe(serializeIndexPairs({ SuitNum: 16, Suit: 'Major' })); // こちらは揺れない
	});

	it('空入力は空文字', () => {
		expect(serializeIndexPairs(null)).toBe('');
		expect(serializeIndexPairs({})).toBe('');
	});
});

describe('buildNodeKey', () => {
	it('作品 / DB / インデックスの 3 セグメント', () => {
		expect(buildNodeKey('NumberTales', 'Primary', { Num: 57 }))
			.toBe('#Works_NumberTales|Primary|Num=57');
	});
});

describe('extractIndexPairs', () => {
	it('スカラー Index はそのまま 1 ペア', () => {
		expect(extractIndexPairs({ Num: 57 }, SCALAR_INDEX_DEF)).toEqual({ Num: '57' });
		expect(extractIndexPairs({ Num: '2-alt' }, SCALAR_INDEX_DEF)).toEqual({ Num: '2-alt' });
	});

	it('複合 Index は root 配下を展開する', () => {
		expect(extractIndexPairs({ Card: { Suit: 'Major', SuitNum: 16, Num: 16 } }, COMPOSITE_INDEX_DEF))
			.toEqual({ Suit: 'Major', SuitNum: '16', Num: '16' });
	});

	it('root を省いたフラット形も受理する', () => {
		expect(extractIndexPairs({ Suit: 'Major', SuitNum: 16 }, COMPOSITE_INDEX_DEF))
			.toEqual({ Suit: 'Major', SuitNum: '16' });
	});

	it('空値のサブキーは含めない（部分集合一致で扱うため）', () => {
		expect(extractIndexPairs({ Card: { Suit: 'Major', SuitNum: null, Num: '' } }, COMPOSITE_INDEX_DEF))
			.toEqual({ Suit: 'Major' });
	});

	it('サブキーの値がオブジェクトなら識別子として使わない', () => {
		expect(extractIndexPairs({ Card: { Suit: { nested: 1 }, SuitNum: 3 } }, COMPOSITE_INDEX_DEF))
			.toEqual({ SuitNum: '3' });
	});

	it('取り出せなければ null', () => {
		expect(extractIndexPairs({}, SCALAR_INDEX_DEF)).toBeNull();
		expect(extractIndexPairs({ Num: null }, SCALAR_INDEX_DEF)).toBeNull();
		expect(extractIndexPairs({ Other: 1 }, COMPOSITE_INDEX_DEF)).toBeNull();
		expect(extractIndexPairs(null, SCALAR_INDEX_DEF)).toBeNull();
	});
});

describe('extractDbLinkPairs', () => {
	it('センチネルキー（_Work / _DB / label_*）を除いてインデックスを取り出す', () => {
		expect(extractDbLinkPairs({ _Work: 'NumberTales', _DB: 'Primary', Num: '0' }, SCALAR_INDEX_DEF))
			.toEqual({ Num: '0' });
	});

	it('ネストした複合インデックスを展開する', () => {
		expect(extractDbLinkPairs({ _DB: 'Primary', Card: { Suit: 'Major', SuitNum: 0 } }, COMPOSITE_INDEX_DEF))
			.toEqual({ Suit: 'Major', SuitNum: '0' });
	});

	it('参照先 typedef が無くてもフォールバックで平坦化する', () => {
		expect(extractDbLinkPairs({ _DB: 'Primary', Card: { Suit: 'Major', SuitNum: 0 } }, null))
			.toEqual({ Suit: 'Major', SuitNum: '0' });
		expect(extractDbLinkPairs({ _Work: 'NumberTales', _DB: 'Primary', Num: '0' }, null))
			.toEqual({ Num: '0' });
	});

	it('インデックス指定が無ければ null', () => {
		expect(extractDbLinkPairs({ _Work: 'X', _DB: 'Y' }, SCALAR_INDEX_DEF)).toBeNull();
		expect(extractDbLinkPairs(null, SCALAR_INDEX_DEF)).toBeNull();
	});
});

describe('isPairsSubset', () => {
	it('少ないキーしか持たないペイロードを包含判定できる', () => {
		expect(isPairsSubset({ Suit: 'Major', SuitNum: '16' }, { Suit: 'Major', SuitNum: '16', Num: '16' })).toBe(true);
	});

	it('値が違えば false', () => {
		expect(isPairsSubset({ Suit: 'Minor' }, { Suit: 'Major' })).toBe(false);
	});

	it('数値と文字列は String 比較で一致させる', () => {
		expect(isPairsSubset({ SuitNum: 16 }, { SuitNum: '16' })).toBe(true);
	});
});

describe('classifyRelationFields（スキーマ駆動）', () => {
	const globalTypeDef = {
		$DefType: [
			{ hashTag: 'AnotherRegions_DBLink', $type: '$Def_DBLinkRef[]|#Null', $enrich: true },
			{ hashTag: 'AnotherVersions_DBLink', $type: '$Def_DBLinkRef[]|#Null', $enrich: false },
			{ hashTag: 'Name_JP', $type: '#String_JP' },
			{ $slot: '#Index', $slotMatch: { $type: '#Index' } } // マーカーは無視される
		]
	};
	const workTypeDef = {
		$DefType: [
			{ hashTag: 'Relation', $type: [{ hashTag: 'Related' }], $display: { sectionWrapper: 'relationSection' } },
			{ hashTag: 'RelationTo_Primary', $type: [{ hashTag: 'Related' }], $display: { sectionWrapper: 'relationSection' } },
			{ hashTag: 'SameModels_DBLink', $type: '$Def_DBLinkRef[]|#Null', $enrich: true },
			{ hashTag: 'ThisPerformer_DBLink', $type: '$Def_DBLinkRef|#Null' }
		]
	};

	const c = classifyRelationFields(globalTypeDef, workTypeDef);

	it('`$display.sectionWrapper === "relationSection"` で Relation 系を拾う', () => {
		expect(c.relation.has('Relation')).toBe(true);
		expect(c.relation.get('Relation').targetDb).toBeNull(); // 同一DB
	});

	it('`RelationTo_<Db>` からターゲットDB名を取り出す', () => {
		expect(c.relation.get('RelationTo_Primary').targetDb).toBe('Primary');
	});

	it('`$enrich: true` の `*_DBLink` は同一存在', () => {
		expect(c.sameBeing.has('AnotherRegions_DBLink')).toBe(true);
		expect(c.sameBeing.has('SameModels_DBLink')).toBe(true);
	});

	it('`$enrich` が true でない `*_DBLink` は別版・派生', () => {
		expect(c.variant.has('AnotherVersions_DBLink')).toBe(true);
		expect(c.variant.has('ThisPerformer_DBLink')).toBe(true);
	});

	it('関係を表さないフィールドはどこにも入らない', () => {
		expect(c.relation.has('Name_JP')).toBe(false);
		expect(c.sameBeing.has('Name_JP')).toBe(false);
		expect(c.variant.has('Name_JP')).toBe(false);
	});
});

describe('pickRecordName', () => {
	const rec = { Name_JP: '和名', Name_EN: 'English', FormalName_JP: '正式名' };

	it('JP 優先 / EN 優先を切り替えられる', () => {
		expect(pickRecordName(rec, 'jp')).toBe('和名');
		expect(pickRecordName(rec, 'en')).toBe('English');
	});

	it('候補が無ければ空文字', () => {
		expect(pickRecordName({}, 'jp')).toBe('');
		expect(pickRecordName(null, 'jp')).toBe('');
	});

	it('旧データ互換で裸の Name もフォールバックに含む', () => {
		expect(pickRecordName({ Name: '裸の名前' }, 'jp')).toBe('裸の名前');
	});
});

describe('createUnionFind', () => {
	it('推移的に結ばれたキーを 1 グループへまとめる', () => {
		const uf = createUnionFind();
		uf.union('a', 'b');
		uf.union('b', 'c');
		uf.union('x', 'y');
		const groups = [...uf.groups().values()].map(g => g.sort());
		expect(groups).toHaveLength(2);
		expect(groups).toContainEqual(['a', 'b', 'c']);
		expect(groups).toContainEqual(['x', 'y']);
	});
});

describe('buildGraph', () => {
	const globalTypeDef = {
		$DefType: [{ hashTag: 'AnotherRegions_DBLink', $type: '$Def_DBLinkRef[]|#Null', $enrich: true }]
	};
	const workTypeDefs = {
		'#Works_A': {
			$IndexDef: SCALAR_INDEX_DEF,
			$DefType: [
				{ hashTag: 'Relation', $type: [{ hashTag: 'Related' }], $display: { sectionWrapper: 'relationSection' } },
				{ hashTag: 'SameMPSeries_DBLink', $type: '$Def_DBLinkRef[]|#Null' }
			]
		},
		'#Works_B': { $IndexDef: SCALAR_INDEX_DEF, $DefType: [] }
	};

	const baseWorks = () => ([
		{
			work: '#Works_A',
			databases: [{ key: 'Primary', DB_Label_JP: '一次創作' }],
			data: {
				Primary: [
					{
						Num: 1, Name_JP: 'いち',
						Relation: {
							Related: [{ Num: 2, RelationLabel: ['classmate'], Comments: '「よろしく」' }],
							Commented: [{ Num: 3 }]
						}
					},
					{
						Num: 2, Name_JP: 'に',
						// 1 との相互参照。畳まれて 1 本になるはず
						Relation: { Related: [{ Num: 1, RelationLabel: ['classmate'] }] },
						SameMPSeries_DBLink: [{ _DB: 'Primary', Num: 3 }]
					},
					{
						Num: 3, Name_JP: 'さん',
						AnotherRegions_DBLink: [{ _Work: 'B', _DB: 'Primary', Num: 9 }],
						ThisMasters: [{ value_JP: '主人', _DBLink: { _Work: 'B', _DB: 'Primary', Num: 9 } }]
					}
				]
			}
		},
		{
			work: '#Works_B',
			databases: [{ key: 'Primary' }],
			data: { Primary: [{ Num: 9, Name_JP: 'きゅう' }] }
		}
	]);

	const g = buildGraph({ works: baseWorks(), globalTypeDef, workTypeDefs });

	it('全レコードがノードになる', () => {
		expect(g.stats.nodeCount).toBe(4);
		expect(g.nodes.map(n => n.key).sort()).toEqual([
			'#Works_A|Primary|Num=1',
			'#Works_A|Primary|Num=2',
			'#Works_A|Primary|Num=3',
			'#Works_B|Primary|Num=9'
		]);
	});

	it('相互参照は 1 本の無向エッジへ畳まれ direction が mutual になる', () => {
		const e = g.edges.find(x => x.kind === EDGE_KINDS.RELATED
			&& x.source === '#Works_A|Primary|Num=1' && x.target === '#Works_A|Primary|Num=2');
		expect(e).toBeTruthy();
		expect(e.direction).toBe('mutual');
		expect(g.edges.filter(x => x.kind === EDGE_KINDS.RELATED)).toHaveLength(1);
	});

	it('Related と Commented は別種別のエッジになる', () => {
		expect(g.stats.edgesByKind[EDGE_KINDS.RELATED]).toBe(1);
		expect(g.stats.edgesByKind[EDGE_KINDS.COMMENTED]).toBe(1);
	});

	it('Relation のラベルとコメントがエッジのメタに載る', () => {
		const e = g.edges.find(x => x.kind === EDGE_KINDS.RELATED);
		const meta = e.metaAToB || e.metaBToA;
		expect(meta.labels).toEqual(['classmate']);
		expect(meta.comment_JP).toBe('「よろしく」');
	});

	it('`$enrich: true` の `*_DBLink` は同一存在、それ以外は別版になる', () => {
		expect(g.stats.edgesByKind[EDGE_KINDS.SAME_BEING]).toBe(1);
		expect(g.stats.edgesByKind[EDGE_KINDS.VARIANT]).toBe(1);
	});

	it('配列要素に埋まった `_DBLink`（ThisMasters 等）を field 名の決め打ちなしで拾う', () => {
		expect(g.stats.edgesByKind[EDGE_KINDS.MASTER]).toBe(1);
		const e = g.edges.find(x => x.kind === EDGE_KINDS.MASTER);
		expect(e.source === '#Works_B|Primary|Num=9' || e.target === '#Works_B|Primary|Num=9').toBe(true);
	});

	it('同一存在は Union-Find で 1 グループになる', () => {
		const groups = [...g.sameBeingGroups.values()].filter(m => m.length > 1);
		expect(groups).toHaveLength(1);
		expect(groups[0].sort()).toEqual(['#Works_A|Primary|Num=3', '#Works_B|Primary|Num=9']);
	});

	it('相互参照を畳んだのでエッジ数は有向数より少ない', () => {
		expect(g.stats.directedCount).toBeGreaterThan(g.stats.edgeCount);
		expect(g.stats.mutualCount).toBe(1);
	});

	it('ノードに次数が付く', () => {
		const n1 = g.nodes.find(n => n.key === '#Works_A|Primary|Num=1');
		expect(n1.degree).toBe(2); // 2 への related と 3 への commented
	});

	it('参照先が居なければエッジを張らず diagnostics へ記録する', () => {
		const works = baseWorks();
		works[0].data.Primary[0].Relation.Related = [{ Num: 999 }];
		const g2 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g2.diagnostics.unresolvedLinks.length).toBeGreaterThan(0);
		expect(g2.edges.some(e => e.target === '#Works_A|Primary|Num=999')).toBe(false);
	});

	it('部分集合一致で一意に定まらなければエッジを張らない（曖昧として記録）', () => {
		const compositeWorks = [{
			work: '#Works_C',
			databases: [{ key: 'Primary' }],
			data: {
				Primary: [
					{ Card: { Suit: 'Major', SuitNum: 1, Num: 1 }, Name_JP: 'a' },
					{ Card: { Suit: 'Major', SuitNum: 2, Num: 2 }, Name_JP: 'b' },
					// Suit だけ指定 → 2 件に一致するので曖昧
					{ Card: { Suit: 'Minor', SuitNum: 1, Num: 3 }, Name_JP: 'c', Ref_DBLink: { _DB: 'Primary', Card: { Suit: 'Major' } } }
				]
			}
		}];
		const g3 = buildGraph({
			works: compositeWorks,
			globalTypeDef: { $DefType: [] },
			workTypeDefs: {
				'#Works_C': {
					$IndexDef: COMPOSITE_INDEX_DEF,
					$DefType: [{ hashTag: 'Ref_DBLink', $type: '$Def_DBLinkRef|#Null' }]
				}
			}
		});
		expect(g3.diagnostics.ambiguousLinks).toHaveLength(1);
		expect(g3.stats.edgeCount).toBe(0);
	});

	it('1 件もノード化できないDB（資料系）は skippedDbs へまとめ、個別ノイズを出さない', () => {
		const works = baseWorks();
		works[0].databases.push({ key: 'Vocabulary', layer: 'References' });
		works[0].data.Vocabulary = [{ Term_JP: '用語1' }, { Term_JP: '用語2' }];
		const g4 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g4.diagnostics.skippedDbs).toEqual([
			{ workId: '#Works_A', dbName: 'Vocabulary', recordCount: 2, layer: 'References' }
		]);
		expect(g4.diagnostics.unindexedRecords).toHaveLength(0);
	});

	it('`isPrivate` のレコードはノードにならず、参照先にもならない（多重防御）', () => {
		const works = baseWorks();
		// 2 を非公開にする。1 は 2 への Related を持っているので、そのエッジも消えるはず
		works[0].data.Primary[1].isPrivate = true;
		const g6 = buildGraph({ works, globalTypeDef, workTypeDefs });

		expect(g6.nodes.some(n => n.key === '#Works_A|Primary|Num=2')).toBe(false);
		expect(g6.diagnostics.excluded.privateRecords).toBe(1);
		expect(g6.edges.some(e => e.source.endsWith('Num=2') || e.target.endsWith('Num=2'))).toBe(false);
		// 参照は解決できなかったものとして診断へ落ちる
		expect(g6.diagnostics.unresolvedLinks.some(u => String(u.pairs?.Num) === '2')).toBe(true);
	});

	it('`isPrivate` は文字列 "true" でも除外する', () => {
		const works = baseWorks();
		works[0].data.Primary[1].isPrivate = 'true';
		const g7 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g7.diagnostics.excluded.privateRecords).toBe(1);
		expect(g7.nodes.some(n => n.key === '#Works_A|Primary|Num=2')).toBe(false);
	});

	it('`DB_Hidden` のDBはまるごと除外する（多重防御）', () => {
		const works = baseWorks();
		works[0].databases[0].DB_Hidden = true;
		const g8 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g8.diagnostics.excluded.hiddenDbs).toBe(1);
		expect(g8.nodes.every(n => n.workId !== '#Works_A')).toBe(true);
	});

	it('`Works_Hidden` の作品はまるごと除外する（多重防御）', () => {
		const works = baseWorks();
		works[0].workInfo = { Works_Hidden: true };
		const g9 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g9.diagnostics.excluded.hiddenWorks).toBe(1);
		expect(g9.nodes.every(n => n.workId !== '#Works_A')).toBe(true);
	});

	it('全件が非公開のDBを「キャラDBではない」と誤判定しない', () => {
		const works = baseWorks();
		for (const r of works[0].data.Primary) r.isPrivate = true;
		const g10 = buildGraph({ works, globalTypeDef, workTypeDefs });
		expect(g10.diagnostics.excluded.privateRecords).toBe(3);
		expect(g10.diagnostics.skippedDbs).toHaveLength(0);
	});

	it('dbFilter で対象DBを絞れる（二次創作の除外など）', () => {
		const g5 = buildGraph({
			works: baseWorks(), globalTypeDef, workTypeDefs,
			options: { dbFilter: (workId) => workId === '#Works_A' }
		});
		expect(g5.nodes.every(n => n.workId === '#Works_A')).toBe(true);
	});
});

describe('computeWorkDensity', () => {
	it('作品内エッジ密度を作品ごとに出す', () => {
		const nodes = [
			{ key: 'a', workId: '#Works_A' },
			{ key: 'b', workId: '#Works_A' },
			{ key: 'c', workId: '#Works_B' }
		];
		const edges = [
			{ source: 'a', target: 'b' }, // 作品内
			{ source: 'b', target: 'c' }  // 作品跨ぎ（カウントしない）
		];
		const d = computeWorkDensity(nodes, edges);
		expect(d.get('#Works_A')).toEqual({ nodes: 2, intraEdges: 1, density: 0.5 });
		expect(d.get('#Works_B')).toEqual({ nodes: 1, intraEdges: 0, density: 0 });
	});
});

describe('実データ不変条件', () => {
	/**
	 * 各作品・各DBの生レコードから、全サブキーソート方式でノードキーを作り一意性を確かめる。
	 * bootstrap を通さない軽量チェック（enrich 前でも Index フィールドは存在する前提）。
	 */
	const workDirs = globSync('data/Works_*/DataBases/db_type.json', { cwd: repoRoot })
		.map(p => p.replace(/[\\/]DataBases[\\/]db_type\.json$/, ''));

	for (const dir of workDirs) {
		const typeDef = JSON.parse(readFileSync(join(repoRoot, dir, 'DataBases/db_type.json'), 'utf-8'));
		const dbFiles = globSync(`${dir.replace(/\\/g, '/')}/DataBases/db_*.json`, { cwd: repoRoot })
			.filter(p => !/db_(meta|type)\.json$/.test(p));

		for (const dbFile of dbFiles) {
			const dbName = /db_(.+)\.json$/.exec(dbFile.replace(/\\/g, '/'))?.[1];
			if (!dbName) continue;

			it(`${dir.replace('data/', '')}/${dbName} のノードキーが一意`, () => {
				const raw = JSON.parse(readFileSync(join(repoRoot, dbFile), 'utf-8'));
				if (!Array.isArray(raw) || raw.length === 0) return;

				const indexDef = resolveIndexDef(typeDef, dbName);
				if (!indexDef) return;

				const seen = new Map();
				const collisions = [];
				for (const rec of raw) {
					const pairs = extractIndexPairs(rec, indexDef);
					if (!pairs) continue;
					const key = serializeIndexPairs(pairs);
					if (seen.has(key)) collisions.push(`${key}（${seen.get(key)} と ${pickRecordName(rec, 'jp')}）`);
					else seen.set(key, pickRecordName(rec, 'jp'));
				}
				expect(collisions, `ノードキー衝突: ${collisions.join(' / ')}`).toEqual([]);
			});
		}
	}

	it('「最初の非空サブキー 1 個」方式なら衝突する DB が実在する（全サブキー方式が必要な根拠）', () => {
		const p = join(repoRoot, 'data/Works_UnibyteLive/DataBases/db_Primary.json');
		if (!existsSync(p)) return;
		const raw = JSON.parse(readFileSync(p, 'utf-8'));
		const typeDef = JSON.parse(readFileSync(join(repoRoot, 'data/Works_UnibyteLive/DataBases/db_type.json'), 'utf-8'));
		const indexDef = resolveIndexDef(typeDef, 'Primary');
		const subKeys = getIndexSubKeys(indexDef) || [];

		// 旧方式: root 配下の「最初の非空サブキー」だけを識別子にする
		const firstOnly = new Set();
		let firstOnlyCollisions = 0;
		for (const rec of raw) {
			const container = rec[indexDef.hashTag] || rec;
			for (const k of subKeys) {
				const v = container?.[k];
				if (v === null || v === undefined || v === '') continue;
				const id = `${k}=${v}`;
				if (firstOnly.has(id)) firstOnlyCollisions += 1;
				firstOnly.add(id);
				break;
			}
		}

		// 新方式: 全サブキーをソートして連結
		const allKeys = new Set(raw.map(r => serializeIndexPairs(extractIndexPairs(r, indexDef) || {})));

		expect(firstOnlyCollisions).toBeGreaterThan(0); // 旧方式は衝突する
		expect(allKeys.size).toBe(raw.length);          // 新方式は全件一意
	});
});
