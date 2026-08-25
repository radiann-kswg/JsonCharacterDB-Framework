/**
 * [build-roleplay-prompts.mjs] - JSON DB ＋ テンプレートから配布用ロールプレイプロンプト（Markdown）を生成する CLI
 * @description
 *   各作品 `data/Works_<Work>/RoleplayPrompts/roleplay-prompt.tpl.md` の差し込み口へ、
 *   `ConversationPattern` を中心とした DB 値を機械的に差し込んでプロンプトを生成する。LLM は一切
 *   呼ばず、既存の充填済み値を組み立てるだけ（CLAUDE.md「会話パターン情報の運用制約」準拠）。
 *
 *   符号化フィールド（三人称 DSL / GenderType / RaceType / TailsUnit）は lib/basic-renders /
 *   lib/section-renders の純関数を side-effect import して人間可読へ展開する（UI と同一デコード）。
 *
 *   出力パスは CreationsDBClient.resolveIndexPathRoles() の宣言的判定に従う（フォルダキー/ファイルキー）。
 *   生成物はマーカー無しのクリーン Markdown。既存ファイルの再生成は sections.mjs の見出しアンカー
 *   方式でマージ更新し、手書き独自見出しのセクションは元の位置のまま保全する。
 *
 *   CLI:
 *     node tools/build-roleplay-prompts.mjs            # 既定 = plan（dry-run。新規列挙＋既存はマージ差分）
 *       --write            生成/マージ書き込み（新規フル生成・既存は見出しアンカーでマージ）
 *       --check            CI 用: 差分（新規/マージ更新）があれば exit 1（書かない）
 *       --force            既存を構造非依存で丸ごと再生成（脱出口）
 *       --reconcile        .private/<id> と DB 生成のドリフト差分だけ表示（書き込み無し・フェーズ3）
 *       --adopt            .private/<id> を管理版として生成場所へ取り込み（フェーズ3）
 *       --work=<Name>      作品を絞り込み（Works_ 省略名。例: NumberTales）
 *       --db=<Name>        DB を絞り込み（DB_ 省略名。例: Primary）
 *       --id=<Value>       ファイルキー値で単一レコードに絞り込み
 *       --lang=jp|en       生成言語（既定 jp。en はフェーズ4）
 *       --report=<path>    レポート JSON 出力先（既定 .cache/roleplay-report.json）
 *
 * @author 100BeautiesLab.
 * @version 1.0.0
 * @dependencies Node.js >= 18, pkg/nodejs/index.mjs, tools/roleplay/*.mjs, lib/*（side-effect）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CreationsDBClient from '../pkg/nodejs/index.mjs';
import { renderTemplate, hasUnresolvedPlaceholders, applyFilter, normalizeEol, unwrapValueLike } from './roleplay/render.mjs';
import { mergeByHeadings, diffSections } from './roleplay/sections.mjs';
// 符号化フィールドのデコードを Node 側でも使えるよう globalThis へ登録（UI と同一ロジック）
import '../lib/wrapper-common.js';
import '../lib/section-wrapper-common.js';
import '../lib/basic-renders/calling-common.js';
import '../lib/basic-renders/type-common.js';
import '../lib/basic-renders/def-object-common.js';
import '../lib/basic-renders/keyedDialogue.js';
import '../lib/section-renders/tailsUnit.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_NAME = 'roleplay-prompt.tpl.md';
const PROMPTS_DIR = 'RoleplayPrompts';
const DEEP_LINK_BASE = 'https://database.numbertales-radiann.net/pages/characters.html';

/**
 * CLI 引数をパースする（外部依存なしの自前実装）。
 * @param {string[]} argv
 * @returns {{write:boolean, check:boolean, force:boolean, adopt:boolean, reconcile:boolean, lang:string, work:string, db:string, id:string, report:string}}
 */
