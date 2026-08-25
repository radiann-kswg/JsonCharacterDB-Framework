/**
 * $DefType の $slot マーカーによるマージ順制御テスト
 *
 * 目的:
 * - グローバル `$DefType` に置いた `$slot` マーカーが、作品固有フィールドの挿入位置を決めること
 * - マーカー未宣言時は従来仕様（グローバル順を土台 → 作品固有は末尾追加）へフォールバックすること
 * - マーカー自体（hashTag を持たないエントリ）はマージ結果に漏れないこと
 *
 * 背景:
 * - `Index`（作品ごとに hashTag が異なる）/ `Images` / 作品固有 `_DBLink` はグローバル `$DefType` に
 *   宣言が無いため、従来の「作品固有は末尾追加」では常に末尾へ落ちていた。
 * - 位置をツール側の field 名ハードコードで持つのではなく、schema（`$slot` / `$slotMatch`）で
 *   宣言するために `TypeDefUtils.mergeDefTypes()` を拡張した。
 *
 * NOTE:
 * - Service Worker 自体は起動せず、`TypeDefUtils` を直接呼びます。
 */
import { describe, it, expect } from 'vitest';

// data-common.js はブラウザ/SW向けにグローバル公開する設計だが、Node でも評価可能
import '../lib/data-common.js';

const { TypeDefUtils } = globalThis;

/** マージ結果を hashTag 列へ落とす（マーカー混入検出のため filter は敢えて掛けない） */
const tags = (merged) => merged.map((e) => e.hashTag);

describe('TypeDefUtils.isFieldForSecondaryContext()', () => {
  const applies = (isForSecondary, isSecondary) => TypeDefUtils.isFieldForSecondaryContext(
    { isForSecondary },
    isSecondary
  );

  it('null/未指定を一次・二次共通として扱う', () => {
    expect(applies(null, false)).toBe(true);
    expect(applies(null, true)).toBe(true);
    expect(applies(undefined, false)).toBe(true);
    expect(applies(undefined, true)).toBe(true);
  });

  it('true/false は対応する DB 文脈だけで有効にする', () => {
    expect(applies(false, false)).toBe(true);
    expect(applies(false, true)).toBe(false);
    expect(applies(true, false)).toBe(false);
    expect(applies(true, true)).toBe(true);
  });
});

describe('TypeDefUtils.matchesSlot()', () => {
  it('$type は完全一致で判定する', () => {
    expect(TypeDefUtils.matchesSlot({ $type: '#Index' }, { $type: '#Index' })).toBe(true);
    expect(TypeDefUtils.matchesSlot({ $type: '#Index' }, { $type: '#Index|#Null' })).toBe(false);
  });

  it('$typeIncludes は部分一致で判定し、$Def_DBLinkRef の両形（[] 有無）を拾う', () => {
    const m = { $typeIncludes: '$Def_DBLinkRef' };
    expect(TypeDefUtils.matchesSlot(m, { $type: '$Def_DBLinkRef[]|#Null' })).toBe(true);
    expect(TypeDefUtils.matchesSlot(m, { $type: '$Def_DBLinkRef|#Null' })).toBe(true);
    expect(TypeDefUtils.matchesSlot(m, { $type: '#String|#Null' })).toBe(false);
  });

  it('$typeIncludes は $type が配列（インライン構造体宣言）のエントリに一致しない', () => {
    const m = { $typeIncludes: '$Def_DBLinkRef' };
    expect(TypeDefUtils.matchesSlot(m, { $type: [{ hashTag: 'x', $type: '$Def_DBLinkRef' }] })).toBe(false);
  });

  it('$display は浅い部分集合一致で判定する', () => {
    const m = { $display: { section: 'images' } };
    expect(TypeDefUtils.matchesSlot(m, { $display: { section: 'images', tagSpace: 'creation' } })).toBe(true);
    expect(TypeDefUtils.matchesSlot(m, { $display: { section: 'other' } })).toBe(false);
    expect(TypeDefUtils.matchesSlot(m, {})).toBe(false);
  });

  it('"*" は catch-all として常に一致する', () => {
    expect(TypeDefUtils.matchesSlot('*', { hashTag: 'Whatever' })).toBe(true);
  });

  it('述語を 1 つも指定しない {} は一致しない（全件誤爆の防止）', () => {
    expect(TypeDefUtils.matchesSlot({}, { hashTag: 'X', $type: '#String' })).toBe(false);
  });

  it('$inLayout は $DetailLayout の宣言配列に載っているかで判定する', () => {
    const m = { $inLayout: 'basicFields' };
    const options = { detailLayout: { basicFields: ['TailsUnit', 'ForMasterCalling'], subFields: ['Relation'] } };
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'TailsUnit' }, options)).toBe(true);
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'Relation' }, options)).toBe(false);
  });

  it('$inLayout は base 名で突き合わせる（宣言配列は base、実フィールドは _JP/_EN）', () => {
    const m = { $inLayout: 'basicFields' };
    const options = { detailLayout: { basicFields: ['ForMasterCalling'] } };
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'ForMasterCalling_JP' }, options)).toBe(true);
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'ForMasterCalling_EN' }, options)).toBe(true);
  });

  it('$inLayout は detailLayout 欠損時に一致しない（catch-all へ落とすため）', () => {
    const m = { $inLayout: 'basicFields' };
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'TailsUnit' })).toBe(false);
    expect(TypeDefUtils.matchesSlot(m, { hashTag: 'TailsUnit' }, { detailLayout: {} })).toBe(false);
  });
});

