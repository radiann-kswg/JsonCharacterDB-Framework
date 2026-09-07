/**
 * DB_Layer による DB レイヤー切り替えの基本テスト
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

function loadSwCommonIntoContext(extra = {}) {
  const code = loadText('lib/sw-common.js');
  const context = {
    console,
    fetch: extra.fetch || globalThis.fetch,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    self: {
      location: { origin: 'https://example.invalid', pathname: '/' }
    }
  };

  vm.runInNewContext(code, context, { filename: 'lib/sw-common.js' });
  return context;
}

describe('DB layer aware routing', () => {
  it('DataFetcher.readDB uses #Ref_ catalog keys to resolve ref_*.json by default', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: {
          '#Ref_Glossary': {
            DB_Label: '創作用語',
            DB_Layer: 'References'
          }
        }
      },
      '/data/Works_Test/References/ref_Glossary.json': [
        { Term: '百花繚乱研究所' }
      ]
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) {
        return new Response('not found', { status: 404 });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const SWConfig = ctx?.self?.SWConfig;
    const DataFetcher = ctx?.self?.DataFetcher;
    expect(SWConfig).toBeTypeOf('function');
    expect(DataFetcher).toBeTypeOf('function');

    const fetcher = new DataFetcher(new SWConfig('/pages'));
    const records = await fetcher.readDB('#Works_Test', 'Glossary');

    expect(records).toEqual([{ Term: '百花繚乱研究所' }]);
  });

  it('DataFetcher.readWorkMeta merges References/db_meta.json Databases into the result', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: {
          '#DB_Primary': { DB_Label: '一次創作' }
        }
      },
      '/data/Works_Test/References/db_meta.json': {
        Databases: {
          '#Ref_Vocabulary': { DB_Label: '語彙辞書', DB_Label_EN: 'Vocabulary' }
        }
      }
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const meta = await fetcher.readWorkMeta('#Works_Test');

    expect(meta.Databases?.['#DB_Primary']?.DB_Label).toBe('一次創作');
    expect(meta.Databases?.['#Ref_Vocabulary']?.DB_Label).toBe('語彙辞書');
    expect(meta.Databases?.['#Ref_Vocabulary']?.DB_Layer).toBe('References');
  });

  it('DataFetcher.readWorkMeta keeps DB_Layer from References/db_meta.json when explicitly set', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': { Databases: {} },
      '/data/Works_Test/References/db_meta.json': {
        Databases: {
          '#Ref_Reference': { DB_Label: '創作基本資料', DB_Layer: 'References' }
        }
      }
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const meta = await fetcher.readWorkMeta('#Works_Test');

    expect(meta.Databases?.['#Ref_Reference']?.DB_Layer).toBe('References');
  });

  it('DataFetcher.readWorkMeta gracefully handles missing References/db_meta.json', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: { '#DB_Primary': { DB_Label: '一次創作' } }
      }
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const meta = await fetcher.readWorkMeta('#Works_Test');

    expect(meta.Databases?.['#DB_Primary']?.DB_Label).toBe('一次創作');
  });

  it('handleWorkDbListEndpoint keeps custom file and layer information for non-DataBases entries', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      listWorkDBs: async () => [{ key: 'Glossary', file: 'ref_Glossary.json', layer: 'References' }],
      readWorkMeta: async () => ({
        Databases: {
          '#Ref_Glossary': {
            DB_Label_JP: '創作用語',
            DB_Label_EN: 'Glossary',
            DB_Layer: 'References',
            DB_Summary: '作品用語の一覧。'
          }
        }
      })
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleWorkDbListEndpoint('Works_Test');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.databases[0].key).toBe('Glossary');
    expect(json.databases[0].DB_Layer).toBe('References');
    expect(json.databases[0].file).toBe('ref_Glossary.json');
    expect(json.databases[0].DB_Label_JP).toBe('創作用語');
  });

  it('DataFetcher.readWorkMeta merges Localization/db_meta.json Databases into the result', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: { '#DB_Primary': { DB_Label: '一次創作' } }
      },
      '/data/Works_Test/Localization/db_meta.json': {
        Databases: {
          '#Loc_PersonName': { DB_Layer: 'Localization', DB_Label_JP: '人物名・呼称', DB_Label_EN: 'Person Name / Appellation' }
        }
      }
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const meta = await fetcher.readWorkMeta('#Works_Test');

    expect(meta.Databases?.['#DB_Primary']?.DB_Label).toBe('一次創作');
    expect(meta.Databases?.['#Loc_PersonName']?.DB_Label_JP).toBe('人物名・呼称');
    expect(meta.Databases?.['#Loc_PersonName']?.DB_Layer).toBe('Localization');
  });

  it('DataFetcher.readDB resolves Localization layer trans_*.json via Localization/db_meta.json', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: {}
      },
      '/data/Works_Test/Localization/db_meta.json': {
        Databases: {
          '#Loc_PersonName': {
            DB_Layer: 'Localization',
            DB_Label_JP: '人物名・呼称',
            DB_Label_EN: 'Person Name / Appellation'
          }
        }
      },
      '/data/Works_Test/Localization/trans_PersonName.json': [
        { Term_JP: '扇一春', Term_EN: 'Hatsuharu Ogi', TransPolicy: '#TP_LocalizeName' }
      ]
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const records = await fetcher.readDB('#Works_Test', 'PersonName');

    expect(records).toHaveLength(1);
    expect(records[0].Term_JP).toBe('扇一春');
    expect(records[0].TransPolicy).toBe('#TP_LocalizeName');
  });

  it('DataUtils.stripMetaDbPrefix strips Loc_ prefix from #Loc_ keys', () => {
    const ctx = loadSwCommonIntoContext();
    const DataUtils = ctx?.self?.DataUtils;
    expect(DataUtils).toBeTypeOf('function');

    expect(DataUtils.stripMetaDbPrefix('#Loc_Dict')).toBe('Dict');
    expect(DataUtils.stripMetaDbPrefix('Loc_Dict')).toBe('Dict');
    expect(DataUtils.stripMetaDbPrefix('#Ref_Glossary')).toBe('Glossary');
    expect(DataUtils.stripMetaDbPrefix('#DB_Primary')).toBe('Primary');
  });

  it('DataFetcher.listWorkDBs excludes #Loc_* entries from the browsable DB list', async () => {
    const jsonByPath = {
      '/data/Works_Test/DataBases/db_meta.json': {
        Databases: { '#DB_Primary': { DB_Label: '一次創作' } }
      },
      '/data/Works_Test/Localization/db_meta.json': {
        Databases: {
          '#Loc_PersonName': { DB_Layer: 'Localization', DB_Label_JP: '人物名・呼称', DB_Label_EN: 'Person Name / Appellation' },
          '#Loc_FamilyName': { DB_Layer: 'Localization', DB_Label_JP: '種族名・襲名', DB_Label_EN: 'Race / Succession Name' }
        }
      },
      '/data/Works_Test/DataBases/db_Primary.json': [{ Name: 'test' }]
    };

    const fetchStub = async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };

    const ctx = loadSwCommonIntoContext({ fetch: fetchStub });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));
    const dbs = await fetcher.listWorkDBs('#Works_Test');

    const keys = dbs.map((d) => d.key);
    expect(keys).toContain('Primary');
    expect(keys).not.toContain('PersonName');
    expect(keys).not.toContain('FamilyName');
  });

  it('DataUtils.findMetaDbEntry finds #Loc_ entries alongside #DB_ and #Ref_', () => {
    const ctx = loadSwCommonIntoContext();
    const DataUtils = ctx?.self?.DataUtils;

    const databases = {
      '#DB_Primary': { DB_Label: '一次創作' },
      '#Ref_Glossary': { DB_Layer: 'References', DB_Label: '創作用語' },
      '#Loc_Dict': { DB_Layer: 'Localization', DB_Label_JP: '翻訳辞書' }
    };

    const r = DataUtils.findMetaDbEntry(databases, 'Dict');
    expect(r.metaKey).toBe('#Loc_Dict');
    expect(r.entry?.DB_Layer).toBe('Localization');
  });
});

describe('Works_Dir override (common references pseudo-work)', () => {
  function makeFetchStub(jsonByPath) {
    return async (url, opt = {}) => {
      const pathname = new URL(url).pathname;
      const body = jsonByPath[pathname];
      if ((opt?.method || 'GET').toUpperCase() === 'HEAD') {
        return new Response('', { status: body ? 200 : 404 });
      }
      if (!body) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    };
  }

  it('DataFetcher.resolveWorkDir honors Works_Dir override from global db_meta.json', async () => {
    const jsonByPath = {
      '/data/db_meta.json': {
        CreationWorks: {
          '#Works_CommonReferences': { Works_Dir: 'References' }
        }
      }
    };

    const ctx = loadSwCommonIntoContext({ fetch: makeFetchStub(jsonByPath) });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));

    expect(await fetcher.resolveWorkDir('#Works_CommonReferences')).toBe('References');
    // オーバーライドが無い作品は従来通りの導出のまま（回帰確認）
    expect(await fetcher.resolveWorkDir('#Works_NumberTales')).toBe('Works_NumberTales');
  });

  it('DataFetcher.readWorkMeta/readWorkType fall back to root files when DataBases/ subfolder is absent', async () => {
    const jsonByPath = {
      '/data/db_meta.json': {
        CreationWorks: {
          '#Works_CommonReferences': { Works_Dir: 'References' }
        }
      },
      '/data/References/db_meta.json': {
        Databases: {
          '#Ref_Vocabulary': { DB_Label_JP: '語彙辞書', DB_Layer: 'References' }
        }
      },
      '/data/References/db_type.json': {
        $IndexDef: { hashTag: 'Term_JP' }
      }
    };

    const ctx = loadSwCommonIntoContext({ fetch: makeFetchStub(jsonByPath) });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));

    const meta = await fetcher.readWorkMeta('#Works_CommonReferences');
    expect(meta.Databases?.['#Ref_Vocabulary']?.DB_Label_JP).toBe('語彙辞書');

    const type = await fetcher.readWorkType('#Works_CommonReferences');
    expect(type.$IndexDef?.hashTag).toBe('Term_JP');
  });

  it('DataFetcher.readDB/listWorkDBs collapse the layer segment when DB_Layer equals the resolved workDir', async () => {
    const jsonByPath = {
      '/data/db_meta.json': {
        CreationWorks: {
          '#Works_CommonReferences': { Works_Dir: 'References' }
        }
      },
      '/data/References/db_meta.json': {
        Databases: {
          '#Ref_Vocabulary': { DB_Label_JP: '語彙辞書', DB_Layer: 'References' }
        }
      },
      '/data/References/ref_Vocabulary.json': [
        { Term_JP: '九蓮国' }
      ]
    };

    const ctx = loadSwCommonIntoContext({ fetch: makeFetchStub(jsonByPath) });
    const fetcher = new ctx.self.DataFetcher(new ctx.self.SWConfig('/pages'));

    // レイヤーが workDir 自身と一致する場合、/data/References/References/... へ二重化しない
    const records = await fetcher.readDB('#Works_CommonReferences', 'Vocabulary');
    expect(records).toEqual([{ Term_JP: '九蓮国' }]);

    const dbs = await fetcher.listWorkDBs('#Works_CommonReferences');
    expect(dbs).toEqual([{ key: 'Vocabulary', file: 'ref_Vocabulary.json', layer: 'References' }]);
  });
});