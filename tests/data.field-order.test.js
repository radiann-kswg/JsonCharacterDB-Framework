/**
 * 実データのフィールドキー順が typedef($DefType) の正準順と一致することを検証する
 *
 * 目的:
 * - `data/Works_<work>/DataBases/db_<db>.json` のレコードキー順が、
 *   `TypeDefUtils.mergeDefTypes()`（$slot マーカー適用後）の順に追従していること
 * - 手書きでレコードを追加/編集したときに、並び順の乱れを CI で検知すること
 *
 * 背景:
 * - 以前はキー順に関する検証が無く、同一 DB 内で 105件76通りまで乱れていた。
 * - 整列は `node tools/normalize-field-order.mjs --write`（または `npm run data:order:write`）で行う。
 *
 * NOTE:
 * - 順序の正は typedef 側（data/db_type.json の $slot 宣言）です。
 *   本テストが落ちたら、まず「データが古い」のか「typedef の宣言を変えたい」のかを切り分けてください。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

import { buildFieldRank, sortRecordKeys, normalizeFileText } from '../tools/normalize-field-order.mjs';
import '../lib/data-common.js';

const { TypeDefUtils } = globalThis;

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const loadJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf-8'));

/** レコード配列を持つ DB だけを対象にする（db_type / db_meta / db_temp は除外） */
const RECORD_DB_RE = /^db_(?!type\.json$|meta\.json$|temp\.json$)[A-Za-z]+\.json$/;

const globalType = loadJson('data/db_type.json');
const globalMeta = loadJson('data/db_meta.json');

/** @returns {Array<{rel: string, work: string, db: string}>} */
function enumerateRecordDbs() {
  return globSync(join(repoRoot, 'data/Works_*/DataBases/db_*.json').replace(/\\/g, '/'))
    .map((abs) => abs.replace(/\\/g, '/'))
    .filter((abs) => RECORD_DB_RE.test(basename(abs)))
    .map((abs) => {
      const rel = abs.slice(abs.indexOf('data/'));
      return {
        rel,
        work: rel.split('/')[1].replace(/^Works_/, ''),
        db: basename(abs).replace(/^db_/, '').replace(/\.json$/, ''),
      };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

const rankCache = new Map();
function rankFor(work) {
  if (!rankCache.has(work)) {
    const workType = loadJson(`data/Works_${work}/DataBases/db_type.json`);
    const detailLayout = globalMeta?.CreationWorks?.[`#Works_${work}`]?.$DetailLayout ?? null;
    const merged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
    rankCache.set(work, buildFieldRank(merged.map((e) => e.hashTag).filter(Boolean)));
  }
  return rankCache.get(work);
}

const targets = enumerateRecordDbs();

describe('実データのフィールドキー順が $DefType の正準順に追従している', () => {
  it('対象 DB を検出できる（グロブが db_type/db_meta を拾っていない）', () => {
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((t) => !/^(type|meta|temp)$/.test(t.db))).toBe(true);
  });

  it.each(targets.map((t) => [t.rel, t]))('%s', (_rel, t) => {
    const rank = rankFor(t.work);
    const records = loadJson(t.rel);
    expect(Array.isArray(records)).toBe(true);
    for (const [i, rec] of records.entries()) {
      const keys = Object.keys(rec);
      expect(sortRecordKeys(keys, rank), `${t.rel} のレコード #${i}`).toEqual(keys);
    }
  });
});

describe('整列ツールが実データに対して冪等', () => {
  it.each(targets.map((t) => [t.rel, t]))('%s は再実行しても差分ゼロ', (_rel, t) => {
    const result = normalizeFileText(join(repoRoot, t.rel), rankFor(t.work));
    expect(result.changed, `${t.rel} は未整列（npm run data:order:write で整列できます）`).toBe(0);
  });
});

describe('$slot マーカーの健全性', () => {
  const markers = globalType.$DefType.filter((e) => e && !e.hashTag && typeof e.$slot === 'string');

  it('マーカーが宣言されている', () => {
    expect(markers.length).toBeGreaterThan(0);
  });

  it('catch-all マーカーが厳密に 1 個ある（作品固有フィールドの取りこぼしを防ぐ）', () => {
    expect(markers.filter((m) => m.$slotMatch === '*')).toHaveLength(1);
  });

  it('$slot 名が重複していない', () => {
    const names = markers.map((m) => m.$slot);
    expect(new Set(names).size).toBe(names.length);
  });

  it('マージ結果にマーカーが漏れない（全エントリが hashTag を持つ）', () => {
    // NOTE: 作品側エントリの `$slot` 明示（逃がし弁。例: DestinyFoxRecords の Unit_FullEN）は
    //   hashTag を持つ正当なフィールドなので結果に含まれてよい。
    //   ここで検出したいのは「hashTag を持たないマーカー」が下流へ漏れることだけ。
    for (const work of [...new Set(targets.map((t) => t.work))]) {
      const workType = loadJson(`data/Works_${work}/DataBases/db_type.json`);
      const detailLayout = globalMeta?.CreationWorks?.[`#Works_${work}`]?.$DetailLayout ?? null;
      const merged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
      expect(merged.every((e) => typeof e.hashTag === 'string' && e.hashTag), work).toBe(true);
      expect(merged.filter((e) => !e.hashTag && '$slot' in e), work).toHaveLength(0);
    }
  });

  it('作品固有フィールドがマージで失われない', () => {
    for (const work of [...new Set(targets.map((t) => t.work))]) {
      const workType = loadJson(`data/Works_${work}/DataBases/db_type.json`);
      const detailLayout = globalMeta?.CreationWorks?.[`#Works_${work}`]?.$DetailLayout ?? null;
      const merged = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout });
      const mergedKeys = new Set(merged.map((e) => e.hashTag));
      for (const e of workType.$DefType ?? []) {
        if (!e?.hashTag) continue;
        expect(mergedKeys.has(e.hashTag), `${work} の ${e.hashTag}`).toBe(true);
      }
    }
  });
});

