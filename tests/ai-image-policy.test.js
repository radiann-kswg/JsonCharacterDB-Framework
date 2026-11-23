import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { globSync } from 'glob';
import { validateImageOptouts, isImageOptedOut, canonicalAIImagePath, createImagePermissionIndex, filterAIImageReferences, filterCostumeOptouts } from '../pkg/ai-image-policy.mjs';

const fields = [
  { hashTag: 'concept_PNGName' },
  { hashTag: 'designAlt_PNGPath', AI_Optout: true },
  { hashTag: 'corefolder_PNGPath', AI_Optout: false },
];
const record = {
  Images: { concept_PNGName: 'sheet', designAlt_PNGPath: ['idol'], corefolder_PNGPath: ['61/a', '61/b'] },
  Images_AIOptout: { corefolder_PNGPath: ['61/b'] },
};

describe('画像単位の AI オプトアウト', () => {
  it('typedef と個別ファイルを合成し、false で除外を解除しない', () => {
    const source = structuredClone(record);
    validateImageOptouts(source, fields);
    expect(isImageOptedOut(source, fields, 'concept_PNGName', 'sheet')).toBe(false);
    expect(isImageOptedOut(source, fields, 'designAlt_PNGPath', 'idol')).toBe(true);
    expect(isImageOptedOut(source, fields, 'corefolder_PNGPath', '61/a')).toBe(false);
    expect(isImageOptedOut(source, fields, 'corefolder_PNGPath', '61/b')).toBe(true);
    expect(isImageOptedOut({ ...source, AI_Optout: true }, fields, 'concept_PNGName', 'sheet')).toBe(true);
    expect(isImageOptedOut({ ...source, AI_Optout: false }, fields, 'designAlt_PNGPath', 'idol')).toBe(true);
    expect(isImageOptedOut(source, fields, 'unknown', 'sheet')).toBe(true);
    expect(source).toEqual(record);
  });

  it.each([
    { bad: { typo: ['sheet'] } },
    { bad: { concept_PNGName: ['Sheet'] } },
    { bad: { concept_PNGName: ['sheet.png'] } },
    { bad: { concept_PNGName: 'sheet' } },
    { bad: { concept_PNGName: [] } },
    { bad: { concept_PNGName: [null] } },
    { bad: [] },
    { bad: true },
  ])('書き間違い・型不正を拒否する: $bad', ({ bad }) => {
    expect(() => validateImageOptouts({ ...record, Images_AIOptout: bad }, fields)).toThrow();
  });

  it('boolean 以外の権利フラグを拒否する', () => {
    expect(() => validateImageOptouts({ ...record, AI_Optout: 'false' }, fields)).toThrow();
    expect(() => validateImageOptouts(record, [{ hashTag: 'x', AI_Optout: null }])).toThrow();
  });

  it('上位の不許可・連名画像の除外を読み取り順にかかわらず優先する', () => {
    for (const decisions of [[true, false], [false, true]]) {
      const index = createImagePermissionIndex();
      for (const allowed of decisions) index.add('data/Works_Test/Images/DB_Primary/arts/shared.png', allowed);
      expect(index.has('https://database.numbertales-radiann.net/data/Works_Test/Images/DB_Primary/arts/shared.png')).toBe(false);
      expect(index.paths()).toEqual([]);
      expect(index.has('data/Works_Test/Images/orphan.png')).toBe(false);
    }
  });

  it('既知の配信URLだけを正規化し、不明URLや親参照を拒否する', () => {
    expect(canonicalAIImagePath('https://radiann-kswg.github.io/100BeautiesLab_CreationsDB/data/a.png')).toBe('data/a.png');
    for (const value of ['https://example.com/data/a.png', 'data/../a.png', 'data/%2e%2e/a.png', 'data/a\\b.png', '%XX', null]) {
      expect(canonicalAIImagePath(value)).toBeNull();
    }
  });

  it('AIHints の入れ子・配列から除外参照だけを取り去り、本文とnullを保持する', () => {
    const source = { prompt: 'keep', forms: [{ reference_images: { main: null, gallery: ['yes', 'no'] }, other: 'keep' }] };
    expect(filterAIImageReferences(source, value => value === 'yes')).toEqual({
      prompt: 'keep', forms: [{ reference_images: { main: null, gallery: ['yes'] }, other: 'keep' }],
    });
    expect(source.forms[0].reference_images.gallery).toEqual(['yes', 'no']);
  });

  it('衣装辞書の拒否は外見・自由文・構造化AIHintsに適用し、元データを変えない', () => {
    const source = { AppearanceDetail: [{ Costume: 'stage', Attrs: [{ value_EN: 'special red vest' }] }, { Costume: 'usual' }],
      AIHints: { common: ['base design', 'special red vest (stage outfit)'], prompt: 'A character in stage costume',
        forms: [{ Costume: 'stage', detail: 'blocked' }, { Costume: 'usual', detail: 'keep' }] } };
    const filtered = filterCostumeOptouts(source, [{ Costume: 'stage', Costume_EN: 'Stage Costume', AI_Optout: true }]);
    expect(filtered.AppearanceDetail).toEqual([{ Costume: 'usual' }]);
    expect(filtered.AIHints).toEqual({ common: ['base design'], prompt: null, forms: [{ Costume: 'usual', detail: 'keep' }] });
    expect(source.AppearanceDetail).toHaveLength(2);
    expect(() => filterCostumeOptouts(source, [{ Costume: 'stage', AI_Optout: 'false' }])).toThrow();
  });

  it('61のアイドル4項目と分数D-Vines4人の指定を維持する', () => {
    const primary = JSON.parse(fs.readFileSync('data/Works_NumberTales/DataBases/db_Primary.json', 'utf8'));
    const costumes = JSON.parse(fs.readFileSync('data/Works_NumberTales/Dictionaries/dict_Costume.json', 'utf8'));
    const source = primary.find(record => record.Num === 61);
    const filtered = filterCostumeOptouts(source, costumes);
    expect(source.AppearanceDetail.filter(entry => entry.Costume === 'idol')).toHaveLength(4);
    expect(filtered.AppearanceDetail.some(entry => entry.Costume === 'idol')).toBe(false);
    const semi = JSON.parse(fs.readFileSync('data/Works_NumberTales/DataBases/db_SemiPrimary.json', 'utf8'));
    for (const id of ['3/3', '7/7', '8/8', '22/22']) expect(semi.find(record => String(record.Num) === id).AI_Optout).toBe(true);
    for (const id of ['266', '314']) expect(semi.find(record => String(record.Num) === id).AI_Optout).not.toBe(true);
  });

  it('すべての作品 DB の宣言と指定値が一致する', () => {
    const global = JSON.parse(fs.readFileSync('data/db_type.json', 'utf8'));
    for (const file of globSync('data/Works_*/DataBases/db_*.json')) {
      if (/db_(meta|type|temp)\.json$/.test(file)) continue;
      const work = JSON.parse(fs.readFileSync(file.replace(/db_[^/\\]+\.json$/, 'db_type.json'), 'utf8'));
      const definitions = [...(global.$DefType ?? []), ...(work.$DefType ?? [])]
        .filter(def => def.hashTag === 'Images').flatMap(def => Array.isArray(def.$type) ? def.$type : []);
      const records = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const source of records) {
        expect(() => validateImageOptouts(source, definitions), file).not.toThrow();
      }
    }
  });
});
