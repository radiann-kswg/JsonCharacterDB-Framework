/**
 * tools/normalize-field-order.mjs の単体テスト
 *
 * 目的:
 * - rank 構築（base 名 ↔ _JP/_EN サフィックスの解決）が typedef 宣言に追従すること
 * - 並べ替えが安定で冪等であること（未宣言キーは末尾へ原順で温存）
 * - テキスト走査が書式（インライン/展開・インデント）を壊さないこと
 * - findValueEnd() のスカラー分岐が末尾の改行/インデントを span へ飲み込む問題に対する回帰
 *
 * NOTE:
 * - 実データには触れず、合成テキストで検証します。
 */
import { describe, it, expect } from 'vitest';

import {
  buildFieldRank,
  sortRecordKeys,
  scanRecordMembers,
  reorderRecordText,
  normalizeFileText,
} from '../tools/normalize-field-order.mjs';
import { scanTopLevelRecords } from '../tools/extract-palette.mjs';

describe('buildFieldRank()', () => {
  it('宣言順がそのまま順位になる', () => {
    const rank = buildFieldRank(['Num', 'Progress', 'Images']);
    expect(rank.get('Num')).toBeLessThan(rank.get('Progress'));
    expect(rank.get('Progress')).toBeLessThan(rank.get('Images'));
  });

  it('base 宣言は _JP / _JPReading / _EN を直後へ束ねる', () => {
    const rank = buildFieldRank(['FirstPersonCalling', 'Images']);
    expect(rank.get('FirstPersonCalling')).toBeLessThan(rank.get('FirstPersonCalling_JP'));
    expect(rank.get('FirstPersonCalling_JP')).toBeLessThan(rank.get('FirstPersonCalling_JPReading'));
    expect(rank.get('FirstPersonCalling_JPReading')).toBeLessThan(rank.get('FirstPersonCalling_EN'));
    // 派生キーは次の宣言（Images）より前に収まる
    expect(rank.get('FirstPersonCalling_EN')).toBeLessThan(rank.get('Images'));
  });

  it('サフィックス付きで宣言済みなら base 展開しない（Name_JP / Name_EN）', () => {
    const rank = buildFieldRank(['Name_JP', 'Name_JPReading', 'Name_EN']);
    expect(rank.get('Name_JP')).toBe(0);
    expect(rank.get('Name_JPReading')).toBe(1);
    expect(rank.get('Name_EN')).toBe(2);
    expect(rank.has('Name')).toBe(false);
  });
});

describe('sortRecordKeys()', () => {
  const rank = buildFieldRank(['Num', 'Progress', 'Name_JP', 'Name_EN', 'FirstPersonCalling']);

  it('正準順へ並べ替える', () => {
    expect(sortRecordKeys(['Name_EN', 'Num', 'Progress', 'Name_JP'], rank)).toEqual([
      'Num',
      'Progress',
      'Name_JP',
      'Name_EN',
    ]);
  });

  it('base 宣言のフィールドは _JP → _EN の順で近傍へ束ねられる', () => {
    expect(sortRecordKeys(['FirstPersonCalling_EN', 'FirstPersonCalling_JP', 'Num'], rank)).toEqual([
      'Num',
      'FirstPersonCalling_JP',
      'FirstPersonCalling_EN',
    ]);
  });

  it('未宣言キーは直前の宣言済みキーへアンカーされ、元の位置に留まる', () => {
    // isTriple / Regioministration は「フラグ用にあえて宣言しない」運用。
    // Progress の直後にあるものが整列で末尾へ流されてはいけない
    expect(sortRecordKeys(['Num', 'Progress', 'isTriple', 'Name_EN', 'Name_JP'], rank)).toEqual([
      'Num',
      'Progress',
      'isTriple',
      'Name_JP',
      'Name_EN',
    ]);
  });

  it('末尾の未宣言キーは末尾に留まる', () => {
    // Works_VirtuesUs/db_SemiPrimary の isPrivate（レコード末尾の制御フラグ）
    expect(sortRecordKeys(['Num', 'Progress', 'Name_JP', 'isPrivate'], rank)).toEqual([
      'Num',
      'Progress',
      'Name_JP',
      'isPrivate',
    ]);
  });

  it('未宣言キーは、元の並びで直前にあった宣言済みキーの直後へ付いていく', () => {
    // Name_EN が正準位置へ動いても、isPrivate は元の直前キー（Num）の直後に残る
    expect(sortRecordKeys(['Name_EN', 'Num', 'isPrivate'], rank)).toEqual(['Num', 'isPrivate', 'Name_EN']);
  });

  it('連続する未宣言キーは元の相対順を保つ', () => {
    expect(sortRecordKeys(['Num', 'Progress', 'flagA', 'flagB', 'Name_JP'], rank)).toEqual([
      'Num',
      'Progress',
      'flagA',
      'flagB',
      'Name_JP',
    ]);
  });

  it('先頭の未宣言キーは先頭に留まる', () => {
    expect(sortRecordKeys(['leading', 'Name_JP', 'Num'], rank)).toEqual(['leading', 'Num', 'Name_JP']);
  });

  it('冪等（2 回目の適用で変化しない）', () => {
    for (const input of [
      ['Name_EN', 'isPrivate', 'Num', 'Progress'],
      ['Num', 'Progress', 'isTriple', 'Name_EN', 'Name_JP'],
      ['leading', 'Name_JP', 'Num', 'trailing'],
    ]) {
      const once = sortRecordKeys(input, rank);
      expect(sortRecordKeys(once, rank), JSON.stringify(input)).toEqual(once);
    }
  });
});

