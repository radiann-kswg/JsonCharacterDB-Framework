# フォーク構造と同期運用

3 つのリポジトリの上下関係と、上流の更新を下流へ流すための手順をまとめた正典です。

- 設定: [`.sync/upstream.json`](../.sync/upstream.json)
- 実装: [`tools/sync-upstream.mjs`](../tools/sync-upstream.mjs)
- 定期点検: [`.github/workflows/upstream-sync-check.yml`](../.github/workflows/upstream-sync-check.yml)

---

## 1. 上下関係

```
100BeautiesLab_CreationsDB   (上流 / public / 一次創作 DB・フレームワークの実開発地)
            │
            │  フレームワーク部分だけを流す
            ▼
JsonCharacterDB-Framework    (中流 / public / CC BY-NC 4.0・創作データを持たない)
            │
            │  フレームワーク部分だけを流す
            ▼
RadianNs_SecondaryWorksDB    (下流 / private / 二次創作 DB)
```

**一方向のみ**です。下流での修正を上流へ戻す経路は用意していません。
下流で見つけたフレームワークのバグは、**上流（`100BeautiesLab_CreationsDB`）で直して流し直す**のが原則です。
下流で直接直すと、次回の同期でコンフリクトとして跳ね返ってきます。

## 2. なぜ `git subtree` や単純な `git merge` を使わないのか

この 3 つは GitHub 上のフォークではなく、**履歴が無関係な独立リポジトリ**です
（`JsonCharacterDB-Framework` は上流からファイルをコピーして初期化されました）。
そのため素の `git merge upstream/develop` は使えず、仮に `--allow-unrelated-histories` で
通しても、上流の**創作データ本体**（`data/Works_*`、辞書、CNAME、カレンダー同期など）まで
流れ込んでしまいます。中流は CC BY-NC 4.0 で創作データを持たない設計なので、これは許容できません。

また `git subtree` は「上流の 1 ディレクトリを下流の 1 ディレクトリへ」対応させる道具で、
`lib/` `pages/` `tools/` `tests/` … と**散らばった共有面**を扱えません。

## 3. 採用した方式 — ベンダーブランチ

上流と develop の間に、**マニフェストで絞り込んだ中間ブランチ**を挟みます。

```
上流/develop ──[.sync/upstream.json で絞り込み]──▶ upstream/<name> ──[通常の git merge]──▶ develop
                     tools/sync-upstream.mjs                            User が手動で実行
```

`upstream/<name>` は毎回**同じ絞り込みルールで作られる**ため、2 回目以降は前回のベンダーコミットが
自然な merge base になります。つまり **1 回接いでしまえば、以後は普通の 3-way merge** です。
コンフリクトも通常どおりマーカー付きで出ます。

ベンダーツリーの構築には一時 index（`.cache/`）と `git read-tree` / `write-tree` を使い、
**作業ツリーには一切触れません**。blob は上流のオブジェクトをそのまま使うので、
上流が CRLF・下流が LF といった改行差で偽の差分が出ることもありません。

> `tools/sync-upstream.mjs` が行うのは**ベンダーブランチの更新と差分報告だけ**です。
> `develop` への merge は必ず User が手で実行します。

## 4. 日々の手順

```sh
# 1. 上流との差分を見る（ref は書き換えない）
npm run sync:check

# 2. 取り込む気になったらベンダーブランチを進める
npm run sync:update

# 3. 取り込む
git merge upstream/creationsdb      # 下流リポジトリでは upstream/framework

# 4. 門番を通す
npm test
```

`npm run sync:check` は差分があると **exit 1** を返します（CI 用）。
オフラインや fetch 済みの状態で回したいときは `npm run sync:check:offline`。

出力の読み方:

**比較基準は「develop の履歴に取り込み済みの最新ベンダーコミット」**です（HEAD ではありません）。
つまり出るのは**上流で新しく変わって、まだ取り込んでいないもの**だけで、
下流が意図的に持っている差（`'sub'` セクション、`Works_Sample` 前提のテストなど）は報告されません。

| 記号 | 意味 |
| --- | --- |
| `A` | 上流で追加された（まだ取り込んでいない） |
| `M` | 上流で変更された（まだ取り込んでいない） |
| `D` | 上流で削除された、または `exclude` へ追加して同期対象から外した |

ベンダーコミットは commit-tree のトレーラ `Upstream-Repo:` で履歴から見つけるので、
ローカルの `upstream/<name>` ブランチが無い **fresh clone や CI でもそのまま動きます**
（`sync:update` はその履歴上のコミットを親にして続きを作ります）。
「比較基準: HEAD」と出たら §5 の接ぎ木がまだ済んでいないリポジトリです。

## 5. 初回だけ必要な「履歴の接ぎ木」

> **本リポジトリでは実施済み（2026-09-07）。** フォーク元の上流コミット `e11412c` でベンダーブランチを作り
> （`sync:update --ref e11412c`）、`git merge -s ours` で接いだうえで最新まで進めて 3-way merge した。
> 以後この節の操作は不要で、§4 の手順だけで回る。fresh clone でも履歴から復元されるので再接ぎ木は要らない。

ベンダーブランチを初めて作った直後は、まだ merge base がありません。
`npm run sync:update` が 2 択を表示するので、どちらかを選びます。

**A) 現在の下流を正として履歴だけ接ぐ（推奨）**

```sh
git merge -s ours --allow-unrelated-histories upstream/creationsdb
```

