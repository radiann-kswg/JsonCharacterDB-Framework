# 2026-11-16 上流同期の定期点検（JsonCharacterDB-Framework）

> **`git merge` と `data/` の変更は行っていない**（`sync:update` までの読み取り中心の調査と提案）。
> コード・ワークフロー・画像も一切書き換えていない。改善はすべて提案どまり。

## 点検の前提

| 項目 | 値 |
| --- | --- |
| 点検日時 | 2026-11-16 01:10〜01:20 UTC |
| 上流 | `100BeautiesLab_CreationsDB` @ `develop` (`f4ef83f`) |
| 比較基準 | 取り込み済みベンダーコミット `e0692d4`（上流 `4f48192`） |
| 同期対象ファイル数 | 174 |
| 未取り込み | **8 件**（M=8） |
| ベンダーブランチ | `upstream/creationsdb` を `6b132aa` へ更新済み（`sync:update` 実行済み） |

比較基準はベンダーコミット。「比較基準: HEAD」の異常なし。

## 差分 8 件の分類

8 件すべて上流の単一コミット `f4ef83f`「DB全体整備(クラス周り)」由来。上流 CHANGELOG の 2026-11-15 の 2 エントリ
（`scopeField` 構造化値の fix ＋ グローバル Class 辞書の `Dictionaries/Class/` 移動 refactor）に対応する。
**中流 `develop` はこの 8 ファイルすべてで旧ベンダー `e0692d4` と差分ゼロ（固有差分なし）**。
`git merge-tree --write-tree develop upstream/creationsdb` の実測でも**コンフリクト 0**。

| 分類 | ファイル | 判断理由（1 行） |
| --- | --- | --- |
| 取り込むべき | `lib/basic-renders/type-common.js` | `rowMatchesRecordScope()` が構造化 `scopeField` 値を解決できないバグの修正。スカラー宣言は従来どおりで後方互換 |
| 取り込むべき | `pkg/nodejs/index.mjs` | 辞書バンドル読み込みを `dictFile` 宣言準拠へ（ファイル名決め打ちの素のバグも同時修正） |
| 取り込むべき | `pkg/python/creationsdb/client.py` | 同上（Python クライアント） |
| 取り込むべき | `pkg/csharp/CreationsDBClient.cs` | 同上（C# クライアント） |
| 取り込むべき | `tools/deepl/build-glossary-source.mjs` | `collectFromDir()` が辞書サブフォルダを再帰で拾うようになる改善 |
| 取り込むべき | `docs/schema-meta-processing.md` | 構造化 `scopeField` を正とする §3.4.1 の更新（上記 fix の文書化） |
| 取り込むべき | `docs/db-update-guidelines.md` | 同整備に伴う追記（+4 行） |
| 取り込むべき | `docs/deepl-localization.md` | 同整備に伴う 2 行の更新 |

要注意・要相談は **0 件**。上流の `data/Dictionaries/Class/` への辞書ファイル移動そのものは `data/` で同期対象外。
中流の `Works_Sample` はスカラー `scopeField` のみ・サブフォルダ辞書なしなので挙動差は出ない見込み。

## Dependabot open PR（radiann-kswg 3 リポジトリ・2026-11-16 時点）

| リポジトリ | PR | 内容 | open から |
| --- | --- | --- | --- |
| 中流 | #20 | glob 14.0.4 → 14.0.6（dev-minor-patch グループ） | 本日（放置なし） |
| 上流 | #58 | glob 14.0.3 → 14.0.6（dev-minor-patch グループ） | 本日（放置なし） |
| 下流 | — | open 0 件 | （version updates 未稼働疑いが 10-05 から継続） |

前回持ち越しの中流 #15/#16/#17/#18・上流 #53/#54 はすべて解消済み（`node_modules` 実測でも glob 14 系・
依存整理による **−8.6 MB / −405 ファイル**を確認）。

## GitHub Pages 軽量化・高速化の点検

ワークフロー（`pages.yml`）は 11-09 から変更なし。`npm ci` → `npm test` → `upload-pages-artifact@v5`（`path: .`）のまま。

**今回の新事実**: 中流の Pages は**有効で公開中**（`https://radiann-kswg.github.io/JsonCharacterDB-Framework/` が 200。
11-09 は有効化状況未確認だった）。さらに `node_modules/vitest/package.json` へのアクセスが **200** を返し、
`node_modules/` が公開サイトから実際に配信されていることを実証した。

| 計測 | 今回（11-16） | 前回（11-09） | 増減 |
| --- | --- | --- | --- |
| 追跡ファイル合計 | 4.885 MB / 253 件 | 4.890 MB / 253 件 | −4.6 KB |
| アーティファクトに混ざる `node_modules/` | **92.1 MB / 2,570 件** | 100.7 MB / 2,975 件 | −8.6 MB（Dependabot 整理分） |
| 初回表示（`index.html` + `pages/characters.css`） | 59,372 B（gzip 計 11,318 B） | 同値 | 変化なし |
| 実サイト `/`（Windows 側 curl） | 200 / TTFB 0.64s / 989 B / gzip / `max-age=600` | 未計測（egress 403） | 初計測 |