export function parseArgs(argv) {
	const args = { write: false, check: false, force: false, adopt: false, reconcile: false, lang: 'jp', work: '', db: '', id: '', report: '' };
	for (const a of argv) {
		if (a === '--write') args.write = true;
		else if (a === '--check') args.check = true;
		else if (a === '--force') args.force = true;
		else if (a === '--adopt') args.adopt = true;
		else if (a === '--reconcile') args.reconcile = true;
		else if (a.startsWith('--work=')) args.work = a.slice('--work='.length);
		else if (a.startsWith('--db=')) args.db = a.slice('--db='.length);
		else if (a.startsWith('--id=')) args.id = a.slice('--id='.length);
		else if (a.startsWith('--lang=')) args.lang = a.slice('--lang='.length);
		else if (a.startsWith('--report=')) args.report = a.slice('--report='.length);
	}
	if (args.write && args.check) throw new Error('--write と --check は同時指定できません');
	if (args.reconcile && args.adopt) throw new Error('--reconcile と --adopt は同時指定できません');
	return args;
}

/**
 * ドットパスでオブジェクトから値を取得する。
 * @param {any} obj
 * @param {string} dotpath
 * @returns {any}
 */
export function getByPath(obj, dotpath) {
	const segs = String(dotpath || '').split('.');
	let cur = obj;
	for (const seg of segs) {
		if (cur == null || typeof cur !== 'object') return undefined;
		cur = cur[seg];
	}
	return cur;
}

/**
 * ファイル/ディレクトリ名に使えない文字をアンダースコアへ置換する。
 * @param {any} s
 * @returns {string}
 */
