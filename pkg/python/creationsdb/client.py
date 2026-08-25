"""
CreationsDB クライアント実装

100BeautiesLab_CreationsDB リポジトリをファイルシステム経由で操作する。
外部ライブラリ依存なし（標準ライブラリのみ）。

対応する DB 機構（``lib/sw-common.js`` / ``lib/data-common.js`` の移植）:

- ``isPrivate`` 除外 / ``_Commons`` / ``_Secondaries`` 補完
- ``Works_Hidden`` / ``DB_Hidden`` による非公開制御（一覧・直接アクセスの双方を遮断）
- ``Works_Dir`` / ``Works_Shared`` オーバーライド（共通資料の疑似作品）
- ``$IndexDef`` / ``$IndexDef_<DbNorm>`` によるインデックスキーのスキーマ駆動解決
- 旧作品名エイリアス（``Proxies`` → ``Works_DestinyFoxRecords``）

未対応（SW 専用。Cloudflare Workers 版と同じスコープ）:

- ``_DBLink`` / ``_Jump`` の参照解決 enrich

動作要件: Python 3.9+
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────────────────────
# 定数
# ─────────────────────────────────────────────────────────────────────────────

_SAFE_TOKEN_RE = re.compile(r'^[A-Za-z0-9_]+$')
_VALID_JSON_FILE_RE = re.compile(r'^[A-Za-z0-9_.\-]+\.json$')

# このファイル (pkg/python/creationsdb/client.py) の 4 階層上がリポジトリルート:
#   client.py → creationsdb/ → python/ → pkg/ → <repo root>
_DEFAULT_REPO_ROOT: str = str(Path(__file__).resolve().parent.parent.parent.parent)

# 旧作品名 → 現行ディレクトリ名のエイリアス表。
# lib/sw-common.js / lib/data-common.js / pkg/nodejs の同名テーブルと同期させること。
_LEGACY_WORK_DIR_ALIASES: dict[str, str] = {'Proxies': 'Works_DestinyFoxRecords'}


class CreationsDBNotFoundError(LookupError):
    """
    対象が存在しない、または非公開のため参照できない場合に送出される。
    Service Worker / Cloudflare Workers 版の 404 レスポンスに対応する。
    """


# ─────────────────────────────────────────────────────────────────────────────
# 内部ユーティリティ
# ─────────────────────────────────────────────────────────────────────────────

def _is_safe_token(s: Any) -> bool:
    """英数字とアンダースコアのみからなる安全なトークン判定"""
    return isinstance(s, str) and bool(s) and bool(_SAFE_TOKEN_RE.match(s))


def _capitalize(s: str) -> str:
    """先頭文字を大文字化"""
    return s[:1].upper() + s[1:] if s else s


def _to_work_key(work_id: str) -> Optional[str]:
    """
    作品 ID を '#Works_<Name>' 形式に正規化。
    'NumberTales' / 'Works_NumberTales' / '#Works_NumberTales' いずれも受け付ける。
    無効な場合は None を返す。
    """
    if not work_id:
        return None
    raw = str(work_id).strip()
    if raw.startswith('#Works_'):
        normalized = raw
    elif raw.startswith('Works_'):
        normalized = f'#{raw}'
    else:
        normalized = f'#Works_{raw}'
    m = re.match(r'^#Works_([A-Za-z0-9_]+)$', normalized)
    return f'#Works_{m.group(1)}' if m else None


def _resolve_work_dir_name(work_id: str) -> str:
    """
    '#Works_XXX' → 'Works_XXX'（旧作品名エイリアスを適用）。
    ``Works_Dir`` オーバーライドは含まない（そちらは ``_WorkDirResolver`` が担当）。
    """
    bare = str(work_id or '').lstrip('#')
    if bare.startswith('Works_'):
        bare = bare[len('Works_'):]
    return _LEGACY_WORK_DIR_ALIASES.get(bare, f'Works_{bare}')


def _strip_meta_db_prefix(db_name: str) -> str:
    """'#DB_Primary' / '#Ref_Primary' / '#Loc_Primary' → 'Primary'"""
    s = str(db_name or '').strip()
    s = re.sub(r'^#?(DB|Ref|Loc)_', '', s, flags=re.IGNORECASE)
    return s.lstrip('#')


def _find_meta_db_entry(
    databases: Any, db_name: str
) -> tuple[Optional[str], Optional[dict]]:
    """
    databases オブジェクトから DB エントリを検索。
    戻り値: (metaKey, entry)
    """
    if not isinstance(databases, dict):
        return None, None
    norm = _capitalize(_strip_meta_db_prefix(db_name))
    candidates = [f'#DB_{norm}', f'#Ref_{norm}', f'#Loc_{norm}']
    for meta_key in candidates:
        entry = databases.get(meta_key)
        if isinstance(entry, dict):
            return meta_key, entry
    return candidates[0], None


def _resolve_db_layer(db_entry: Optional[dict]) -> str:
    """DB エントリから物理レイヤー名を解決"""
    raw = str((db_entry or {}).get('DB_Layer') or '').strip()
    return raw if _is_safe_token(raw) else 'DataBases'


def _resolve_db_file(db_entry: Optional[dict]) -> str:
    """DB エントリから明示ファイル名（DB_File）を解決。不正・未指定なら空文字"""
    raw = str((db_entry or {}).get('DB_File') or '').strip()
    return raw if _VALID_JSON_FILE_RE.match(raw) else ''


def _resolve_db_file_prefix(meta_key: Optional[str]) -> str:
    """メタキーの種別からデフォルトのファイル名 prefix を決定"""
    key = str(meta_key or '')
    if key.startswith('#Ref_'):
        return 'ref_'
    if key.startswith('#Loc_'):
        return 'trans_'
    return 'db_'


def _build_db_base_path(work_dir: str, layer: str) -> str:
    """
    DB ファイルのベースディレクトリを組み立てる。

    layer が work_dir 自身と一致する場合（``Works_Dir`` オーバーライドにより
    work_dir と DB_Layer が同名になる共通資料の疑似作品等）はレイヤーセグメントを
    畳み込み、``data/References/References/...`` のような二重ディレクトリを避ける。
    """
    if layer and layer != work_dir:
        return f'/data/{work_dir}/{layer}'
    return f'/data/{work_dir}'


def _is_public_record(record: Any) -> bool:
    """isPrivate フラグを持つレコードを非公開と判定"""
    if not isinstance(record, dict):
        return True
    v = record.get('isPrivate')
    if v is True:
        return False
    if isinstance(v, str) and v.strip().lower() == 'true':
        return False
    return True


def _resolve_idx_key_from_index_def(index_def: Any) -> str:
    """
    ``$IndexDef`` からインデックスキーのドットパスを導出する。

    ``pkg/cloudflare/scripts/migrate.mjs`` の ``resolveIdxKey()`` と同一規則。
    ネスト型（``$type`` がリスト）の場合は ``#IndexListKey`` → ``#Number`` → 先頭要素
    の優先順で主インデックスの子要素を選ぶ。

    Returns
    -------
    str
        例: 'Num' / 'Card.Suit' / 'BeastType.Beast'
    """
    if not isinstance(index_def, dict):
        return 'Num'
    root = index_def.get('hashTag') or 'Num'
    types = index_def.get('$type')
    if not isinstance(types, list):
        return str(root)

    def find_child(pred) -> Optional[dict]:
        for t in types:
            if isinstance(t, dict) and isinstance(t.get('$type'), str) and pred(t['$type']):
                return t
        return None

    primary = (
        find_child(lambda s: '#IndexListKey' in s)
        or find_child(lambda s: '#Number' in s)
        or (types[0] if types and isinstance(types[0], dict) else None)
    )
    if primary and primary.get('hashTag'):
        return f"{root}.{primary['hashTag']}"
    return str(root)


def _is_empty_for_commons(v: Any) -> bool:
    """_Commons 適用時の空値判定（None / '' / {} は空、hideText は空扱いしない）

    `[]` は「該当なし」の明示宣言（例: Belonging: [] = 無所属）なので空扱いしない。
    """
    if v is None:
        return True
    if v == '':
        return True
    if isinstance(v, list):
        return False
    if isinstance(v, dict):
        if v.get('hideText'):
            return False  # 意図的マスクは空扱いしない
        return len(v) == 0
    return False


def _get_by_path(obj: Any, path: str) -> Any:
    """ドット区切りパスでネストされた値を取得"""
    for part in str(path).split('.'):
        if not isinstance(obj, dict) or part not in obj:
            return None
        obj = obj[part]
    return obj


def _apply_commons_to_records(
    records: list, work_meta: dict, db_name: str
) -> list:
    """
    db_meta.json の ``_Commons`` / ``_Secondaries`` をレコード配列に非破壊適用する。
    ``lib/sw-common.js`` CommonsProcessor.applyCommonsToRecords の Python 移植版。
    """
    try:
        _, db_entry = _find_meta_db_entry(
            work_meta.get('Databases') if isinstance(work_meta, dict) else {}, db_name
        )
        db_entry = db_entry or {}
        commons = db_entry.get('_Commons')
        sec_defs = db_entry.get('_Secondaries')
        if sec_defs is None:
            sec_defs = db_entry.get('Secondaries')

        if not commons and not isinstance(sec_defs, list):
            return records

        conditional_prefix = '_ListLinkIf_'

        def norm_str(v: Any) -> str:
            return '' if v is None else str(v)

        def deep_find_first_by_key(obj: Any, key: str) -> Any:
            """レコード内を深さ優先で探索し、最初に見つかったキーの値を返す"""
            if not isinstance(obj, dict):
                return None
            if key in obj:
                return obj[key]
            for v in obj.values():
                if isinstance(v, dict):
                    found = deep_find_first_by_key(v, key)
                    if found is not None:
                        return found
            return None

        def build_defaults_from_commons(cmn: Any, rec: dict) -> dict:
            """_Commons オブジェクトから、当該レコードへ適用する既定値を組み立てる"""
            if not isinstance(cmn, dict):
                return {}
            out: dict = {}

            # 1) 単純な commons
            for k, v in cmn.items():
                if k.startswith('_') or k.startswith('#'):
                    continue
                out[k] = v

            # 2) 条件付き commons（`_ListLinkIf_<Field>`）
            for k, arr in cmn.items():
                if not k.startswith(conditional_prefix) or not isinstance(arr, list):
                    continue
                field = k[len(conditional_prefix):]
                cur_val = rec.get(field)
                if cur_val is None and isinstance(rec.get('Card'), dict):
                    cur_val = rec['Card'].get(field)
                if cur_val is None and isinstance(rec.get('SpecType'), dict):
                    cur_val = rec['SpecType'].get(field)
                if cur_val is None:
                    cur_val = deep_find_first_by_key(rec, field)
                if cur_val is None:
                    continue

                match = None
                for it in arr:
                    if isinstance(it, dict) and field in it and str(it[field]) == str(cur_val):
                        match = it
                        break
                if not match:
                    continue
                for ik, iv in match.items():
                    if ik == field or ik.startswith('_') or ik.startswith('#'):
                        continue
                    out[ik] = iv
            return out

        # `_Secondaries` の条件軸。sec_SeriesTitle を主キー、他は追加条件として扱う。
        criteria_defs = [
            {'primary': True,  'def_keys': ['sec_SeriesTitle', 'SecondarySeriesTitle', 'SecondarySeriesTitle_EN'], 'rec_paths': ['sec_SeriesTitle', 'SecondarySeriesTitle']},
            {'primary': False, 'def_keys': ['sec_Category', 'SecondaryCategory'],       'rec_paths': ['sec_Category', 'SecondaryCategory']},
            {'primary': False, 'def_keys': ['sec_DesignedBy', 'SecondaryDesignedBy'],   'rec_paths': ['sec_DesignedBy', 'SecondaryDesignedBy']},
        ]

        def is_blank(v: Any) -> bool:
            return v is None or norm_str(v).strip() == ''

        def matches_criteria(def_val: Any, rec_val: Any) -> bool:
            """
            def_val が文字列 → rec_val（リスト可）に含まれれば一致。
            def_val がリスト → 全要素が rec_val に含まれれば一致。
            """
            def to_arr(v: Any) -> list[str]:
                items = v if isinstance(v, list) else [v]
                return [s for s in (norm_str(x) for x in items) if s != '']
            def_arr = to_arr(def_val)
            rec_arr = to_arr(rec_val)
            if not def_arr:
                return True
            if not rec_arr:
                return False
            return all(d in rec_arr for d in def_arr)

        def get_first(obj: dict, keys: list[str]) -> Any:
            for k in keys:
                if k and k in obj:
                    return obj[k]
            return None

        def find_secondary_commons(rec: dict) -> Optional[dict]:
            """
            レコードに適用すべき ``_Secondaries`` 定義を選ぶ。
            sec_** を一切指定しない定義はデフォルト fallback、
            条件付き定義が一致すればそちらを優先する。
            """
            if not isinstance(sec_defs, list):
                return None

            def get_rec(paths: list[str]) -> Any:
                for p in paths:
                    v = _get_by_path(rec, p)
                    if v is not None:
                        return v
                return None

            default_def: Optional[dict] = None
            best_def: Optional[dict] = None
            best_score = -1

            for defn in sec_defs:
                if not isinstance(defn, dict) or not isinstance(defn.get('_Commons'), dict):
                    continue

                # sec_** を一つも指定しない定義はデフォルト fallback として退避
                has_any = any(not is_blank(get_first(defn, c['def_keys'])) for c in criteria_defs)
                if not has_any:
                    if default_def is None:
                        default_def = defn
                    continue

                primary_criteria = next(c for c in criteria_defs if c['primary'])
                has_primary = not is_blank(get_first(defn, primary_criteria['def_keys']))

                score = 0
                ok = True
                for c in criteria_defs:
                    def_val = get_first(defn, c['def_keys'])
                    if is_blank(def_val):
                        continue  # 条件なし（ワイルドカード）

                    rec_val = get_rec(c['rec_paths'])

                    # 主キー（sec_SeriesTitle）は必須一致
                    if c['primary']:
                        if not matches_criteria(def_val, rec_val):
                            ok = False
                            break
                        score += 10
                        continue

                    # primary がある場合、追加条件はレコード側に値がある場合のみ絞り込みに使う。
                    # primary が無い場合、追加条件が実質 primary になるため必須一致とする。
                    rec_empty = is_blank(rec_val)
                    if has_primary:
                        if rec_empty:
                            continue
                        if not matches_criteria(def_val, rec_val):
                            ok = False
                            break
                        score += 1
                        continue

                    if rec_empty or not matches_criteria(def_val, rec_val):
                        ok = False
                        break
                    score += 1

                if ok and score > best_score:
                    best_score = score
                    best_def = defn

            chosen = best_def or default_def
            return chosen.get('_Commons') if chosen else None

        result = []
        for rec in records:
            if not isinstance(rec, dict):
                result.append(rec)
                continue
            out = dict(rec)  # シャローコピー（元データを変更しない）
            defaults = dict(build_defaults_from_commons(commons, rec))
            sec_commons = find_secondary_commons(rec)
            if sec_commons:
                defaults.update(build_defaults_from_commons(sec_commons, rec))

            for k, v in defaults.items():
                if k.startswith('#') or k.startswith('_'):
                    continue
                if _is_empty_for_commons(out.get(k)):
                    out[k] = v
            result.append(out)
        return result
    except Exception:
        return records


def _search_text(records: list, query: str) -> list:
    """searchableText または JSON 全体を対象に部分一致全文検索"""
    if not query or not records:
        return records
    q = str(query).lower()
    result = []
    for rec in records:
        enrichment = rec.get('_enrichment', {}) if isinstance(rec, dict) else {}
        text = enrichment.get('searchableText') if isinstance(enrichment, dict) else None
        if text is None:
            text = json.dumps(rec, ensure_ascii=False)
        if q in str(text).lower():
            result.append(rec)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# ファイルシステム I/O
# ─────────────────────────────────────────────────────────────────────────────

class _FsFetcher:
    """
    リポジトリルートを基点とした JSON ファイル読み込みクラス。
    パスは '/' 始まりのルート相対パスで指定（例: '/data/db_meta.json'）。
    """

    def __init__(self, repo_root: str) -> None:
        self.repo_root = Path(repo_root).resolve()

    def _resolve(self, path: str) -> Path:
        return self.repo_root / path.lstrip('/')

    def exists(self, path: str) -> bool:
        """ファイル存在確認"""
        return self._resolve(path).is_file()

    def read_json(self, path: str) -> Any:
        """
        JSON ファイルを読み込んでパース。
        ファイルが存在しない・JSON 不正の場合は例外を送出。
        """
        with self._resolve(path).open('r', encoding='utf-8') as f:
            return json.load(f)

    def try_read_json(self, path: str, default: Any = None) -> Any:
        """JSON ファイルを読み込み、失敗時は default を返す"""
        try:
            return self.read_json(path)
        except Exception:
            return default


# ─────────────────────────────────────────────────────────────────────────────
# メタ / 型定義 読み込みヘルパー
# ─────────────────────────────────────────────────────────────────────────────

def _read_dictionary_bundle(fetcher: _FsFetcher, base_path: str) -> tuple[dict, dict]:
    """
    辞書バンドル（data/Dictionaries/ または作品別 Dictionaries/）を読み込み。
    戻り値: (dict_meta, vars_dict)
    """
    meta = fetcher.try_read_json(f'{base_path}/db_meta.json', {}) or {}
    type_data = fetcher.try_read_json(f'{base_path}/db_type.json', {}) or {}

    type_vars = {}
    if isinstance(type_data, dict) and isinstance(type_data.get('$VarsDef'), dict):
        type_vars = type_data['$VarsDef']

    catalogs = meta.get('Dictionaries', {}) if isinstance(meta, dict) else {}
    vars_out: dict = dict(type_vars)

    for raw_key, info in (catalogs.items() if isinstance(catalogs, dict) else []):
        if not isinstance(info, dict):
            continue
        dict_name = str(raw_key).replace('#Dict_', '').strip()
        if not dict_name:
            continue
        dict_key = raw_key if str(raw_key).startswith('#Dict_') else f'#Dict_{dict_name}'
        compat_key_raw = info.get('compatListKey')
        compat_key = str(compat_key_raw).strip() if compat_key_raw else f'#List_{dict_name}'
        rows = fetcher.try_read_json(f'{base_path}/dict_{dict_name}.json')
        if not isinstance(rows, list):
            continue
        vars_out[dict_key] = [dict(r) if isinstance(r, dict) else r for r in rows]
        if compat_key and compat_key not in vars_out:
            vars_out[compat_key] = [dict(r) if isinstance(r, dict) else r for r in rows]

    return meta, vars_out


def _merge_meta_with_vars(meta: Any, vars_dict: dict, dict_meta: dict) -> dict:
    """vars / dict_meta をメタオブジェクトへ合流"""
    m = meta if isinstance(meta, dict) else {}
    meta_general = m.get('General', {}) if isinstance(m.get('General'), dict) else {}
    meta_vars = meta_general.get('$VarsDef', {}) if isinstance(meta_general.get('$VarsDef'), dict) else {}
    merged_vars = {**meta_vars, **(vars_dict or {})}

    base_dicts = m.get('Dictionaries', {}) if isinstance(m.get('Dictionaries'), dict) else {}
    extra_dicts = (
        dict_meta.get('Dictionaries', {})
        if isinstance(dict_meta, dict) and isinstance(dict_meta.get('Dictionaries'), dict)
        else {}
    )

    result = dict(m)
    if extra_dicts:
        result['Dictionaries'] = {**base_dicts, **extra_dicts}
    result['General'] = {**meta_general, '$VarsDef': merged_vars}
    return result


def _read_global_meta(fetcher: _FsFetcher) -> dict:
    """グローバルメタ (data/db_meta.json + Dictionaries 合流) を読み込み"""
    meta = fetcher.read_json('/data/db_meta.json')
    dict_meta, vars_dict = _read_dictionary_bundle(fetcher, '/data/Dictionaries')
    return _merge_meta_with_vars(meta, vars_dict, dict_meta)


def _fetch_work_base_meta(fetcher: _FsFetcher, work_dir: str) -> dict:
    """
    作品ベースメタ（``<work_dir>/DataBases/db_meta.json``）を読み込み、
    無ければ直下の ``db_meta.json`` へフォールバックする。
    ``Works_Dir`` オーバーライドで ``DataBases/`` を持たない作品向け。
    """
    meta = fetcher.try_read_json(f'/data/{work_dir}/DataBases/db_meta.json')
    if meta is None:
        meta = fetcher.read_json(f'/data/{work_dir}/db_meta.json')
    return meta


def _fetch_work_type(fetcher: _FsFetcher, work_dir: str) -> dict:
    """
    作品型定義（``<work_dir>/DataBases/db_type.json``）を読み込み、
    無ければ直下の ``db_type.json`` へフォールバックする。未存在なら空 dict。
    """
    t = fetcher.try_read_json(f'/data/{work_dir}/DataBases/db_type.json')
    if t is None:
        t = fetcher.try_read_json(f'/data/{work_dir}/db_type.json', {})
    return t if isinstance(t, dict) else {}


# ─────────────────────────────────────────────────────────────────────────────
# 公開 API クラス
# ─────────────────────────────────────────────────────────────────────────────

class CreationsDBClient:
    """
    CreationsDB Python クライアント。

    サブモジュールとして導入した 100BeautiesLab_CreationsDB リポジトリの
    データを Python 環境から直接取得します。

    使用例::

        from creationsdb import CreationsDBClient

        db = CreationsDBClient()
        works = db.list_works()
        records = db.get_records('NumberTales', 'Primary')

        # インデックスキーはスキーマから自動解決される
        record = db.get_record('FLInvestigator78', 'Primary', 'Major')
        hits = db.search('NumberTales', 'Primary', 'たぬき')
    """

    def __init__(
        self,
        repo_root: str = _DEFAULT_REPO_ROOT,
        *,
        include_private: bool = False,
        include_hidden: bool = False,
    ) -> None:
        """
        Parameters
        ----------
        repo_root : str
            サブモジュールのルートディレクトリパス（絶対・相対どちらも可）。
            省略時は client.py の 4 階層上 (pkg/ の親) を自動解決します。
        include_private : bool
            ``isPrivate: true`` のレコードを含めるか（既定: False）。
        include_hidden : bool
            ``Works_Hidden`` / ``DB_Hidden`` の作品・DB を含めるか（既定: False）。
            既定では公開制御を尊重し、一覧からの除外に加えて直接アクセスも
            :class:`CreationsDBNotFoundError` で遮断します
            （Service Worker / Workers の 404 と同等）。
            リポジトリ所有者のローカルツール等、非公開データを意図的に扱う場合のみ
            True にしてください。
        """
        self._fetcher = _FsFetcher(repo_root)
        self.include_private = include_private
        self.include_hidden = include_hidden
        self._global_meta_raw: Optional[dict] = None
        self._works_dir_overrides: Optional[dict[str, str]] = None

    # ── 内部ヘルパー ────────────────────────────────────────────────────────

    def _get_global_meta_raw(self) -> dict:
        """グローバルメタを辞書合流なしで軽量に読み込む（キャッシュ付き）"""
        if self._global_meta_raw is None:
            self._global_meta_raw = self._fetcher.read_json('/data/db_meta.json')
        return self._global_meta_raw

    def _get_works_dir_overrides(self) -> dict[str, str]:
        """``CreationWorks.*.Works_Dir`` のオーバーライド表を取得（キャッシュ付き）"""
        if self._works_dir_overrides is not None:
            return self._works_dir_overrides
        overrides: dict[str, str] = {}
        try:
            raw = self._get_global_meta_raw()
            for key, info in (raw.get('CreationWorks') or {}).items():
                if not isinstance(info, dict):
                    continue
                work_dir = str(info.get('Works_Dir') or '').strip()
                if work_dir and _is_safe_token(work_dir):
                    overrides[key] = work_dir
        except Exception:
            # 取得失敗時は空表。全 work が _resolve_work_dir_name() へフォールバックする
            pass
        self._works_dir_overrides = overrides
        return overrides

    def _resolve_work_dir(self, work_key: str) -> str:
        """作品IDから物理ディレクトリ名を解決（``Works_Dir`` オーバーライド対応）"""
        return self._get_works_dir_overrides().get(work_key) or _resolve_work_dir_name(work_key)

    def _require_visible_work(self, work_id: str) -> str:
        """
        作品IDを正規化し、``Works_Hidden`` による非公開チェックを行う。

        Raises
        ------
        ValueError
            作品IDが不正な場合
        CreationsDBNotFoundError
            ``Works_Hidden: true`` かつ include_hidden=False の場合
        """
        key = _to_work_key(work_id)
        if not key:
            raise ValueError(f'Invalid work_id: {work_id}')
        if self.include_hidden:
            return key
        try:
            raw = self._get_global_meta_raw()
            info = (raw.get('CreationWorks') or {}).get(key)
        except Exception:
            # グローバルメタが読めない場合は非公開判定をスキップして続行する
            return key
        if isinstance(info, dict) and info.get('Works_Hidden') is True:
            raise CreationsDBNotFoundError(f'Work not found: {work_id}')
        return key

    def _read_work_meta(self, work_key: str) -> Optional[dict]:
        """作品メタ（辞書合流済み）を読み込む。メタ欠損時は None を返す"""
        work_dir = self._resolve_work_dir(work_key)
        try:
            meta = _fetch_work_base_meta(self._fetcher, work_dir)
        except Exception:
            return None  # メタは追加価値レイヤー。欠損時も DB 取得は継続させる
        dict_meta, vars_dict = _read_dictionary_bundle(
            self._fetcher, f'/data/{work_dir}/Dictionaries'
        )
        return _merge_meta_with_vars(meta, vars_dict, dict_meta)

    def _read_db_records(self, work_key: str, db_name: str) -> tuple[list, Optional[dict]]:
        """
        DB ファイルを探索してレコード配列を読み込む（``DB_Hidden`` チェック込み）。
        戻り値: (records, work_meta)
        """
        norm = _strip_meta_db_prefix(db_name)
        if not _is_safe_token(norm):
            raise ValueError(f'Invalid db_name: {db_name}')
        key = _capitalize(norm)

        work_meta = self._read_work_meta(work_key)
        meta_key, db_entry = _find_meta_db_entry(
            work_meta.get('Databases') if isinstance(work_meta, dict) else {}, key
        )

        # DB_Hidden: true の DB は一覧だけでなく直接アクセスからも遮断する
        if not self.include_hidden and isinstance(db_entry, dict) and db_entry.get('DB_Hidden') is True:
            raise CreationsDBNotFoundError(f'DB not found: {work_key}/{db_name}')

        work_dir = self._resolve_work_dir(work_key)
        layer = _resolve_db_layer(db_entry)
        base = _build_db_base_path(work_dir, layer)
        configured_file = _resolve_db_file(db_entry)
        default_prefix = _resolve_db_file_prefix(meta_key)

        conventional = {
            'Primary': 'db_Primary.json', 'Secondary': 'db_Secondary.json',
            'SemiPrimary': 'db_SemiPrimary.json', 'SelfSecondary': 'db_SelfSecondary.json',
            'Proxy': 'db_Proxy.json', 'Mobs': 'db_Mobs.json',
        }

        candidates = []
        if configured_file:
            candidates.append(configured_file)
        if key in conventional:
            candidates.append(conventional[key])
        candidates.append(f'{default_prefix}{key}.json')
        if key.lower() != norm.lower():
            candidates.append(f'{default_prefix}{norm}.json')
        if default_prefix != 'db_':
            candidates.append(f'db_{key}.json')

        for fname in candidates:
            if self._fetcher.exists(f'{base}/{fname}'):
                records = self._fetcher.read_json(f'{base}/{fname}')
                if not isinstance(records, list):
                    records = []
                return records, work_meta

        raise CreationsDBNotFoundError(
            f'DB file not found: work_id={work_key}, db_name={db_name}'
        )

    # ── メタデータ系 ─────────────────────────────────────────────────────────

    def get_meta(self) -> dict:
        """グローバルメタデータを取得（data/db_meta.json + Dictionaries 合流済み）"""
        return _read_global_meta(self._fetcher)

    def list_works(self) -> list[dict]:
        """
        作品一覧を返す。``Works_Hidden: true`` の作品は除外される。

        Returns
        -------
        list[dict]
            各要素: ``{key, Title_JP, Title_EN, Works_Summary_JP, Works_Summary_EN,
            Works_Shared, OldTitles, Works_OfficialLinks}``
        """
        global_meta = _read_global_meta(self._fetcher)
        creation_works = global_meta.get('CreationWorks') or {}
        result = []
        for key, info in (creation_works.items() if isinstance(creation_works, dict) else []):
            if not isinstance(info, dict):
                continue
            if not self.include_hidden and info.get('Works_Hidden') is True:
                continue
            result.append({
                'key': key,
                'Title_JP': str(info.get('Title_JP') or ''),
                'Title_EN': str(info.get('Title_EN') or ''),
                'Works_Summary_JP': str(info.get('Works_Summary_JP') or ''),
                'Works_Summary_EN': str(info.get('Works_Summary_EN') or ''),
                # 全作品共通の資料を束ねる疑似作品（例: 共通資料）は個別の創作タイトルと区別する
                'Works_Shared': info.get('Works_Shared') is True,
                'OldTitles': list(info.get('OldTitles') or []),
                # 公式サイト等の外部リンク（各要素 {URL, Label_JP, Label_EN, LinkType}）
                'Works_OfficialLinks': list(info.get('Works_OfficialLinks') or []),
            })
        return result

    def get_work_meta(self, work_id: str) -> dict:
        """
        作品別メタデータを取得。

        Parameters
        ----------
        work_id : str
            作品ID（'NumberTales' / 'Works_NumberTales' / '#Works_NumberTales' いずれも可）

        Raises
        ------
        CreationsDBNotFoundError
            ``Works_Hidden`` の作品、またはメタが存在しない場合
        """
        key = self._require_visible_work(work_id)
        meta = self._read_work_meta(key)
        if meta is None:
            raise CreationsDBNotFoundError(f'Work meta not found: {work_id}')
        return meta

    def get_work_type(self, work_id: str) -> dict:
        """作品別の型定義（db_type.json）を取得。未存在時は空 dict"""
        key = self._require_visible_work(work_id)
        return _fetch_work_type(self._fetcher, self._resolve_work_dir(key))

    def list_dbs(self, work_id: str) -> list[dict]:
        """
        指定作品で利用可能な DB 一覧を返す。``DB_Hidden: true`` は除外される。

        Returns
        -------
        list[dict]
            各要素: ``{key, file, layer, DB_Label, DB_Label_EN, DB_Image}``
        """
        key = self._require_visible_work(work_id)
        work_dir = self._resolve_work_dir(key)
        work_meta = self._read_work_meta(key)

        exist = []
        databases = (work_meta or {}).get('Databases') or {}
        if isinstance(databases, dict) and databases:
            for db_key, db_entry in databases.items():
                if not isinstance(db_entry, dict):
                    continue
                if not self.include_hidden and db_entry.get('DB_Hidden') is True:
                    continue
                # Localization (#Loc_*) は翻訳データ。閲覧対象の DB としては扱わない
                if str(db_key).startswith('#Loc_'):
                    continue

                norm = _strip_meta_db_prefix(db_key)
                name = _capitalize(norm)
                layer = _resolve_db_layer(db_entry)
                base = _build_db_base_path(work_dir, layer)
                prefix = _resolve_db_file_prefix(db_key)
                configured = _resolve_db_file(db_entry)

                candidates = [c for c in [
                    configured,
                    f'{prefix}{name}.json',
                    f'{prefix}{norm}.json' if name.lower() != norm.lower() else '',
                    f'db_{name}.json' if prefix != 'db_' else '',
                ] if c]

                for fname in candidates:
                    if self._fetcher.exists(f'{base}/{fname}'):
                        exist.append({
                            'key': name,
                            'file': fname,
                            'layer': layer,
                            'DB_Label': str(db_entry.get('DB_Label') or name),
                            'DB_Label_EN': str(db_entry.get('DB_Label_EN') or name),
                            # DB 全体の代表画像（特定レコードに紐づかない）
                            'DB_Image': str(db_entry.get('DB_Image') or ''),
                        })
                        break
            if exist:
                return exist

        # メタ未整備の作品はデフォルトファイルを探索
        base = f'/data/{work_dir}/DataBases'
        defaults = [
            'Primary', 'Secondary', 'SemiPrimary', 'SelfSecondary',
            'Proxy', 'Mobs', 'PrimaryDealer', 'PrimaryMobs', 'UnprocessedSecondary'
        ]
        for name in defaults:
            if self._fetcher.exists(f'{base}/db_{name}.json'):
                exist.append({
                    'key': name, 'file': f'db_{name}.json', 'layer': 'DataBases',
                    'DB_Label': name, 'DB_Label_EN': name, 'DB_Image': '',
                })
        return exist

    def get_index_key(self, work_id: str, db_name: Optional[str] = None) -> str:
        """
        DB のインデックスキー（ドット記法）をスキーマから解決する。

        解決順:

        1. 作品 typedef のサイドカー ``$IndexDef_<DbNorm>``（DB 単位の上書き）
        2. 作品 typedef の ``$IndexDef``（作品既定）
        3. グローバルメタの ``$DefType_Index`` / ``$Def_Index``（後方互換）
        4. ``'Num'``（最終フォールバック）

        Parameters
        ----------
        db_name : str, optional
            省略時は作品既定のインデックスキーを返す。

        Returns
        -------
        str
            例: 'Num' / 'Card.Suit' / 'Generation'

        Examples
        --------
        >>> db.get_index_key('FLInvestigator78', 'Primary')
        'Card.Suit'
        >>> db.get_index_key('DestinyFoxRecords', 'Proxy')   # サイドカー
        'Generation'
        >>> db.get_index_key('DestinyFoxRecords')            # 作品既定
        'Unit'
        """
        key = self._require_visible_work(work_id)
        work_type = self.get_work_type(key)

        if db_name:
            db_norm = _capitalize(_strip_meta_db_prefix(db_name))
            scoped = work_type.get(f'$IndexDef_{db_norm}') if db_norm else None
            if isinstance(scoped, dict):
                return _resolve_idx_key_from_index_def(scoped)

        if isinstance(work_type.get('$IndexDef'), dict):
            return _resolve_idx_key_from_index_def(work_type['$IndexDef'])

        # 後方互換: 旧グローバルメタ側の宣言
        try:
            raw = self._get_global_meta_raw()
            work_meta = (raw.get('CreationWorks') or {}).get(key) or {}
            legacy = work_meta.get('$DefType_Index') or work_meta.get('$Def_Index')
            if isinstance(legacy, dict):
                return _resolve_idx_key_from_index_def(legacy)
        except Exception:
            pass

        return 'Num'

    # ── レコード取得系 ──────────────────────────────────────────────────────

    def get_records(
        self,
        work_id: str,
        db_name: str,
        *,
        apply_commons: bool = True,
    ) -> list[dict]:
        """
        DB のレコード一覧を取得。

        Parameters
        ----------
        db_name : str
            DB 名（例: 'Primary' / 'Secondary'）
        apply_commons : bool
            ``_Commons`` / ``_Secondaries`` 補完を適用するか（既定: True）

        Raises
        ------
        CreationsDBNotFoundError
            非公開（``Works_Hidden`` / ``DB_Hidden``）または DB 未存在の場合
        """
        key = self._require_visible_work(work_id)
        records, work_meta = self._read_db_records(key, db_name)

        # `_Commons` / `_Secondaries` は isPrivate を注入しうる（例: 特定の二次創作シリーズ全体を
        # `_Secondaries[]._Commons.isPrivate: true` で非公開にする）。
        # そのため isPrivate のフィルタは _Commons 適用「後」に行う。
        # 逆順にすると、レコード自身が isPrivate を宣言していない限り注入値が読まれず、
        # 非公開指定のレコードが公開されてしまう。
        if apply_commons and work_meta:
            records = _apply_commons_to_records(records, work_meta, db_name)
        if not self.include_private:
            records = [r for r in records if _is_public_record(r)]
        return records

    def get_record(
        self,
        work_id: str,
        db_name: str,
        idx_value: Any,
        idx_key: Optional[str] = None,
    ) -> Optional[dict]:
        """
        インデックス値でレコードを 1 件取得。見つからない場合は None。

        Parameters
        ----------
        idx_value : str | int
            インデックス値（例: '25', 'Major', 'Wrath'）
        idx_key : str, optional
            インデックスフィールド名（ドット記法可）。
            省略時はスキーマ（``$IndexDef`` / ``$IndexDef_<DbNorm>``）から自動解決する。
        """
        resolved_key = idx_key or self.get_index_key(work_id, db_name)
        records = self.get_records(work_id, db_name)
        target = str(idx_value)
        for rec in records:
            v = _get_by_path(rec, resolved_key)
            if v is not None and str(v) == target:
                return rec
        return None

    def search(self, work_id: str, db_name: str, query: str) -> list[dict]:
        """
        DB 内でキーワード全文検索（大小文字無視、部分一致）。

        Returns
        -------
        list[dict]
            ヒットしたレコードのリスト
        """
        records = self.get_records(work_id, db_name)
        return _search_text(records, query)

    def search_all(self, work_id: str, query: str) -> list[dict]:
        """
        作品内の全 DB を横断検索。

        Returns
        -------
        list[dict]
            各要素: ``{db: str, record: dict}``
        """
        dbs = self.list_dbs(work_id)
        results = []
        for db_info in dbs:
            # 非公開 DB は list_dbs で除外済み。個別 DB の読み込み失敗は全体を止めない
            try:
                hits = self.search(work_id, db_info['key'], query)
            except Exception:
                continue
            for record in hits:
                results.append({'db': db_info['key'], 'record': record})
        return results
