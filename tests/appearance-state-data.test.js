/** 原画と作者確認に基づく外見の形態・衣装・着脱指定を検証する。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const load = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const scg = load('Works_SinisterChangingGirls/DataBases/db_Primary.json');
const sar = load('Works_ShauErRiders/DataBases/db_Primary.json');
const scgRecord = (drc) => scg.find((record) => record.Drc === drc);
const sarRecord = (beast) => sar.find((record) => record.BeastType?.Beast === beast);
const text = (entry) => entry.Attrs.map((attr) => attr.value_JP || '').join('、');

describe('AppearanceDetail の状態・衣装指定', () => {
  it.each(['SinisterChangingGirls', 'ShauErRiders'])('%s の形態と衣装が作品辞書に解決できる', (work) => {
    const records = work === 'SinisterChangingGirls' ? scg : sar;
    const dictMeta = load(`Works_${work}/Dictionaries/db_meta.json`).Dictionaries;
    for (const key of ['Formation', 'Costume']) {
      expect(dictMeta[`#Dict_${key}`]?.keyField).toBe(key);
      const codes = new Set(load(`Works_${work}/Dictionaries/dict_${key}.json`).map((row) => row[key]));
      for (const record of records) {
        for (const entry of record.AppearanceDetail || []) {
          if (entry[key] != null) expect(codes.has(entry[key]), `${record.Name_JP}: ${key}=${entry[key]}`).toBe(true);
        }
      }
    }
  });

  it('三春の膨体を豹変後に限定し、叶の着用クッションを独立して着脱できる', () => {
    const mikhail = scgRecord('NE').AppearanceDetail;
    const enlarged = mikhail.find((entry) => entry.Note_JP?.includes('膨体した姿'));
    expect(enlarged.Formation).toBe('afterChanged');
    expect(mikhail.filter((entry) => entry !== enlarged).every((entry) => entry.Formation === null)).toBe(true);

    const cushion = scgRecord('SE').AppearanceDetail.find((entry) => text(entry).includes('着用クッション'));
    expect(cushion.Detachable).toBe(true);
    expect(cushion.Formation).toBeNull();
    expect(cushion.Costume ?? null).toBeNull();
  });

  it('ユノの頭部を共有し、人型の服・展開した背面部分と球体を同時に描かない', () => {
    const entries = scgRecord('W').AppearanceDetail;
    const sphere = entries.find((entry) => text(entry).includes('球状の姿'));
    expect(sphere.Formation).toBe('beforeChange');
    const common = entries.filter((entry) => entry.Formation == null);
    expect(common.map((entry) => entry.BodyPart)).toEqual([
      ['#BodyPart_Hair'], ['#BodyPart_Ear'], ['#BodyPart_Eye'],
    ]);
    const humanoid = entries.filter((entry) => entry.Formation === 'afterChanged');
    expect(humanoid).toHaveLength(2);
    expect(humanoid.some((entry) => text(entry).includes('胸元の深く開いた服'))).toBe(true);
    expect(humanoid.some((entry) => text(entry).includes('扇状'))).toBe(true);
  });

  it('小里の衣装差分と開いた左目の豹変後の特徴を別々に選べる', () => {
    const entries = scgRecord('NW').AppearanceDetail;
    const eye = entries.find((entry) => entry.BodyPart?.includes('#BodyPart_Eye'));
    expect(eye.Formation).toBe('afterChanged');
    expect(eye.Costume ?? null).toBeNull();
    expect(text(eye)).toContain('黒い白目');
    expect(text(eye)).toContain('小さな赤い瞳');

    const clothed = entries.filter((entry) => entry.Note_JP?.includes('ジャケット着用時'));
    const jacketless = entries.filter((entry) => entry.Note_JP?.includes('ジャケット非着用時'));
    expect(clothed).toHaveLength(2);
    expect(jacketless).toHaveLength(3);
    expect(clothed.every((entry) => entry.Costume === 'usual' && entry.Formation === null)).toBe(true);
    expect(jacketless.every((entry) => entry.Costume === 'jacketless' && entry.Formation === null)).toBe(true);
  });

  it('カミツの獣化時は頭部を共有し、通常時の腕・帯を引き継がない', () => {
    const entries = sarRecord('Snake').AppearanceDetail;
    const common = entries.filter((entry) => entry.Formation == null);
    expect(common.some((entry) => entry.BodyPart?.includes('#BodyPart_Hair'))).toBe(true);
    expect(common.some((entry) => entry.BodyPart?.includes('#BodyPart_Eye'))).toBe(true);
    const beasted = entries.filter((entry) => entry.Formation === 'beasted');
    expect(beasted.some((entry) => text(entry).includes('四肢のない細長い蛇体'))).toBe(true);
    expect(beasted.some((entry) => text(entry).includes('ヘビ柄ワッペン'))).toBe(true);
    const active = [...common, ...beasted];
    expect(active.some((entry) => entry.BodyPart?.includes('#BodyPart_Arm'))).toBe(false);
    expect(active.some((entry) => text(entry).includes('白い帯'))).toBe(false);
    expect(entries.some((entry) => entry.Formation === 'normal' && entry.BodyPart?.includes('#BodyPart_Arm'))).toBe(true);
  });

  it('ハネゝカの制服を私服へ混ぜず、未描画の履物を私服に補完しない', () => {
    const entries = sarRecord('Rabbit').AppearanceDetail;
    const uniform = entries.filter((entry) => entry.Note_JP?.includes('通常制服'));
    expect(uniform).toHaveLength(5);
    expect(uniform.every((entry) => entry.Costume === 'usual')).toBe(true);
    const casual = entries.filter((entry) => entry.Costume === 'private');
    expect(casual).toHaveLength(3);
    expect(casual.some((entry) => text(entry).includes('フード付き上着'))).toBe(true);
    expect(casual.some((entry) => entry.BodyPart?.includes('#BodyPart_Foot'))).toBe(false);
  });
});

describe('NumberTales の衣装差分と独立した着脱品', () => {
  const primary = load('Works_NumberTales/DataBases/db_Primary.json');
  const nts = num => primary.find(record => record.Num === num).AppearanceDetail;

  it('28の普段の腰巻きとビジネスの羽織りを分け、共有特徴の衣装を限定しない', () => {
    const entries = nts(28);
    const usual = entries.filter(entry => entry.Costume === 'usual');
    const business = entries.filter(entry => entry.Costume === 'onBusiness');
    expect(usual).toHaveLength(1);
    expect(business).toHaveLength(1);
    expect(text(usual[0])).toContain('腰に巻き');
    expect(text(usual[0])).toContain('リボンボウ');
    expect(text(business[0])).toContain('羽織った');
    expect(entries.slice(0, 12).every(entry => entry.Costume == null)).toBe(true);
    expect(load('Works_NumberTales/Dictionaries/dict_Costume.json').some(row => row.Costume === 'onBusiness')).toBe(true);
  });

  it('14・41のブレザーと61の頭フードを、衣装そのものを変えずに外せる', () => {
    expect(nts(14)[8].Detachable).toBe(true);
    expect(nts(41)[6].Detachable).toBe(true);
    expect(nts(14)[8].Costume ?? null).toBeNull();
    expect(nts(41)[6].Costume ?? null).toBeNull();
    for (const index of [0, 9]) {
      expect(nts(61)[index].Detachable).toBe(true);
      expect(nts(61)[index].Costume).toBe('usual');
      expect(nts(61)[index].Note_JP).toContain('肩');
    }
    expect(nts(61)[5].Costume).toBe('idol');
    expect(nts(61)[8].Detachable).toBeUndefined();
  });

  it('66は頭フードを下ろしても肩のマントが残る', () => {
    const entries = nts(66);
    expect(text(entries[5])).toBe('肩に掛けたピンクのマント');
    expect(entries[5].Detachable).toBeUndefined();
    const hood = entries.find(entry => entry.Detachable === true);
    expect(hood.BodyPart).toEqual(['#BodyPart_Head']);
    expect(text(hood)).toContain('頭にかぶった');
    expect(hood.Costume ?? null).toBeNull();
  });

  it.each(['SemiPrimary', 'SelfSecondary'])('%s の777系の装備だけを着脱できる', db => {
    const records = load(`Works_NumberTales/DataBases/db_${db}.json`).filter(record => String(record.Num).startsWith('777'));
    expect(records).toHaveLength(2);
    for (const record of records) {
      const equipment = record.AppearanceDetail.filter(entry => /拡張ボード|アドオン/.test(text(entry)));
      expect(equipment).toHaveLength(String(record.Num).includes('Jackpot') ? 2 : 1);
      expect(equipment.every(entry => entry.Detachable === true && entry.Costume == null)).toBe(true);
      expect(record.AppearanceDetail.filter(entry => !equipment.includes(entry)).every(entry => entry.Detachable !== true)).toBe(true);
    }
  });
});
