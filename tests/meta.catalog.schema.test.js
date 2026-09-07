/**
 * 作品/DB カタログ向けメタ schema 宣言の存在確認。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('work-local db_meta databases can expose DB labels', () => {
    const workMeta = load('data/Works_NumberTales/DataBases/db_meta.json');
    const refMeta = load('data/Works_NumberTales/References/db_meta.json');
    const primary = workMeta?.Databases?.['#DB_Primary'];
    const vocabulary = refMeta?.Databases?.['#Ref_Vocabulary'];

    expect(primary?.DB_Label_JP).toBe('一次創作');
    expect(primary?.DB_Label_EN).toBe('Primary');
    expect(vocabulary?.DB_Label_JP).toBe('語彙辞書');
    expect(vocabulary?.DB_Label_EN).toBe('Vocabulary');
  });

  it('work-local db_meta story era values match the structured schema fields', () => {
    const workMeta = load('data/Works_NumberTales/DataBases/db_meta.json');
    const primary = workMeta?.Databases?.['#DB_Primary'];

    expect(Array.isArray(primary?.StoryEra?.FromEra)).toBe(true);
    expect(Array.isArray(primary?.StoryEra?.ToEra)).toBe(true);
    expect(Array.isArray(primary?.StoryEra?.InEra)).toBe(true);
    expect(primary?.StoryEra?.FromEra?.[0]).toMatchObject({ EraGen: 9, YearInEra: 3 });
    expect(primary?.StoryEra?.InEra?.[2]).toMatchObject({ byRealYear: 2050 });
    expect(typeof primary?.StoryEra?.StoryEraAbout_JP).toBe('string');
  });
});