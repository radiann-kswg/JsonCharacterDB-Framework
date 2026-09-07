/**
 * 2言語対応フィールド（*_JP / *_EN）の同義解釈テスト
 *
 * - SW 側検索（EnrichmentProcessor.searchRecords）が、hashTag の言語サフィックス違いを
 *   同義として扱い、どちらのクエリでも一致できることを検証します。
 * - TypeDefUtils の bilingual wrapper 関連ユーティリティ（新規）の動作検証も含みます。
 */
import { describe, it, expect } from 'vitest';

// data-common.js は Node/Vitest 環境で globalThis にクラスを公開する
import '../lib/data-common.js';

/** @type {typeof globalThis.EnrichmentProcessor} */
const EnrichmentProcessor = globalThis.EnrichmentProcessor;
/** @type {typeof globalThis.TypeDefUtils} */
const TypeDefUtils = globalThis.TypeDefUtils;

describe('bilingual field interpretation', () => {
  it('treats base / *_JP / *_EN as aliases in searchRecords()', async () => {
    const dataFetcher = {
      readGeneralVarsDefGlobal: async () => ({}),
      readGeneralVarsDefWork: async () => ({}),
      readGlobalType: async () => ({
        $DefType: [
          { hashTag: 'Name_JP', $type: '#String_JP', hashTag_JP: '名前' },
          { hashTag: 'Name_EN', $type: '#String_EN', hashTag_JP: 'Name' },
        ]
      }),
      readWorkType: async () => ({ $DefType: [] }),
    };

    const proc = new EnrichmentProcessor(dataFetcher, {});

    const records = [
      { Num: 1, Name_JP: '太郎' },
      { Num: 2, Name_EN: 'Alice' },
    ];

    // base 名（Name）でクエリしても Name_JP にマッチできる
    {
      const matched = await proc.searchRecords(records, '#Works_Test', 'Primary', [
        { hashTag: 'Name', key: '太郎' }
      ]);
      expect(matched.map(r => r.Num)).toEqual([1]);
    }

    // Name_EN でクエリしても、Name_JP が存在するレコードにマッチできる
    {
      const matched = await proc.searchRecords(records, '#Works_Test', 'Primary', [
        { hashTag: 'Name_EN', key: '太郎' }
      ]);
      expect(matched.map(r => r.Num)).toEqual([1]);
    }

    // Name_JP でクエリしても、Name_EN が存在するレコードにマッチできる
    {
      const matched = await proc.searchRecords(records, '#Works_Test', 'Primary', [
        { hashTag: 'Name_JP', key: 'Alice' }
      ]);
      expect(matched.map(r => r.Num)).toEqual([2]);
    }
  });
});

// ---------------------------------------------------------------------------
// TypeDefUtils bilingual wrapper ユーティリティのテスト（新規）
// ---------------------------------------------------------------------------

describe('TypeDefUtils.stripLangSuffixFromTypeStr', () => {
  it('removes _JP language suffix from type string', () => {
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_JP')).toBe('#String');
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_EN')).toBe('#String');
  });

  it('removes _JP/_EN and preserves modifier + array marker', () => {
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_JP_withAbout[]')).toBe('#String_withAbout[]');
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_EN_withAbout[]')).toBe('#String_withAbout[]');
  });

  it('leaves type strings without lang suffix unchanged', () => {
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String')).toBe('#String');
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_withAbout[]')).toBe('#String_withAbout[]');
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#Number')).toBe('#Number');
  });

  it('processes each token in a union type independently', () => {
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_JP|#Null')).toBe('#String|#Null');
    expect(TypeDefUtils.stripLangSuffixFromTypeStr('#String_JP_withAbout[]|#String_JP[]|#Null')).toBe(
      '#String_withAbout[]|#String[]|#Null'
    );
  });
});

