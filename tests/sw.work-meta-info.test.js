/**
 * works / db 一覧系エンドポイントが、db_meta.json の創作タイトル情報を返すことを確認する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

function loadText(relPath) {
  return readFileSync(join(repoRoot, relPath), 'utf-8');
}

function loadSwCommonIntoContext() {
  const wrapperCode = loadText('lib/wrapper-common.js');
  const code = loadText('lib/sw-common.js');
  const context = {
    console,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    self: {
      location: { origin: 'https://example.invalid', pathname: '/' }
    }
  };

  vm.runInNewContext(wrapperCode, context, { filename: 'lib/wrapper-common.js' });
  vm.runInNewContext(code, context, { filename: 'lib/sw-common.js' });
  return context;
}

describe('StandardEndpointHandlers exposes work/db catalog meta info', () => {
  it('handleWorksListEndpoint includes creation title summary fields', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readGlobalMeta: async () => ({
        CreationWorks: {
          '#Works_NumberTales': {
            Title_JP: 'ナンバーテールズ',
            Title_EN: 'NumberTales',
            Works_Summary_JP: '作品概要です。',
            OldTitles: [{ Title_JP: '旧題', ArchivedYear: 2024 }],
            Works_OfficialLinks: [
              {
                LinkType: 'HP',
                URL: 'https://www.numbertales-radiann.com/',
                Label_JP: '公式サイト',
                Label_EN: 'Official Site (JAPANESE ONLY)'
              }
            ]
          },
          '#Works_NoLinks': {
            Title_JP: 'リンク無し作品',
            Title_EN: 'No Links Work'
          }
        }
      })
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleWorksListEndpoint();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json[0].Title_JP).toBe('ナンバーテールズ');
    expect(json[0].Works_Summary_JP).toBe('作品概要です。');
    expect(Array.isArray(json[0].OldTitles)).toBe(true);
    // 公式リンク（Works_OfficialLinks）がカタログへパススルーされる
    expect(Array.isArray(json[0].Works_OfficialLinks)).toBe(true);
    expect(json[0].Works_OfficialLinks[0].URL).toBe('https://www.numbertales-radiann.com/');
    expect(json[0].Works_OfficialLinks[0].Label_EN).toBe('Official Site (JAPANESE ONLY)');
    // 未定義の作品では空配列にフォールバックする
    expect(json[1].Works_OfficialLinks).toEqual([]);
  });

  it('handleWorkDbListEndpoint includes DB labels, summary and story era from work meta', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      listWorkDBs: async () => [{ key: 'Primary', file: 'db_Primary.json' }],
      readGlobalType: async () => ({
        $MetaType: {
          $Def_DatabaseCatalog: {
            $DefType: [
              { hashTag: 'DB_Label', $type: '#String|#Null' },
              { hashTag: 'DB_Label_EN', $type: '#String|#Null' },
              { hashTag: 'DB_Summary', $type: '#Summary|#Null' },
              { hashTag: 'StoryEra', $type: '$Def_StoryEraCatalog|#Null' }
            ]
          },
          $Def_StoryEra: {
            $display: { wrapper: 'eraSummary' },
            $DefType: [
              { hashTag: 'EraGen', $display: { role: 'eraGeneration' } },
              { hashTag: 'YearInEra', $display: { role: 'eraYear' } },
              { hashTag: 'byRealYear', $display: { role: 'realYear' } },
              { hashTag: 'about_JP', $display: { role: 'pointLabel' } },
              { hashTag: 'about_EN', $display: { role: 'pointLabelAlt' } }
            ]
          },
          $Def_StoryEraCatalog: {
            $display: { wrapper: 'storyEraSummary' },
            $DefType: [
              { hashTag: 'FromEra', $display: { role: 'rangeStart' } },
              { hashTag: 'ToEra', $display: { role: 'rangeEnd' } },
              { hashTag: 'InEra', $display: { role: 'representativePoint' } },
              { hashTag: 'about_JP', $display: { role: 'preferredLabel' } },
              { hashTag: 'about_EN', $display: { role: 'preferredLabelAlt' } }
            ]
          }
        }
      }),
      readWorkMeta: async () => ({
        Databases: {
          '#DB_Primary': {
            DB_Label_JP: '一次創作',
            DB_Label_EN: 'Primary',
            DB_Summary: 'DB概要です。',
            StoryEra: {
              InEra: [{ EraGen: 9, YearInEra: 3 }],
              about_JP: '第9創世紀3年ごろ'
            }
          }
        }
      })
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleWorkDbListEndpoint('Works_NumberTales');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.databases[0].DB_Label_JP).toBe('一次創作');
    expect(json.databases[0].DB_Label_EN).toBe('Primary');
    expect(json.databases[0].DB_Summary).toBe('DB概要です。');
    expect(json.databases[0].StoryEra.about_JP).toBe('第9創世紀3年ごろ');
    expect(json.databases[0].StoryEraSummary).toBe('第9創世紀3年ごろ');
    expect(json.databases[0].metaKey).toBe('#DB_Primary');
  });

  it('handleWorkEndpoint includes global work info alongside work meta', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readGlobalMeta: async () => ({
        CreationWorks: {
          '#Works_PastDivers': {
            Title_JP: 'パストダイヴァー',
            Title_EN: 'PastDivers',
            Works_Summary_JP: '作品側の概要'
          }
        }
      }),
      readWorkMeta: async () => ({ Databases: { '#DB_Primary': { DB_Summary: 'db summary' } } })
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleWorkEndpoint('Works_PastDivers');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.work).toBe('#Works_PastDivers');
    expect(json.workInfo.Title_EN).toBe('PastDivers');
    expect(json.meta.Databases['#DB_Primary'].DB_Summary).toBe('db summary');
  });
});