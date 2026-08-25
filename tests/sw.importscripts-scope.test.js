/**
 * Service Worker importScripts スコープ衝突の回帰テスト
 *
 * SW は `importScripts()` で複数の classic script を「同一グローバルスコープ」へ読み込むため、
 * ファイルをまたいだトップレベルの `const` / `let` / `class` の同名再宣言は
 * SyntaxError となり SW 全体の評価（登録・更新）が失敗する。
 * （function 宣言同士の重複は classic script では合法＝後勝ちのため対象外）
 *
 * 実例: lib/sw-common.js と lib/data-common.js の両方に
 * `const LEGACY_WORK_DIR_ALIASES` が宣言されたことで 3 つの SW すべてが
 * 「ServiceWorker script evaluation failed」で登録不能になった（2026-07-11 修正）。
 * ブラウザは更新失敗時に古い SW を使い続けるため、この事故は自動テストでしか
 * 早期検知できない。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 各 SW が importScripts で同一グローバルへ読み込むファイル一式（SW 本体もトップレベル宣言を持つため含める）
const SHARED_LIBS = [
  'lib/wrapper-common.js',
  'lib/basic-renders/type-common.js',
  'lib/basic-renders/def-object-common.js',
  'lib/basic-renders/faction.js',
  'lib/basic-renders/baseArea.js',
  'lib/sw-common.js',
  'lib/data-common.js'
];
const SW_SCOPES = [
  { name: 'pages/sw.js', files: [...SHARED_LIBS, 'pages/sw.js'] },
  { name: 'svc/sw.js', files: [...SHARED_LIBS, 'svc/sw.js'] },
  { name: 'api/sw.js', files: [...SHARED_LIBS, 'api/sw.js'] }
];

/**
 * ファイルからトップレベル（行頭）の const / let / class 宣言名を抽出
 * @param {string} relPath - リポジトリルートからの相対パス
 * @returns {string[]} 宣言された識別子名の配列
 */
function extractTopLevelLexicalNames(relPath) {
  const src = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
  const names = [];
  const re = /^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

describe('SW importScripts 同一グローバルスコープの宣言衝突', () => {
  for (const scope of SW_SCOPES) {
    it(`${scope.name} のスコープ内でトップレベル const/let/class が重複しない`, () => {
      const owners = new Map(); // 識別子名 -> 宣言元ファイル配列
      for (const file of scope.files) {
        for (const name of extractTopLevelLexicalNames(file)) {
          if (!owners.has(name)) owners.set(name, []);
          owners.get(name).push(file);
        }
      }
      const duplicates = [...owners.entries()]
        .filter(([, files]) => new Set(files).size > 1)
        .map(([name, files]) => `${name} (${files.join(', ')})`);
      expect(duplicates, `重複宣言があると SW の評価が SyntaxError で失敗します: ${duplicates.join(' / ')}`).toEqual([]);
    });
  }
});
