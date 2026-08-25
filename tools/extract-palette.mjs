/**
 * extract-palette.mjs - 配色検出のライブラリ（CLI は持たない）
 *
 * @description
 *   `data/Works_<work>/Images/` 配下の PNG から配色を読み取る関数群。入力の種類ごとに
 *   2 系統ある:
 *
 *   - **カラーチップ検出**（`detectSwatchChips`）… 設定画に描き込まれた配色見本の丸を読む。
 *     作者が指定した色そのものなので、取れるならこちらが正。
 *   - **透過イラストからの色分布**（`extractSolidColors`）… コアフォルダ / キーキャッパーのような
 *     背景を透過したキャラクター単体イラストを、べた塗り前提の色ヒストグラムで読む。
 *
 *   スキーマ宣言を読む入口も持つ（`listImageFields` が `db_type.json` の `$palette.source`、
 *   `readCommonColors` が `db_meta.json` の `$EnumDef_CommonColor`）。
 *
 *   **実行可能なツールは `tools/patch-colorpalette.mjs` 側にある。** 本ファイルはそこと
 *   `tests/` から import される純粋なライブラリで、`data/` へは書き込まない。
 *
 * 設計原則（CLAUDE.md 準拠）:
 * - **創作内容の自動生成はしない。** 行うのは (1) 既存画像アセットの機械的計測と、
 *   (2) 既存 `AppearanceDetail` に書かれた色語との照合だけ。
 *   色名・部位名・最終的な HEX の採否は User が決める。
 * - **依存追加ゼロ。** PNG デコードは Node 標準 `zlib` のみで自前実装する
 *   （`sharp` 等のネイティブ依存を持ち込まない）。
 *
 * @author 100BeautiesLab.
 * @version 0.2.0
 * @dependencies node:zlib, node:fs, node:path（すべて標準モジュール）
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ────────────────────────────────────────────────────────────────────────────
// PNG デコーダ（Node 標準 zlib のみ / 依存追加ゼロ）
// ────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {Object} DecodedImage
 * @property {number} width
 * @property {number} height
 * @property {Uint8Array} data  RGBA 8bit × width × height
 */

/**
 * Paeth 予測子（PNG フィルタタイプ 4）。
 * @param {number} a 左
 * @param {number} b 上
 * @param {number} c 左上
 * @returns {number}
 */
function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/**
 * PNG のスキャンライン・フィルタを解除する（in-place ではなく新規バッファを返す）。
 *
 * @param {Buffer} raw          inflate 済みの生データ（各行の先頭にフィルタ種別バイト）
 * @param {number} width
 * @param {number} height
 * @param {number} bytesPerPixel  フィルタ計算に使う「1ピクセルあたりのバイト数」（切り上げ、最小 1）
 * @param {number} bytesPerRow    フィルタバイトを除いた 1 行のバイト数
 * @returns {Buffer} フィルタ解除済みのピクセルデータ（フィルタバイトなし）
 */
function unfilter(raw, width, height, bytesPerPixel, bytesPerRow) {
    const out = Buffer.alloc(height * bytesPerRow);
    let rawPos = 0;
    for (let y = 0; y < height; y++) {
        const filterType = raw[rawPos++];
        const rowStart = y * bytesPerRow;
        const prevStart = (y - 1) * bytesPerRow;
        for (let x = 0; x < bytesPerRow; x++) {
            const rawByte = raw[rawPos++];
            const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
            const up = y > 0 ? out[prevStart + x] : 0;
            const upLeft = (y > 0 && x >= bytesPerPixel) ? out[prevStart + x - bytesPerPixel] : 0;
            let value;
            switch (filterType) {
                case 0: value = rawByte; break;                                   // None
                case 1: value = rawByte + left; break;                            // Sub
                case 2: value = rawByte + up; break;                              // Up
                case 3: value = rawByte + ((left + up) >> 1); break;              // Average
                case 4: value = rawByte + paethPredictor(left, up, upLeft); break; // Paeth
                default: throw new Error(`未知の PNG フィルタ種別: ${filterType}（行 ${y}）`);
            }
            out[rowStart + x] = value & 0xff;
        }
    }
    return out;
}

/**
 * PNG バッファをデコードして RGBA ピクセル配列を返す。
 *
 * 対応: bitDepth 8 / 16（16 は 8bit へ丸め）、colorType 0(gray) / 2(RGB) / 3(palette) / 4(gray+A) / 6(RGBA)。
 * パレット画像は bitDepth 1/2/4/8 に対応。インターレース（Adam7）は非対応。
 *
 * @param {Buffer} buf  PNG ファイルの中身
 * @returns {DecodedImage}
 * @throws {Error} 署名不一致・インターレース・未対応の色形式
 */
export function decodePng(buf) {
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('PNG 署名が一致しません');

    let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    /** @type {Buffer|null} */ let palette = null;
    /** @type {Buffer|null} */ let transparency = null;
    /** @type {Buffer[]} */ const idatParts = [];

    let pos = 8;
    while (pos < buf.length) {
        const length = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const dataStart = pos + 8;
        if (type === 'IHDR') {
            width = buf.readUInt32BE(dataStart);
            height = buf.readUInt32BE(dataStart + 4);
            bitDepth = buf[dataStart + 8];
            colorType = buf[dataStart + 9];
            interlace = buf[dataStart + 12];
        } else if (type === 'PLTE') {
            palette = buf.subarray(dataStart, dataStart + length);
        } else if (type === 'tRNS') {
            transparency = buf.subarray(dataStart, dataStart + length);
        } else if (type === 'IDAT') {
            idatParts.push(buf.subarray(dataStart, dataStart + length));
        } else if (type === 'IEND') {
            break;
        }
        pos = dataStart + length + 4; // + CRC
    }

    if (interlace !== 0) throw new Error('インターレース PNG (Adam7) は非対応です');
    if (!idatParts.length) throw new Error('IDAT チャンクが見つかりません');

    const raw = zlib.inflateSync(Buffer.concat(idatParts));

    // colorType → 1 ピクセルあたりのサンプル数
    const samplesPerPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    if (samplesPerPixel === undefined) throw new Error(`未対応の colorType: ${colorType}`);

    const bitsPerPixel = samplesPerPixel * bitDepth;
    const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
    const pixels = unfilter(raw, width, height, bytesPerPixel, bytesPerRow);

    const out = new Uint8Array(width * height * 4);

    /** bitDepth に応じて y 行 x 列の i 番目のサンプルを 8bit 値として読む */
    const readSample = (y, x, sampleIdx) => {
        if (bitDepth === 8) {
            return pixels[y * bytesPerRow + x * samplesPerPixel + sampleIdx];
        }
        if (bitDepth === 16) {
            // 上位バイトのみ採用（8bit へ丸め）
            return pixels[y * bytesPerRow + (x * samplesPerPixel + sampleIdx) * 2];
        }
        // bitDepth 1 / 2 / 4（パレット・グレースケール）
        const bitIndex = (x * samplesPerPixel + sampleIdx) * bitDepth;
        const byte = pixels[y * bytesPerRow + (bitIndex >> 3)];
        const shift = 8 - bitDepth - (bitIndex & 7);
        return (byte >> shift) & ((1 << bitDepth) - 1);
    };

    /** グレースケール値を 8bit へ正規化 */
    const grayScale = (v) => (bitDepth >= 8 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1)));

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (colorType === 3) {
                if (!palette) throw new Error('パレット画像に PLTE チャンクがありません');
                const idx = readSample(y, x, 0);
                out[o] = palette[idx * 3];
                out[o + 1] = palette[idx * 3 + 1];
                out[o + 2] = palette[idx * 3 + 2];
                out[o + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
            } else if (colorType === 0) {
                const g = grayScale(readSample(y, x, 0));
                out[o] = out[o + 1] = out[o + 2] = g;
                out[o + 3] = 255;
            } else if (colorType === 4) {
                const g = grayScale(readSample(y, x, 0));
                out[o] = out[o + 1] = out[o + 2] = g;
                out[o + 3] = grayScale(readSample(y, x, 1));
            } else if (colorType === 2) {
                out[o] = readSample(y, x, 0);
                out[o + 1] = readSample(y, x, 1);
                out[o + 2] = readSample(y, x, 2);
                out[o + 3] = 255;
            } else { // colorType 6 (RGBA)
                out[o] = readSample(y, x, 0);
                out[o + 1] = readSample(y, x, 1);
                out[o + 2] = readSample(y, x, 2);
                out[o + 3] = readSample(y, x, 3);
            }
        }
    }

    return { width, height, data: out };
}

