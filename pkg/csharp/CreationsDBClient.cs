using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

// JSON ライブラリの選択:
//   Unity    → Newtonsoft.Json (com.unity.nuget.newtonsoft-json) を推奨
//   .NET 5+  → System.Text.Json (標準添付) で代替可能
// ここでは Newtonsoft.Json を標準として実装します。
// System.Text.Json を使う場合は #define USE_SYSTEM_TEXT_JSON を有効化してください。
#if USE_SYSTEM_TEXT_JSON
using System.Text.Json;
using System.Text.Json.Nodes;
using JsonObject = System.Text.Json.Nodes.JsonObject;
#else
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
#endif

// 対応する DB 機構（lib/sw-common.js / lib/data-common.js の移植）:
//   - isPrivate 除外 / _Commons / _Secondaries 補完
//   - Works_Hidden / DB_Hidden による非公開制御（一覧・直接アクセスの双方を遮断）
//   - Works_Dir / Works_Shared オーバーライド（共通資料の疑似作品）
//   - $IndexDef / $IndexDef_<DbNorm> によるインデックスキーのスキーマ駆動解決
//   - 旧作品名エイリアス（Proxies → Works_DestinyFoxRecords）
// 未対応（SW 専用。Cloudflare Workers 版と同じスコープ）:
//   - _DBLink / _Jump の参照解決 enrich

namespace CreationsDB
{
    // ─────────────────────────────────────────────────────────────────────────
    // 型エイリアス（JSON オブジェクト / 配列の抽象化）
    // ─────────────────────────────────────────────────────────────────────────

#if USE_SYSTEM_TEXT_JSON
    using JObj  = System.Text.Json.Nodes.JsonObject;
    using JArr  = System.Text.Json.Nodes.JsonArray;
    using JNode = System.Text.Json.Nodes.JsonNode;
#else
    using JObj  = Newtonsoft.Json.Linq.JObject;
    using JArr  = Newtonsoft.Json.Linq.JArray;
    using JNode = Newtonsoft.Json.Linq.JToken;
#endif

    // ─────────────────────────────────────────────────────────────────────────
    // 例外
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 対象が存在しない、または非公開（Works_Hidden / DB_Hidden）のため参照できない場合に送出される。
    /// Service Worker / Cloudflare Workers 版の 404 レスポンスに対応する。
    /// </summary>
    public sealed class CreationsDBNotFoundException : Exception
    {
        public CreationsDBNotFoundException(string message) : base(message) { }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 公開データ型
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>作品の概要情報</summary>
    public sealed class WorkInfo
    {
        public string Key       { get; set; } = "";
        public string TitleJP   { get; set; } = "";
        public string TitleEN   { get; set; } = "";
        public string SummaryJP { get; set; } = "";
        public string SummaryEN { get; set; } = "";

        /// <summary>
        /// 全作品共通の資料を束ねる疑似作品（例: 共通資料）かどうか。
        /// true の場合、個別の創作タイトルとは区別して扱う。
        /// </summary>
        public bool WorksShared { get; set; }

        public IReadOnlyList<string> OldTitles { get; set; } = Array.Empty<string>();

        /// <summary>
        /// 公式サイト等の外部リンク。各要素は { URL, Label_JP, Label_EN, LinkType } を持つ JSON オブジェクト。
        /// </summary>
        public IReadOnlyList<JObj> OfficialLinks { get; set; } = Array.Empty<JObj>();
    }

    /// <summary>DB の概要情報</summary>
    public sealed class DbInfo
    {
        public string Key     { get; set; } = "";
        public string File    { get; set; } = "";
        public string Layer   { get; set; } = "DataBases";
        public string Label   { get; set; } = "";
        public string LabelEN { get; set; } = "";

        /// <summary>DB 全体の代表画像ファイル名（特定レコードに紐づかない）。未設定なら空文字。</summary>
        public string Image   { get; set; } = "";
    }

    /// <summary>横断検索の結果 1 件</summary>
    public sealed class SearchResult
    {
        public string DbName { get; set; } = "";
        public JObj   Record { get; set; } = new JObj();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 内部ユーティリティ
    // ─────────────────────────────────────────────────────────────────────────

    internal static class Utils
    {
        private static readonly Regex SafeToken     = new Regex(@"^[A-Za-z0-9_]+$", RegexOptions.Compiled);
        private static readonly Regex ValidJsonFile = new Regex(@"^[A-Za-z0-9_.\-]+\.json$", RegexOptions.Compiled);

        /// <summary>
        /// 旧作品名 → 現行ディレクトリ名のエイリアス表。
        /// lib/sw-common.js / lib/data-common.js / pkg/nodejs / pkg/python の同名テーブルと同期させること。
        /// </summary>
        private static readonly Dictionary<string, string> LegacyWorkDirAliases = new()
        {
            { "Proxies", "Works_DestinyFoxRecords" },
        };

        /// <summary>英数字とアンダースコアのみ許可するトークン検証</summary>
        public static bool IsSafeToken(string? s)
            => !string.IsNullOrEmpty(s) && SafeToken.IsMatch(s);

        /// <summary>DB ファイル名として安全か検証</summary>
        public static bool IsValidJsonFile(string? s)
            => !string.IsNullOrEmpty(s) && ValidJsonFile.IsMatch(s);

        /// <summary>先頭文字を大文字化</summary>
        public static string Capitalize(string? s)
            => string.IsNullOrEmpty(s) ? s ?? "" : char.ToUpperInvariant(s[0]) + s.Substring(1);

        /// <summary>
        /// 作品 ID を '#Works_&lt;Name&gt;' 形式に正規化。
        /// 'NumberTales' / 'Works_NumberTales' / '#Works_NumberTales' いずれも受け付ける。
        /// </summary>
        public static string? ToWorkKey(string? workId)
        {
            if (string.IsNullOrWhiteSpace(workId)) return null;
            var raw = workId.Trim();
            string normalized;
            if (raw.StartsWith("#Works_"))     normalized = raw;
            else if (raw.StartsWith("Works_")) normalized = $"#{raw}";
            else                               normalized = $"#Works_{raw}";
            var m = Regex.Match(normalized, @"^#Works_([A-Za-z0-9_]+)$");
            return m.Success ? $"#Works_{m.Groups[1].Value}" : null;
        }