describe('TypeDefUtils.mergeDefTypes() — $slot マーカー未宣言（後方互換）', () => {
  const globalType = {
    $DefType: [
      { hashTag: 'Progress', $type: '$EnumDef' },
      { hashTag: 'Name_JP', $type: '#String_JP' },
    ],
  };
  const workType = {
    $DefType: [
      { hashTag: 'Num', $type: '#Index' },
      { hashTag: 'Images', $type: '#ImageSet', $display: { section: 'images' } },
    ],
  };

  it('グローバル順を土台に、作品固有は末尾へ追加される（従来仕様のまま）', () => {
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Progress',
      'Name_JP',
      'Num',
      'Images',
    ]);
  });

  it('同名 hashTag は作品側定義で置換され、位置はグローバルのまま', () => {
    const w = { $DefType: [{ hashTag: 'Name_JP', $type: '#Overridden' }] };
    const merged = TypeDefUtils.mergeDefTypes(globalType, w);
    expect(tags(merged)).toEqual(['Progress', 'Name_JP']);
    expect(merged.find((e) => e.hashTag === 'Name_JP').$type).toBe('#Overridden');
  });
});

describe('TypeDefUtils.mergeDefTypes() — $slot マーカー宣言時', () => {
  const globalType = {
    $MetaType: {
      $Def_SecondaryMeta: {
        $DefType: [
          { hashTag: 'sec_SeriesTitle', $type: '#DictIndex|#Null' },
          { hashTag: 'sec_Category', $type: '#DictIndex|#Null' },
        ],
      },
    },
    $DefType: [
      { $slot: '#Index', $slotMatch: { $type: '#Index' } },
      { hashTag: 'Progress', $type: '$EnumDef' },
      { hashTag: 'AnotherVersions_DBLink', $type: '$Def_DBLinkRef[]|#Null' },
      { $slot: '#SecondaryMeta', $slotExpand: '$MetaType.$Def_SecondaryMeta' },
      { $slot: '#WorkDBLinkRef', $slotMatch: { $typeIncludes: '$Def_DBLinkRef' } },
      { hashTag: 'Name_JP', $type: '#String_JP' },
      { $slot: '#Images', $slotMatch: { $display: { section: 'images' } } },
      { hashTag: 'FormalName_JP', $type: '#String_JP' },
      { $slot: '#WorkRest', $slotMatch: '*' },
    ],
  };

  it('User 要望順（Index > Progress > _DBLink > Name > Images > FormalName）で並ぶ', () => {
    const workType = {
      $DefType: [
        { hashTag: 'Num', $type: '#Index' },
        { hashTag: 'Images', $type: '#ImageSet', $display: { section: 'images' } },
        { hashTag: 'SameModels_DBLink', $type: '$Def_DBLinkRef[]|#Null' },
        { hashTag: 'Relation', $type: '$Def_Relations|#Null' },
      ],
    };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Num',
      'Progress',
      'AnotherVersions_DBLink',
      'sec_SeriesTitle',
      'sec_Category',
      'SameModels_DBLink',
      'Name_JP',
      'Images',
      'FormalName_JP',
      'Relation',
    ]);
  });

  it('マーカー（hashTag を持たないエントリ）は結果に含まれない', () => {
    const merged = TypeDefUtils.mergeDefTypes(globalType, { $DefType: [] });
    expect(merged.every((e) => typeof e.hashTag === 'string' && e.hashTag)).toBe(true);
    expect(merged.some((e) => '$slot' in e)).toBe(false);
  });

  it('複数の #Index を持つ作品は、作品側の宣言順をスロット内で保つ', () => {
    const workType = {
      $DefType: [
        { hashTag: 'Model', $type: '#Index' },
        { hashTag: 'Logic', $type: '#Index' },
        { hashTag: 'LogicAlt', $type: '#Index' },
      ],
    };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType)).slice(0, 4)).toEqual([
      'Model',
      'Logic',
      'LogicAlt',
      'Progress',
    ]);
  });

  it('作品側の $slot 明示は $slotMatch 述語より優先される（逃がし弁）', () => {
    const workType = {
      $DefType: [
        { hashTag: 'Num', $type: '#Index' },
        { hashTag: 'Images', $type: '#ImageSet', $display: { section: 'images' } },
        // section: other なので既定では #WorkRest（末尾）だが、$slot 明示で Images の隣へ寄せる
        { hashTag: 'VRMs', $type: '#VRMSet', $display: { section: 'other' }, $slot: '#Images' },
      ],
    };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Num',
      'Progress',
      'AnotherVersions_DBLink',
      'sec_SeriesTitle',
      'sec_Category',
      'Name_JP',
      'Images',
      'VRMs',
      'FormalName_JP',
    ]);
  });

  it('$slotExpand の展開先に作品側の同名宣言があれば作品側を採る', () => {
    const workType = { $DefType: [{ hashTag: 'sec_Category', $type: '#Overridden' }] };
    const merged = TypeDefUtils.mergeDefTypes(globalType, workType);
    expect(merged.find((e) => e.hashTag === 'sec_Category').$type).toBe('#Overridden');
    // 展開位置は $slot マーカーの位置のまま（末尾に重複しない）
    expect(tags(merged).filter((t) => t === 'sec_Category')).toHaveLength(1);
  });

  it('どのスロットにも該当しない作品固有フィールドは catch-all へ入る', () => {
    const workType = { $DefType: [{ hashTag: 'WorkOnlyThing', $type: '#String' }] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Progress',
      'AnotherVersions_DBLink',
      'sec_SeriesTitle',
      'sec_Category',
      'Name_JP',
      'FormalName_JP',
      'WorkOnlyThing',
    ]);
  });

  it('catch-all マーカーが無くても作品固有フィールドを落とさない（保険）', () => {
    const noCatchAll = { ...globalType, $DefType: globalType.$DefType.filter((e) => e.$slotMatch !== '*') };
    const workType = { $DefType: [{ hashTag: 'WorkOnlyThing', $type: '#String' }] };
    expect(tags(TypeDefUtils.mergeDefTypes(noCatchAll, workType))).toContain('WorkOnlyThing');
  });

  it('$slotExpand が解決できないパスでも落ちず、その位置に何も展開しない', () => {
    const broken = {
      $DefType: [
        { hashTag: 'Progress', $type: '$EnumDef' },
        { $slot: '#Nope', $slotExpand: '$MetaType.$DoesNotExist' },
        { $slot: '#WorkRest', $slotMatch: '*' },
      ],
    };
    expect(tags(TypeDefUtils.mergeDefTypes(broken, { $DefType: [{ hashTag: 'X', $type: '#String' }] }))).toEqual([
      'Progress',
      'X',
    ]);
  });
});

