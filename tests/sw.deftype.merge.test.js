/**
 * `deftype` / `meta` 系エンドポイントの `$VarsDef` 合成テスト
 *
 * db_meta.json と db_type.json に辞書が分散していても、
 * API 応答から一貫して参照できることを確認する。
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

function loadSwCommonIntoContext(overrides = {}) {
  const code = loadText('lib/sw-common.js');
  const context = {
    console,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    fetch: globalThis.fetch,
    self: {
      location: { origin: 'https://example.invalid', pathname: '/' }
    },
    ...overrides
  };

  vm.runInNewContext(code, context, { filename: 'lib/sw-common.js' });
  return context;
}

describe('ApiEndpointHandlers merges vars defs across meta/type sources', () => {
  it('handleDeftypeGlobalEndpoint includes type-side enum definitions', async () => {
    const ctx = loadSwCommonIntoContext();
    const ApiEndpointHandlers = ctx?.self?.ApiEndpointHandlers;
    expect(ApiEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readGlobalMeta: async () => ({
        General: {
          $VarsDef: {
            $EnumDef_GenderType: {
              '#Female': { GenderType: 'Female', GenderType_JP: '女性' }
            }
          }
        }
      }),
      readGlobalType: async () => ({
        $VarsDef: {
          $EnumDef_Decave: {
            '#Decave5': { Decave: '9xV', DecaveText_JP: 'クィントナイン(99.999%以上)' }
          }
        }
      })
    };

    const handlers = new ApiEndpointHandlers(stubFetcher);
    const res = await handlers.handleDeftypeGlobalEndpoint();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json?.General?.$VarsDef?.$EnumDef_GenderType?.['#Female']?.GenderType).toBe('Female');
    expect(json?.General?.$VarsDef?.$EnumDef_Decave?.['#Decave5']?.Decave).toBe('9xV');
  });

  it('handleWorkMetaEndpoint includes work type vars defs inside meta response', async () => {
    const ctx = loadSwCommonIntoContext();
    const ApiEndpointHandlers = ctx?.self?.ApiEndpointHandlers;
    expect(ApiEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readWorkMeta: async () => ({
        General: {
          $VarsDef: {
            '#List_RelationLabel': [
              { RelationLabel: 'allies', RelationLabel_JP: '味方' }
            ]
          }
        }
      }),
      readWorkType: async () => ({
        $VarsDef: {
          $EnumDef_Decave: {
            '#Decave3': { Decave: '99.9%+', DecaveText_JP: 'トリナイン(99.9%以上)' }
          }
        }
      })
    };

    const handlers = new ApiEndpointHandlers(stubFetcher);
    const res = await handlers.handleWorkMetaEndpoint('Works_PastDivers');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.work).toBe('#Works_PastDivers');
    expect(Array.isArray(json?.meta?.General?.$VarsDef?.['#List_RelationLabel'])).toBe(true);
    expect(json?.meta?.General?.$VarsDef?.$EnumDef_Decave?.['#Decave3']?.Decave).toBe('99.9%+');
  });

  it('DataFetcher merges dictionary DBs into global meta vars defs', async () => {
    const jsonByPath = {
      '/data/db_meta.json': {
        General: {
          $VarsDef: {
            $EnumDef_GenderType: {
              '#Female': { GenderType: 'Female', GenderType_JP: '女性' }
            }
          }
        }
      },
      '/data/Dictionaries/db_meta.json': {
        Dictionaries: {
          '#Dict_Area': {
            keyField: 'Area',
            compatListKey: '#List_Area'
          },
          '#Dict_Faction': {
            keyField: 'Faction',
            compatListKey: '#List_Faction'
          }
        }
      },
      '/data/Dictionaries/db_type.json': {
        $VarsDef: {}
      },
      '/data/Dictionaries/dict_Area.json': [
        { Area: '九蓮国', Area_EN: 'LotusNinea' }
      ],
      '/data/Dictionaries/dict_Faction.json': [
        { Faction: '百花繚乱研究所', FactionsBaseArea: { Area: '九蓮国' } }
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
    const meta = await fetcher.readGlobalMeta();

    expect(Array.isArray(meta?.General?.$VarsDef?.['#Dict_Area'])).toBe(true);
    expect(Array.isArray(meta?.General?.$VarsDef?.['#List_Area'])).toBe(true);
    expect(meta?.General?.$VarsDef?.['#Dict_Faction']?.[0]?.FactionsBaseArea?.Area).toBe('九蓮国');
    expect(meta?.Dictionaries?.['#Dict_Area']?.file).toBeUndefined();
    expect(meta?.Dictionaries?.['#Dict_Area']?.keyField).toBe('Area');
    expect(meta?.Dictionaries?.['#Dict_Faction']?.keyField).toBe('Faction');
  });
});
