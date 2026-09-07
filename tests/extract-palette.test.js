/**
 * tools/extract-palette.mjs のテスト
 *
 * @description
 *   キャラクター画像からの配色候補抽出ツールを検証する。
 *
 *   - `decodePng()`: Node 標準 zlib のみで実装した PNG デコーダ。実際のリポジトリ内の
 *     画像アセットを読み、寸法・ピクセル数・アルファ範囲が妥当であることを確認する。
 *   - `rgbToHsv()` / `toHex()`: 色空間変換の既知値。
 *   - `medianCut()`: 色量子化が占有ピクセル数の降順で代表色を返すこと。
 *   - `collectColorHints()`: `AppearanceDetail` の `#DesignAttr_Color` /
 *     `#DesignAttr_Overview` から色語を拾えること。
 *   - `resolveImageSources()`: 画像ソースの優先順（arts → corefolder → concept）。
 *   - `scanTopLevelRecords()` / `findValueEnd()`: 書式非破壊の追記に使うテキスト走査。
 *
 * @see _work_in_progress/2026-07-13_progress_colorpalette-schema.md
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    decodePng,
    rgbToHsv,
    toHex,
    medianCut,
    collectColorHints,
    resolveImageSources,
    scanTopLevelRecords,
    findValueEnd,
} from '../tools/extract-palette.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_PNG = path.join(
    REPO_ROOT, 'data', 'Works_NumberTales', 'Images', 'DB_Primary',
    'corefolder', '1', 'emstk_corefolderNTS-1-1.png',
);

describe('decodePng — 自前 PNG デコーダ（依存追加ゼロ）', () => {
    it('リポジトリ内の実 PNG をデコードでき、RGBA バッファの長さが width*height*4 になる', () => {
        const img = decodePng(fs.readFileSync(SAMPLE_PNG));
        expect(img.width).toBeGreaterThan(0);
        expect(img.height).toBeGreaterThan(0);
        expect(img.data.length).toBe(img.width * img.height * 4);
    });

    it('デコード結果に有効な RGBA 値（0-255）が入る', () => {
        const img = decodePng(fs.readFileSync(SAMPLE_PNG));
        for (let i = 0; i < Math.min(img.data.length, 4000); i++) {
            expect(img.data[i]).toBeGreaterThanOrEqual(0);
            expect(img.data[i]).toBeLessThanOrEqual(255);
        }
    });

    it('PNG 署名が不正なら例外を投げる', () => {
        expect(() => decodePng(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/署名/);
    });
});

describe('rgbToHsv / toHex — 色空間変換', () => {
    it('原色の HSV を正しく求める', () => {
        expect(rgbToHsv(255, 0, 0)).toMatchObject({ h: 0, s: 1, v: 1 });        // 赤
        expect(rgbToHsv(0, 255, 0).h).toBe(120);                                 // 緑
        expect(rgbToHsv(0, 0, 255).h).toBe(240);                                 // 青
    });

    it('無彩色は彩度 0 になる', () => {
        expect(rgbToHsv(255, 255, 255).s).toBe(0);
        expect(rgbToHsv(128, 128, 128).s).toBe(0);
        expect(rgbToHsv(0, 0, 0)).toMatchObject({ s: 0, v: 0 });
    });

    it('#Hexcode_Color 型に適合する #RRGGBB 形式（大文字）を返す', () => {
        expect(toHex(232, 84, 58)).toBe('#E8543A');
        expect(toHex(0, 0, 0)).toBe('#000000');
        expect(toHex(255, 255, 255)).toBe('#FFFFFF');
    });

    it('範囲外の値をクランプする', () => {
        expect(toHex(300, -20, 128)).toBe('#FF0080');
    });
});

describe('medianCut — 色量子化', () => {
    /** 赤 5px / 青 2px の入力 */
    const redAndBlue = [
        [255, 0, 0], [250, 5, 5], [245, 10, 0], [255, 2, 8], [248, 0, 4],
        [0, 0, 255], [5, 5, 250],
    ];

    it('占有ピクセル数の降順で返し、全ピクセルをいずれかのクラスタへ振り分ける', () => {
        const clusters = medianCut(redAndBlue, 2);
        expect(clusters).toHaveLength(2);
        expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[1].count);
        // median-cut は「色空間の中央値」ではなく「ピクセル数の中央」で分割するため、
        // 2 分割では少数派（青 2px）が多数派のバケットへ混ざりうる。
        // 保証されるのは総数の保存と降順であって、色ごとの完全分離ではない。
        expect(clusters.reduce((s, c) => s + c.count, 0)).toBe(redAndBlue.length);
    });

    it('支配的な色が最上位クラスタになる（赤 5px > 青 2px）', () => {
        // 分割数を増やしすぎると支配色の側が複数クラスタへ割れて少数派とタイになるため、
        // 「主要色を数点取る」という本ツールの用途どおりの色数で検証する。
        const clusters = medianCut(redAndBlue, 3);
        expect(clusters[0].count).toBe(4);
        expect(clusters[0].r).toBeGreaterThan(200); // 赤が最大クラスタ
        expect(clusters[0].b).toBeLessThan(100);
    });

    it('空入力では空配列を返す', () => {
        expect(medianCut([], 4)).toEqual([]);
    });

    it('要求色数より入力の色種が少なくても破綻しない', () => {
        const clusters = medianCut([[10, 10, 10], [10, 10, 10]], 8);
        expect(clusters.length).toBeGreaterThan(0);
        expect(clusters.reduce((s, c) => s + c.count, 0)).toBe(2);
    });
});

