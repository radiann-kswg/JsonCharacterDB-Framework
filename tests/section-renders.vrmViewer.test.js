/**
 * lib/section-renders/vrmViewer.js の最小回帰テスト
 *
 * three.js / @pixiv/three-vrm はビューア起動ボタン押下時にのみ動的 import されるため、
 * このテストではボタンを押さない（= import() を発火させない）範囲でのみ検証する。
 * つまりテストが three.js 無しで完走すること自体が「クリックまで無関係にロードしない」
 * 設計の裏付けになる。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

beforeAll(async () => {
  const ts = Date.now();
  const wrapperUrl = `${pathToFileURL(join(repoRoot, 'lib/section-wrapper-common.js')).href}?vrm-viewer-test=${ts}`;
  await import(wrapperUrl);
  const vrmViewerUrl = `${pathToFileURL(join(repoRoot, 'lib/section-renders/vrmViewer.js')).href}?vrm-viewer-test=${ts}`;
  await import(vrmViewerUrl);
});

/** テスト用の最小 DOM-likeモック el() ヘルパー（real DOM を必要としない） */
function el(tag, props = {}, children = []) {
  return { tag, props, children: Array.isArray(children) ? children : [children] };
}

describe('vrmViewerSection', () => {
  it('registers itself into CharacterSectionRendererRegistry', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    const names = registry.getRegisteredSectionRenderers().map((r) => r.name);
    expect(names).toContain('vrmViewerSection');
  });

  it('resolves by $display.sectionWrapper declaration', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    expect(registry.resolveSectionRendererName({
      display: { sectionWrapper: 'vrmViewerSection' }
    })).toBe('vrmViewerSection');
  });

  it('returns null when corefolder_VRMPath is empty', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    const result = registry.renderWithRegisteredSectionRenderer(
      { key: 'VRMs', value: { corefolder_VRMPath: [] }, display: { sectionWrapper: 'vrmViewerSection' } },
      { helpers: { el, buildVrmAssetUrl: () => '/mock.vrm', wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children }) } }
    );
    expect(result).toBeNull();
  });

  it('builds a poster + launch button card without importing three.js', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    // folderHint（フィールド名 `corefolder_VRMPath` の接頭辞由来）がURL構築へ正しく渡ることも検証する
    const buildVrmAssetUrl = (relPath, ext, folderHint) => `/mock/${folderHint}/${relPath}${ext}`;

    const result = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'VRMs',
        value: { corefolder_VRMPath: ['16/vrm_corefolder16'] },
        display: { sectionWrapper: 'vrmViewerSection' }
      },
      {
        isStandaloneSubField: true,
        helpers: {
          el,
          buildVrmAssetUrl,
          getCurrentPageLanguage: () => 'jp',
          isPlainObject: (v) => v != null && typeof v === 'object' && !Array.isArray(v),
          wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children })
        }
      }
    );

    expect(result?.wrapped).toBe('VRMs');
    const listEl = result?.children?.[0];
    expect(listEl?.props?.class).toBe('model-viewer-list');
    const card = listEl?.children?.[0];
    expect(card?.props?.class).toBe('model-viewer');

    // 2カラム構造: ポスター画像（__media）の右隣に起動ボタン/ステージ（__body）が並ぶ
    const media = card?.children?.find((c) => c?.props?.class === 'model-viewer__media');
    const poster = media?.children?.find((c) => c?.props?.class === 'model-viewer__poster');
    expect(poster?.props?.src).toBe('/mock/corefolder/16/vrm_corefolder16.png');

    const body = card?.children?.find((c) => c?.props?.class === 'model-viewer__body');
    const launchBtn = body?.children?.find((c) => c?.props?.class === 'model-viewer__launch-btn');
    expect(launchBtn?.children?.[0]).toBe('3Dビューアを起動');
    expect(typeof launchBtn?.props?.onclick).toBe('function');
  });
});