作業ツリーは 1 バイトも変わりません。現時点の差分は「下流が意図的に持っている差」として据え置かれ、
**以後の上流の変更だけ**が流れてくるようになります。
今ある差分のうち取り込みたいものは、この後で個別に `git cherry-pick` / 手作業で入れてください。

**B) 差分を全部コンフリクトとして出して突き合わせる**

```sh
git merge --allow-unrelated-histories upstream/creationsdb
```

共有ファイルの食い違いが全件コンフリクトになります。棚卸しとしては正確ですが、初回の負荷は重いです。

どちらを選んでも、**2 回目以降は `git merge upstream/<name>` だけ**で済みます。

## 6. 何を同期し、何を同期しないか

`.sync/upstream.json` の `include` / `exclude` が唯一の判断基準です
（`**` `*` `?` のみ解釈する簡易 glob）。

**同期する**: `lib/` `pages/` `tools/` `tests/` `pkg/` `svc/` `api/` `docs/` `vitest.config.js` `.gitattributes`

**同期しない**:

| 種別 | 例 | 理由 |
| --- | --- | --- |
| 創作データ | `data/**` | 各リポジトリの中身そのもの。混ざってはいけない |
| リポジトリの身元 | `AGENTS.md` `CLAUDE.md` `README.md` `CHANGELOG.md` `LICENSE` `index.html` `CNAME` `package.json` | リポジトリごとに違って当然 |
| 生成物 | `.github/copilot-instructions.md` `.claude/skills/**` `.github/instructions/**` | `AGENTS.md` から `npm run agents:build` で作る |
| 人格 | `.agents/roleplay/ROLEPLAY.md` | リポジトリ固有。テンプレートのみ共有 |
| CI・配信設定 | `.github/workflows/**` `.github/dependabot.yml` `.github/ISSUE_TEMPLATE/**` `pkg/cloudflare/wrangler.toml` | デプロイ先・シークレット・ディレクトリ構成が違う |
| 同期設定そのもの | `.sync/**` | 各リポジトリが自分の上流を指す |
| 上流固有のツール | `tools/build-calendar-ics.mjs` `tools/patch-*.mjs` ほか | 中流には対応する `data/` が無い |

### 不変則: ツールを除外したら、そのツールのテストも除外する

`tools/foo.mjs` を `exclude` しているのに `tests/foo.test.js` が流れてくると、
参照先の無いテストが入って `npm test` が確実に壊れます。
この対応関係は `tests/sync-upstream.manifest.test.js` で固定してあり、片方だけの除外は CI で落ちます。

### マニフェストを変えたくなったら

上流に新機能が入り、下流でも欲しくなったときは `exclude` から外すだけです。逆に
「この機能は下流では持たない」と決めたら `exclude` へ足します。**マニフェストが運用の調整ノブ**で、
スクリプト本体を触る必要はありません。

## 7. 定期点検

二重に仕掛けてあります。片方が止まってももう片方が気づける構成です。

### 7-1. GitHub Actions（機械的な検出）

`.github/workflows/upstream-sync-check.yml` が**毎週月曜 09:00 JST** に走ります。

- 上流は 2 本とも public なので **anonymous clone** で読めます。**PAT は不要**です
- 差分があれば `upstream-sync` ラベルの Issue を**起票、または既存 Issue を上書き更新**します（コメントは増やしません）
- 差分が解消されれば Issue を自動クローズします
- `workflow_dispatch` で手動実行もできます

検出だけを行い、ベンダーブランチの更新や merge はしません。

### 7-2. Cowork の週次タスク（内容の判断）

ローカルの 3 リポジトリを直接読み、差分の中身を見て「取り込むべきか / 下流の意図的な差か」を
判断したレポートを `_work_in_progress/YYYY-MM-DD_upstream-sync.md` に残します。
Actions が拾えない「で、これは取り込むべきなのか」の部分を担当します。

## 8. 依存関係の定期更新（Dependabot）

`.github/dependabot.yml` で **npm**（リポジトリ直下 / `pkg/mcp`）と **GitHub Actions** を
毎週月曜 09:00 JST に更新チェックします。

- 開発依存のマイナー / パッチは 1 本の PR にまとめます（レビュー負荷を下げるため）
- GitHub Actions は全 action をまとめて 1 本にします（`actions/checkout@v4 → v5` 等の追従用）
- 脆弱性由来の **security updates は本ファイルが無くても動きます**。ここで設定しているのは定期のバージョン追従のほうです

本ファイルは**同期対象外**（`.github/**` は各リポジトリ個別管理）です。
ディレクトリ構成が違うため、下流へ持っていくときは `directory:` の増減を確認してください。
`RadianNs_SecondaryWorksDB` は `pkg/mcp` を持たないので、その項目がありません。

## 9. 上流（`100BeautiesLab_CreationsDB`）側の責務

上流にはこの同期スクリプトはありません（流し込む先が無いため）。代わりに次を守ります。

- **フレームワーク部分と創作データを同じコミットに混ぜない。** 混ざると下流が
  「取り込みたい部分だけ」を選べなくなります
- `lib/` `pages/` `svc/` `api/` `pkg/` `tools/` `tests/` を変更したら、
  `CHANGELOG.md` に**下流へ波及する変更である旨**を書く
- 破壊的変更（`db_type.json` の仕様変更、Service Worker のルーティング変更など）は、
  下流の点検 Issue で気づけるよう、変更理由を CHANGELOG に残す