describe('collectColorHints — AppearanceDetail からの色語収集', () => {
    const record = {
        Num: 1,
        AppearanceDetail: [
            {
                BodyPart: ['#BodyPart_Hair'],
                DesignElement: '#Element_Motif',
                Attrs: [
                    { AttrLabel: '#DesignAttr_Overview', value_JP: '赤橙色の髪', value_EN: 'red orange hair' },
                ],
            },
            {
                BodyPart: ['#BodyPart_Chest'],
                DesignElement: '#Element_NumberMark',
                Attrs: [
                    { AttrLabel: '#DesignAttr_Color', value_JP: '赤', value_EN: 'red' },
                    { AttrLabel: '#DesignAttr_Notation', value_JP: 'アラビア数字の「1」', value_EN: "Arabic numeral '1'" },
                ],
            },
        ],
    };

    it('#DesignAttr_Overview の色語を部位付きで拾う', () => {
        const hints = collectColorHints(record);
        const hair = hints.filter(h => h.bodyPart === '#BodyPart_Hair');
        expect(hair.map(h => h.word)).toContain('red orange');
    });

    it('#DesignAttr_Color の色語を部位付きで拾う', () => {
        const hints = collectColorHints(record);
        const chest = hints.filter(h => h.bodyPart === '#BodyPart_Chest');
        expect(chest.map(h => h.word)).toContain('red');
    });

    it('AppearanceDetail が無いレコードでは空配列を返す', () => {
        expect(collectColorHints({ Num: 99 })).toEqual([]);
        expect(collectColorHints(null)).toEqual([]);
    });

    /**
     * 英語の色語は単語境界で判定する。素朴な `includes` だと別語の一部に誤爆し、
     * 無関係な部位を `AppliesTo` へ転記させる（実データで 50 パターン確認）。
     * @see issue #20「AppearanceDetail 充足性レビュー」
     */
    it('別語の一部に含まれる色語では誤爆しない', () => {
        const bogus = {
            AppearanceDetail: [
                {
                    BodyPart: ['#BodyPart_Chest'],
                    Attrs: [
                        // "layered" / "colored" / "inspired" / "assured" に "red" が含まれる
                        { AttrLabel: '#DesignAttr_Overview', value_EN: 'layered multicolored coat inspired by a pattern' },
                        // "tank-top" / "rectangular" に "tan" が含まれる
                        { AttrLabel: '#DesignAttr_Overview', value_EN: 'rectangular tank-top' },
                    ],
                },
            ],
        };
        const words = collectColorHints(bogus).map(h => h.word);
        expect(words).not.toContain('red');
        expect(words).not.toContain('brown');
    });

    it('正当な派生形（reddish / golden / yellowish / grayish）は拾う', () => {
        const derived = (en) => collectColorHints({
            AppearanceDetail: [{ BodyPart: ['#BodyPart_Hair'], Attrs: [{ AttrLabel: '#DesignAttr_Overview', value_EN: en }] }],
        }).map(h => h.word);

        expect(derived('reddish brown hair')).toContain('red');
        expect(derived('pale golden hair')).toContain('yellow');
        expect(derived('yellowish orange hair')).toContain('yellow');
        expect(derived('dark grayish blue eyes')).toContain('gray');
    });

    it('issue #20 で挙がった色語（amber / blonde / burgundy）を拾う', () => {
        const words = (en) => collectColorHints({
            AppearanceDetail: [{ BodyPart: ['#BodyPart_Eye'], Attrs: [{ AttrLabel: '#DesignAttr_Overview', value_EN: en }] }],
        }).map(h => h.word);

        // amber は橙と黄の境目にあるため両方の語彙へ入れ、実際の HEX 側で振り分ける
        expect(words('amber eyes')).toEqual(expect.arrayContaining(['orange', 'yellow']));
        expect(words('blonde ponytail')).toContain('yellow');
        expect(words('burgundy vest dress')).toContain('red');
    });

    it('複数部位のエントリは全部位ぶんのヒントを出す（先頭だけにしない）', () => {
        const multi = {
            AppearanceDetail: [{
                BodyPart: ['#BodyPart_Chest', '#BodyPart_Leg', '#BodyPart_Waist'],
                Attrs: [{ AttrLabel: '#DesignAttr_Overview', value_EN: 'green casual outfit' }],
            }],
        };
        const parts = collectColorHints(multi).filter(h => h.word === 'green').map(h => h.bodyPart);
        expect(parts).toEqual(['#BodyPart_Chest', '#BodyPart_Leg', '#BodyPart_Waist']);
    });
});

