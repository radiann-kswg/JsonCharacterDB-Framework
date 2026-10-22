/**
 * 作品/DB カタログ向けメタ schema 宣言の存在確認。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

function load(file) {
  return JSON.parse(readFileSync(join(repoRoot, file), 'utf-8'));
}

describe('catalog meta schema declarations', () => {
  it('global db_type declares work and database catalog meta definitions', () => {
    const dbType = load('data/db_type.json');
    const dbMeta = load('data/db_meta.json');
    const storyEra = dbType?.$MetaType?.$Def_StoryEra?.$DefType;
    const storyEraCatalog = dbType?.$MetaType?.$Def_StoryEraCatalog?.$DefType;

    expect(dbType?.$MetaType?.$Def_CreationWorkCatalog?.$DefType).toBeInstanceOf(Array);
    expect(dbType?.$MetaType?.$Def_DatabaseCatalog?.$DefType).toBeInstanceOf(Array);
    expect(dbType?.$MetaType?.$Def_OldTitleCatalog?.$DefType).toBeInstanceOf(Array);
    expect(dbType?.$MetaType?.$Def_StoryEra?.$display?.wrapper).toBe('eraSummary');
    expect(dbType?.$MetaType?.$Def_StoryEraCatalog?.$display?.wrapper).toBe('storyEraSummary');
    expect(dbMeta?.General?.$VarsDef?.$Def_Day?.$display?.wrapper).toBe('daySummary');
    expect(storyEra).toBeInstanceOf(Array);
    expect(storyEraCatalog).toBeInstanceOf(Array);
    expect(dbType?.$MetaType?.$Def_SecondaryMeta?.$DefType).toBeInstanceOf(Array);

    expect(storyEra.map((entry) => entry?.hashTag)).toEqual([
      'EraGen',
      'YearInEra',
      'byRealYear',
      'about_JP',
      'about_EN'
    ]);
    expect(storyEraCatalog.map((entry) => entry?.hashTag)).toEqual([
      'FromEra',
      'ToEra',
      'InEra',
      'StoryEraAbout_JP',
      'StoryEraAbout_EN'
    ]);
    expect(storyEra.map((entry) => entry?.$display?.role || null)).toEqual([
      'eraGeneration',
      'eraYear',
      'realYear',
      'pointLabel',
      'pointLabelAlt'
    ]);
    expect(storyEraCatalog.map((entry) => entry?.$display?.role || null)).toEqual([
      'rangeStart',
      'rangeEnd',
      'representativePoint',
      'preferredLabel',
      'preferredLabelAlt'
    ]);
  });

  // 作品ディレクトリを走査する（作品名や年代の実値を書かないことで、上流のデータ更新がこのテストに差分を作らないようにする）
  const workDirs = readdirSync(join(repoRoot, 'data')).filter((n) => n.startsWith('Works_'));
  const loadWorkDbs = (rel) =>
    workDirs
      .map((w) => join(repoRoot, 'data', w, rel))
      .filter((p) => existsSync(p))
      .flatMap((p) => Object.values(JSON.parse(readFileSync(p, 'utf-8'))?.Databases ?? {}));

  it('work-local db_meta databases can expose DB labels', () => {
    const primaries = loadWorkDbs('DataBases/db_meta.json').filter((db) => db?.DB_Label_JP !== undefined);
    const refs = loadWorkDbs('References/db_meta.json').filter((db) => db?.DB_Label_JP !== undefined);
    expect(primaries.length).toBeGreaterThan(0);
    expect(refs.length).toBeGreaterThan(0);
    for (const db of [...primaries, ...refs]) {
      expect(typeof db.DB_Label_JP).toBe('string');
      expect(typeof db.DB_Label_EN).toBe('string');
    }
  });

  it('work-local db_meta story era values match the structured schema fields', () => {
    // {value, about} で包まれた形も許容する
    const unwrap = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v);
    const eras = loadWorkDbs('DataBases/db_meta.json')
      .map((db) => db?.StoryEra)
      .filter(Boolean);
    expect(eras.length).toBeGreaterThan(0);
    for (const era of eras) {
      expect(typeof era.StoryEraAbout_JP).toBe('string');
      for (const key of ['FromEra', 'ToEra', 'InEra']) {
        const points = unwrap(era[key]);
        if (points == null) continue;
        expect(Array.isArray(points)).toBe(true);
        for (const p of points) {
          expect(typeof p.EraGen === 'number' || typeof p.byRealYear === 'number').toBe(true);
        }
      }
      expect(unwrap(era.InEra).some((p) => typeof p?.byRealYear === 'number')).toBe(true);
    }
  });
});
