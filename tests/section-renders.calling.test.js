/**
 * lib/section-renders/calling.js の回帰テスト
 *
 * callingSection がレジストリ登録され、CallingCommon を使ったトークン描画と
 * 言語未確定時のフォールバック描画の両方が期待どおりに動作することを確認する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

beforeAll(async () => {
  const ts = Date.now();
  const wrapperUrl = `${pathToFileURL(join(repoRoot, 'lib/section-wrapper-common.js')).href}?calling-section-test=${ts}`;
  await import(wrapperUrl);
  const commonUrl = `${pathToFileURL(join(repoRoot, 'lib/basic-renders/calling-common.js')).href}?calling-section-test=${ts}`;
  await import(commonUrl);
  const rendererUrl = `${pathToFileURL(join(repoRoot, 'lib/section-renders/calling.js')).href}?calling-section-test=${ts}`;
  await import(rendererUrl);
});

function el(tag, props = {}, children = []) {
  return { tag, props, children: Array.isArray(children) ? children : [children] };
}

describe('callingSection', () => {
  it('registers itself into CharacterSectionRendererRegistry', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    const names = registry.getRegisteredSectionRenderers().map((r) => r.name);
    expect(names).toContain('callingSection');
  });

  it('renders parsed JP tokens as standalone section with token classes', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    const result = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'ThirdPersonCalling_JP',
        label: '三人称',
        value: '[※二人称],*の子/彼女'
      },
      {
        isStandaloneSubField: true,
        helpers: {
          el,
          getCurrentPageLanguage: () => 'jp',
          preWrapText: (text) => el('pre', { class: 'pre-wrap' }, [text]),
          wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children })
        }
      }
    );

    expect(result?.wrapped).toBe('ThirdPersonCalling_JP');

    const valueEl = result?.children?.[0];
    expect(valueEl?.props?.class).toBe('calling-value');

    const firstContext = valueEl?.children?.[0];
    const cat = firstContext?.children?.[0];
    const tokenNodes = cat?.children?.filter((n) => n?.tag === 'span' && String(n?.props?.class || '').includes('calling-tok'));
    expect(tokenNodes?.length).toBeGreaterThanOrEqual(3);

    expect(tokenNodes[0]?.props?.class).toContain('calling-tok--ref');
    expect(tokenNodes[0]?.children?.[0]).toBe('二人称と同じ');
    expect(tokenNodes[0]?.props?.title).toBe('[※二人称]');

    expect(tokenNodes[1]?.props?.class).toContain('calling-tok--demo');
    expect(tokenNodes[1]?.children?.[0]).toBe('その子/この子系');

    expect(tokenNodes[2]?.props?.class).toContain('calling-tok--plain');
    expect(tokenNodes[2]?.children?.[0]).toBe('彼女');
  });

  it('falls back to preWrapText when language cannot be resolved from key/page state', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    const result = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'ThirdPersonCalling',
        label: '三人称',
        value: '[※二人称],*の子/彼女'
      },
      {
        isStandaloneSubField: true,
        helpers: {
          el,
          preWrapText: (text) => el('pre', { class: 'pre-wrap' }, [text]),
          wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children })
        }
      }
    );

    expect(result?.wrapped).toBe('ThirdPersonCalling');
    const valueEl = result?.children?.[0];
    const ctx = valueEl?.children?.[0];
    const pre = ctx?.children?.[0];
    expect(pre?.tag).toBe('pre');
    expect(pre?.children?.[0]).toBe('[※二人称],*の子/彼女');
  });
});
