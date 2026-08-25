/**
 * フェーズ2: DB種別多様化への耐性 - 作品別db_meta欠損時の耐性テスト
 *
 * StandardEndpointHandlers が `readWorkMeta()` に失敗しても 500 にならず、
 * DB取得・検索が継続できること（_Commons適用はスキップ）を最小ケースで検証します。
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
  const code = loadText('lib/sw-common.js');

  // sw-common.js は Service Worker 環境向けの classic script。
  // vm 上で self と最低限の Web API（Response/URL）を注入してロードする。
  const context = {
    console,
    Response: globalThis.Response,
    Headers: globalThis.Headers,
    URL: globalThis.URL,
    self: {
      location: { origin: 'https://example.invalid', pathname: '/' },
    }
  };

  vm.runInNewContext(code, context, { filename: 'lib/sw-common.js' });
  return context;
}

describe('StandardEndpointHandlers tolerates missing work meta', () => {
  it('handleDbEndpoint returns 200 even if readWorkMeta throws', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readDB: async (_workId, _dbName) => [{ Num: 1, Name: 'dummy' }],
      readWorkMeta: async () => {
        throw new Error('missing work meta');
      },
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleDbEndpoint('Works_NumberTales', 'Primary', false, false, false);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.work).toBe('#Works_NumberTales');
    expect(json.db).toBe('Primary');
    expect(Array.isArray(json.records)).toBe(true);
    expect(json.records.length).toBe(1);
  });

  it('handleSearchEndpoint returns 200 even if readWorkMeta throws', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readDB: async (_workId, _dbName) => [{ Num: 1, Name: 'dummy' }, { Num: 2, Name: 'dummy2' }],
      readWorkMeta: async () => {
        throw new Error('missing work meta');
      },
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');

    const url = new URL('https://example.invalid/v1/search');
    url.searchParams.set('works', 'Works_NumberTales');
    url.searchParams.set('db', 'Primary');
    url.searchParams.append('hashTag', 'Num');
    url.searchParams.append('key', '2');

    const res = await handlers.handleSearchEndpoint(url, false, false, false);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.work).toBe('#Works_NumberTales');
    expect(json.db).toBe('Primary');
    expect(json.count).toBe(1);
    expect(json.records[0].Num).toBe(2);
  });

  it('handleDbEndpoint excludes records with isPrivate=true', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readDB: async () => [
        { Num: 1, Name: 'public' },
        { Num: 2, Name: 'private', isPrivate: true }
      ],
      readWorkMeta: async () => ({ Databases: {} }),
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');
    const res = await handlers.handleDbEndpoint('Works_NumberTales', 'Primary', false, false, false);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.records.map((record) => record.Num)).toEqual([1]);
  });

  it('handleSearchEndpoint ignores records with isPrivate=true', async () => {
    const ctx = loadSwCommonIntoContext();
    const StandardEndpointHandlers = ctx?.self?.StandardEndpointHandlers;
    expect(StandardEndpointHandlers).toBeTypeOf('function');

    const stubFetcher = {
      readDB: async () => [
        { Num: 1, Name: 'public target' },
        { Num: 2, Name: 'private target', isPrivate: true }
      ],
      readWorkMeta: async () => ({ Databases: {} }),
    };

    const handlers = new StandardEndpointHandlers(stubFetcher, null, null, 'Test');

    const url = new URL('https://example.invalid/v1/search');
    url.searchParams.set('works', 'Works_NumberTales');
    url.searchParams.set('db', 'Primary');
    url.searchParams.append('hashTag', 'Name');
    url.searchParams.append('key', 'private target');

    const res = await handlers.handleSearchEndpoint(url, false, false, false);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.count).toBe(0);
    expect(json.records).toEqual([]);
  });
});
