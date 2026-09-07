/**
 * section-wrapper-common.js の最小レジストリ回帰テスト
 *
 * subFields standalone section renderer の built-in registry が登録され、
 * `sectionWrapper` 宣言から適切な helper へディスパッチできることを確認する。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

beforeAll(async () => {
  const ts = Date.now();
  const moduleUrl = `${pathToFileURL(join(repoRoot, 'lib/section-wrapper-common.js')).href}?section-wrapper-common-test=${ts}`;
  await import(moduleUrl);
  // relation.js が relationSection を上書き登録する（section-wrapper-common の後に必ず import）
  const relationUrl = `${pathToFileURL(join(repoRoot, 'lib/section-renders/relation.js')).href}?section-wrapper-common-test=${ts}`;
  await import(relationUrl);
});

describe('section-wrapper-common registry', () => {
  it('registers built-in section renderers', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;
    expect(registry).toBeTruthy();
    expect(typeof registry.renderNamedSectionRenderer).toBe('function');

    const rendererNames = registry.getRegisteredSectionRenderers().map((renderer) => renderer.name).sort();
    // statsSection / thisMastersSection は lib/section-renders/ に移動し characters.js import 時に登録される
    expect(rendererNames).toEqual(['relationSection', 'structuredObjectSection']);
  });

  it('resolves section renderer names from display metadata', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    expect(registry.resolveSectionRendererName({
      display: { sectionWrapper: 'relationSection' }
    })).toBe('relationSection');
  });

  it('renders built-in relation sections from relationApi helpers', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    const createElement = (tag, props = {}, children = []) => ({
      tag,
      props,
      children: Array.isArray(children) ? children : [children]
    });

    const result = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'Relation',
        label: '関係キャラクター',
        value: {
          Related: [
            { Num: 1, Comments: 'テストコメント', RelationLabel: ['trusted'] }
          ]
        },
        display: { sectionWrapper: 'relationSection' }
      },
      {
        isStandaloneSubField: true,
        fieldLabelMap: {},
        workMeta: {},
        globalDefType: {},
        fieldDisplayMap: {},
        fieldTypeMap: {},
        helpers: {
          wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children }),
          relationApi: {
            createElement,
            createDetailTagGrid: (nodes) => ({ tag: 'grid', nodes }),
            formatValueForDisplay: (value) => value,
            dialogueBodyText: (text) => ({ tag: 'dialogue', text }),
            getFieldLabel: (_key, _labelMap, _workMeta, _globalDefType, fallback) => fallback,
            resolveVarsDefLabelPack: (_defName, raw) => ({ hashTag_JP: raw === 'trusted' ? '信頼' : '', hashTag_EN: raw === 'trusted' ? 'Trusted' : '' }),
            formatBilingualLabel: (pack, raw) => (pack?.hashTag_JP ? `${pack.hashTag_JP} / ${pack.hashTag_EN}` : raw),
            getWorkIndexField: () => ({ hashTag: 'Num' }),
            getIndexSubDefs: () => [],
            pickPrimaryIndexSubDef: () => null,
            recordMatchesIndexQuery: (record, _indexDef, idxValue) => String(record?.Num) === idxValue,
            buildViewerNavigationHref: (_workId, dbName, params) => `/?db=${dbName}&idx=${params.idx}&idxKey=${params.idxKey}&num=${params.num}`,
            openDetail: async () => {},
            openViewerNavigation: async () => {},
            getCharState: () => ({
              workId: '#Works_Test',
              db: 'Primary',
              records: [{ Num: 1, Name: 'テストキャラ' }]
            })
          }
        }
      }
    );

    expect(result?.wrapped).toBe('Relation');
    expect(result?.children?.[0]?.tag).toBe('grid');
    expect(result?.children?.[0]?.nodes).toHaveLength(1);
  });

  it('prefers Name_JP in Relation links when pageLang is jp', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    const createElement = (tag, props = {}, children = []) => ({
      tag,
      props,
      children: Array.isArray(children) ? children : [children]
    });

    const result = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'Relation',
        label: '関係キャラクター',
        value: {
          Related: [
            { Num: 1, Comments: 'テストコメント' }
          ]
        },
        display: { sectionWrapper: 'relationSection' }
      },
      {
        isStandaloneSubField: true,
        fieldLabelMap: {},
        workMeta: {},
        globalDefType: {},
        fieldDisplayMap: {},
        fieldTypeMap: {},
        helpers: {
          wrapStandaloneSection: (item, children) => ({ wrapped: item.key, children }),
          relationApi: {
            createElement,
            createDetailTagGrid: (nodes) => ({ tag: 'grid', nodes }),
            formatValueForDisplay: (value) => value,
            dialogueBodyText: (text) => ({ tag: 'dialogue', text }),
            getFieldLabel: (_key, _labelMap, _workMeta, _globalDefType, fallback) => fallback,
            resolveVarsDefLabelPack: () => null,
            formatBilingualLabel: (_pack, raw) => raw,
            getWorkIndexField: () => ({ hashTag: 'Num' }),
            getIndexSubDefs: () => [],
            pickPrimaryIndexSubDef: () => null,
            recordMatchesIndexQuery: (record, _indexDef, idxValue) => String(record?.Num) === idxValue,
            buildViewerNavigationHref: (_workId, dbName, params) => `/?db=${dbName}&idx=${params.idx}&idxKey=${params.idxKey}&num=${params.num}`,
            openDetail: async () => {},
            openViewerNavigation: async () => {},
            getCharState: () => ({
              workId: '#Works_Test',
              db: 'Primary',
              pageLang: 'jp',
              records: [{ Num: 1, Name: 'Legacy English', Name_JP: '日本語名', Name_EN: 'English Name' }]
            })
          }
        }
      }
    );

    const anchor = result?.children?.[0]?.nodes?.[0]?.children?.find((part) => part?.tag === 'a');
    expect(anchor?.children?.[0]).toBe('日本語名');
  });

  it('falls back to the structured object renderer matcher for plain objects', () => {
    const registry = globalThis.CharacterSectionRendererRegistry;

    const structuredResult = registry.renderWithRegisteredSectionRenderer(
      {
        key: 'ConversationPattern',
        value: { TalkingTone: '落ち着いた口調' }
      },
      {
        helpers: {
          renderStructuredObjectSection: (item) => `structured:${item.key}`
        }
      }
    );

    expect(structuredResult).toBe('structured:ConversationPattern');
  });
});