        /// <summary>
        /// '#Works_XXX' → 'Works_XXX'（旧作品名エイリアスを適用）。
        /// Works_Dir オーバーライドは含まない（そちらは <see cref="WorkDirResolver"/> が担当）。
        /// </summary>
        public static string ResolveWorkDirName(string workId)
        {
            var bare = (workId ?? "").TrimStart('#');
            if (bare.StartsWith("Works_")) bare = bare.Substring("Works_".Length);
            return LegacyWorkDirAliases.TryGetValue(bare, out var alias) ? alias : $"Works_{bare}";
        }

        /// <summary>'#DB_Primary' / '#Ref_Primary' / '#Loc_Primary' → 'Primary'</summary>
        public static string StripMetaDbPrefix(string? dbName)
        {
            var s = (dbName ?? "").Trim();
            s = Regex.Replace(s, @"^#?(DB|Ref|Loc)_", "", RegexOptions.IgnoreCase);
            return s.TrimStart('#');
        }

        /// <summary>
        /// databases オブジェクトから DB エントリを検索。
        /// 戻り値: (metaKey, entry)
        /// </summary>
        public static (string? MetaKey, JObj? Entry) FindMetaDbEntry(JObj? databases, string dbName)
        {
            if (databases == null) return (null, null);
            var norm = Capitalize(StripMetaDbPrefix(dbName));
            foreach (var prefix in new[] { $"#DB_{norm}", $"#Ref_{norm}", $"#Loc_{norm}" })
            {
                var entry = TryGetObject(databases, prefix);
                if (entry != null) return (prefix, entry);
            }
            return ($"#DB_{norm}", null);
        }

        /// <summary>DB エントリから物理レイヤー名を解決</summary>
        public static string ResolveDbLayer(JObj? dbEntry)
        {
            var raw = (GetString(dbEntry, "DB_Layer") ?? "").Trim();
            return IsSafeToken(raw) ? raw : "DataBases";
        }

        /// <summary>DB エントリから明示ファイル名（DB_File）を解決。不正・未指定なら空文字</summary>
        public static string ResolveDbFile(JObj? dbEntry)
        {
            var raw = (GetString(dbEntry, "DB_File") ?? "").Trim();
            return IsValidJsonFile(raw) ? raw : "";
        }

        /// <summary>メタキーの種別からデフォルトのファイル名 prefix を決定</summary>
        public static string ResolveDbFilePrefix(string? metaKey)
        {
            var key = metaKey ?? "";
            if (key.StartsWith("#Ref_")) return "ref_";
            if (key.StartsWith("#Loc_")) return "trans_";
            return "db_";
        }

        /// <summary>
        /// DB ファイルのベースディレクトリを組み立てる。
        /// layer が workDir 自身と一致する場合（Works_Dir オーバーライドにより workDir と
        /// DB_Layer が同名になる共通資料の疑似作品等）はレイヤーセグメントを畳み込み、
        /// data/References/References/... のような二重ディレクトリを避ける。
        /// </summary>
        public static string BuildDbBasePath(string workDir, string layer)
            => (!string.IsNullOrEmpty(layer) && layer != workDir)
                ? $"/data/{workDir}/{layer}"
                : $"/data/{workDir}";

        /// <summary>JSON ノードが真偽値 true（または文字列 "true"）かを判定</summary>
        public static bool IsTrue(JNode? v)
        {
            if (v == null) return false;
#if USE_SYSTEM_TEXT_JSON
            if (v is System.Text.Json.Nodes.JsonValue jv)
            {
                if (jv.TryGetValue<bool>(out var b)) return b;
                if (jv.TryGetValue<string>(out var s)) return s.Trim().ToLowerInvariant() == "true";
            }
            return false;
#else
            if (v.Type == JTokenType.Boolean) return (bool)v;
            if (v.Type == JTokenType.String) return ((string)v!).Trim().ToLowerInvariant() == "true";
            return false;
#endif
        }

        /// <summary>isPrivate フラグによる非公開判定</summary>
        public static bool IsPublicRecord(JObj? record)
            => record == null || !IsTrue(record["isPrivate"]);

        /// <summary>
        /// _Commons 適用時の空値判定（hideText は空扱いしない）。
        /// `[]` は「該当なし」の明示宣言（例: Belonging: [] = 無所属）なので空扱いしない。
        /// </summary>
        public static bool IsEmptyForCommons(JNode? v)
        {
            if (v == null) return true;
#if USE_SYSTEM_TEXT_JSON
            if (v is System.Text.Json.Nodes.JsonValue jval)
            {
                if (jval.TryGetValue<string>(out var s)) return s == "";
                return false;
            }
            if (v is JArr) return false;
            if (v is JObj obj)
            {
                if (obj["hideText"] != null) return false;
                return obj.Count == 0;
            }
#else
            if (v.Type == JTokenType.Null) return true;
            if (v.Type == JTokenType.String) return ((string)v!) == "";
            if (v.Type == JTokenType.Array) return false;
            if (v.Type == JTokenType.Object)
            {
                var obj = (JObj)v;
                if (obj["hideText"] != null) return false;
                return !obj.HasValues;
            }
#endif
            return false;
        }

        /// <summary>ドット区切りパスでネストされた値を取得</summary>
        public static JNode? GetByPath(JObj? obj, string path)
        {
            JNode? cur = obj;
            foreach (var part in path.Split('.'))
            {
                if (cur is not JObj o) return null;
                cur = o[part];
            }
            return cur;
        }

        /// <summary>JSON オブジェクトから文字列値を安全に取得（null 許容）</summary>
        public static string? GetString(JObj? obj, string key)
        {
            if (obj == null) return null;
            var v = obj[key];
            if (v == null) return null;
#if USE_SYSTEM_TEXT_JSON
            return v is System.Text.Json.Nodes.JsonValue jv && jv.TryGetValue<string>(out var s) ? s : v.ToString();
#else
            return v.Type == JTokenType.String ? (string?)v : v.ToString();
#endif
        }

        /// <summary>JSON オブジェクト型ノードを安全に取得</summary>
        public static JObj? TryGetObject(JObj? obj, string key)
            => obj?[key] as JObj;

        /// <summary>JSON 配列型ノードを安全に取得</summary>
        public static JArr? TryGetArray(JObj? obj, string key)
            => obj?[key] as JArr;

