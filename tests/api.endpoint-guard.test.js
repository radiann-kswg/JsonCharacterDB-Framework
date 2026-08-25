/**
 * API テスト UI のエンドポイント検証テスト
 *
 * 任意入力からの外部 URL / 許可外パス fetch を防げることを確認する。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadApiUiHelpers() {
  const filePath = path.resolve(process.cwd(), 'api/api.js');
  const source = readFileSync(filePath, 'utf-8');
  const context = {
    URL,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: filePath });
  return context.__100blApiUi;
}

describe('api endpoint guard', () => {
  it('allows same-origin /api/v1 paths', () => {
    const helpers = loadApiUiHelpers();
    const result = helpers.normalizeApiUiEndpoint('/api/v1/works/NumberTales?resolve=1', 'https://example.com/api/index.html');

    expect(result).toEqual({
      ok: true,
      path: '/api/v1/works/NumberTales?resolve=1'
    });
  });

  it('allows relative v1 paths that resolve under /api/v1', () => {
    const helpers = loadApiUiHelpers();
    const result = helpers.normalizeApiUiEndpoint('v1/index', 'https://example.com/api/index.html');

    expect(result).toEqual({
      ok: true,
      path: '/api/v1/index'
    });
  });

  it('rejects cross-origin endpoints', () => {
    const helpers = loadApiUiHelpers();
    const result = helpers.normalizeApiUiEndpoint('https://evil.example/api/v1/index', 'https://example.com/api/index.html');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('同一オリジン');
  });

  it('rejects non-http schemes', () => {
    const helpers = loadApiUiHelpers();
    const result = helpers.normalizeApiUiEndpoint('javascript:alert(1)', 'https://example.com/api/index.html');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('スキーム');
  });

  it('rejects paths outside /api/v1', () => {
    const helpers = loadApiUiHelpers();
    const result = helpers.normalizeApiUiEndpoint('/svc/v1/index', 'https://example.com/api/index.html');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('/api/v1/*');
  });
});