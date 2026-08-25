/**
 * `_DBCrossLinkPath` 解決の基本テスト
 *
 * 目的:
 * - `#PNGFilePath`/`#PNGFileName` フィールド専用の DB/Work 横断パス参照が
 *   `_enrichment.images` へ正しく追記されること（`Images.*` 自体は非破壊のまま）
 * - `_DBLink`（レコード参照機構）とは異なり、対象レコードの検索・照合を行わないこと
 * - `Works_Hidden`/`DB_Hidden` の非公開制御が尊重されること
 *
 * NOTE:
 * - Service Worker 自体は起動せず、`EnrichmentProcessor` を直接呼びます（enrich.dblink.jump.merge.test.js と同パターン）。
 */
import { describe, it, expect } from 'vitest';

// data-common.js はブラウザ/SW向けにグローバル公開する設計だが、Node でも評価可能
import '../lib/data-common.js';

/**
 * Node 用の最小 config スタブ（画像系の withRepoBase を満たす）
 */
const testConfig = {
  ORIGIN: 'http://localhost',
  withRepoBase: (p) => String(p || '')
};

/**
 * テスト用の最小 typedef。`Images` コンテナ配下に `arts_PNGPath` / `corefolder_PNGPath` の
 * 2フィールドを `#PNGFilePath[]` として宣言する（`_Field` の既定値/明示指定テストの両方で使う）。
 */
const IMAGE_TYPE_DEF = {
  $DefType: [
    {
      hashTag: 'Images',
      $type: [
        { hashTag: 'arts_PNGPath', $type: '#PNGFilePath[]', hashTag_JP: 'イラスト作品' },
        { hashTag: 'corefolder_PNGPath', $type: '#PNGFilePath[]', hashTag_JP: 'コアフォルダ画像' }
      ]
    }
  ]
};

/**
 * Node 用の最小 DataFetcher スタブ。
 * `_DBCrossLinkPath` の解決は対象レコードの検索を行わないため、`readDB` は不要。
 * 代わりに対象Workの typedef（readWorkType）・グローバルメタ（readGlobalMeta, Works_Hidden用）・
 * 作品別メタ（fetchJSON, DB_Hidden用）を提供する。
 */
class BaseDataFetcher {
  async readGlobalMeta() { return { CreationWorks: {} }; }
  async readGeneralVarsDefGlobal() { return {}; }
  async readGeneralVarsDefWork() { return {}; }
  async readGlobalType() { return {}; }
  async readWorkType() { return IMAGE_TYPE_DEF; }
  async fetchJSON() { return null; }
}