describe('scanRecordMembers()', () => {
  it('メンバーの key と span を宣言順で返し、span に前後の空白を含めない', () => {
    const text = '[\n  {\n    "B": 1,\n    "A": "x"\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const members = scanRecordMembers(text, span[0], span[1]);
    expect(members.map((m) => m.key)).toEqual(['B', 'A']);
    expect(text.slice(members[0].start, members[0].end)).toBe('"B": 1');
    expect(text.slice(members[1].start, members[1].end)).toBe('"A": "x"');
  });

  it('レコード末尾のスカラー値で改行/インデントを span へ飲み込まない（findValueEnd の回帰）', () => {
    // data/Works_VirtuesUs/DataBases/db_SemiPrimary.json の `isPrivate` が末尾キーになるケース
    const text = '[\n  {\n    "Virtues": "礼",\n    "isPrivate": true\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const members = scanRecordMembers(text, span[0], span[1]);
    expect(text.slice(members[1].start, members[1].end)).toBe('"isPrivate": true');
  });

  it('インラインオブジェクト/配列を 1 メンバーとして扱う', () => {
    const text = '[\n  {\n    "Age": { "value": 17, "about_JP": "？" },\n    "Tags": ["a", "b"]\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const members = scanRecordMembers(text, span[0], span[1]);
    expect(members.map((m) => m.key)).toEqual(['Age', 'Tags']);
    expect(text.slice(members[0].start, members[0].end)).toBe('"Age": { "value": 17, "about_JP": "？" }');
  });

  it('キー/値に含まれる波括弧・引用符に釣られない', () => {
    const text = '[\n  {\n    "Note": "a{b}\\"c\\"",\n    "Num": 1\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const members = scanRecordMembers(text, span[0], span[1]);
    expect(members.map((m) => m.key)).toEqual(['Note', 'Num']);
  });
});

describe('reorderRecordText()', () => {
  const rank = buildFieldRank(['Num', 'Progress', 'Name_JP']);

  it('キー順だけ入れ替え、値のテキストとインデントを保つ', () => {
    const text = '[\n  {\n    "Name_JP": "あ",\n    "Num": 1,\n    "Progress": "done"\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const result = reorderRecordText(text, span, rank);
    expect(result.to).toEqual(['Num', 'Progress', 'Name_JP']);
    expect(result.text).toBe('{\n    "Num": 1,\n    "Progress": "done",\n    "Name_JP": "あ"\n  }');
  });

  it('インラインオブジェクトを展開しない（往復整形との決定的な差）', () => {
    const text = '[\n  {\n    "Name_JP": { "hideText": "非公開希望" },\n    "Num": 1\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    const result = reorderRecordText(text, span, rank);
    expect(result.text).toContain('"Name_JP": { "hideText": "非公開希望" }');
  });

  it('既に正準順なら null を返す（no-op）', () => {
    const text = '[\n  {\n    "Num": 1,\n    "Progress": "done"\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    expect(reorderRecordText(text, span, rank)).toBeNull();
  });

  it('メンバーが 1 つなら null を返す', () => {
    const text = '[\n  {\n    "Num": 1\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    expect(reorderRecordText(text, span, rank)).toBeNull();
  });

  it('セパレータが不均一なら throw する（意図的な空行を壊さない）', () => {
    const text = '[\n  {\n    "Name_JP": "あ",\n\n    "Num": 1,\n    "Progress": "done"\n  }\n]\n';
    const [span] = scanTopLevelRecords(text);
    expect(() => reorderRecordText(text, span, rank)).toThrow(/セパレータが不均一/);
  });
});

describe('normalizeFileText() — ファイル単位', () => {
  const rank = buildFieldRank(['Num', 'Progress', 'Name_JP']);

  it('複数レコードを整列し、値を一切変えない（fail-closed 検証を通る）', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'nfo-'));
    const file = join(dir, 'db_Test.json');
    // 1 件目・2 件目とも要整列、3 件目は既に正準順（no-op であることを同時に確認する）
    const original =
      '[\n  {\n    "Name_JP": "あ",\n    "Num": 1\n  },\n' +
      '  {\n    "Progress": "wip",\n    "Num": 2,\n    "Name_JP": "い"\n  },\n' +
      '  {\n    "Num": 3,\n    "Progress": "done"\n  }\n]\n';
    writeFileSync(file, original);

    const result = normalizeFileText(file, rank);
    expect(result.changed).toBe(2);
    expect(result.total).toBe(3);
    expect(JSON.parse(result.text)).toEqual(JSON.parse(original));
    expect(JSON.parse(result.text).map((r) => Object.keys(r))).toEqual([
      ['Num', 'Name_JP'],
      ['Num', 'Progress', 'Name_JP'],
      ['Num', 'Progress'],
    ]);

    // 冪等: 整列済みテキストを再度流しても変化しない
    writeFileSync(file, result.text);
    expect(normalizeFileText(file, rank).changed).toBe(0);
  });
});