// ────────────────────────────────────────────────────────────────────────────
// 色空間ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

/**
 * RGB → HSV 変換。
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {{ h: number, s: number, v: number }} h: 0-360, s/v: 0-1
 */
export function rgbToHsv(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === rn) h = ((gn - bn) / d) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

/**
 * RGB → `#RRGGBB` 形式の HEX 文字列（`#Hexcode_Color` 型に適合）。
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function toHex(r, g, b) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
    return `#${h(r)}${h(g)}${h(b)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 前景マスク（背景・線画・紙面の除去）
// ────────────────────────────────────────────────────────────────────────────

/** 設定画のカラーチップ検出のしきい値（実測で詰めた固定値） */
const CHIP_TOL = 12;          // 同色とみなす色差
const CHIP_MIN_PX = 30;       // チップとみなす最小面積
const CHIP_MIN_PX_LOOSE = 8;  // 配色領域を特定したあとの再捜査で使う緩い下限
const CHIP_MERGE_TOL = 6;     // 近すぎるチップを 1 つに畳む色差
const CHIP_ERODE = 2;         // ノイズを削る収縮回数

/** 配色領域の再捜査（rescanPaletteRegion）のしきい値 */
const RESCAN_TOL = 10;
const RESCAN_FILL_MIN = 0.35;   // 外接矩形に対する塗りつぶし率の下限（三日月形チップ対策）
const RESCAN_ASPECT_MIN = 0.35;
const RESCAN_ASPECT_MAX = 3.0;

/** 透過イラストからの色ヒストグラム抽出のしきい値 */
const SOLID_ALPHA_MIN = 250;    // 半透明の縁（アンチエイリアス）は塗りの色ではない
const SOLID_EXCLUDE_TOL = 6;    // 共通造形色とみなす色差
const SOLID_MERGE_TOL = 10;     // 近似色を 1 つに畳む色差（チップ検出より緩い）
const SOLID_TOP = 8;            // 返す色数の上限

/** 被覆率計測のしきい値。分布計測（profileColorBands）より緩いのは、
 *  チップ由来の色を陰影込みで拾うため。 */
const COVERAGE_MAX_DIST = 60;
/** ピクセル走査の間引き幅。全関数で共通。 */
const SAMPLE_STEP = 2;

/** 外周フラッドフィルの伸長しきい値（隣接ピクセルとの色差）。線画で止まる値。 */
const FLOOD_TOLERANCE = 40;
/** 外周から推定した背景色とみなす色差。arts の二層背景を落とすための第 3 段。 */
const BG_TOLERANCE = 38;
/** 線画の黒とみなす明度の上限。 */
const DARK_V = 0.16;
/** 紙・白飛びとみなす彩度の上限と明度の下限。 */
const PALE_S = 0.10;
const PALE_V = 0.90;

/**
 * 前景（キャラクター本体）と思われるピクセルのマスクを構築する。
 *
 * 処理は 4 段:
 *   1. 透過ピクセル（alpha < 128）を背景とする
 *   2. 画像の外周を種として **フラッドフィル** し、隣接ピクセルとの色差が小さい間だけ
 *      伸長して背景連結成分を塗り潰す。線画（急峻な色差）で停止するのでキャラクター
 *      内部へは侵入しない。
 *   3. **外周の色分布から背景色を推定**し、それに近いピクセルを背景とする。
 *      arts 画像は「白い外枠 → グラデーション背景」という二層構造を持つため、
 *      枠と背景の境界でフラッドフィルが停止してしまい 2. だけでは背景が残る。
 *      画像ごとに最適なフラッドフィルのしきい値が異なる問題も、この段で吸収する。
 *   4. 残ったピクセルから、線画の黒（明度が極端に低い）と紙・白飛び（低彩度かつ高明度）を除く
 *
 * しきい値は実測で詰めた固定値。引数で差し替えられるようにしていたが、呼び出し元が
 * 一度も渡さないまま残っていたので定数へ畳んだ（作品ごとに変える必要が出たら戻す）。
 *
 * @param {DecodedImage} img
 * @returns {Uint8Array} 1 = 前景, 0 = 背景（長さ width*height）
 */
export function buildForegroundMask(img) {
    const { width, height, data } = img;
    const n = width * height;
    const mask = new Uint8Array(n).fill(1);

    // 1. 透過を背景に
    for (let i = 0; i < n; i++) {
        if (data[i * 4 + 3] < 128) mask[i] = 0;
    }

    // 2. 外周からのフラッドフィル（色差が FLOOD_TOLERANCE 未満の間だけ伸長）
    const visited = new Uint8Array(n);
    /** @type {number[]} */ const queue = [];
    const pushSeed = (x, y) => {
        const i = y * width + x;
        if (!visited[i]) { visited[i] = 1; queue.push(i); mask[i] = 0; }
    };
    for (let x = 0; x < width; x++) { pushSeed(x, 0); pushSeed(x, height - 1); }
    for (let y = 0; y < height; y++) { pushSeed(0, y); pushSeed(width - 1, y); }

    const colorDist = (i, j) => {
        const dr = data[i * 4] - data[j * 4];
        const dg = data[i * 4 + 1] - data[j * 4 + 1];
        const db = data[i * 4 + 2] - data[j * 4 + 2];
        return Math.sqrt(dr * dr + dg * dg + db * db);
    };

    while (queue.length) {
        const i = queue.pop();
        const x = i % width;
        const y = (i / width) | 0;
        const neighbors = [
            x > 0 ? i - 1 : -1,
            x < width - 1 ? i + 1 : -1,
            y > 0 ? i - width : -1,
            y < height - 1 ? i + width : -1,
        ];
        for (const j of neighbors) {
            if (j < 0 || visited[j]) continue;
            // 透過は無条件で背景扱い、それ以外は色差がしきい値未満のときだけ伸長
            if (data[j * 4 + 3] < 128 || colorDist(i, j) < FLOOD_TOLERANCE) {
                visited[j] = 1;
                mask[j] = 0;
                queue.push(j);
            }
        }
    }

    // 3. 外周の色分布から背景色を推定し、それに近いピクセルを背景とする。
    //    arts の「白枠 → グラデ背景」のように、フラッドフィルが枠と背景の境界で
    //    止まってしまうケースを吸収する（枠も背景も外周に現れるため両方拾える）。
    const borderWidth = Math.max(2, Math.round(Math.min(width, height) * 0.02));
    /** @type {Array<[number,number,number]>} */
    const borderPixels = [];
    for (let y = 0; y < height; y++) {
        const nearTopBottom = y < borderWidth || y >= height - borderWidth;
        for (let x = 0; x < width; x++) {
            if (!nearTopBottom && x >= borderWidth && x < width - borderWidth) continue;
            const i = y * width + x;
            if (data[i * 4 + 3] < 128) continue; // 透過は既に背景
            borderPixels.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
        }
    }
    if (borderPixels.length) {
        const bgColors = medianCut(borderPixels, 4);
        for (let i = 0; i < n; i++) {
            if (!mask[i]) continue;
            for (const bg of bgColors) {
                const dr = data[i * 4] - bg.r;
                const dg = data[i * 4 + 1] - bg.g;
                const db = data[i * 4 + 2] - bg.b;
                if (Math.sqrt(dr * dr + dg * dg + db * db) < BG_TOLERANCE) { mask[i] = 0; break; }
            }
        }
    }

    // 4. 線画の黒 / 紙・白飛びを除去
    for (let i = 0; i < n; i++) {
        if (!mask[i]) continue;
        const { s, v } = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        if (v < DARK_V) mask[i] = 0;              // 線画・影の黒
        else if (s < PALE_S && v > PALE_V) mask[i] = 0; // 紙面・ハイライトの白
    }

    return mask;
}