describe('resolveImageSources — 画像ソースの優先順（$palette.source 駆動）', () => {
    const NTS_WORK_DIR = path.join(REPO_ROOT, 'data', 'Works_NumberTales');
    const NTS_IMAGES = path.join(NTS_WORK_DIR, 'Images', 'DB_Primary');

    it('存在しないファイルは返さない', () => {
        const sources = resolveImageSources(
            { Images: { arts_PNGPath: ['does/not/exist'], concept_PNGName: 'nope' } },
            NTS_WORK_DIR, NTS_IMAGES,
        );
        expect(sources).toEqual([]);
    });

    it('illustration → artwork → swatch の順に返す', () => {
        const sources = resolveImageSources(
            {
                Images: {
                    concept_PNGName: 'cnsp_imgNTS-1',
                    corefolder_PNGPath: ['1/emstk_corefolderNTS-1-1'],
                    arts_PNGPath: ['humanoids/2023/art_imgNTS-1-humanoid'],
                },
            },
            NTS_WORK_DIR, NTS_IMAGES,
        );
        expect(sources.map(s => s.role)).toEqual(['arts', 'corefolder', 'concept']);
        expect(sources.map(s => s.source)).toEqual(['illustration', 'artwork', 'swatch']);
    });

    /**
     * フィールド名は作品ごとに違う（`corefolder_PNGPath` / `keycapper_PNGPath` /
     * `weakening_PNGPath`）。宣言だけで解決できることを、実データの別作品で確かめる。
     */
    it('作品ごとに違うフィールド名でも宣言だけで解決する（ハンカクライブ）', () => {
        const ublWorkDir = path.join(REPO_ROOT, 'data', 'Works_UnibyteLive');
        const db = JSON.parse(fs.readFileSync(path.join(ublWorkDir, 'DataBases', 'db_Primary.json'), 'utf8'));
        const record = db.find(r => (r.Images?.keycapper_PNGPath ?? []).length);
        expect(record).toBeTruthy();

        const sources = resolveImageSources(record, ublWorkDir, path.join(ublWorkDir, 'Images', 'DB_Primary'));
        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0].source).toBe('artwork'); // keycapper。illustration の宣言は無い
    });
});

describe('scanTopLevelRecords / findValueEnd — テキスト走査（書式非破壊の追記に使う）', () => {
    it('トップレベル配列の各レコード範囲を返す', () => {
        const text = '[\n  { "Num": 1 },\n  { "Num": 2 }\n]\n';
        const spans = scanTopLevelRecords(text);
        expect(spans).toHaveLength(2);
        expect(JSON.parse(text.slice(...spans[0]))).toEqual({ Num: 1 });
        expect(JSON.parse(text.slice(...spans[1]))).toEqual({ Num: 2 });
    });

    it('文字列中の括弧に惑わされない', () => {
        const text = '[\n  { "Name": "a{b}[c]", "Num": 1 }\n]\n';
        const spans = scanTopLevelRecords(text);
        expect(spans).toHaveLength(1);
        expect(JSON.parse(text.slice(...spans[0])).Name).toBe('a{b}[c]');
    });

    it('エスケープされた引用符を含む文字列を正しく飛ばす', () => {
        const text = '[\n  { "Name": "say \\"hi\\"", "Num": 1 }\n]\n';
        const spans = scanTopLevelRecords(text);
        expect(spans).toHaveLength(1);
        expect(JSON.parse(text.slice(...spans[0])).Num).toBe(1);
    });

    it('配列・オブジェクト・文字列・スカラーそれぞれの値の終端を求められる', () => {
        const cases = [
            ['{"k": [1, [2], 3], "next": 1}', '[1, [2], 3]'],
            ['{"k": {"a": {"b": 1}}, "next": 1}', '{"a": {"b": 1}}'],
            ['{"k": "va]lue", "next": 1}', '"va]lue"'],
            ['{"k": 42, "next": 1}', '42'],
            ['{"k": null, "next": 1}', 'null'],
        ];
        for (const [text, expected] of cases) {
            const colon = text.indexOf(':');
            const end = findValueEnd(text, colon);
            expect(text.slice(colon + 2, end)).toBe(expected);
        }
    });
});