大きいファイル上位は前回と同一（`pages/vendor/` の cytoscape / three.js 系が上位。初回表示には乗らない遅延読み込み）。

### 改善案（1 件に絞る）

1. **`pages.yml` の `Test` 直後に `run: rm -rf node_modules` を 1 ステップ追加**（中流固有・`.github/` は同期対象外なので上流からは降りてこない）。
   効果: アーティファクト **−92.1 MB / −2,570 ファイル**、公開中の `node_modules/` 配信も止まる。`npm test` 後なので門番の役目は不変。
   下流にも同件があるため、同じ 1 行を下流 `pages.yml` にも（下流レポート参照）。

## 次にやるべき 1 手

```
git merge upstream/creationsdb
npm test
```

コンフリクト見込みファイルなし（merge-tree 実測 0）。merge 後は下流の `sync:check` にこの 8 件が降りてくる。

---

## 追記: `upstream-sync-check.yml` の失敗調査（同日・User 依頼）

本日 00:09 UTC のスケジュール実行 [43778716893](https://github.com/radiann-kswg/JsonCharacterDB-Framework/actions/runs/43778716893) が失敗。
失敗したのは最後の「Open or update tracking issue」ステップで、ログの該当 2 行はこれ:

```
HTTP 403: Resource not accessible by integration (https://api.github.com/repos/radiann-kswg/100BeautiesLab_CreationsDB/labels)
could not add label: 'upstream-sync' not found
```

### 原因: gh CLI が「上流リポジトリ」に向かって叩いている

直前の「Fetch upstream (shallow)」ステップが checkout に `upstream` リモートを追加する。
gh CLI はリポジトリ指定（`-R` / `GH_REPO`）が無いとき git リモートから対象を解決し、その優先順位は
**`upstream` > `github` > `origin`**。つまり issue ステップの `gh label create` / `gh issue list` / `gh issue create` は
すべて上流 `100BeautiesLab_CreationsDB` に向かっていた。`GITHUB_TOKEN` は自リポジトリ限定なので
上流の labels API が 403 →「ラベルが見つからない」で `gh issue create` が exit 1。
（ラベル `upstream-sync` は中流自身にはちゃんと存在する。`gh label create` の失敗は `|| true` で見えなくなっていた）

### これは今日壊れたのではなく、最初から一度も動いていない

実行履歴を見ると**差分があった週は毎回失敗**（9-14 / 9-21 / 9-28 / 10-12 / 10-19 / 11-02 / 11-16）、
差分ゼロの週だけ成功（DRIFT=0 の経路は gh への書き込みが無いため）。追跡 Issue は一度も作られたことがない。
下流 `RadianNs_SecondaryWorksDB` の同ワークフローも同一内容で、10-19（差分 8 件あり）に同じ失敗をしている
（今日は差分ゼロなので成功表示だが、潜在バグは同じ）。

なお、トークンに権限があったら**上流リポジトリに Issue を作ってしまう**挙動だった。403 が事故を防いでいた形。

### 修正案（1 行・中流と下流の両方。`.github/` は同期対象外なので各自で）

「Open or update tracking issue」ステップの `env:` に 1 行足して、gh の対象を自リポジトリへ固定する:

```yaml
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}   # ← 追加。upstream リモートへの誤解決を防ぐ
          DRIFT: ${{ steps.check.outputs.drift }}
```

検証は修正後に `workflow_dispatch` で 1 回手動実行すれば足りる（いま中流は差分 8 件なので、成功すれば追跡 Issue が初めて立つはず）。

### 対応結果（同日・User 承認のもと適用済み）

- 中流 `852ed102`・下流 `bfa32bd` として上記 1 行を commit し、`origin/develop` へ push 済み
  （中流は push 前に origin の Dependabot #20 merge を rebase で取り込み）。
- 中流で `workflow_dispatch` を手動実行 → [43811403997](https://github.com/radiann-kswg/JsonCharacterDB-Framework/actions/runs/43811403997) **success**。
  追跡 Issue [#21](https://github.com/radiann-kswg/JsonCharacterDB-Framework/issues/21) が初めて作成された（本日の 8 件を掲載。merge 後の次回実行で自動クローズされる想定）。
- 下流は本日差分ゼロで同経路を通らないため dispatch 検証は省略（修正内容は中流と同一）。

---

## 追記: 8 件の取り込み（2026-11-24）

この 8 件は 11-23 点検の 23 件に含めて、2026-11-24 に `git merge upstream/creationsdb`（`bb627cd`）で取り込み済み。詳細は `2026-11-23_upstream-sync.md` の末尾の追記を参照。