// ────────────────────────────────────────────────────────────────────────────
// カラーチップ（設定画に描かれた配色見本）の検出
// ────────────────────────────────────────────────────────────────────────────

/**
 * 設定画（concept / catalog）に描き込まれたカラーチップを検出する。
 *
 * ナンバーテールズの設定画には「Color:」ラベルとともに **5〜6 色のカラーチップ**
 * （べた塗りの円）が描かれており、これが作者の指定した配色そのものである。
 * カタログ画像ではさらに `0x00b6d9` のような HEX コードが併記されている。
 * 画像全体からの median-cut 推定より遥かに正確なため、こちらを優先して使う。
 *
 * 検出方針:
 *   1. 背景（ほぼ白）/ 線画（暗色）/ 有色 に分類する。
 *   2. **同色（近似）の平坦領域**を連結成分として抽出する。単純な「有色の連結成分」では、
 *      チップ同士が重なって描かれている場合（例: Num 48）に全部が 1 つの塊に融合して
 *      しまうため、色が変わる境界で成分を切る。
 *   3. 線画に接する成分を捨てる（キャラクター本体は必ず黒で輪郭線が引かれているため、
 *      これだけで本体の塗りを除外できる）。
 *   4. 収縮（erosion）で消える細い成分を捨てる（手描き注釈のストロークを除去）。
 *   5. 残った成分を空間クラスタリングし、「サイズの揃った 2〜8 個が密集している」
 *      クラスタをチップ列として採用する。
 *
 * @param {DecodedImage} img
 *        erode: 細い手描きストロークを落とす収縮回数
 * @returns {Array<{ hex: string, count: number, cx: number, cy: number }>} 検出したチップ（0 個なら空配列）
 */
export function detectSwatchChips(img) {
    const { width: W, height: H, data } = img;
    const n = W * H;
    // 既定 30px（半径 ~3px）。作品によってはカラーチップの丸が小さく描かれており、
    // これを大きくすると小さいチップを取りこぼす（実測: 64px だと Num 68/86/94 が検出 0 になる）。
    // 領域内での救済に使う下限。第2段（パレット領域の再捜査）でのみ効く。
    // 領域を絞ったうえでの下限なので、かなり小さく取ってよい（作品によってはチップの丸が
    // 非常に小さく描かれる。実測: 14 → 8 で検出できるレコードが 92 → 93 件に増える）。
    // 「同じチップが重なり・アンチエイリアスで分割検出されたもの」を統合するための距離。
    // 分割された断片はべた塗りゆえ **色が完全一致** するので、しきい値は小さくてよい。
    // 大きくすると、淡い配色（色空間で互いに近い）で **別々のチップを 1 つに潰してしまう**
    // （実測: 12 だと Num 12/21 の #FEF3D9 が #FFEFE4 と統合されて消える。両者の距離は 11.75）。

    const BG = 0, DARK = 1, COLOR = 2;
    const kind = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (data[i * 4 + 3] < 128) { kind[i] = BG; continue; }
        const { s, v } = rgbToHsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        if (v > 0.94 && s < 0.06) kind[i] = BG;
        else if (v < 0.30) kind[i] = DARK;
        else kind[i] = COLOR;
    }

    const label = new Int32Array(n).fill(-1);
    /** @type {Array<{hex: string, count: number, cx: number, cy: number, rad: number}>} */
    const chips = [];

    for (let i = 0; i < n; i++) {
        if (kind[i] !== COLOR || label[i] >= 0) continue;
        const r0 = data[i * 4], g0 = data[i * 4 + 1], b0 = data[i * 4 + 2];
        const id = chips.length;
        const stack = [i];
        label[i] = id;
        /** @type {number[]} */ const px = [];
        let minX = W, maxX = 0, minY = H, maxY = 0, touchesDark = false;

        while (stack.length) {
            const p = stack.pop();
            px.push(p);
            const x = p % W, y = (p / W) | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            const neighbors = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
            for (const q of neighbors) {
                if (q < 0) continue;
                if (kind[q] === DARK) { touchesDark = true; continue; }
                if (kind[q] !== COLOR || label[q] >= 0) continue;
                const dr = data[q * 4] - r0, dg = data[q * 4 + 1] - g0, db = data[q * 4 + 2] - b0;
                if (Math.sqrt(dr * dr + dg * dg + db * db) > CHIP_TOL) continue; // 色が変わる境界で切る
                label[q] = id;
                stack.push(q);
            }
        }

        if (touchesDark || px.length < CHIP_MIN_PX_LOOSE) continue;

        // 成分を 2 段階に格付けする:
        //   strict … 収縮 `CHIP_ERODE` 回に耐える十分な大きさの塊。パレット領域の特定に使う。
        //   round  … 収縮 1 回に耐え、円形でべた塗り。領域内に限り小さなチップとして救う。
        // カラーチップは大小が不揃いに描かれることがあり（例: Num 75 は大きい黄色が半径 11.8px、
        // 青が 3.7px）、収縮回数だけで足切りすると小さいチップを取りこぼす。一方で収縮を一律に
        // 緩めるとノイズを拾ってクラスタ選定が乱れるため、救済は領域内に限定する。
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const fill = px.length / (bw * bh);
        const aspect = bw / bh;
        const round = fill >= 0.55 && aspect >= 0.55 && aspect <= 1.8;

        let cur = new Set(px);
        let survived = 0;
        for (let k = 0; k < CHIP_ERODE && cur.size; k++) {
            const next = new Set();
            for (const p of cur) {
                const x = p % W, y = (p / W) | 0;
                if (x > 0 && cur.has(p - 1) && x < W - 1 && cur.has(p + 1) &&
                    y > 0 && cur.has(p - W) && y < H - 1 && cur.has(p + W)) next.add(p);
            }
            cur = next;
            if (cur.size) survived = k + 1;
        }

        const strict = survived >= CHIP_ERODE && px.length >= CHIP_MIN_PX;
        const rescuable = survived >= 1 && round;
        if (!strict && !rescuable) continue;

        chips.push({
            hex: toHex(r0, g0, b0),
            count: px.length,
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
            rad: Math.sqrt(px.length / Math.PI),
            strict,
            round,
        });
    }

    // 領域特定に使うのは「大きくて円形」の成分だけに絞る。
    // 手描きメッセージ（例: 二次創作の「thank you for reaction!」）はチップと同じ色で
    // 書かれることが多く、ストロークが strict 判定を通ってしまう。これを混ぜたまま
    // 空間クラスタリングすると、文字の方が数も広がりも大きいためパレット領域を
    // 見失う（実測: Works_NumberTales/Secondary のナンバーテールズ化企画絵 26 件が
    // 全滅）。チップは必ずべた塗りの円なので、円形条件で文字を落とせる。
    const strict = chips.filter(c => c.strict && c.round);
    if (!strict.length) return [];

    // ── 第1段: 確実なチップだけで空間クラスタリングし、パレット領域を特定する。
    //
    // 近接しきい値（半径の何倍まで同じ列とみなすか）は段階的に狭める。既定の 7 倍だと、
    // 手描き文字の「閉じた字画」（"o" / "a" の丸）がチップと同色・同サイズで拾われ、
    // チップ列と 1 つの塊に融合して「9 個以上 = チップ列ではない」と棄却されてしまう
    // （実測: Secondary 263RZ / 467RZ）。緩い方から試し、最初に成立した分割を採る。
    for (const gapFactor of [7, 5, 3.5]) {
        const best = pickSwatchCluster(strict, gapFactor);
        if (best.length) return refineChips(img, best);
    }
    return [];
}

