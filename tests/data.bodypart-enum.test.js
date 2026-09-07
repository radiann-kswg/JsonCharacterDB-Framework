/**
 * `#BodyPart_*` の宣言漏れ検出テスト
 *
 * @description
 *   `AppearanceDetail[].BodyPart` と `ColorPalette[].AppliesTo` が使う部位は、
 *   `data/db_meta.json` の `$EnumDef_DesignBodyPart` に宣言されている必要がある。
 *
 *   宣言が漏れていると、部位 enum を正として値を組み立てるツールが
 *   **未宣言の値を黙って落とす**。実際 `#BodyPart_Halo` が宣言漏れしており、
 *   `AppliesTo` を一括更新した際に 3 箇所から消えた（HEAD と突き合わせて発覚）。
 *   宣言側で気づけるようにここで固定する。
 *
 * @see https://github.com/radiann-kswg/100BeautiesLab_CreationsDB/issues/21
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(REPO_ROOT, 'data');

/** `$EnumDef_DesignBodyPart` に宣言された部位キー */
const declared = new Set(Object.keys(
    JSON.parse(fs.readFileSync(path.join(DATA, 'db_meta.json'), 'utf8'))
        .General.$VarsDef.$EnumDef_DesignBodyPart,
));

/** 作品別 DB（`data/Works_<作品>/DataBases/db_<種別>.json`）を走査して、使われている部位を集める */
function collectUsedBodyParts() {
    /** @type {Map<string, string[]>} 部位 → 使用箇所（先頭 3 件） */
    const used = new Map();
    const note = (part, where) => {
        if (!used.has(part)) used.set(part, []);
        const list = used.get(part);
        if (list.length < 3) list.push(where);
    };

    for (const work of fs.readdirSync(DATA).filter(d => d.startsWith('Works_'))) {
        const dir = path.join(DATA, work, 'DataBases');
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(f => /^db_.*\.json$/.test(f))) {
            let db;
            try {
                db = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            } catch {
                continue; // JSON の壊れは data.sanity.test.js の担当
            }
            if (!Array.isArray(db)) continue;

            for (const record of db) {
                const where = `${work}/${file} Num=${record?.Num}`;
                for (const entry of record?.AppearanceDetail ?? []) {
                    for (const p of entry?.BodyPart ?? []) note(p, `${where} AppearanceDetail`);
                }
                for (const color of record?.ColorPalette ?? []) {
                    for (const p of color?.AppliesTo ?? []) note(p, `${where} ColorPalette ${color.Hex}`);
                }
            }
        }
    }
    return used;
}

describe('$EnumDef_DesignBodyPart — 部位の宣言漏れ', () => {
    const used = collectUsedBodyParts();

    it('データで使われている部位はすべて宣言されている', () => {
        const undeclared = [...used.keys()].filter(p => !declared.has(p));
        const detail = undeclared.map(p => `${p} … ${used.get(p).join(' / ')}`).join('\n');
        expect(undeclared, `未宣言の部位:\n${detail}`).toEqual([]);
    });

    it('部位キーは `#BodyPart_` 接頭辞を持つ', () => {
        const malformed = [...used.keys()].filter(p => !/^#BodyPart_[A-Za-z]+$/.test(p));
        expect(malformed).toEqual([]);
    });

    it('宣言漏れで消えた実例（#BodyPart_Halo）が宣言されている', () => {
        // 一括更新で 3 箇所から消えた値。宣言側の回帰として固定する。
        // データ側の使用有無は User が随時変えるので縛らない（縛ると編集の邪魔になる）。
        expect(declared.has('#BodyPart_Halo')).toBe(true);
    });
});