describe('TypeDefUtils.detectBilingualWrapper', () => {
  /** @type {Array} */
  const greetingTypeArray = [
    { hashTag: 'StreamingGreeting_JP', $type: '#String_JP_withAbout[]', hashTag_JP: '配信挨拶(JP)' },
    { hashTag: 'StreamingGreeting_EN', $type: '#String_EN_withAbout[]', hashTag_JP: '配信挨拶(EN)' },
  ];

  /** @type {Array} */
  const nicknameTypeArray = [
    { hashTag: 'ListenerNickname_JP', $type: '#String_JP', hashTag_JP: 'ニックネーム(JP)' },
    { hashTag: 'ListenerNickname_EN', $type: '#String_EN', hashTag_JP: 'Nickname(EN)' },
  ];

  it('detects a _JP/_EN pair array as bilingual wrapper', () => {
    const result = TypeDefUtils.detectBilingualWrapper(greetingTypeArray, { langMode: 'jp' });
    expect(result?.detected).toBe(true);
  });

  it('resolves effective base type by stripping language suffix', () => {
    const result = TypeDefUtils.detectBilingualWrapper(greetingTypeArray, { langMode: 'jp' });
    // '#String_JP_withAbout[]' → '#String_withAbout[]'
    expect(result?.effectiveBaseType).toBe('#String_withAbout[]');
  });

  it('resolves effective base type for plain string type', () => {
    const result = TypeDefUtils.detectBilingualWrapper(nicknameTypeArray, { langMode: 'jp' });
    // '#String_JP' → '#String'
    expect(result?.effectiveBaseType).toBe('#String');
  });

  it('selects JP as primary child when langMode is "jp"', () => {
    const result = TypeDefUtils.detectBilingualWrapper(greetingTypeArray, { langMode: 'jp' });
    expect(result?.primaryChildKey).toBe('StreamingGreeting_JP');
    expect(result?.altChildKey).toBe('StreamingGreeting_EN');
  });

  it('selects EN as primary child when langMode is "en"', () => {
    const result = TypeDefUtils.detectBilingualWrapper(greetingTypeArray, { langMode: 'en' });
    expect(result?.primaryChildKey).toBe('StreamingGreeting_EN');
    expect(result?.altChildKey).toBe('StreamingGreeting_JP');
  });

  it('defaults to jp when langMode is absent', () => {
    const result = TypeDefUtils.detectBilingualWrapper(greetingTypeArray, null);
    expect(result?.langMode).toBe('jp');
    expect(result?.primaryChildKey).toBe('StreamingGreeting_JP');
  });

  it('returns null for non-bilingual array (mixed non-lang entries)', () => {
    const mixedArray = [
      { hashTag: 'Foo_JP', $type: '#String_JP' },
      { hashTag: 'Bar', $type: '#String' },   // 非言語サフィックス
    ];
    expect(TypeDefUtils.detectBilingualWrapper(mixedArray, null)).toBeNull();
  });

  it('returns null for JP-only array (no EN pair)', () => {
    const jpOnly = [
      { hashTag: 'Name_JP', $type: '#String_JP' },
    ];
    expect(TypeDefUtils.detectBilingualWrapper(jpOnly, null)).toBeNull();
  });
});

describe('TypeDefUtils.collectBilingualWrapperPaths', () => {
  it('collects top-level bilingual wrapper fields', () => {
    const entries = [
      {
        hashTag: 'ListenerNickname',
        $type: [
          { hashTag: 'ListenerNickname_JP', $type: '#String_JP' },
          { hashTag: 'ListenerNickname_EN', $type: '#String_EN' },
        ],
        $display: { langMode: 'jp' },
      },
    ];
    const result = TypeDefUtils.collectBilingualWrapperPaths(entries);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('ListenerNickname');
    expect(result[0].effectiveBaseType).toBe('#String');
  });

  it('collects nested bilingual wrapper fields via recursive walk', () => {
    // 親フィールドの $type 配下に置かれた _JP/_EN ペアを検出できることの確認。
    // 実データ（Works_UnibyteLive）の現行例は `StreamingActivity.ListenerNickname`
    // （`StreamingGreeting` 等の配列系は和英共有フィールドへ移行済み）。
    const entries = [
      {
        hashTag: 'StreamingActivity',
        $type: [
          {
            hashTag: 'StreamingCategory',
            $type: '#String_withAbout[]', // non-bilingual
          },
          {
            hashTag: 'StreamingGreeting',
            $type: [
              { hashTag: 'StreamingGreeting_JP', $type: '#String_JP_withAbout[]' },
              { hashTag: 'StreamingGreeting_EN', $type: '#String_EN_withAbout[]' },
            ],
            $display: { langMode: 'jp' },
          },
        ],
      },
    ];
    const result = TypeDefUtils.collectBilingualWrapperPaths(entries);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('StreamingActivity.StreamingGreeting');
    expect(result[0].effectiveBaseType).toBe('#String_withAbout[]');
    expect(result[0].primaryChildKey).toBe('StreamingGreeting_JP');
  });

  it('collects both top-level and nested bilingual wrapper fields', () => {
    const entries = [
      {
        hashTag: 'ListenerNickname',
        $type: [
          { hashTag: 'ListenerNickname_JP', $type: '#String_JP' },
          { hashTag: 'ListenerNickname_EN', $type: '#String_EN' },
        ],
        $display: { langMode: 'jp' },
      },
      {
        hashTag: 'StreamingActivity',
        $type: [
          {
            hashTag: 'StreamingGreeting',
            $type: [
              { hashTag: 'StreamingGreeting_JP', $type: '#String_JP_withAbout[]' },
              { hashTag: 'StreamingGreeting_EN', $type: '#String_EN_withAbout[]' },
            ],
            $display: { langMode: 'jp' },
          },
        ],
      },
    ];
    const result = TypeDefUtils.collectBilingualWrapperPaths(entries);
    const paths = result.map(r => r.path);
    expect(paths).toContain('ListenerNickname');
    expect(paths).toContain('StreamingActivity.StreamingGreeting');
  });
});