/**
 * チップ候補を空間クラスタリングし、「配色見本らしい」クラスタを 1 つ選ぶ。
 *
 * @param {Array<{cx: number, cy: number, rad: number}>} candidates
 * @param {number} gapFactor  半径の何倍まで離れていても同じクラスタとみなすか
 * @returns {Array<any>} 選ばれたクラスタ（見つからなければ空配列）
 */
function pickSwatchCluster(candidates, gapFactor) {
    const used = new Array(candidates.length).fill(false);
    /** @type {Array<Array<any>>} */
    const clusters = [];
    for (let i = 0; i < candidates.length; i++) {
        if (used[i]) continue;
        const cluster = [candidates[i]];
        used[i] = true;
        let grew = true;
        while (grew) {
            grew = false;
            for (let j = 0; j < candidates.length; j++) {
                if (used[j]) continue;
                const near = cluster.some(c =>
                    Math.hypot(c.cx - candidates[j].cx, c.cy - candidates[j].cy)
                    < Math.max(c.rad, candidates[j].rad) * gapFactor);
                if (near) { cluster.push(candidates[j]); used[j] = true; grew = true; }
            }
        }
        clusters.push(cluster);
    }

    // 「チップらしい」クラスタを選ぶ: 2〜8 個が密集している
    let best = [], bestScore = -1;
    for (const cluster of clusters) {
        const radii = cluster.map(c => c.rad).sort((a, b) => a - b);
        const median = radii[radii.length >> 1];
        const kept = cluster.filter(c => c.rad >= median * 0.25 && c.rad <= median * 4);
        if (kept.length < 2 || kept.length > 8) continue;

        let sum = 0, pairs = 0;
        for (let a = 0; a < kept.length; a++) {
            for (let b = a + 1; b < kept.length; b++) {
                sum += Math.hypot(kept[a].cx - kept[b].cx, kept[a].cy - kept[b].cy);
                pairs++;
            }
        }
        const spread = pairs ? (sum / pairs) / median : 0;
        if (spread > 9) continue;

        const score = kept.length * 10 - spread;
        if (score > bestScore) { bestScore = score; best = kept; }
    }
    return best;
}

/**
 * 特定したパレット領域を再捜査し、同一チップの分割検出を統合して返す。
 *
 * @param {DecodedImage} img
 * @param {Array<any>} best  第1段で選ばれたチップ列
 * @returns {Array<{ hex: string, count: number, cx: number, cy: number }>}
 */
function refineChips(img, best) {
    const { width: W, height: H } = img;

    // ── 第2段: 特定したパレット領域の**中だけ**を、前処理の色分類を外して再捜査する。
    //
    // 第1段の分類（背景 = ほぼ白 / 線画 = 暗色）は画像全体を相手にするための安全策だが、
    // その副作用としてチップ自体も落としてしまう:
    //   - **淡い色のチップ**が「ほぼ白 = 背景」に分類されて消える
    //   - **黒に近いチップ**が「暗色 = 線画」に分類されて消える（例: Num 19）
    // 配色見本は 1 箇所にまとめて描かれるため、いったん領域を特定してしまえば、その中には
    // チップ・白い紙面・（あれば）手描き注釈しか無い。よって領域内では色による足切りをやめ、
    // 「紙面の白」だけを除いて、形（円形・べた塗り）でチップを拾う。
    const radii = best.map(c => c.rad).sort((a, b) => a - b);
    const medianRad = radii[radii.length >> 1];
    const margin = Math.max(medianRad * 5, 28);
    const x0 = Math.max(0, Math.round(Math.min(...best.map(c => c.cx)) - margin));
    const x1 = Math.min(W - 1, Math.round(Math.max(...best.map(c => c.cx)) + margin));
    const y0 = Math.max(0, Math.round(Math.min(...best.map(c => c.cy)) - margin));
    const y1 = Math.min(H - 1, Math.round(Math.max(...best.map(c => c.cy)) + margin));

    const rescanned = rescanPaletteRegion(img, { x0, x1, y0, y1 }, { CHIP_MIN_PX: CHIP_MIN_PX_LOOSE });
    const pool = rescanned.length >= best.length ? rescanned : best;

    // 同一チップが分割検出された場合（重なり・アンチエイリアス）に近似色を統合する
    /** @type {Array<{hex: string, count: number, cx: number, cy: number}>} */
    const merged = [];
    for (const chip of pool.slice().sort((a, b) => b.count - a.count)) {
        const dup = merged.find(m => colorDistance(m.hex, chip.hex) <= CHIP_MERGE_TOL);
        if (dup) dup.count += chip.count;
        else merged.push({ hex: chip.hex, count: chip.count, cx: chip.cx, cy: chip.cy });
    }
    return merged.slice(0, 8);
}

/**
 * 特定済みのパレット領域を、色による足切りをせずに再捜査する。
 *
 * 領域内には「チップ / 紙面の白 / 手描き注釈」しか無い前提で、
 *   - 紙面の白（領域の外周に接する最大の連結成分）だけを除外し、
 *   - 残りから円形でべた塗りの成分をチップとして拾う。
 * これにより、明度・彩度で足切りすると消えてしまう**淡い色**や**黒に近い色**の
 * チップも検出できる。
 *
 * @param {DecodedImage} img
 * @param {{x0: number, x1: number, y0: number, y1: number}} region
 * @param {{ CHIP_TOL?: number, CHIP_MIN_PX?: number }} [opt]
 * @returns {Array<{ hex: string, count: number, cx: number, cy: number, rad: number }>}
 */