describe('TypeDefUtils.mergeDefTypes() — $slotOrder（catch-all を subFields 順へ）', () => {
  const globalType = {
    $DefType: [
      { hashTag: 'Progress', $type: '$EnumDef' },
      { $slot: '#WorkRest', $slotMatch: '*', $slotOrder: 'subFields' },
    ],
  };
  const workType = {
    $DefType: [
      { hashTag: 'VRMs', $type: '#VRMSet' },
      { hashTag: 'ThisMasters', $type: '$Def_Masters' },
      { hashTag: 'ForMasterCalling_JP', $type: '#String_JP' },
      { hashTag: 'TailsUnit', $type: '$Def_TailsUnit[]' },
      { hashTag: 'NumerospecAbout_JP', $type: '#Summary' },
      { hashTag: 'NumerospecAbout_EN', $type: '#Summary' },
      { hashTag: 'Relation', $type: '$Def_Relations' },
    ],
  };

  it('detailLayout があれば subFields の宣言順へ寄せ、未登録は元の宣言順で後ろへ送る', () => {
    const detailLayout = { subFields: ['TailsUnit', 'NumerospecAbout', 'Relation', 'ThisMasters', 'VRMs'] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'TailsUnit',
      // subFields は base 名で書かれるが、実フィールドの _JP/_EN は同順位に束ねて宣言順を保つ
      'NumerospecAbout_JP',
      'NumerospecAbout_EN',
      'Relation',
      'ThisMasters',
      'VRMs',
      // subFields 未登録は末尾へ（元の相対順のまま）
      'ForMasterCalling_JP',
    ]);
  });

  it('detailLayout が無ければ作品別 $DefType の宣言順のまま（後方互換）', () => {
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Progress',
      'VRMs',
      'ThisMasters',
      'ForMasterCalling_JP',
      'TailsUnit',
      'NumerospecAbout_JP',
      'NumerospecAbout_EN',
      'Relation',
    ]);
  });

  it('subFields が空配列なら並べ替えない', () => {
    const detailLayout = { subFields: [] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout })).slice(0, 3)).toEqual([
      'Progress',
      'VRMs',
      'ThisMasters',
    ]);
  });
});