describe('TypeDefUtils.pickDisplaySection with bilingual wrapper', () => {
  it('uses effective base type (#String_withAbout[]) for section classification', () => {
    // StreamingGreeting の有効ベース型は '#String_withAbout[]' で、
    // '#Summary' / '#Dialogue' を含まないため 'basic' に分類される（既定）
    const entry = {
      hashTag: 'StreamingGreeting',
      $type: [
        { hashTag: 'StreamingGreeting_JP', $type: '#String_JP_withAbout[]' },
        { hashTag: 'StreamingGreeting_EN', $type: '#String_EN_withAbout[]' },
      ],
      $display: { langMode: 'jp' },
    };
    const section = TypeDefUtils.pickDisplaySection(entry);
    // '#String_withAbout[]' は '#Summary' や '#Dialogue' を含まず、key も profile パターン外
    expect(['basic', 'profile', 'spec', 'images', 'other']).toContain(section);
  });
});

describe('EnrichmentProcessor.enrichRecords: bilingualWrapperFields metadata', () => {
  it('adds _enrichment.bilingualWrapperFields for bilingual wrapper fields', async () => {
    const dataFetcher = {
      readGeneralVarsDefGlobal: async () => ({}),
      readGeneralVarsDefWork: async () => ({}),
      readGlobalType: async () => ({ $DefType: [] }),
      readWorkType: async () => ({
        $DefType: [
          {
            hashTag: 'StreamingActivity',
            $type: [
              {
                hashTag: 'StreamingGreeting',
                $type: [
                  { hashTag: 'StreamingGreeting_JP', $type: '#String_JP_withAbout[]' },
                  { hashTag: 'StreamingGreeting_EN', $type: '#String_EN_withAbout[]' },
                ],
                $display: { langMode: 'jp' },
              },
              {
                hashTag: 'ListenerNickname',
                $type: [
                  { hashTag: 'ListenerNickname_JP', $type: '#String_JP' },
                  { hashTag: 'ListenerNickname_EN', $type: '#String_EN' },
                ],
                $display: { langMode: 'jp' },
              },
            ],
          },
        ],
      }),
    };

    const proc = new EnrichmentProcessor(dataFetcher, {});

    const records = [
      {
        Letter: 'A',
        StreamingActivity: {
          StreamingGreeting: {
            StreamingGreeting_JP: [{ value: 'こんにちは！', about_JP: '配信開始' }],
            StreamingGreeting_EN: [{ value: 'Hello!', about_EN: 'Stream start' }],
          },
          ListenerNickname: {
            ListenerNickname_JP: 'リスナーちゃん',
            ListenerNickname_EN: 'Listener',
          },
        },
      },
    ];

    const enriched = await proc.enrichRecords(records, '#Works_Test', 'Primary');
    const rec = enriched[0];
    const bwFields = rec._enrichment?.bilingualWrapperFields;

    expect(bwFields).toBeDefined();
    expect(Array.isArray(bwFields)).toBe(true);

    const greetingMeta = bwFields.find(f => f.path === 'StreamingActivity.StreamingGreeting');
    expect(greetingMeta).toBeDefined();
    expect(greetingMeta.effectiveBaseType).toBe('#String_withAbout[]');
    expect(greetingMeta.primaryChildKey).toBe('StreamingGreeting_JP');
    expect(greetingMeta.langMode).toBe('jp');

    const nicknameMeta = bwFields.find(f => f.path === 'StreamingActivity.ListenerNickname');
    expect(nicknameMeta).toBeDefined();
    expect(nicknameMeta.effectiveBaseType).toBe('#String');
    expect(nicknameMeta.primaryChildKey).toBe('ListenerNickname_JP');
  });
});