export function rescanPaletteRegion(img, region, opt = {}) {
    const { width: W, data } = img;
    const minPx = opt.minPx ?? 14;
    const { x0, x1, y0, y1 } = region;
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    if (rw <= 0 || rh <= 0) return [];

    const idxOf = (x, y) => (y - y0) * rw + (x - x0);
    const label = new Int32Array(rw * rh).fill(-1);
    /** @type {Array<any>} */
    const comps = [];

    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const li = idxOf(x, y);
            if (label[li] >= 0) continue;
            const p0 = (y * W + x) * 4;
            if (data[p0 + 3] < 128) { label[li] = -2; continue; } // 透過
            const r0 = data[p0], g0 = data[p0 + 1], b0 = data[p0 + 2];

            const id = comps.length;
            const stack = [[x, y]];
            label[li] = id;
            let count = 0, minX = x, maxX = x, minY = y, maxY = y, touchesEdge = false;
            // 成分の代表色は起点ピクセルではなく**最頻色**で決める。走査は上から始まるため、
            // 起点はチップ上端のアンチエイリアス縁になりやすく、そのままだと縁の色が
            // チップの色として登録されてしまう（実測: Secondary 263RZ のピンクが
            // 塗り #FFCEED ではなく縁 #FFD7F0 になっていた）。
            /** @type {Map<number, number>} */
            const colorCount = new Map();

            while (stack.length) {
                const [cx, cy] = stack.pop();
                count++;
                const pi = (cy * W + cx) * 4;
                const key = (data[pi] << 16) | (data[pi + 1] << 8) | data[pi + 2];
                colorCount.set(key, (colorCount.get(key) ?? 0) + 1);
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                if (cx === x0 || cx === x1 || cy === y0 || cy === y1) touchesEdge = true;

                const neighbors = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
                for (const [nx, ny] of neighbors) {
                    if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
                    const nli = idxOf(nx, ny);
                    if (label[nli] !== -1) continue;
                    const np = (ny * W + nx) * 4;
                    if (data[np + 3] < 128) { label[nli] = -2; continue; }
                    const dr = data[np] - r0, dg = data[np + 1] - g0, db = data[np + 2] - b0;
                    if (Math.sqrt(dr * dr + dg * dg + db * db) > RESCAN_TOL) continue;
                    label[nli] = id;
                    stack.push([nx, ny]);
                }
            }

            const bw = maxX - minX + 1, bh = maxY - minY + 1;
            let modeKey = (r0 << 16) | (g0 << 8) | b0, modeCount = -1;
            for (const [k, c] of colorCount) {
                if (c > modeCount) { modeCount = c; modeKey = k; }
            }
            const [mr, mg, mb] = [(modeKey >> 16) & 255, (modeKey >> 8) & 255, modeKey & 255];
            comps.push({
                hex: toHex(mr, mg, mb), count, touchesEdge,
                cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
                fill: count / (bw * bh), aspect: bw / bh,
                rad: Math.sqrt(count / Math.PI),
                isWhite: rgbToHsv(mr, mg, mb).v > 0.93 && rgbToHsv(mr, mg, mb).s < 0.05,
            });
        }
    }

    // 紙面の白を除外する。純白（#FFFFFF ごく近傍）だけを落とし、**淡い色のチップは残す**
    // （カタログの中間色には `0xf4fae8` のようなほぼ白の色が実在するため、
    //  「明るい＝背景」で足切りすると正規のチップまで消えてしまう）。
    const isPaperWhite = (hex) => colorDistance(hex, '#FFFFFF') < 10;

    // 形状条件は緩めに取る。チップが密に重なって描かれていると、隠れていない部分が
    // 三日月形になり、厳しい円形条件では弾かれてしまう（例: Num 40）。
    // パレット領域はすでに特定済みで、中にはチップと紙面しか無いため、
    // ここで条件を緩めても手描き注釈などを拾う危険は小さい。

    return comps
        .filter(c => !isPaperWhite(c.hex))
        .filter(c => c.count >= minPx)
        .filter(c => c.fill >= RESCAN_FILL_MIN && c.aspect >= RESCAN_ASPECT_MIN && c.aspect <= RESCAN_ASPECT_MAX)
        .sort((a, b) => b.count - a.count);
}

/**
 * `#RRGGBB` を [r, g, b] へ変換する。
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
    const m = /^#?([0-9A-Fa-f]{6})/.exec(hex);
    if (!m) return [0, 0, 0];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * 2 色の RGB 距離（ユークリッド）。近似色の統合・除外・照合すべての判定で使う。
 *
 * ピクセル走査ループの内側では、この関数を呼ばず式を展開したままにしている
 * （数十万画素を回すため）。ここは HEX 同士を比べる用途に限る。
 *
 * @param {string} a #RRGGBB
 * @param {string} b #RRGGBB
 * @returns {number}
 */
export function colorDistance(a, b) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * パレット各色が、キャラクター画像の前景をどれだけ占めているかを実測する。
 *
 * カラーチップは「どの色が使われているか」は教えてくれるが「どれが主色か」は教えて
 * くれない。そこで実際の作画を測り、被覆率の高い順に主従を決める。
 * 画像全体からの median-cut 推定と違い、**色そのものは作者指定のチップ値をそのまま使う**。
 *
 * @param {DecodedImage} img       キャラクター画像（arts / corefolder）
 * @param {string[]} paletteHexes  チップから得た配色
 * @param {{ maxDist?: number, sampleStep?: number }} [opt]
 *        maxDist: この距離より遠い画素はどの色にも数えない
 * @returns {number[]} paletteHexes と同じ並びの被覆率（合計は 1 以下）
 */
export function measurePaletteCoverage(img, paletteHexes) {
    const mask = buildForegroundMask(img);
    const rgbs = paletteHexes.map(hexToRgb);
    const counts = new Array(paletteHexes.length).fill(0);
    let total = 0;

    for (let y = 0; y < img.height; y += SAMPLE_STEP) {
        for (let x = 0; x < img.width; x += SAMPLE_STEP) {
            const i = y * img.width + x;
            if (!mask[i]) continue;
            total++;
            const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
            let bestIdx = -1, bestDist = Infinity;
            for (let k = 0; k < rgbs.length; k++) {
                const d = Math.sqrt((r - rgbs[k][0]) ** 2 + (g - rgbs[k][1]) ** 2 + (b - rgbs[k][2]) ** 2);
                if (d < bestDist) { bestDist = d; bestIdx = k; }
            }
            if (bestIdx >= 0 && bestDist <= COVERAGE_MAX_DIST) counts[bestIdx]++;
        }
    }
    if (!total) return counts.map(() => 0);
    return counts.map(c => Number((c / total).toFixed(4)));
}

// ────────────────────────────────────────────────────────────────────────────
// median-cut による色量子化
// ────────────────────────────────────────────────────────────────────────────

/**
 * median-cut 法で代表色を抽出する。
 *
 * @param {Array<[number, number, number]>} pixels  前景ピクセルの RGB 配列
 * @param {number} maxColors  抽出する代表色の最大数
 * @returns {Array<{ r: number, g: number, b: number, count: number }>} 占有ピクセル数の降順
 */