describe('TypeDefUtils.mergeDefTypes() — $slotAnchor（basicFields 上の隣へ散らす）', () => {
  // basicFields は「グローバル項目の間へ作品固有フィールドが挟まる」宣言のため、
  // $slotOrder（マーカー位置へまとめる）では表現できない。行き先が個別に散るのを検証する
  const globalType = {
    $DefType: [
      { hashTag: 'Progress', $type: '$EnumDef' },
      { $slot: '#Images', $slotMatch: { $display: { section: 'images' } } },
      { $slot: '#WorkBasic', $slotMatch: { $inLayout: 'basicFields' }, $slotAnchor: 'basicFields' },
      { hashTag: 'FormalName_JP', $type: '#String_JP' },
      { hashTag: 'BustSize', $type: '#ListIndex' },
      { hashTag: 'Age', $type: '#Number' },
      { hashTag: 'ThirdPersonCalling', $type: '#String' },
      { hashTag: 'Character_JP', $type: '#Summary' },
      { $slot: '#WorkRest', $slotMatch: '*', $slotOrder: 'subFields' },
    ],
  };

  it('作品固有 basicField を宣言配列上の直前の隣人の直後へ散らす', () => {
    const workType = {
      $DefType: [
        { hashTag: 'TailsUnit', $type: '$Def_TailsUnit[]' },
        { hashTag: 'ForMasterCalling_JP', $type: '#String_JP' },
        { hashTag: 'Relation', $type: '$Def_Relations' },
      ],
    };
    const detailLayout = {
      basicFields: ['FormalName', 'BustSize', 'TailsUnit', 'Age', 'ThirdPersonCalling', 'ForMasterCalling'],
      subFields: ['Relation'],
    };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'FormalName_JP',
      'BustSize',
      'TailsUnit', // BustSize の直後（マーカー位置ではない）
      'Age',
      'ThirdPersonCalling',
      'ForMasterCalling_JP', // ThirdPersonCalling の直後
      'Character_JP',
      'Relation', // catch-all
    ]);
  });

  it('同じアンカーを共有するメンバーは basicFields の宣言順を保つ', () => {
    const workType = {
      $DefType: [
        { hashTag: 'For80thDealerCalling_JP', $type: '#String_JP' },
        { hashTag: 'For79thDealerCalling_JP', $type: '#String_JP' },
      ],
    };
    const detailLayout = {
      basicFields: ['ThirdPersonCalling', 'For79thDealerCalling', 'For80thDealerCalling'],
    };
    // 作品別 $DefType の宣言順（80th が先）ではなく basicFields の宣言順（79th が先）に従う
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'FormalName_JP',
      'BustSize',
      'Age',
      'ThirdPersonCalling',
      'For79thDealerCalling_JP',
      'For80thDealerCalling_JP',
      'Character_JP',
    ]);
  });

  it('_JP/_JPReading/_EN の群は元の相対順を保ったまま同じアンカーの直後へ束ねる', () => {
    const workType = {
      $DefType: [
        { hashTag: 'ChronoholderName_JP', $type: '#String_JP' },
        { hashTag: 'ChronoholderName_JPReading', $type: '##String_JP|#Null' },
        { hashTag: 'ChronoholderName_EN', $type: '##String_EN|#Null' },
      ],
    };
    const detailLayout = { basicFields: ['ThirdPersonCalling', 'ChronoholderName'] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'FormalName_JP',
      'BustSize',
      'Age',
      'ThirdPersonCalling',
      'ChronoholderName_JP',
      'ChronoholderName_JPReading',
      'ChronoholderName_EN',
      'Character_JP',
    ]);
  });

  it('basicFields の先頭（＝直前の隣人が無い）はマーカー位置＝基本項目ブロックの先頭へ落ちる', () => {
    const workType = {
      $DefType: [
        { hashTag: 'Images', $type: '#ImageSet', $display: { section: 'images' } },
        { hashTag: 'Generation', $type: '#Number|#Null' },
      ],
    };
    const detailLayout = { basicFields: ['Generation', 'FormalName', 'BustSize'] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'Images',
      'Generation', // Images の直下（マーカー位置＝フォールバック）
      'FormalName_JP',
      'BustSize',
      'Age',
      'ThirdPersonCalling',
      'Character_JP',
    ]);
  });

  it('作品側の $slot 明示は $inLayout 述語より優先される（逃がし弁）', () => {
    const workType = {
      $DefType: [
        { hashTag: 'Images', $type: '#ImageSet', $display: { section: 'images' } },
        { hashTag: 'Generation', $type: '#Number|#Null', $slot: '#Images' },
      ],
    };
    // basicFields 上は BustSize の直後だが、$slot 明示で Images の隣へ寄る
    const detailLayout = { basicFields: ['FormalName', 'BustSize', 'Generation'] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }))).toEqual([
      'Progress',
      'Images',
      'Generation',
      'FormalName_JP',
      'BustSize',
      'Age',
      'ThirdPersonCalling',
      'Character_JP',
    ]);
  });

  it('detailLayout が無ければ $inLayout は一致せず catch-all へ落ちる（後方互換）', () => {
    const workType = { $DefType: [{ hashTag: 'TailsUnit', $type: '$Def_TailsUnit[]' }] };
    expect(tags(TypeDefUtils.mergeDefTypes(globalType, workType))).toEqual([
      'Progress',
      'FormalName_JP',
      'BustSize',
      'Age',
      'ThirdPersonCalling',
      'Character_JP',
      'TailsUnit',
    ]);
  });

  it('番兵（$slotSentinel）がマージ結果に漏れない', () => {
    const workType = { $DefType: [{ hashTag: 'TailsUnit', $type: '$Def_TailsUnit[]' }] };
    const detailLayout = { basicFields: ['BustSize', 'TailsUnit'] };
    const merged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
    expect(merged.every((e) => e.hashTag)).toBe(true);
    expect(merged.some((e) => '$slotSentinel' in e)).toBe(false);
    // 保険ループによる重複 push が起きていないこと
    expect(tags(merged).filter((t) => t === 'TailsUnit')).toHaveLength(1);
  });
});

describe('TypeDefUtils.sortEntriesByDeclaredOrder()', () => {
  it('順序配列に無いエントリ同士は元の相対順を保つ（Infinity 同士の比較が壊れない）', () => {
    const entries = [{ hashTag: 'C' }, { hashTag: 'A' }, { hashTag: 'D' }, { hashTag: 'B' }];
    const sorted = TypeDefUtils.sortEntriesByDeclaredOrder(entries, ['A', 'B']);
    expect(sorted.map((e) => e.hashTag)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('order が空/未指定なら元配列をそのまま返す', () => {
    const entries = [{ hashTag: 'C' }, { hashTag: 'A' }];
    expect(TypeDefUtils.sortEntriesByDeclaredOrder(entries, [])).toBe(entries);
    expect(TypeDefUtils.sortEntriesByDeclaredOrder(entries, null)).toBe(entries);
  });
});