        /// <summary>
        /// $IndexDef からインデックスキーのドットパスを導出する。
        /// pkg/cloudflare/scripts/migrate.mjs の resolveIdxKey() と同一規則。
        /// ネスト型（$type が配列）の場合は #IndexListKey → #Number → 先頭要素 の
        /// 優先順で主インデックスの子要素を選ぶ。
        /// </summary>
        /// <returns>例: "Num" / "Card.Suit" / "BeastType.Beast"</returns>
        public static string ResolveIdxKeyFromIndexDef(JObj? indexDef)
        {
            if (indexDef == null) return "Num";
            var root = GetString(indexDef, "hashTag");
            if (string.IsNullOrEmpty(root)) root = "Num";

            if (indexDef["$type"] is not JArr types) return root!;

            JObj? FindChild(Func<string, bool> pred)
            {
                foreach (var t in types)
                {
                    if (t is not JObj to) continue;
                    var ts = GetString(to, "$type");
                    if (ts != null && pred(ts)) return to;
                }
                return null;
            }

            var primary = FindChild(s => s.Contains("#IndexListKey"))
                          ?? FindChild(s => s.Contains("#Number"))
                          ?? types.FirstOrDefault() as JObj;

            var childTag = GetString(primary, "hashTag");
            return !string.IsNullOrEmpty(childTag) ? $"{root}.{childTag}" : root!;
        }

        /// <summary>JSON をパース（失敗時は null）</summary>
        public static JObj? ParseObjectOrNull(string json)
        {
            try
            {
#if USE_SYSTEM_TEXT_JSON
                return JsonNode.Parse(json) as JObj;
#else
                return JObject.Parse(json);
#endif
            }
            catch { return null; }
        }