export function medianCut(pixels, maxColors) {
    if (!pixels.length) return [];

    /** @type {Array<Array<[number,number,number]>>} */
    let buckets = [pixels];

    while (buckets.length < maxColors) {
        // 最も色レンジの広いバケットを選んで分割する
        let targetIdx = -1;
        let targetRange = -1;
        let targetAxis = 0;
        buckets.forEach((bucket, idx) => {
            if (bucket.length < 2) return;
            for (let axis = 0; axis < 3; axis++) {
                let min = 255, max = 0;
                for (const p of bucket) {
                    if (p[axis] < min) min = p[axis];
                    if (p[axis] > max) max = p[axis];
                }
                const range = max - min;
                if (range > targetRange) {
                    targetRange = range;
                    targetIdx = idx;
                    targetAxis = axis;
                }
            }
        });
        if (targetIdx < 0 || targetRange <= 0) break; // これ以上分割できない

        const bucket = buckets[targetIdx];
        bucket.sort((a, b) => a[targetAxis] - b[targetAxis]);
        const mid = bucket.length >> 1;
        buckets.splice(targetIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets
        .filter(b => b.length)
        .map(bucket => {
            let r = 0, g = 0, b = 0;
            for (const p of bucket) { r += p[0]; g += p[1]; b += p[2]; }
            const c = bucket.length;
            return { r: r / c, g: g / c, b: b / c, count: c };
        })
        .sort((a, b) => b.count - a.count);
}

// ────────────────────────────────────────────────────────────────────────────
// AppearanceDetail の色語との照合
// ────────────────────────────────────────────────────────────────────────────

/**
 * 色語 → HSV 範囲の対応表。`AppearanceDetail` に書かれた色語（JP/EN）と
 * 抽出クラスタを突き合わせ、「この HEX はどの色語に対応しそうか」の根拠を付けるために使う。
 *
 * 範囲はあくまで**照合のヒント**であり、これで色を確定するものではない。
 * hueRange が null の色（白 / 黒 / 灰）は彩度・明度のみで判定する。
 */
const COLOR_WORD_RANGES = [
    { key: 'red', jp: ['赤', '紅'], en: ['red', 'reddish', 'crimson', 'burgundy'], hue: [[345, 360], [0, 12]], sMin: 0.35, vMin: 0.25 },
    { key: 'red orange', jp: ['赤橙', '朱'], en: ['red orange', 'vermilion'], hue: [[8, 25]], sMin: 0.35, vMin: 0.3 },
    { key: 'orange', jp: ['橙', 'オレンジ'], en: ['orange', 'orangish', 'amber'], hue: [[20, 42]], sMin: 0.35, vMin: 0.35 },
    { key: 'yellow', jp: ['黄', '金'], en: ['yellow', 'yellowish', 'gold', 'golden', 'amber', 'blonde', 'blond'], hue: [[43, 68]], sMin: 0.3, vMin: 0.4 },
    { key: 'green', jp: ['緑', '碧'], en: ['green', 'greenish'], hue: [[69, 165]], sMin: 0.2, vMin: 0.2 },
    { key: 'cyan', jp: ['水色', '青緑'], en: ['cyan', 'turquoise', 'teal'], hue: [[166, 200]], sMin: 0.2, vMin: 0.3 },
    { key: 'blue', jp: ['青', '藍', '紺'], en: ['blue', 'bluish', 'navy', 'indigo'], hue: [[201, 255]], sMin: 0.2, vMin: 0.15 },
    { key: 'purple', jp: ['紫', '菫'], en: ['purple', 'purplish', 'violet', 'lavender'], hue: [[256, 300]], sMin: 0.15, vMin: 0.2 },
    { key: 'pink', jp: ['桃', 'ピンク'], en: ['pink', 'pinkish', 'magenta', 'rose'], hue: [[301, 344]], sMin: 0.12, vMin: 0.45 },
    { key: 'brown', jp: ['茶', '褐'], en: ['brown', 'brownish', 'tan', 'beige'], hue: [[10, 45]], sMin: 0.2, vMin: 0.15, vMax: 0.6 },
    { key: 'white', jp: ['白'], en: ['white', 'whitish', 'cream', 'ivory'], hue: null, sMax: 0.14, vMin: 0.82 },
    { key: 'black', jp: ['黒'], en: ['black'], hue: null, sMax: 0.3, vMax: 0.22 },
    { key: 'gray', jp: ['灰', 'グレー'], en: ['gray', 'grey', 'grayish', 'greyish', 'silver'], hue: null, sMax: 0.14, vMin: 0.22, vMax: 0.82 },
];

/**
 * 英語の色語が**単語として**現れているかを判定する。
 *
 * 素朴な `includes()` は別語の一部に誤爆する。実データ（NumberTales 1,464 件の `value_EN`）で
 * 計測したところ、`red` が `colored` / `layered` / `inspired` / `numbered` / `assured` などに、
 * `tan` が `rectangular` / `stands` / `tank-top` に一致していた（合計 50 パターン）。
 * 誤爆した色語はそのエントリの `BodyPart` を無関係な色へ転記させるため、
 * 「表情」のエントリが配色の根拠として扱われるといった実害が出る。
 *
 * 対処は単語境界での一致に統一し、`reddish` / `golden` / `yellowish` / `grayish` のような
 * 正当な派生形は **`COLOR_WORD_RANGES` へ語として明示的に並べる**（境界判定を緩めない）。
 * 日本語側は分かち書きが無いため従来どおり部分一致で見る。
 *
 * 未知の派生形が現れた場合は素通しになるが、`100BeautiesLab_GeneratorsAI` の
 * `verify_appearance_detail` が「色語表に無い色語」として検出するため、そこで拾って追加する。
 *
 * @param {string} text 小文字化済みの英語テキスト
 * @param {string} word 色語（空白を含む場合は連続空白を許容する）
 * @returns {boolean}
 */
function containsColorWordEn(text, word) {
    const pattern = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
    return new RegExp(`(^|[^a-z])${pattern}($|[^a-z])`).test(text);
}

/**
 * 抽出クラスタが色語の HSV 範囲に収まるかを判定する。
 * @param {{ h: number, s: number, v: number }} hsv
 * @param {typeof COLOR_WORD_RANGES[number]} def
 * @returns {boolean}
 */
function matchesColorWord(hsv, def) {
    if (def.sMin !== undefined && hsv.s < def.sMin) return false;
    if (def.sMax !== undefined && hsv.s > def.sMax) return false;
    if (def.vMin !== undefined && hsv.v < def.vMin) return false;
    if (def.vMax !== undefined && hsv.v > def.vMax) return false;
    if (!def.hue) return true;
    return def.hue.some(([lo, hi]) => hsv.h >= lo && hsv.h <= hi);
}

/**
 * 色語（AppearanceDetail 由来）と HEX が対応しそうかを判定する。
 * 判定範囲は COLOR_WORD_RANGES を唯一の正とする。
 *
 * @param {string} word 色語（例: 'red orange'）
 * @param {string} hex  #RRGGBB
 * @returns {boolean} 未知の色語なら false
 */
export function colorWordMatchesHex(word, hex) {
    const def = COLOR_WORD_RANGES.find(d => d.key === word);
    if (!def) return false;
    const [r, g, b] = hexToRgb(hex);
    return matchesColorWord(rgbToHsv(r, g, b), def);
}

/**
 * レコードの `AppearanceDetail` から色語のヒントを収集する。
 * `#DesignAttr_Color` の `value_JP` / `value_EN` と、`#DesignAttr_Overview`
 * （例: "red orange hair"）に含まれる色語を拾う。
 *
 * @param {any} record
 * @returns {Array<{ word: string, bodyPart: string|null, element: string|null, source: string }>}
 */
export function collectColorHints(record) {
    /** @type {Array<{word: string, bodyPart: string|null, element: string|null, source: string}>} */
    const hints = [];
    const details = Array.isArray(record?.AppearanceDetail) ? record.AppearanceDetail : [];

    for (const entry of details) {
        // 部位は**全部**ヒントにする。1 エントリが複数部位を持つ場合（"casual outfit" の
        // Chest / Leg / Waist など）に先頭だけを見ると、残りの部位へ色を転記できない。
        const parts = Array.isArray(entry?.BodyPart) && entry.BodyPart.length ? entry.BodyPart : [null];
        const element = entry?.DesignElement ?? null;
        for (const attr of (Array.isArray(entry?.Attrs) ? entry.Attrs : [])) {
            const text = `${attr?.value_JP ?? ''} ${attr?.value_EN ?? ''}`.toLowerCase();
            if (!text.trim()) continue;
            for (const def of COLOR_WORD_RANGES) {
                // 英語は単語境界で、日本語は分かち書きが無いため部分一致で見る
                const hit = def.en.some(w => containsColorWordEn(text, w)) || def.jp.some(w => text.includes(w));
                if (!hit) continue;
                for (const bodyPart of parts) {
                    hints.push({
                        word: def.key,
                        bodyPart,
                        element,
                        source: `${attr.AttrLabel ?? '?'}: ${attr.value_EN ?? attr.value_JP ?? ''}`.trim(),
                    });
                }
            }
        }
    }
    return hints;
}

// ────────────────────────────────────────────────────────────────────────────
// 画像ソースの解決
// ────────────────────────────────────────────────────────────────────────────

/**
 * 配色検出における画像の優先順。`$palette.source` の宣言値で決まる。
 *
 * - `illustration` … 清書イラスト。最も色が確定しているので最優先
 * - `artwork`      … 透過キャラクター単体絵（コアフォルダ / キーキャッパー等）。被覆率が最大
 * - `null`         … 宣言の無いフィールド（衣装差分など）。使えなくはないので最後に回す
 * - `swatch`       … 設定画。手書き注釈・白紙面のノイズが多く、被覆率の測定には使えない
 *
 * @type {ReadonlyArray<string|null>}
 */
const PALETTE_SOURCE_ORDER = ['illustration', 'artwork', null, 'swatch'];

/**
 * レコードの `Images` から、配色検出に使う画像を優先順に解決する。
 *
 * フィールド名をここへ書かないための入口。作品ごとに名前が違ううえ
 * （`arts_PNGPath` / `keycapper_PNGPath` / `weakening_PNGPath`）、
 * **同種の単体絵が今後も別名で増える**前提なので、`db_type.json` の
 * `$palette.source` 宣言を正とする。新しい画像フィールドを足したら、
 * そこへ `illustration` / `artwork` / `swatch` のいずれかを宣言すること。
 *
 * @param {any} record
 * @param {string} workDir     `data/Works_<work>` の絶対パス
 * @param {string} imagesRoot  `data/Works_<work>/Images/DB_<db>` の絶対パス
 * @returns {Array<{ role: string, source: string|null, path: string }>} 実在するファイルのみ
 */
export function resolveImageSources(record, workDir, imagesRoot) {
    const images = record?.Images ?? {};
    /** @type {Array<{role: string, source: string|null, path: string}>} */
    const out = [];

    for (const f of listImageFields(workDir).slice().sort(
        (a, b) => PALETTE_SOURCE_ORDER.indexOf(a.paletteSource) - PALETTE_SOURCE_ORDER.indexOf(b.paletteSource),
    )) {
        const value = images[f.field];
        const rels = Array.isArray(value) ? value : (typeof value === 'string' && value ? [value] : []);
        for (const rel of rels) {
            if (typeof rel !== 'string' || !rel) continue;
            // `keycapper_PNGPath` は拡張子込み、`corefolder_PNGPath` は拡張子なしで記録されている
            const name = rel.toLowerCase().endsWith('.png') ? rel : `${rel}.png`;
            const p = path.join(imagesRoot, f.folder, ...name.split('/'));
            if (fs.existsSync(p)) out.push({ role: f.folder, source: f.paletteSource, path: p });
        }
    }
    return out;
}

/**
 * 作品の `db_type.json` から `Images` 配下の画像フィールドを列挙する。
 *
 * フィールド名をツール側へ書かないための入口。`corefolder_PNGPath`（ナンバーテールズ）と
 * `keycapper_PNGPath`（ハンカクライブ）のように作品ごとに名前が違うため、
 * スキーマ宣言を正として読み取る（`AGENTS.md`「field 名依存の分岐を足さない」）。
 *
 * フォルダ名は `_PNGName` / `_PNGPath` サフィックスを除いた部分とする規約
 * （`corefolder_PNGPath` → `corefolder/`、`concept_PNGName` → `concept/`）。
 *
 * `$palette.source` は「そのフィールドの画像を配色検出のどの入力として使うか」の宣言。
 * `"artwork"`（透過キャラクター単体イラスト = 色分布からの抽出）と
 * `"swatch"`（設定画のカラーチップ検出）を解釈する。
 * 宣言が無い作品では、呼び出し側が全フィールドを候補にして透過率で選り分ける。
 *
 * @param {string} workDir  `data/Works_<work>` の絶対パス
 * @returns {Array<{ field: string, folder: string, isList: boolean, paletteSource: string|null }>} 宣言順
 */
export function listImageFields(workDir) {
    const typePath = path.join(workDir, 'DataBases', 'db_type.json');
    if (!fs.existsSync(typePath)) return [];
    /** @type {any} */
    let typedef;
    try {
        typedef = JSON.parse(fs.readFileSync(typePath, 'utf8'));
    } catch {
        return [];
    }
    const imagesDef = (typedef?.$DefType ?? []).find(d => d?.hashTag === 'Images');
    if (!Array.isArray(imagesDef?.$type)) return [];

    /** @type {Array<{field: string, folder: string, isList: boolean, paletteSource: string|null}>} */
    const out = [];
    for (const child of imagesDef.$type) {
        const field = child?.hashTag;
        if (typeof field !== 'string') continue;
        const m = /^(.+)_PNG(?:Name|Path)$/.exec(field);
        if (!m) continue;
        const source = child?.$palette?.source;
        out.push({
            field,
            folder: m[1],
            isList: String(child?.$type ?? '').includes('[]'),
            paletteSource: typeof source === 'string' ? source : null,
        });
    }
    return out;
}

/**
 * 作品の `db_meta.json` に宣言された共通造形色（`$EnumDef_CommonColor`）を読む。
 *
 * ナンバーテールズの肌・舌・コアフォルダの毛のように、**全キャラで共通の色**は
 * キャラ固有の配色ではないため、透過イラストからの抽出では除外する。
 * この宣言はカタログ画像（`Images/General/catalog/`）に印字された色コードの転記であり、
 * 宣言が無い作品では除外を行わない。
 *
 * @param {string} workDir  `data/Works_<work>` の絶対パス
 * @returns {string[]} `#RRGGBB` の配列（宣言が無ければ空配列）
 */
export function readCommonColors(workDir) {
    const metaPath = path.join(workDir, 'DataBases', 'db_meta.json');
    if (!fs.existsSync(metaPath)) return [];
    /** @type {any} */
    let meta;
    try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
        return [];
    }
    const def = meta?.General?.$VarsDef?.$EnumDef_CommonColor;
    if (!def || typeof def !== 'object') return [];
    return Object.values(def)
        .map(entry => entry?.Hex)
        .filter(hex => typeof hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(hex))
        .map(hex => hex.toUpperCase());
}

/**
 * 画像が「背景を透過したキャラクター単体イラスト」かを透過率で判定する。
 *
 * コアフォルダ / キーキャッパーの透過率は実測 26〜36%、背景付きの設定画（concept）や
 * 清書イラストは 0%。フィールド名で分岐せずに素材を選り分けられる。
 *
 * @param {DecodedImage} img
 * @param {number} [threshold]  この割合以上が透過なら透過素材とみなす
 * @returns {boolean}
 */
export function isTransparentArtwork(img, threshold = 0.1) {
    const n = img.width * img.height;
    if (!n) return false;
    let transparent = 0;
    for (let i = 0; i < n; i++) {
        if (img.data[i * 4 + 3] < 128) transparent++;
    }
    return transparent / n >= threshold;
}

// ────────────────────────────────────────────────────────────────────────────
// 透過キャラクター単体イラストからの配色抽出
// ────────────────────────────────────────────────────────────────────────────

/**
 * 背景を透過したキャラクター単体イラストから配色を抽出する。
 *
 * 設定画のカラーチップが無いレコードのための経路。対象がべた塗り（アニメ塗り）である
 * ことを利用し、**完全一致の色ヒストグラム**で作者の使用色そのものを取り出す。
 * `medianCut()` は複数色の平均を作るため、実在しない中間色になってしまい使えない
 * （実測: Num 1 は本方式だとチップ由来の値と**距離 0** で一致する）。
 *
 * `buildForegroundMask()` も使わない。あちらは紙面付きの設定画を想定して外周の
 * フラッドフィルと背景色推定を行うため、透過画像では不要なうえ、キャラクターの
 * **白い塗りを紙面と誤判定して落として**しまう。
 *
 * 除外するもの:
 *   - 純黒（`v < 0.08`）… 輪郭線。面積 5〜9% を占めるが配色ではない
 *   - `exclude` に渡された共通造形色 … 肌・舌・コアフォルダの毛など全キャラ共通の色。
 *     除外するとチップ由来パレットとの一致率が 60.8% → 82.3% に上がる（実測 89 件）
 *   - 面積比が `minRatio` 未満の色 … 影・ハイライト・アンチエイリアスの残り
 *
 * @param {DecodedImage[]} images  同一キャラの透過イラスト（複数枚は合算する）
 * @param {{ exclude?: string[], minRatio?: number }} [opt]
 *        exclude: 除外する共通造形色 / minRatio: 採用する面積比の下限
 * @returns {Array<{ hex: string, ratio: number, count: number }>} 面積比の降順
 */
export function extractSolidColors(images, opt = {}) {
    const exclude = (opt.exclude ?? []).map(h => h.toUpperCase());
    const minRatio = opt.minRatio ?? 0.02;

    /** @type {Map<number, number>} 24bit RGB → 画素数 */
    const hist = new Map();
    let counted = 0;

    for (const img of images) {
        const n = img.width * img.height;
        for (let i = 0; i < n; i++) {
            if (img.data[i * 4 + 3] < SOLID_ALPHA_MIN) continue;
            const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
            // 輪郭線の純黒を落とす。彩度条件を添えるのは、濃い有彩色（深緑・濃紺など）を
            // 輪郭線と誤って落とさないため。輪郭線は無彩色の黒で引かれる。
            const { s, v } = rgbToHsv(r, g, b);
            if (v < 0.08 && s < 0.5) continue;
            counted++;
            const key = (r << 16) | (g << 8) | b;
            hist.set(key, (hist.get(key) ?? 0) + 1);
        }
    }
    if (!counted) return [];

    const rows = [...hist]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ hex: toHex((key >> 16) & 255, (key >> 8) & 255, key & 255), count }))
        .filter(row => !exclude.some(e => colorDistance(e, row.hex) <= SOLID_EXCLUDE_TOL));

    // 同じ塗りのアンチエイリアス縁を、面積の大きい色へ吸収する（面積降順に貪欲マージ）
    /** @type {Array<{hex: string, count: number}>} */
    const merged = [];
    for (const row of rows) {
        const dup = merged.find(m => colorDistance(m.hex, row.hex) <= SOLID_MERGE_TOL);
        if (dup) dup.count += row.count;
        else merged.push({ ...row });
    }

    // マージで順位が入れ替わるため、必ず再ソートする。Role（Primary/Secondary/…）は
    // この並びで決まるので、忘れると主従が狂う。
    return merged
        .sort((a, b) => b.count - a.count)
        .filter(m => m.count / counted >= minRatio)
        .slice(0, SOLID_TOP)
        .map(m => ({ hex: m.hex, ratio: Number((m.count / counted).toFixed(4)), count: m.count }));
}