export function sanitizeSegment(s) {
	return String(s == null ? '' : s).trim().replace(/[/\\:*?"<>|]/g, '_');
}

/**
 * レコードが「充填済みの ConversationPattern」を持つか判定する（生成対象の絞り込み）。
 * テキスト項目のいずれかが非空、または DialogueExamples に非空要素があれば true。
 * @param {any} rec
 * @returns {boolean}
 */
export function hasFilledConversationPattern(rec) {
	const cp = rec?.ConversationPattern;
	if (!cp || typeof cp !== 'object' || Array.isArray(cp)) return false;
	const textKeys = [
		'TalkingTone_JP', 'TalkingTone_EN', 'TopicPreference_JP', 'TopicPreference_EN',
		'TalkFrequency_JP', 'TalkFrequency_EN', 'PreferredTopics_JP', 'PreferredTopics_EN',
		'AvoidedTopics_JP', 'AvoidedTopics_EN', 'ConversationNotes_JP', 'ConversationNotes_EN',
	];
	if (textKeys.some((k) => typeof cp[k] === 'string' && cp[k].trim())) return true;
	const de = cp.DialogueExamples;
	if (Array.isArray(de) && de.some((d) => d && (typeof d === 'string' ? d.trim() : (d.value_JP || d.value_EN || d.value)))) return true;
	return false;
}

/**
 * テンプレ先頭の設定ブロック（`<!-- 100bl:tpl ... -->`）を抽出し、本体から除去する。
 * @param {string} tpl
 * @returns {{config: Record<string,string>, body: string}}
 */
export function extractConfigAndBody(tpl) {
	const config = {};
	let body = String(tpl == null ? '' : tpl);
	const m = body.match(/<!--\s*100bl:tpl\s*([\s\S]*?)-->[ \t]*\r?\n?/);
	if (m) {
		for (const line of m[1].split('\n')) {
			const t = line.trim();
			if (!t) continue;
			const idx = t.indexOf(':');
			if (idx < 0) continue;
			config[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
		}
		body = body.slice(0, m.index) + body.slice(m.index + m[0].length);
	}
	return { config, body };
}

/**
 * レコードから合成変数（@DisplayName 等）を構築する。
 * - 設定ブロックの式（displayName 等）を評価
 * - 派生値（三人称/性別/種族/尻尾ユニット/deep link）を lib デコードで生成
 * @param {any} record
 * @param {object} ctx - { config, workShort, dbShort, pathRoles, workMeta, globalMeta, lang }
 * @returns {Record<string, any>}
 */
export function buildVars(record, ctx) {
	const { config, workShort, dbShort, pathRoles, workMeta, globalMeta, lang, workTitle } = ctx;
	// 作品名は複数行を持つことがあるため先頭行のみ採用
	const vars = { __lang: lang, WorkTitle_JP: String(workTitle || '').split('\n')[0].trim() };

	// 台詞リストのキー接頭辞（`TouchReactions` の行為 / `MotifCommentaries` のモチーフ）を辞書解決する。
	// 対象コンテナは `$display.wrapper: "keyedDialogueSummary"` を宣言した `$Def_*` から自動収集し、
	// 要素が持つキー項目（`$display.role: "dialogueKey"`）で突き合わせるため、
	// ここに field 名ごとの分岐は持たない。`{{#each}}` から render.mjs 経由で呼ばれる。
	vars.__dialogueKeyLabel = (() => {
		const K = globalThis.KeyedDialogueRenderer;
		if (!K) return null;
		const containers = [globalMeta?.General?.$VarsDef, workMeta?.General?.$VarsDef]
			.filter((v) => v && typeof v === 'object')
			.flatMap((varsDef) => Object.entries(varsDef))
			.filter(([name, c]) => name.startsWith('$Def_') && c?.$display?.wrapper === K.WRAPPER_NAME)
			.map(([, c]) => c);
		if (!containers.length) return null;

		return (item, itemLang) => {
			if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
			const context = { workMeta, globalDefType: globalMeta, pageLang: itemLang || lang };
			for (const container of containers) {
				const entries = Array.isArray(container?.$DefType) ? container.$DefType : [];
				const keyName = String(entries.find((e) => e?.$display?.role === 'dialogueKey')?.hashTag || '').trim();
				if (!keyName || !item[keyName]) continue;
				const label = K.buildKeyLabel(item, container, context);
				if (label) return label;
			}
			return '';
		};
	})();

	// 名前系（改行区切りの複数名）は 1 名ずつ鉤括弧で括る形（`「A」または「B」`）へ連結する。
	// 外側の `「` `」` はテンプレが持つため、ここでは名の間だけを `」または「` で繋ぐ（orquote/altquote）。
	// 読み（FormalNameReading）は `（読み：…）` の中に置かれ鉤括弧で括られないため従来の「または」連結。
	vars.FormalName = applyFilter(record.FormalName_JP, 'orquote');
	vars.FormalNameReading = applyFilter(record.FormalName_JPReading, 'orjoin');
	vars.FormalNameCompact = applyFilter(record.FormalName_JP, 'altquote');

	// 設定ブロックの式（displayName → DisplayName 等）を評価
	for (const [k, expr] of Object.entries(config || {})) {
		const varName = k.charAt(0).toUpperCase() + k.slice(1);
		vars[varName] = renderTemplate(expr, { record, vars: { ...vars } }, { finalize: false }).trim();
	}
	// DisplayName に改行（複数名）が残る場合も鉤括弧連結へ（テンプレ側フィルタ取りこぼしの防御）
	if (typeof vars.DisplayName === 'string' && vars.DisplayName.includes('\n')) {
		vars.DisplayName = applyFilter(vars.DisplayName, 'altquote');
	}

	const CC = globalThis.CallingCommon;
	const TR = globalThis.TypeResolver;
	const reg = globalThis.CharacterValueWrapperRegistry;

	// 呼称系（一/二/三人称・主人呼称）を DSL 展開（UI と同一デコード）
	const decodeCalling = (baseKey) => {
		const raw = (typeof record[`${baseKey}_JP`] === 'string' ? record[`${baseKey}_JP`] : record[baseKey]) || '';
		return (CC?.decodeCallingToText && String(raw).trim()) ? CC.decodeCallingToText(raw, { lang }) : '';
	};
	vars.FirstPerson = decodeCalling('FirstPersonCalling');
	vars.SecondPerson = decodeCalling('SecondPersonCalling');
	vars.ThirdPerson = decodeCalling('ThirdPersonCalling');
	vars.ForMaster = decodeCalling('ForMasterCalling');

	// object 値（`{ value, about }` 形式）はプリミティブへアンラップする（GenderType/Age 等）。
	// 判定規則は render.mjs の共通実装に寄せる（`value` 無しで `about` だけを持つ値も拾えるようにするため。
	// 旧実装は `'value' in v` を条件にしていたため `{ about_JP: '不詳' }` を素通しし `[object Object]` になっていた）
	const unwrapValue = (v) => unwrapValueLike(v, lang);

	/**
	 * 数値系フィールド（身長・体重・年齢）を、単位付きの表示テキストへ整形する。
	 *
	 * @description
	 *   これらのフィールドは「素の数値」「`{ value, about }`」「その配列」「`{ hideText }`」を取りうる。
	 *   単位（cm / kg / 歳）をテンプレ側に固定で置くと、補足だけを持つ値（例: 年齢 `{ about_JP: '不詳' }`）が
	 *   「不詳歳」という壊れた文になる。そこで単位の付け外しをここで受け持ち、テンプレは変数を差し込むだけにする。
	 *
	 *   - `value` を持つ要素 … `<value><unit>`（`0` も有効値。例: `0kg`）
	 *   - `value` が無く補足だけ … 補足をそのまま（**単位は付けない**。例: `不詳` / `可変(球体化姿時は…)`）
	 *   - `hideText` … 出力しない（意図的マスク）
	 *   - 複数要素は `・` で連結（例: 本体 42kg ＋ 安全装置 4kg → `42kg・4kg`）
	 * @param {any} raw - レコードの生値
	 * @param {string} unit - 付与する単位（'cm' / 'kg' / '歳'）
	 * @returns {string} 表示テキスト（該当なしなら空文字）
	 */
	const formatMeasure = (raw, unit) => {
		if (raw == null) return '';
		return (Array.isArray(raw) ? raw : [raw])
			.map((item) => {
				// 素の数値・文字列はそのまま単位を付ける
				if (item == null || typeof item !== 'object') return item == null ? '' : `${item}${unit}`;
				if (typeof item.hideText === 'string') return '';
				if ('value' in item && item.value != null && item.value !== '') return `${item.value}${unit}`;
				// 補足だけの値は単位を付けない（「不詳歳」を避ける）
				const about = unwrapValueLike(item, lang);
				return about == null ? '' : String(about);
			})
			.filter((s) => s !== '')
			.join('・');
	};

	/**
	 * `$Def_*` 型の構造化値を、辞書ラベル解決へ渡せるコード値へ平坦化する。
	 *
	 * @description
	 *   例: `Belonging: [{ Faction: '百花繚乱研究所' }]` → `['百花繚乱研究所']`。
	 *   どの子要素をコード値とみなすかは typedef の `$Def_*.$shorthand` 宣言を正とするため、
	 *   ここに field 名ごとの分岐は持たない（旧形式の文字列配列もそのまま通す）。
	 * @param {any} raw - レコードの値
	 * @param {string} defName - `$Def_*` コンテナ名
	 * @returns {any} 平坦化した値
	 */
	const flattenDefShorthand = (raw, defName) => {
		const container = globalMeta?.General?.$VarsDef?.[defName] ?? workMeta?.General?.$VarsDef?.[defName];
		const key = typeof container?.$shorthand === 'string' ? container.$shorthand.trim() : '';
		if (!key) return raw;

		const pick = (item) => (item && typeof item === 'object' && !Array.isArray(item)) ? item[key] : item;
		if (Array.isArray(raw)) return raw.map(pick).filter((v) => v !== null && v !== undefined && v !== '');
		return pick(raw);
	};

	// GenderType / RaceType / Belonging / Class（enum/辞書ラベル解決）。
	// 解決不能な object が `[object Object]` へ文字列化された場合は未対応として省略する。
	const cleanLabel = (s) => (typeof s === 'string' && s && !s.includes('[object Object]')) ? s : '';

	/**
	 * 辞書コード（単体 or 配列）を 1 要素ずつラベル解決し、読点で連結する。
	 *
	 * @description
	 *   `TypeResolver.resolveVarsDefLabel()` は**スカラー専用**（内部で `String(rawValue)` する）。
	 *   配列をそのまま渡すと `Array.prototype.toString()` が働き `"A,B"` という
	 *   辞書に無いコードとして扱われ、ラベル解決されないまま素通りする
	 *   （例: 所属が2件ある錦野姉妹が `セブンティエイト特殊探偵団,第三県立技巧美術女子高校` になる）。
	 *   `$Def_*` の構造化値は `flattenDefShorthand()` でコード値へ落としてから解決する。
	 * @param {string} fieldName - 辞書名（typedef の `$dict` 宣言に対応）
	 * @param {any} raw - レコードの生値（スカラー / 配列 / `$Def_*` オブジェクト）
	 * @param {string} [defName] - `$Def_*` コンテナ名（`$shorthand` を持つ型のみ指定）
	 * @returns {string} 解決済みラベルを `、` で連結した表示テキスト（該当なしなら空文字）
	 */
	const resolveDictLabels = (fieldName, raw, defName = '') => {
		if (!TR) return '';
		const flat = defName ? flattenDefShorthand(unwrapValue(raw), defName) : unwrapValue(raw);
		if (flat === null || flat === undefined || flat === '') return '';
		return (Array.isArray(flat) ? flat : [flat])
			.map((code) => cleanLabel(TR.resolveVarsDefLabel(fieldName, code, globalMeta, workMeta)))
			.filter(Boolean)
			.join('、');
	};

	vars.Gender = cleanLabel(TR ? TR.resolveVarsDefLabel('GenderType', unwrapValue(record.GenderType), globalMeta, workMeta) : '');
	vars.Race = cleanLabel(TR ? TR.resolveVarsDefLabel('RaceType', unwrapValue(record.RaceType), globalMeta, workMeta) : '');
	vars.Belonging = resolveDictLabels('Belonging', record.Belonging, '$Def_Faction');
	// Class は `$dict: "Class"`。辞書側がコード（`Class`）と表示名（`Class_JP`）を分離したため、
	// レコードの生コードを直接差し込むと読み（`1桁番(ユニデジッツ)` の括弧内）が落ちる。
	vars.Class = resolveDictLabels('Class', record.Class);

	// 年齢は Age（無ければ ConceptAge）を採用し、object 値はアンラップして統一する
	const ageRaw = record.Age != null ? record.Age : record.ConceptAge;
	vars.Age = unwrapValue(ageRaw);

	// 単位付きの表示テキスト（テンプレは単位を持たず、これらを差し込むだけにする）
	vars.HeightText = formatMeasure(record.Height_cm, 'cm');
	vars.WeightText = formatMeasure(record.Weight_kg, 'kg');
	vars.AgeText = formatMeasure(ageRaw, '歳');

	// 誕生日（`{ Day: { Month, DayOfMonth } }` 形式）を「M月D日」へ整形
	vars.BirthDay = (() => {
		const bd = record.BirthDay;
		const day = (bd && typeof bd === 'object') ? (bd.Day || bd) : null;
		return (day && day.Month && day.DayOfMonth) ? `${day.Month}月${day.DayOfMonth}日` : '';
	})();

	// TailsUnit（構造化サマリー。配列各要素をサマリー化して連結）
	vars.TailsUnit = (() => {
		const tu = record.TailsUnit;
		if (!Array.isArray(tu) || !tu.length || !reg?.formatWithRegisteredWrapper) return '';
		const wctx = { schemaType: '$Def_TailsUnit', workMeta, globalDefType: globalMeta, pageLang: lang };
		return tu.map((t) => reg.formatWithRegisteredWrapper(t, wctx)).filter(Boolean).join('、');
	})();

	// deep link（直リンク要素＝ファイルキー＝link 優先を使う）
	vars.DeepLink = (() => {
		const val = getByPath(record, pathRoles.fileKey);
		if (val == null || val === '') return '';
		const langSuffix = lang === 'en' ? '&lang=en' : '';
		return `${DEEP_LINK_BASE}?c=${workShort}/${dbShort}/${pathRoles.fileKey}:${val}${langSuffix}`;
	})();

	return vars;
}

/**
 * レコード 1 件分のプロンプト本文を生成する（テンプレ展開のみ。マーカーは付与しない）。
 * @param {string} tpl
 * @param {any} record
 * @param {object} ctx - buildVars と同じ ctx
 * @returns {{text: string, unresolved: boolean}}
 */
export function generatePrompt(tpl, record, ctx) {
	const { config, body } = extractConfigAndBody(tpl);
	const vars = buildVars(record, { ...ctx, config });
	const rendered = renderTemplate(body, { record, vars }, { onMissing: 'drop' });
	// 生成物はマーカーを含まないクリーンな Markdown とする。既存ファイルの再生成は sections.mjs の
	// 見出し（`## 「X」の概要` 等）をアンカーにしたマージ更新で行う（フェーズ2）。
	return { text: rendered, unresolved: hasUnresolvedPlaceholders(rendered) };
}

/**
 * 出力パスを算出する（§出力パス規約: splitFolder でフォルダ分け or ファイル名 suffix）。
 * @param {string} outputRoot - <work>/RoleplayPrompts の絶対パス
 * @param {string} dbShort
 * @param {any} record
 * @param {{folderKey:string, fileKey:string, splitFolder:boolean}} pathRoles
 * @returns {string}
 */
export function computeOutputPath(outputRoot, dbShort, record, pathRoles) {
	const fileVal = sanitizeSegment(getByPath(record, pathRoles.fileKey) ?? '');
	const dbDir = path.join(outputRoot, `DB_${dbShort}`);
	if (pathRoles.splitFolder) {
		const folderVal = sanitizeSegment(getByPath(record, pathRoles.folderKey) ?? '');
		return path.join(dbDir, folderVal, `roleplay-prompt-${fileVal}.md`);
	}
	return path.join(dbDir, `roleplay-prompt-${fileVal}.md`);
}

/**
 * 一時ファイルへ書いてから rename でアトミックに置き換える。既存があれば `.cache/roleplay-backups/`
 * 配下へバックアップを退避してから上書きする（マージ更新の巻き戻し用。`.cache` は Git 管轄外）。
 * @param {string} outPath
 * @param {string} text
 * @param {string} repoRoot
 */
export function writeFileAtomic(outPath, text, repoRoot) {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	if (fs.existsSync(outPath)) {
		const rel = path.relative(repoRoot, outPath).replace(/\\/g, '/');
		const backup = path.join(repoRoot, '.cache', 'roleplay-backups', rel);
		fs.mkdirSync(path.dirname(backup), { recursive: true });
		fs.copyFileSync(outPath, backup);
	}
	const tmp = `${outPath}.tmp`;
	fs.writeFileSync(tmp, text, 'utf8');
	fs.renameSync(tmp, outPath);
}

/**
 * メインエントリ。作品/DB/レコードを走査してプロンプトを生成する。
 * @returns {Promise<void>}
 */
async function main() {
	const args = parseArgs(process.argv.slice(2));
	const lang = args.lang === 'en' ? 'en' : 'jp';
	const client = new CreationsDBClient();
	const globalMeta = await client.getMeta();

	const mode = args.reconcile
		? 'reconcile'
		: args.adopt
			? (args.write ? 'adopt-write' : 'adopt')
			: args.write
				? 'write'
				: args.check
					? 'check'
					: 'plan';
	const report = { mode, lang, generated: [], unchanged: [], reconciled: [], adopted: [], noPrivate: 0, noCpSkip: 0, errors: [] };
	let exitCode = 0;

	const worksList = await client.listWorks();
	for (const w of worksList) {
		const workShort = String(w.key).replace(/^#?Works_/, '');
		if (args.work && workShort !== args.work) continue;

		const outputRoot = path.join(REPO_ROOT, 'data', `Works_${workShort}`, PROMPTS_DIR);
		const tplPath = path.join(outputRoot, TEMPLATE_NAME);
		if (!fs.existsSync(tplPath)) continue; // テンプレ未整備の作品はスキップ

		const tpl = fs.readFileSync(tplPath, 'utf8');
		let workMeta = null;
		try { workMeta = await client.getWorkMeta(workShort); } catch { workMeta = null; }

		let dbs = [];
		try { dbs = await client.listDBs(workShort); } catch { dbs = []; }
		for (const dbInfo of dbs) {
			const dbShort = String(dbInfo.key).replace(/^#?DB_/, '');
			if (args.db && dbShort !== args.db) continue;

			let records = [];
			try { records = await client.getRecords(workShort, dbShort); } catch { continue; }
			const pathRoles = await client.resolveIndexPathRoles(workShort, dbShort);
			const seenPaths = new Map();

			for (const rec of records) {
				if (!hasFilledConversationPattern(rec)) { report.noCpSkip++; continue; }
				const idVal = getByPath(rec, pathRoles.fileKey);
				if (args.id && String(idVal) !== args.id) continue;

				const outPath = computeOutputPath(outputRoot, dbShort, rec, pathRoles);
				const relOut = path.relative(REPO_ROOT, outPath).replace(/\\/g, '/');

				// 出力パス衝突検知（先頭だけで完結と判定したのに非一意だった等）
				if (seenPaths.has(outPath)) {
					report.errors.push({ work: workShort, db: dbShort, id: String(idVal), type: 'collision', path: relOut, other: seenPaths.get(outPath) });
					exitCode = 1;
					continue;
				}
				seenPaths.set(outPath, String(idVal));

				let gen;
				try {
					gen = generatePrompt(tpl, rec, { workShort, dbShort, pathRoles, workMeta, globalMeta, lang, workTitle: w.Title_JP });
				} catch (e) {
					report.errors.push({ work: workShort, db: dbShort, id: String(idVal), type: 'render', message: String(e?.message || e), path: relOut });
					exitCode = 1;
					continue;
				}
				if (gen.unresolved) {
					report.errors.push({ work: workShort, db: dbShort, id: String(idVal), type: 'unresolved', path: relOut });
					exitCode = 1;
					continue;
				}

				// フェーズ3: .private/<id> の手書き実運用プロンプトを対象にした差分（--reconcile）/
				// 取り込み（--adopt）。原本 .private は一切書き換えず、adopt は管理版を生成場所へ書き出す。
				if (args.reconcile || args.adopt) {
					const privPath = path.join(path.dirname(outPath), '.private', path.basename(outPath));
					if (!fs.existsSync(privPath)) { report.noPrivate++; continue; }
					const priv = fs.readFileSync(privPath, 'utf8');
					const merged = mergeByHeadings(priv, gen.text);
					const changed = diffSections(priv, merged).filter((d) => d.status !== 'unchanged');
					const entry = {
						work: workShort, db: dbShort, id: String(idVal),
						private: path.relative(REPO_ROOT, privPath).replace(/\\/g, '/'), path: relOut,
						sections: changed.map((d) => `${d.status}:${d.heading}`),
					};
					if (args.reconcile) {
						report.reconciled.push(entry);
					} else {
						if (args.write) writeFileAtomic(outPath, merged, REPO_ROOT);
						entry.wrote = args.write;
						report.adopted.push(entry);
					}
					continue;
				}

				// 既存があれば見出しアンカーでマージ（テンプレ由来節は DB 最新へ・手書き独自節は保全）。
				// --force のときだけ構造非依存で丸ごと再生成する（脱出口）。
				let finalText = gen.text;
				let action = 'create';
				let changedSections = null;
				if (fs.existsSync(outPath)) {
					const current = fs.readFileSync(outPath, 'utf8');
					// 既存は Windows のワークツリーで CRLF になる。改行コード差だけで毎回「更新あり」に
					// ならないよう、変更判定は LF へ揃えてから行う（書き込む内容は生成物＝LF のまま）。
					const same = (a, b) => normalizeEol(a) === normalizeEol(b);
					if (args.force) {
						action = same(current, finalText) ? 'unchanged' : 'overwrite';
					} else {
						finalText = mergeByHeadings(current, gen.text);
						if (same(finalText, current)) {
							action = 'unchanged';
						} else {
							action = 'merge';
							changedSections = diffSections(current, finalText).filter((d) => d.status !== 'unchanged');
						}
					}
				}

				if (action === 'unchanged') {
					report.unchanged.push({ work: workShort, db: dbShort, id: String(idVal), path: relOut });
					continue;
				}

				if (args.write) writeFileAtomic(outPath, finalText, REPO_ROOT);
				report.generated.push({
					work: workShort, db: dbShort, id: String(idVal), path: relOut,
					bytes: finalText.length, wrote: args.write, action,
					sections: changedSections ? changedSections.map((d) => `${d.status}:${d.heading}`) : undefined,
				});
			}
		}
	}

	// レポート出力（.cache は Git 管轄外）
	const reportPath = args.report
		? path.resolve(REPO_ROOT, args.report)
		: path.join(REPO_ROOT, '.cache', 'roleplay-report.json');
	fs.mkdirSync(path.dirname(reportPath), { recursive: true });
	fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	// サマリ出力
	if (args.reconcile) {
		console.log(`[roleplay] mode=${report.mode} lang=${lang}  reconciled=${report.reconciled.length} noPrivate=${report.noPrivate} noCP=${report.noCpSkip} errors=${report.errors.length}`);
		for (const r of report.reconciled) {
			const n = r.sections.length;
			console.log(`  DRIFT ${r.private}  (${n} 差分)`);
			if (n) console.log(`         sections: ${r.sections.join(', ')}`);
		}
	} else if (args.adopt) {
		console.log(`[roleplay] mode=${report.mode} lang=${lang}  adopted=${report.adopted.length} noPrivate=${report.noPrivate} noCP=${report.noCpSkip} errors=${report.errors.length}`);
		for (const a of report.adopted) {
			console.log(`  ${a.wrote ? 'ADOPT ' : 'PLAN  '} ${a.private} → ${a.path}`);
			if (a.sections.length) console.log(`         sections: ${a.sections.join(', ')}`);
		}
	} else {
		console.log(`[roleplay] mode=${report.mode} lang=${lang}  changed=${report.generated.length} unchanged=${report.unchanged.length} noCP=${report.noCpSkip} errors=${report.errors.length}`);
		for (const g of report.generated) {
			console.log(`  ${g.wrote ? 'WROTE ' : 'PLAN  '}[${g.action}] ${g.path} (${g.bytes}B)`);
			if (g.sections && g.sections.length) console.log(`         sections: ${g.sections.join(', ')}`);
		}
	}
	for (const e of report.errors) console.log(`  ERROR[${e.type}] ${e.work}/${e.db} ${e.id}: ${e.message || e.path}`);
	console.log(`  report: ${path.relative(REPO_ROOT, reportPath).replace(/\\/g, '/')}`);

	// --check: 新規生成予定（差分）があれば CI 失敗
	if (args.check && report.generated.length > 0) exitCode = 1;
	if (exitCode) process.exitCode = exitCode;
}

// テストから import した場合は main() を実行しない
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	main().catch((e) => {
		console.error(e);
		process.exitCode = 1;
	});
}
