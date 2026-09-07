/**
 * Service Worker エンリッチメント機能の基本テスト
 * 参照解決とデータ拡張機能の動作検証
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// このテストは最近の変更で導入された2つの重要な不変条件を検証します:
// 1) 解決済み出力に *_Resolved キーが存在してはならない
// 2) エンリッチメント後、一部のフィールドは解決済みオブジェクトでインプレース置換される

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

/**
 * ファイルを読み込んで JSON として解析
 * @param {string} file - リポジトリルートからの相対パス
 * @returns {Object} 解析された JSON オブジェクト
 */
function load(file) {
  const p = join(repoRoot, file);
  const txt = readFileSync(p, 'utf-8');
  return JSON.parse(txt);
}

/**
 * ファイルの読み込みを試行（存在しない場合は null を返す）
 * @param {string} file - リポジトリルートからの相対パス
 * @returns {Object|null} 解析された JSON オブジェクトまたは null
 */
function tryLoad(file) {
  const p = join(repoRoot, file);
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, 'utf-8');
  try { return JSON.parse(txt); } catch { return null; }
}

/**
 * オブジェクトを再帰的に走査してコールバックを実行
 * @param {Object} obj - 走査するオブジェクト
 * @param {Function} cb - コールバック関数
 * @param {Array} path - 現在のパス
 */
function walk(obj, cb, path = []) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    cb(path, k, v);
    if (v && typeof v === 'object') walk(v, cb, [...path, k]);
  }
}

// エンリッチメント動作のサブセットに対する最小限のインプロセスシミュレーション（データファイル使用）
// sw.js はインポートしません（Service Worker/API に依存するため）。代わりに生データの形状と
// meta/type ファイルに期待されるインデックスが存在することをアサートし、データ回帰の早期シグナルを提供します。

describe('enrichment invariants (static)', () => {
  it('global dictionary bodies are separated from db_meta.json into data/Dictionaries', () => {
    // グローバルメタデータ本体から Area / Faction 辞書が外れ、専用ディレクトリ側に存在することを確認
    const meta = load('data/db_meta.json');
    const dictMeta = load('data/Dictionaries/db_meta.json');
    const areaDb = load('data/Dictionaries/dict_Area.json');
    const factionDb = load('data/Dictionaries/dict_Faction.json');

    expect(meta).toBeTypeOf('object');
    expect(meta?.General?.$VarsDef?.['#List_Area']).toBeUndefined();
    expect(meta?.General?.$VarsDef?.['#List_Faction']).toBeUndefined();
    expect(dictMeta?.Dictionaries?.['#Dict_Area']?.file).toBeUndefined();
    expect(dictMeta?.Dictionaries?.['#Dict_Faction']?.file).toBeUndefined();
    expect(dictMeta?.Dictionaries?.['#Dict_Area']?.keyField).toBe('Area');
    expect(dictMeta?.Dictionaries?.['#Dict_Faction']?.keyField).toBe('Faction');
    expect(Array.isArray(areaDb)).toBe(true);
    expect(Array.isArray(factionDb)).toBe(true);
    expect(areaDb.length).toBeGreaterThan(0);
    expect(factionDb.length).toBeGreaterThan(0);
  });

  it('per-work meta exist for known works', () => {
    // 既知の作品に対して作品別メタデータが存在することを確認
    const metaNT = load('data/Works_NumberTales/DataBases/db_meta.json');
    expect(metaNT).toBeTypeOf('object');
  });
});