// ────────────────────────────────────────────────────────────────────────────
// 実データへの ColorPalette 追記（テキスト挿入 / 書式非破壊）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 書式非破壊パッチのために DB ファイルを開く。
 *
 * 「テキストとして読む → `JSON.parse` でレコードを得る → `scanTopLevelRecords()` で
 * 各レコードの範囲を取る → 件数が合っているか確かめる」までは、どのパッチツールでも同じ。
 * 件数照合は走査ミスに気づくための安全弁で、ここを省くと**別のレコードを書き換える**。
 *
 * @param {string} dbPath  `db_*.json` の絶対パス
 * @returns {{ original: string, records: any[], spans: Array<[number, number]> }}
 * @throws {Error} ファイルが無い / トップレベルが配列でない / 走査件数が合わない場合
 */
export function openRecordsFile(dbPath) {
    if (!fs.existsSync(dbPath)) throw new Error(`DB が見つかりません: ${dbPath}`);
    const original = fs.readFileSync(dbPath, 'utf8');
    const records = JSON.parse(original);
    if (!Array.isArray(records)) throw new Error(`トップレベルが配列ではありません: ${dbPath}`);
    const spans = scanTopLevelRecords(original);
    if (spans.length !== records.length) {
        throw new Error(`レコード走査に失敗しました（テキスト ${spans.length} 件 / パース ${records.length} 件）: ${dbPath}`);
    }
    return { original, records, spans };
}

