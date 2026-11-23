/** 着脱タグは宣言済みの日英ラベルを使い、true のときだけ表示する。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../lib/section-renders/appearanceDetail.js', import.meta.url), 'utf8');
const vars = JSON.parse(readFileSync(new URL('../data/db_meta.json', import.meta.url), 'utf8')).General.$VarsDef;

describe('AppearanceDetail の着脱タグ', () => {
  it.each(['jp', 'en'])('%s の schema ラベルを true の項目だけに表示する', lang => {
    const { document } = new JSDOM('').window;
    let renderer;
    runInNewContext(source, { globalThis: { CharacterSectionRendererRegistry: { registerSectionRenderer: (_, value) => { renderer = value; } } } });
    const item = { key: 'AppearanceDetail', type: '$Def_AppearanceDetail[]', label: '外見', value: [true, false, null, undefined].map(Detachable => ({ Detachable, Attrs: [{ AttrLabel: '#DesignAttr_Overview', value_JP: '外見', value_EN: 'Appearance' }] })) };
    const declaration = structuredClone(vars);
    const field = declaration.$Def_AppearanceDetail.$DefType.find(field => field.hashTag === 'Detachable');
    field.hashTag_JP = 'テスト用の着脱ラベル';
    field.hashTag_EN = 'Custom detachable label';
    const node = renderer.render(item, {
      globalDefType: { General: { $VarsDef: declaration } },
      helpers: {
        el: (tag, attributes, children) => {
          const element = document.createElement(tag);
          for (const [key, value] of Object.entries(attributes ?? {})) element.setAttribute(key, value);
          for (const child of children ?? []) element.append(child);
          return element;
        },
        isPlainObject: value => value && typeof value === 'object' && !Array.isArray(value),
        wrapStandaloneSection: (_, nodes) => { const element = document.createElement('section'); element.append(...nodes); return element; },
        getCurrentPageLanguage: () => lang,
      },
    });
    const headers = [...node.querySelectorAll('.appearance-detail__entry')].map(entry => entry.querySelector('.appearance-detail__entry-header')?.textContent ?? '');
    expect(headers).toEqual([lang === 'en' ? field.hashTag_EN : field.hashTag_JP, '', '', '']);
  });
});