describe('User 要望の冒頭順（Index → Progress → _DBLinkRef → Name → Images → FormalName）', () => {
  it.each([...new Set(targets.map((t) => t.work))])('%s の正準順が要望順に沿う', (work) => {
    const workType = loadJson(`data/Works_${work}/DataBases/db_type.json`);
    const detailLayout = globalMeta?.CreationWorks?.[`#Works_${work}`]?.$DetailLayout ?? null;
    const tags = TypeDefUtils.mergeDefTypes(globalType, workType, { detailLayout }).map((e) => e.hashTag);
    const at = (k) => tags.indexOf(k);

    // Index（$type: "#Index"）が先頭に来る
    const indexTags = (workType.$DefType ?? []).filter((e) => e?.$type === '#Index').map((e) => e.hashTag);
    for (const idx of indexTags) expect(at(idx), `${work}: ${idx}`).toBeLessThan(at('Progress'));

    // Progress → _DBLink 群 → Name → Images → FormalName
    expect(at('Progress')).toBeLessThan(at('AnotherVersions_DBLink'));
    expect(at('AnotherVersions_DBLink')).toBeLessThan(at('Name_JP'));
    expect(at('Name_JP')).toBeLessThan(at('FormalName_JP'));
    if (at('Images') !== -1) {
      expect(at('Name_EN'), `${work}: Images は Name の後`).toBeLessThan(at('Images'));
      expect(at('Images'), `${work}: Images は FormalName の前`).toBeLessThan(at('FormalName_JP'));
    }
    // 作品固有 _DBLink はグローバル _DBLink 群の直後、Name より前
    for (const e of workType.$DefType ?? []) {
      if (typeof e?.$type !== 'string' || !e.$type.includes('$Def_DBLinkRef')) continue;
      expect(at(e.hashTag), `${work}: ${e.hashTag}`).toBeLessThan(at('Name_JP'));
    }
  });
});