/**
 * パッチ結果を書き戻す。書き込み前に必ず `JSON.parse` を通す。
 *
 * テキスト置換で組み立てた文字列は、位置計算を 1 つ間違えるだけで壊れた JSON になる。
 * ここで弾けば、壊れたまま `data/` へ書き出す事故を防げる。
 *
 * @param {string} dbPath
 * @param {string} text
 * @throws {SyntaxError} 組み立てた結果が JSON として壊れている場合
 */
export function writeRecordsFile(dbPath, text) {
    JSON.parse(text);
    fs.writeFileSync(dbPath, text, 'utf8');
}

/**
 * JSON テキストを走査し、トップレベル配列の各要素（レコード）の範囲を返す。
 *
 * `JSON.parse` → `JSON.stringify` の往復は、prettier が 1 行に畳んでいる短い配列
 * （例: `"corefolder_PNGPath": ["a", "b"]`）をすべて展開してしまい、ファイル全体が
 * 差分になる。そのため `tools/patch-aihints.mjs` と同様、**既存フォーマットを壊さない
 * テキスト挿入**で追記する。本関数はそのための位置特定に使う。
 *
 * @param {string} text  db_*.json の中身（トップレベルは配列）
 * @returns {Array<[number, number]>} 各レコードの [開始, 終了) オフセット（配列順）
 */
export function scanTopLevelRecords(text) {
    return scanArrayElements(text, text.indexOf('['));
}

/**
 * JSON 配列テキストの各要素の範囲を、文字列リテラルを踏まないように走査して返す。
 *
 * `findValueEnd()` は「キーのコロンから値の終端まで」しか返さないため、
 * `AppearanceDetail[9]` のように**添字で要素を狙う**にはこちらが要る。
 * `scanTopLevelRecords()` はトップレベル配列に対する薄いラッパ。
 *
 * @param {string} text
 * @param {number} openBracket  対象の `[` の位置
 * @returns {Array<[number, number]>} 各要素の [開始, 終了) オフセット（配列順）
 * @throws {Error} 開始位置が `[` でない / 配列が閉じていない場合
 */
export function scanArrayElements(text, openBracket) {
    if (text[openBracket] !== '[') throw new Error(`配列の開始 [ ではありません: ${openBracket}`);
    /** @type {Array<[number, number]>} */
    const spans = [];
    let depth = 0, inString = false, escaped = false, start = -1;

    for (let i = openBracket; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }

        if (ch === '[' || ch === '{') {
            depth++;
            if (depth === 2 && start < 0) start = i;
        } else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 1 && start >= 0) { spans.push([start, i + 1]); start = -1; }
            if (depth === 0) return spans; // 対象の配列が閉じた
        }
        // プリミティブ要素（数値・true/null 等）は書き換え対象にならないので拾わない
    }
    throw new Error('配列が閉じていません');
}

/**
 * `"Key":` の値の終端オフセット（値の最後の文字の次）を返す。
 * 文字列・エスケープを尊重して括弧の対応を取る。
 *
 * @param {string} text
 * @param {number} colonIdx  `:` のオフセット
 * @returns {number} 値の終端（次の文字のオフセット）
 * @throws {Error} 値の終端を特定できない場合
 */
export function findValueEnd(text, colonIdx) {
    let i = colonIdx + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    const ch = text[i];

    if (ch === '[' || ch === '{') {
        const open = ch;
        const close = ch === '[' ? ']' : '}';
        let depth = 0, inString = false, escaped = false;
        for (; i < text.length; i++) {
            const c = text[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') inString = false;
                continue;
            }
            if (c === '"') { inString = true; continue; }
            if (c === open) depth++;
            else if (c === close) {
                depth--;
                if (depth === 0) return i + 1;
            }
        }
        throw new Error('値の括弧が閉じていません');
    }

    if (ch === '"') {
        let escaped = false;
        for (i++; i < text.length; i++) {
            const c = text[i];
            if (escaped) { escaped = false; continue; }
            if (c === '\\') { escaped = true; continue; }
            if (c === '"') return i + 1;
        }
        throw new Error('文字列が閉じていません');
    }

    // スカラー（number / true / false / null）
    for (; i < text.length; i++) {
        if (text[i] === ',' || text[i] === '}' || text[i] === ']') return i;
    }
    throw new Error('スカラー値の終端を特定できません');
}