describe('_DBCrossLinkPath resolution (in-process)', () => {
  it('同一Work・別DB（_DB指定のみ）を解決し、対象DB自身のfolderHintで絶対パスを構築する', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 22,
      Images: {
        arts_PNGPath: [
          'corefolders/autumnMoon/art_autumnMoon2023',
          { _DBCrossLinkPath: { _DB: 'SemiPrimary', _IsoPath: 'corefolders/autumnMoon/art_autumnMoon2025' } }
        ]
      }
    };

    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');
    const images = out[0]._enrichment?.images ?? [];
    const crossLinked = images.find((img) => img.url?.includes('art_autumnMoon2025'));

    expect(crossLinked).toBeTruthy();
    expect(crossLinked.url).toBe('/data/Works_XLPMain/Images/DB_SemiPrimary/arts/corefolders/autumnMoon/art_autumnMoon2025.png');
    // 非破壊: Images.* の生値は書き換えられていない
    expect(out[0].Images.arts_PNGPath[1]).toEqual({
      _DBCrossLinkPath: { _DB: 'SemiPrimary', _IsoPath: 'corefolders/autumnMoon/art_autumnMoon2025' }
    });
  });

  it('別Work（_Work指定）を解決し、参照元とは異なる作品ディレクトリの絶対パスを構築する', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: {
        arts_PNGPath: [
          { _DBCrossLinkPath: { _Work: 'XLPOther', _DB: 'Primary', _IsoPath: 'shared/art_shared' } }
        ]
      }
    };

    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');
    const images = out[0]._enrichment?.images ?? [];

    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/data/Works_XLPOther/Images/DB_Primary/arts/shared/art_shared.png');
  });

  it('_DB が欠落している場合は解決失敗し、例外も発生しない', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = { Num: 1, Images: { arts_PNGPath: [{ _DBCrossLinkPath: { _IsoPath: 'foo/bar' } }] } };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');

    expect(out[0]._enrichment?.images ?? []).toHaveLength(0);
  });

  it('_IsoPath が欠落・空文字列の場合は解決失敗する', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: { arts_PNGPath: [{ _DBCrossLinkPath: { _DB: 'SemiPrimary' } }, { _DBCrossLinkPath: { _DB: 'SemiPrimary', _IsoPath: '  ' } }] }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');

    expect(out[0]._enrichment?.images ?? []).toHaveLength(0);
  });

  it('_Field 省略時は wrapper が出現したフィールドと同名を対象にする（folderHint=arts）', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: { arts_PNGPath: [{ _DBCrossLinkPath: { _DB: 'SemiPrimary', _IsoPath: 'foo/bar' } }] }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');
    const images = out[0]._enrichment?.images ?? [];

    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/data/Works_XLPMain/Images/DB_SemiPrimary/arts/foo/bar.png');
  });

  it('_Field を明示指定すると、その画像フィールドのfolderHintで解決する（folderHint=corefolder）', async () => {
    const dataFetcher = new BaseDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: {
        arts_PNGPath: [
          { _DBCrossLinkPath: { _DB: 'SemiPrimary', _Field: 'corefolder_PNGPath', _IsoPath: '22/emstk_corefolder22-1' } }
        ]
      }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');
    const images = out[0]._enrichment?.images ?? [];

    expect(images).toHaveLength(1);
    expect(images[0].url).toBe('/data/Works_XLPMain/Images/DB_SemiPrimary/corefolder/22/emstk_corefolder22-1.png');
  });

  it('Works_Hidden: true の対象Workへの参照は解決失敗する', async () => {
    class HiddenWorkDataFetcher extends BaseDataFetcher {
      async readGlobalMeta() {
        return { CreationWorks: { '#Works_XLPHiddenTarget': { Works_Hidden: true } } };
      }
    }
    const dataFetcher = new HiddenWorkDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: {
        arts_PNGPath: [
          { _DBCrossLinkPath: { _Work: 'XLPHiddenTarget', _DB: 'Primary', _IsoPath: 'foo/bar' } }
        ]
      }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');

    expect(out[0]._enrichment?.images ?? []).toHaveLength(0);
  });

  it('DB_Hidden: true の対象DBへの参照は解決失敗する', async () => {
    class HiddenDbDataFetcher extends BaseDataFetcher {
      async fetchJSON(url) {
        if (String(url).endsWith('/Works_XLPMain/DataBases/db_meta.json')) {
          return { Databases: { '#DB_Secret': { DB_Hidden: true } } };
        }
        return null;
      }
    }
    const dataFetcher = new HiddenDbDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: { arts_PNGPath: [{ _DBCrossLinkPath: { _DB: 'Secret', _IsoPath: 'foo/bar' } }] }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');

    expect(out[0]._enrichment?.images ?? []).toHaveLength(0);
  });

  it('未宣言フィールド（対象Workのschemaで画像型として宣言されていない）への参照は解決失敗する', async () => {
    class UndeclaredFieldDataFetcher extends BaseDataFetcher {
      async readWorkType() {
        return { $DefType: [{ hashTag: 'Images', $type: [{ hashTag: 'arts_PNGPath', $type: '#PNGFilePath[]' }] }] };
      }
    }
    const dataFetcher = new UndeclaredFieldDataFetcher();
    const proc = new globalThis.EnrichmentProcessor(dataFetcher, testConfig);

    const rec = {
      Num: 1,
      Images: {
        arts_PNGPath: [
          { _DBCrossLinkPath: { _DB: 'SemiPrimary', _Field: 'notDeclared_PNGPath', _IsoPath: 'foo/bar' } }
        ]
      }
    };
    const out = await proc.enrichRecords([rec], '#Works_XLPMain', 'Primary');

    expect(out[0]._enrichment?.images ?? []).toHaveLength(0);
  });
});