        /// <summary>JSON 配列をパース（失敗時は null）</summary>
        public static JArr? ParseArrayOrNull(string json)
        {
            try
            {
#if USE_SYSTEM_TEXT_JSON
                return JsonNode.Parse(json) as JArr;
#else
                return JArray.Parse(json);
#endif
            }
            catch { return null; }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ファイルシステム I/O
    // ─────────────────────────────────────────────────────────────────────────

    internal sealed class FsFetcher
    {
        private readonly string _repoRoot;

        /// <param name="repoRoot">サブモジュールのルートディレクトリ絶対パス</param>
        public FsFetcher(string repoRoot)
        {
            _repoRoot = Path.GetFullPath(repoRoot);
        }

        private string Resolve(string path)
            => Path.Combine(_repoRoot, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));

        /// <summary>ファイル存在確認</summary>
        public bool Exists(string path) => File.Exists(Resolve(path));

        /// <summary>JSON ファイルを読み込んでオブジェクトとして返す（失敗時は null）</summary>
        public async Task<JObj?> ReadObjectAsync(string path)
        {
            try
            {
                var text = await File.ReadAllTextAsync(Resolve(path));
                return Utils.ParseObjectOrNull(text);
            }
            catch { return null; }
        }

        /// <summary>JSON ファイルを読み込んで配列として返す（失敗時は null）</summary>
        public async Task<JArr?> ReadArrayAsync(string path)
        {
            try
            {
                var text = await File.ReadAllTextAsync(Resolve(path));
                return Utils.ParseArrayOrNull(text);
            }
            catch { return null; }
        }

        /// <summary>JSON ファイルを読み込んでオブジェクトとして返す（失敗時は例外）</summary>
        public async Task<JObj> RequireObjectAsync(string path)
        {
            var text = await File.ReadAllTextAsync(Resolve(path));
            return Utils.ParseObjectOrNull(text)
                   ?? throw new InvalidDataException($"JSON parse failed: {path}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 作品ディレクトリ解決（Works_Dir オーバーライド / Works_Hidden 判定）
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// グローバルメタの CreationWorks を読み、作品IDから物理ディレクトリ名を解決する。
    /// 解決結果はインスタンス内にキャッシュする。
    /// </summary>
    internal sealed class WorkDirResolver
    {
        private readonly FsFetcher _fetcher;
        private JObj? _globalMetaRaw;
        private Dictionary<string, string>? _overrides;

        public WorkDirResolver(FsFetcher fetcher) => _fetcher = fetcher;

        /// <summary>グローバルメタを辞書合流なしで軽量に読み込む（キャッシュ付き）</summary>
        public async Task<JObj?> GetGlobalMetaRawAsync()
            => _globalMetaRaw ??= await _fetcher.ReadObjectAsync("/data/db_meta.json");

        /// <summary>CreationWorks.*.Works_Dir のオーバーライド表を取得（キャッシュ付き）</summary>
        private async Task<Dictionary<string, string>> GetOverridesAsync()
        {
            if (_overrides != null) return _overrides;

            var map = new Dictionary<string, string>();
            var raw = await GetGlobalMetaRawAsync();
            var works = Utils.TryGetObject(raw, "CreationWorks");
            if (works != null)
            {
                foreach (var kv in works)
                {
                    if (kv.Value is not JObj info) continue;
                    var dir = (Utils.GetString(info, "Works_Dir") ?? "").Trim();
                    if (Utils.IsSafeToken(dir)) map[kv.Key] = dir;
                }
            }
            _overrides = map;
            return map;
        }

        /// <summary>作品IDから物理ディレクトリ名を解決（Works_Dir オーバーライド対応）</summary>
        public async Task<string> ResolveAsync(string workKey)
        {
            var overrides = await GetOverridesAsync();
            return overrides.TryGetValue(workKey, out var dir) ? dir : Utils.ResolveWorkDirName(workKey);
        }

        /// <summary>作品が Works_Hidden: true かを判定</summary>
        public async Task<bool> IsWorkHiddenAsync(string workKey)
        {
            var raw = await GetGlobalMetaRawAsync();
            var info = Utils.TryGetObject(Utils.TryGetObject(raw, "CreationWorks"), workKey);
            return info != null && Utils.IsTrue(info["Works_Hidden"]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // メタ読み込みヘルパー
    // ─────────────────────────────────────────────────────────────────────────

    internal static class MetaReader
    {
        /// <summary>辞書バンドルを読み込み、VarsDef へ展開して返す</summary>
        internal static async Task<(JObj Meta, Dictionary<string, JNode> Vars)> ReadDictionaryBundleAsync(
            FsFetcher fetcher, string basePath)
        {
            var meta = await fetcher.ReadObjectAsync($"{basePath}/db_meta.json") ?? new JObj();
            var typeData = await fetcher.ReadObjectAsync($"{basePath}/db_type.json");
            var vars = new Dictionary<string, JNode>();

            // db_type.json の $VarsDef を先に追加
            var typeVarsDef = Utils.TryGetObject(typeData, "$VarsDef");
            if (typeVarsDef != null)
            {
                foreach (var p in typeVarsDef)
                    vars[p.Key] = p.Value ?? new JObj();
            }

            var catalogs = Utils.TryGetObject(meta, "Dictionaries");
            if (catalogs == null) return (meta, vars);

            foreach (var kv in catalogs)
            {
                var rawKey = kv.Key;
                if (kv.Value is not JObj info) continue;
                var dictName = rawKey.Replace("#Dict_", "").Trim();
                if (string.IsNullOrEmpty(dictName)) continue;

                var dictKey = rawKey.StartsWith("#Dict_") ? rawKey : $"#Dict_{dictName}";
                var compatKeyRaw = Utils.GetString(info, "compatListKey");
                var compatKey = !string.IsNullOrWhiteSpace(compatKeyRaw)
                    ? compatKeyRaw! : $"#List_{dictName}";

                var rows = await fetcher.ReadArrayAsync($"{basePath}/dict_{dictName}.json");
                if (rows == null) continue;

                vars[dictKey] = rows;
                if (!vars.ContainsKey(compatKey)) vars[compatKey] = rows;
            }

            return (meta, vars);
        }

        /// <summary>vars を meta.General.$VarsDef へ合流したオブジェクトを返す</summary>
        internal static JObj MergeMetaWithVars(JObj meta, Dictionary<string, JNode> vars, JObj dictMeta)
        {
            var result = (JObj)meta.DeepClone();
            var general = Utils.TryGetObject(result, "General") ?? new JObj();
            var metaVars = Utils.TryGetObject(general, "$VarsDef") ?? new JObj();

            foreach (var kv in vars)
                metaVars[kv.Key] = kv.Value?.DeepClone();

            general["$VarsDef"] = metaVars;
            result["General"] = general;

            // Dictionaries も合流
            var extraDicts = Utils.TryGetObject(dictMeta, "Dictionaries");
            if (extraDicts != null)
            {
                var baseDicts = Utils.TryGetObject(result, "Dictionaries") ?? new JObj();
                foreach (var kv in extraDicts) baseDicts[kv.Key] = kv.Value?.DeepClone();
                result["Dictionaries"] = baseDicts;
            }

            return result;
        }

        /// <summary>グローバルメタ (data/db_meta.json + Dictionaries) を読み込む</summary>
        public static async Task<JObj> ReadGlobalMetaAsync(FsFetcher fetcher)
        {
            var meta = await fetcher.RequireObjectAsync("/data/db_meta.json");
            var (dictMeta, vars) = await ReadDictionaryBundleAsync(fetcher, "/data/Dictionaries");
            return MergeMetaWithVars(meta, vars, dictMeta);
        }

        /// <summary>
        /// 作品ベースメタ (&lt;workDir&gt;/DataBases/db_meta.json) を読み込み、
        /// 無ければ直下の db_meta.json へフォールバックする。
        /// Works_Dir オーバーライドで DataBases/ を持たない作品（共通資料の疑似作品等）向け。
        /// </summary>
        public static async Task<JObj?> FetchWorkBaseMetaAsync(FsFetcher fetcher, string workDir)
            => await fetcher.ReadObjectAsync($"/data/{workDir}/DataBases/db_meta.json")
               ?? await fetcher.ReadObjectAsync($"/data/{workDir}/db_meta.json");

        /// <summary>
        /// 作品型定義 (&lt;workDir&gt;/DataBases/db_type.json) を読み込み、
        /// 無ければ直下の db_type.json へフォールバックする。未存在なら空オブジェクト。
        /// </summary>
        public static async Task<JObj> FetchWorkTypeAsync(FsFetcher fetcher, string workDir)
            => await fetcher.ReadObjectAsync($"/data/{workDir}/DataBases/db_type.json")
               ?? await fetcher.ReadObjectAsync($"/data/{workDir}/db_type.json")
               ?? new JObj();

        /// <summary>作品別メタ (db_meta.json + Dictionaries) を読み込む。欠損時は null</summary>
        public static async Task<JObj?> ReadWorkMetaAsync(FsFetcher fetcher, string workDir)
        {
            var meta = await FetchWorkBaseMetaAsync(fetcher, workDir);
            if (meta == null) return null; // メタは追加価値レイヤー。欠損時も DB 取得は継続させる
            var (dictMeta, vars) = await ReadDictionaryBundleAsync(fetcher, $"/data/{workDir}/Dictionaries");
            return MergeMetaWithVars(meta, vars, dictMeta);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // _Commons / _Secondaries 適用
    // ─────────────────────────────────────────────────────────────────────────

    internal static class CommonsApplier
    {
        private const string ConditionalPrefix = "_ListLinkIf_";

        /// <summary>_Secondaries の条件軸（sec_SeriesTitle を主キー、他は追加条件）</summary>
        private sealed record Criteria(bool Primary, string[] DefKeys, string[] RecPaths);

        private static readonly Criteria[] CriteriaDefs =
        {
            new(true,  new[] { "sec_SeriesTitle", "SecondarySeriesTitle", "SecondarySeriesTitle_EN" },
                       new[] { "sec_SeriesTitle", "SecondarySeriesTitle" }),
            new(false, new[] { "sec_Category", "SecondaryCategory" },
                       new[] { "sec_Category", "SecondaryCategory" }),
            new(false, new[] { "sec_DesignedBy", "SecondaryDesignedBy" },
                       new[] { "sec_DesignedBy", "SecondaryDesignedBy" }),
        };

        /// <summary>
        /// _Commons / _Secondaries をレコード配列に非破壊適用（ディープコピー後に空値を穴埋め）。
        /// sw-common.js CommonsProcessor.applyCommonsToRecords の C# 移植版。
        /// </summary>
        public static IEnumerable<JObj> Apply(IEnumerable<JObj> records, JObj? workMeta, string dbName)
        {
            var databases = Utils.TryGetObject(workMeta, "Databases");
            var (_, dbInfo) = Utils.FindMetaDbEntry(databases, dbName);
            var commons = Utils.TryGetObject(dbInfo, "_Commons");
            var secDefs = Utils.TryGetArray(dbInfo, "_Secondaries")
                          ?? Utils.TryGetArray(dbInfo, "Secondaries");

            if (commons == null && secDefs == null) return records;

            var result = new List<JObj>();
            foreach (var rec in records)
            {
                var copy = (JObj)rec.DeepClone();

                var defaults = new Dictionary<string, JNode?>(BuildDefaultsFromCommons(commons, rec));
                var secCommons = FindSecondaryCommons(secDefs, rec);
                if (secCommons != null)
                {
                    foreach (var kv in BuildDefaultsFromCommons(secCommons, rec))
                        defaults[kv.Key] = kv.Value;
                }

                foreach (var kv in defaults)
                {
                    if (kv.Key.StartsWith("#") || kv.Key.StartsWith("_")) continue;
                    if (Utils.IsEmptyForCommons(copy[kv.Key]))
                        copy[kv.Key] = kv.Value?.DeepClone();
                }
                result.Add(copy);
            }
            return result;
        }

        /// <summary>_Commons オブジェクトから、当該レコードへ適用する既定値を組み立てる</summary>
        private static Dictionary<string, JNode?> BuildDefaultsFromCommons(JObj? cmn, JObj rec)
        {
            var outMap = new Dictionary<string, JNode?>();
            if (cmn == null) return outMap;

            // 1) 単純な commons
            foreach (var kv in cmn)
            {
                if (kv.Key.StartsWith("_") || kv.Key.StartsWith("#")) continue;
                outMap[kv.Key] = kv.Value;
            }

            // 2) 条件付き commons（_ListLinkIf_<Field>）
            foreach (var kv in cmn)
            {
                if (!kv.Key.StartsWith(ConditionalPrefix) || kv.Value is not JArr arr) continue;
                var field = kv.Key.Substring(ConditionalPrefix.Length);

                var curVal = rec[field]
                             ?? Utils.TryGetObject(rec, "Card")?[field]
                             ?? Utils.TryGetObject(rec, "SpecType")?[field]
                             ?? DeepFindFirstByKey(rec, field);
                if (curVal == null) continue;

                JObj? match = null;
                foreach (var item in arr)
                {
                    if (item is not JObj it) continue;
                    var iv = it[field];
                    if (iv != null && iv.ToString() == curVal.ToString()) { match = it; break; }
                }
                if (match == null) continue;

                foreach (var ikv in match)
                {
                    if (ikv.Key == field || ikv.Key.StartsWith("_") || ikv.Key.StartsWith("#")) continue;
                    outMap[ikv.Key] = ikv.Value;
                }
            }
            return outMap;
        }

        /// <summary>レコード内を深さ優先で探索し、最初に見つかったキーの値を返す</summary>
        private static JNode? DeepFindFirstByKey(JObj? obj, string key)
        {
            if (obj == null) return null;
            var direct = obj[key];
            if (direct != null) return direct;
            foreach (var kv in obj)
            {
                if (kv.Value is not JObj child) continue;
                var found = DeepFindFirstByKey(child, key);
                if (found != null) return found;
            }
            return null;
        }

        /// <summary>
        /// レコードに適用すべき _Secondaries 定義を選ぶ。
        /// sec_** を一切指定しない定義はデフォルト fallback、
        /// 条件付き定義が一致すればそちらを優先する。
        /// </summary>
        private static JObj? FindSecondaryCommons(JArr? secDefs, JObj rec)
        {
            if (secDefs == null) return null;

            JObj? defaultDef = null;
            JObj? bestDef = null;
            var bestScore = -1;

            foreach (var item in secDefs)
            {
                if (item is not JObj def) continue;
                if (Utils.TryGetObject(def, "_Commons") == null) continue;

                // sec_** を一つも指定しない定義はデフォルト fallback として退避
                var hasAny = CriteriaDefs.Any(c => !IsBlank(GetFirst(def, c.DefKeys)));
                if (!hasAny)
                {
                    defaultDef ??= def;
                    continue;
                }

                var primaryCriteria = CriteriaDefs.First(c => c.Primary);
                var hasPrimary = !IsBlank(GetFirst(def, primaryCriteria.DefKeys));

                var score = 0;
                var ok = true;

                foreach (var c in CriteriaDefs)
                {
                    var defVal = GetFirst(def, c.DefKeys);
                    if (IsBlank(defVal)) continue; // 条件なし（ワイルドカード）

                    var recVal = GetRec(rec, c.RecPaths);

                    // 主キー（sec_SeriesTitle）は必須一致
                    if (c.Primary)
                    {
                        if (!MatchesCriteria(defVal, recVal)) { ok = false; break; }
                        score += 10;
                        continue;
                    }

                    // primary がある場合、追加条件はレコード側に値がある場合のみ絞り込みに使う。
                    // primary が無い場合、追加条件が実質 primary になるため必須一致とする。
                    var recEmpty = IsBlank(recVal);
                    if (hasPrimary)
                    {
                        if (recEmpty) continue;
                        if (!MatchesCriteria(defVal, recVal)) { ok = false; break; }
                        score += 1;
                        continue;
                    }

                    if (recEmpty || !MatchesCriteria(defVal, recVal)) { ok = false; break; }
                    score += 1;
                }

                if (ok && score > bestScore) { bestScore = score; bestDef = def; }
            }

            var chosen = bestDef ?? defaultDef;
            return chosen != null ? Utils.TryGetObject(chosen, "_Commons") : null;
        }

        private static JNode? GetFirst(JObj obj, string[] keys)
        {
            foreach (var k in keys)
            {
                var v = obj[k];
                if (v != null) return v;
            }
            return null;
        }

        private static JNode? GetRec(JObj rec, string[] paths)
        {
            foreach (var p in paths)
            {
                var v = Utils.GetByPath(rec, p);
                if (v != null) return v;
            }
            return null;
        }

        private static bool IsBlank(JNode? v)
            => v == null || string.IsNullOrWhiteSpace(v.ToString());

        /// <summary>
        /// defVal が文字列 → recVal（配列可）に含まれれば一致。
        /// defVal が配列 → 全要素が recVal に含まれれば一致。
        /// </summary>
        private static bool MatchesCriteria(JNode? defVal, JNode? recVal)
        {
            static List<string> ToArr(JNode? v)
            {
                var list = new List<string>();
                if (v == null) return list;
                if (v is JArr arr)
                {
                    foreach (var x in arr)
                    {
                        var s = x?.ToString() ?? "";
                        if (s != "") list.Add(s);
                    }
                    return list;
                }
                var single = v.ToString();
                if (!string.IsNullOrEmpty(single)) list.Add(single);
                return list;
            }

            var defArr = ToArr(defVal);
            var recArr = ToArr(recVal);
            if (defArr.Count == 0) return true;
            if (recArr.Count == 0) return false;
            return defArr.All(d => recArr.Contains(d));
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DB ファイル解決
    // ─────────────────────────────────────────────────────────────────────────

    internal static class DbResolver
    {
        private static readonly Dictionary<string, string> Conventional = new()
        {
            { "Primary",       "db_Primary.json" },
            { "Secondary",     "db_Secondary.json" },
            { "SemiPrimary",   "db_SemiPrimary.json" },
            { "SelfSecondary", "db_SelfSecondary.json" },
            { "Proxy",         "db_Proxy.json" },
            { "Mobs",          "db_Mobs.json" },
        };

        /// <summary>
        /// DB レコード配列を読み込む（DB_Hidden チェック込み）。
        /// </summary>
        /// <param name="includeHidden">DB_Hidden: true の DB も読み込むか</param>
        /// <exception cref="CreationsDBNotFoundException">
        /// DB_Hidden で遮断された場合、または DB ファイルが存在しない場合
        /// </exception>
        public static async Task<(JArr Records, JObj? WorkMeta)> ReadAsync(
            FsFetcher fetcher, string workDir, string workKey, string dbName, bool includeHidden)
        {
            var norm = Utils.StripMetaDbPrefix(dbName);
            if (!Utils.IsSafeToken(norm))
                throw new ArgumentException($"Invalid dbName: {dbName}");
            var key = Utils.Capitalize(norm);

            var workMeta = await MetaReader.ReadWorkMetaAsync(fetcher, workDir);
            var databases = Utils.TryGetObject(workMeta, "Databases");
            var (metaKey, dbEntry) = Utils.FindMetaDbEntry(databases, key);

            // DB_Hidden: true の DB は一覧だけでなく直接アクセスからも遮断する
            if (!includeHidden && dbEntry != null && Utils.IsTrue(dbEntry["DB_Hidden"]))
                throw new CreationsDBNotFoundException($"DB not found: {workKey}/{dbName}");

            var layer = Utils.ResolveDbLayer(dbEntry);
            var basePath = Utils.BuildDbBasePath(workDir, layer);
            var configuredFile = Utils.ResolveDbFile(dbEntry);
            var defaultPrefix = Utils.ResolveDbFilePrefix(metaKey);

            var candidates = new List<string>();
            if (!string.IsNullOrEmpty(configuredFile)) candidates.Add(configuredFile);
            if (Conventional.TryGetValue(key, out var conv)) candidates.Add(conv);
            candidates.Add($"{defaultPrefix}{key}.json");
            if (!string.Equals(key, norm, StringComparison.OrdinalIgnoreCase))
                candidates.Add($"{defaultPrefix}{norm}.json");
            if (defaultPrefix != "db_") candidates.Add($"db_{key}.json");

            foreach (var fname in candidates)
            {
                if (fetcher.Exists($"{basePath}/{fname}"))
                {
                    var arr = await fetcher.ReadArrayAsync($"{basePath}/{fname}") ?? new JArr();
                    return (arr, workMeta);
                }
            }
            throw new CreationsDBNotFoundException($"DB file not found: workId={workKey}, dbName={dbName}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 公開 API クラス
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// CreationsDB C# クライアント。
    ///
    /// サブモジュールとして導入した 100BeautiesLab_CreationsDB リポジトリの
    /// データを C# (Unity / .NET) 環境から直接取得します。
    /// </summary>
    /// <example>
    /// <code>
    /// var db = new CreationsDBClient();
    /// var works = await db.ListWorksAsync();
    /// var records = await db.GetRecordsAsync("NumberTales", "Primary");
    ///
    /// // インデックスキーはスキーマ ($IndexDef) から自動解決される
    /// var card = await db.GetRecordAsync("FLInvestigator78", "Primary", "Major");
    /// </code>
    /// </example>
    public sealed class CreationsDBClient
    {
        private readonly FsFetcher _fetcher;
        private readonly WorkDirResolver _workDirs;

        /// <summary>isPrivate: true のレコードを含めるか（既定: false）</summary>
        public bool IncludePrivate { get; set; } = false;

        /// <summary>
        /// Works_Hidden / DB_Hidden の作品・DB を含めるか（既定: false）。
        /// 既定では公開制御を尊重し、一覧からの除外に加えて直接アクセスも
        /// <see cref="CreationsDBNotFoundException"/> で遮断します
        /// （Service Worker / Workers の 404 と同等）。
        /// リポジトリ所有者のローカルツール等、非公開データを意図的に扱う場合のみ true にしてください。
        /// </summary>
        public bool IncludeHidden { get; set; } = false;

        /// <summary>
        /// コンストラクター。
        /// </summary>
        /// <param name="repoRoot">
        /// サブモジュールのルートディレクトリ絶対パス。
        /// null の場合は <see cref="FindRepoRoot"/> でアセンブリ位置から自動探索します。
        /// </param>
        public CreationsDBClient(string? repoRoot = null)
        {
            var root = repoRoot ?? FindRepoRoot()
                       ?? throw new InvalidOperationException(
                           "CreationsDB リポジトリルートが見つかりません。" +
                           "repoRoot を明示的に指定するか、data/db_meta.json が存在するディレクトリを確認してください。");
            _fetcher = new FsFetcher(root);
            _workDirs = new WorkDirResolver(_fetcher);
        }

        /// <summary>
        /// <c>data/db_meta.json</c> が存在するディレクトリをリポジトリルートとして探索します。
        /// アセンブリ位置 → 実行ベースディレクトリ → カレントディレクトリ の順に上位フォルダをたどります。
        /// </summary>
        /// <returns>リポジトリルートの絶対パス。見つからない場合は null。</returns>
        public static string? FindRepoRoot()
        {
            var startDirs = new[]
            {
                Path.GetDirectoryName(typeof(CreationsDBClient).Assembly.Location),
                AppDomain.CurrentDomain.BaseDirectory,
                Directory.GetCurrentDirectory(),
            }.Where(d => !string.IsNullOrEmpty(d)).Distinct();

            foreach (var startDir in startDirs)
            {
                var dir = new DirectoryInfo(startDir!);
                while (dir != null)
                {
                    if (File.Exists(Path.Combine(dir.FullName, "data", "db_meta.json")))
                        return dir.FullName;
                    dir = dir.Parent;
                }
            }
            return null;
        }

        // ── 内部ヘルパー ────────────────────────────────────────────────────

        /// <summary>
        /// 作品IDを正規化し、Works_Hidden による非公開チェックを行う。
        /// </summary>
        /// <exception cref="ArgumentException">作品IDが不正な場合</exception>
        /// <exception cref="CreationsDBNotFoundException">
        /// Works_Hidden: true かつ <see cref="IncludeHidden"/> が false の場合
        /// </exception>
        private async Task<string> RequireVisibleWorkAsync(string workId)
        {
            var key = Utils.ToWorkKey(workId)
                      ?? throw new ArgumentException($"Invalid workId: {workId}");
            if (!IncludeHidden && await _workDirs.IsWorkHiddenAsync(key))
                throw new CreationsDBNotFoundException($"Work not found: {workId}");
            return key;
        }

        // ── メタデータ系 ─────────────────────────────────────────────────────

        /// <summary>グローバルメタデータを取得（data/db_meta.json + Dictionaries 合流済み）</summary>
        public Task<JObj> GetMetaAsync()
            => MetaReader.ReadGlobalMetaAsync(_fetcher);

        /// <summary>作品一覧を取得。Works_Hidden: true の作品は除外される。</summary>
        public async Task<IReadOnlyList<WorkInfo>> ListWorksAsync()
        {
            var globalMeta = await MetaReader.ReadGlobalMetaAsync(_fetcher);
            var creationWorks = Utils.TryGetObject(globalMeta, "CreationWorks");
            if (creationWorks == null) return Array.Empty<WorkInfo>();

            var result = new List<WorkInfo>();
            foreach (var kv in creationWorks)
            {
                if (kv.Value is not JObj info) continue;
                if (!IncludeHidden && Utils.IsTrue(info["Works_Hidden"])) continue;

                var oldTitles = Utils.TryGetArray(info, "OldTitles");
                var officialLinks = Utils.TryGetArray(info, "Works_OfficialLinks");
                result.Add(new WorkInfo
                {
                    Key         = kv.Key,
                    TitleJP     = Utils.GetString(info, "Title_JP")          ?? "",
                    TitleEN     = Utils.GetString(info, "Title_EN")          ?? "",
                    SummaryJP   = Utils.GetString(info, "Works_Summary_JP")  ?? "",
                    SummaryEN   = Utils.GetString(info, "Works_Summary_EN")  ?? "",
                    WorksShared = Utils.IsTrue(info["Works_Shared"]),
                    OldTitles   = oldTitles?.Select(t => t?.ToString() ?? "").ToArray()
                                  ?? Array.Empty<string>(),
                    // 構造を保つため各リンクは JSON オブジェクトのまま保持する
                    OfficialLinks = officialLinks?.OfType<JObj>().ToArray()
                                  ?? Array.Empty<JObj>()
                });
            }
            return result;
        }

        /// <summary>作品別メタデータを取得</summary>
        /// <param name="workId">作品ID（'NumberTales' / 'Works_NumberTales' / '#Works_NumberTales' 可）</param>
        public async Task<JObj?> GetWorkMetaAsync(string workId)
        {
            var key = await RequireVisibleWorkAsync(workId);
            return await MetaReader.ReadWorkMetaAsync(_fetcher, await _workDirs.ResolveAsync(key));
        }

        /// <summary>作品別の型定義（db_type.json）を取得。未存在時は空オブジェクト</summary>
        public async Task<JObj> GetWorkTypeAsync(string workId)
        {
            var key = await RequireVisibleWorkAsync(workId);
            return await MetaReader.FetchWorkTypeAsync(_fetcher, await _workDirs.ResolveAsync(key));
        }

        /// <summary>指定作品で利用可能な DB 一覧を取得。DB_Hidden: true は除外される。</summary>
        public async Task<IReadOnlyList<DbInfo>> ListDbsAsync(string workId)
        {
            var key = await RequireVisibleWorkAsync(workId);
            var workDir = await _workDirs.ResolveAsync(key);
            var workMeta = await MetaReader.ReadWorkMetaAsync(_fetcher, workDir);
            var databases = Utils.TryGetObject(workMeta, "Databases");

            var result = new List<DbInfo>();
            if (databases != null)
            {
                foreach (var kv in databases)
                {
                    if (kv.Value is not JObj dbEntry) continue;
                    if (!IncludeHidden && Utils.IsTrue(dbEntry["DB_Hidden"])) continue;
                    // Localization (#Loc_*) は翻訳データ。閲覧対象の DB としては扱わない
                    if (kv.Key.StartsWith("#Loc_")) continue;

                    var norm = Utils.StripMetaDbPrefix(kv.Key);
                    var name = Utils.Capitalize(norm);
                    var layer = Utils.ResolveDbLayer(dbEntry);
                    var basePath = Utils.BuildDbBasePath(workDir, layer);
                    var prefix = Utils.ResolveDbFilePrefix(kv.Key);
                    var cfgFile = Utils.ResolveDbFile(dbEntry);

                    var candidates = new[]
                    {
                        cfgFile,
                        $"{prefix}{name}.json",
                        !string.Equals(name, norm, StringComparison.OrdinalIgnoreCase) ? $"{prefix}{norm}.json" : "",
                        prefix != "db_" ? $"db_{name}.json" : "",
                    }.Where(f => !string.IsNullOrEmpty(f));

                    foreach (var fname in candidates)
                    {
                        if (_fetcher.Exists($"{basePath}/{fname}"))
                        {
                            result.Add(new DbInfo
                            {
                                Key     = name,
                                File    = fname,
                                Layer   = layer,
                                Label   = Utils.GetString(dbEntry, "DB_Label")    ?? name,
                                LabelEN = Utils.GetString(dbEntry, "DB_Label_EN") ?? name,
                                Image   = Utils.GetString(dbEntry, "DB_Image")    ?? "",
                            });
                            break;
                        }
                    }
                }
                if (result.Count > 0) return result;
            }

            // メタ未整備の作品はデフォルトファイル名を探索
            var fallbackBase = $"/data/{workDir}/DataBases";
            foreach (var name in new[] { "Primary", "Secondary", "SemiPrimary", "SelfSecondary",
                                          "Proxy", "Mobs", "PrimaryDealer", "PrimaryMobs",
                                          "UnprocessedSecondary" })
            {
                if (_fetcher.Exists($"{fallbackBase}/db_{name}.json"))
                    result.Add(new DbInfo { Key = name, File = $"db_{name}.json",
                                            Layer = "DataBases", Label = name, LabelEN = name });
            }
            return result;
        }

        /// <summary>
        /// DB のインデックスキー（ドット記法）をスキーマから解決する。
        ///
        /// 解決順:
        ///   1. 作品 typedef のサイドカー $IndexDef_&lt;DbNorm&gt;（DB 単位の上書き）
        ///   2. 作品 typedef の $IndexDef（作品既定）
        ///   3. グローバルメタの $DefType_Index / $Def_Index（後方互換）
        ///   4. "Num"（最終フォールバック）
        /// </summary>
        /// <param name="dbName">DB 名。null の場合は作品既定のインデックスキーを返す</param>
        /// <returns>例: "Num" / "Card.Suit" / "Generation"</returns>
        public async Task<string> GetIndexKeyAsync(string workId, string? dbName = null)
        {
            var key = await RequireVisibleWorkAsync(workId);
            var workType = await MetaReader.FetchWorkTypeAsync(_fetcher, await _workDirs.ResolveAsync(key));

            if (!string.IsNullOrEmpty(dbName))
            {
                var dbNorm = Utils.Capitalize(Utils.StripMetaDbPrefix(dbName));
                var scoped = Utils.TryGetObject(workType, $"$IndexDef_{dbNorm}");
                if (scoped != null) return Utils.ResolveIdxKeyFromIndexDef(scoped);
            }

            var workIndexDef = Utils.TryGetObject(workType, "$IndexDef");
            if (workIndexDef != null) return Utils.ResolveIdxKeyFromIndexDef(workIndexDef);

            // 後方互換: 旧グローバルメタ側の宣言
            var raw = await _workDirs.GetGlobalMetaRawAsync();
            var info = Utils.TryGetObject(Utils.TryGetObject(raw, "CreationWorks"), key);
            var legacy = Utils.TryGetObject(info, "$DefType_Index")
                         ?? Utils.TryGetObject(info, "$Def_Index");
            if (legacy != null) return Utils.ResolveIdxKeyFromIndexDef(legacy);

            return "Num";
        }

        // ── レコード取得系 ──────────────────────────────────────────────────

        /// <summary>
        /// DB のレコード一覧を取得（_Commons / _Secondaries 補完・非公開除外）。
        /// </summary>
        /// <param name="dbName">DB 名（例: "Primary" / "Secondary"）</param>
        /// <param name="applyCommons">_Commons 補完を適用するか（既定: true）</param>
        /// <exception cref="CreationsDBNotFoundException">
        /// 非公開（Works_Hidden / DB_Hidden）または DB 未存在の場合
        /// </exception>
        public async Task<IReadOnlyList<JObj>> GetRecordsAsync(
            string workId, string dbName, bool applyCommons = true)
        {
            var key = await RequireVisibleWorkAsync(workId);
            var workDir = await _workDirs.ResolveAsync(key);

            var (arr, workMeta) = await DbResolver.ReadAsync(_fetcher, workDir, key, dbName, IncludeHidden);

            // _Commons / _Secondaries は isPrivate を注入しうる（例: 特定の二次創作シリーズ全体を
            // _Secondaries[]._Commons.isPrivate: true で非公開にする）。
            // そのため isPrivate のフィルタは _Commons 適用「後」に行う。
            // 逆順にすると、レコード自身が isPrivate を宣言していない限り注入値が読まれず、
            // 非公開指定のレコードが公開されてしまう。
            IEnumerable<JObj> result = arr.OfType<JObj>();
            if (applyCommons) result = CommonsApplier.Apply(result, workMeta, dbName);
            if (!IncludePrivate) result = result.Where(Utils.IsPublicRecord);

            return result.ToList().AsReadOnly();
        }

        /// <summary>
        /// インデックス値でレコードを 1 件取得。見つからない場合は null。
        /// </summary>
        /// <param name="idxValue">インデックス値（例: "25", "Major", "Wrath"）</param>
        /// <param name="idxKey">
        /// インデックスフィールド名（ドット記法可）。
        /// null の場合はスキーマ（$IndexDef / $IndexDef_&lt;DbNorm&gt;）から自動解決する。
        /// </param>
        public async Task<JObj?> GetRecordAsync(
            string workId, string dbName, string idxValue, string? idxKey = null)
        {
            var resolvedKey = idxKey ?? await GetIndexKeyAsync(workId, dbName);
            var records = await GetRecordsAsync(workId, dbName);
            return records.FirstOrDefault(rec => Utils.GetByPath(rec, resolvedKey)?.ToString() == idxValue);
        }

        /// <summary>
        /// DB 内でキーワード全文検索（大小文字無視、部分一致）。
        /// searchableText フィールドまたは JSON 全体を対象にする。
        /// </summary>
        public async Task<IReadOnlyList<JObj>> SearchAsync(
            string workId, string dbName, string query)
        {
            var records = await GetRecordsAsync(workId, dbName);
            if (string.IsNullOrEmpty(query)) return records;

            var q = query.ToLowerInvariant();
            return records.Where(rec =>
            {
                var enrichment = rec["_enrichment"] as JObj;
                var searchableText = Utils.GetString(enrichment, "searchableText");
                var text = searchableText
                           ?? rec.ToString(
#if !USE_SYSTEM_TEXT_JSON
                               Formatting.None
#endif
                           );
                return text.ToLowerInvariant().Contains(q);
            }).ToList().AsReadOnly();
        }

        /// <summary>作品内の全 DB を横断検索。</summary>
        /// <returns>各要素: <see cref="SearchResult"/></returns>
        public async Task<IReadOnlyList<SearchResult>> SearchAllAsync(string workId, string query)
        {
            var dbs = await ListDbsAsync(workId);
            var results = new List<SearchResult>();
            foreach (var db in dbs)
            {
                // 非公開 DB は ListDbsAsync で除外済み。個別 DB の読み込み失敗は全体を止めない
                try
                {
                    var hits = await SearchAsync(workId, db.Key, query);
                    results.AddRange(hits.Select(r => new SearchResult { DbName = db.Key, Record = r }));
                }
                catch (CreationsDBNotFoundException) { /* DB ファイル欠損でも続行 */ }
            }
            return results.AsReadOnly();
        }
    }
}
