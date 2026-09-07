/**
 * tools/deepl/pronoun-normalize.mjs の純粋関数テスト
 *
 * - GenderType → 代名詞ポリシー解決（docs/localization-en-rules.md §1 準拠）
 * - 代名詞トークンの確定的正規化（she/he/ze/avoid）
 * - 一人称混入・呼称不一致の検知（書き換えなし、警告検知のみ）
 *
 * ネットワーク I/O（DeepL API 呼び出し）は対象外。
 */
import { describe, it, expect } from 'vitest';
import {
  pronounPolicyForGenderType,
  normalizePronouns,
  detectFirstPersonLeakage,
  detectCallingTermMismatch,
} from '../tools/deepl/pronoun-normalize.mjs';

describe('pronounPolicyForGenderType', () => {
  it('maps GenderType to the documented pronoun policy', () => {
    expect(pronounPolicyForGenderType('FemaleNeutral')).toBe('she');
    expect(pronounPolicyForGenderType('Female')).toBe('she');
    expect(pronounPolicyForGenderType('MaleNeutral')).toBe('he');
    expect(pronounPolicyForGenderType('Male')).toBe('he');
    expect(pronounPolicyForGenderType('Neutral')).toBe('ze');
    expect(pronounPolicyForGenderType(undefined)).toBe('avoid');
    expect(pronounPolicyForGenderType('SomethingUnknown')).toBe('avoid');
  });
});

describe('normalizePronouns', () => {
  it('rewrites he-family pronouns to she-family (FemaleNeutral)', () => {
    const { text, changed } = normalizePronouns(
      "He is lively; his tone and himself became more enthusiastic.",
      'she',
    );
    expect(text).toBe('She is lively; her tone and herself became more enthusiastic.');
    expect(changed).toBe(true);
  });

  it('rewrites he-family and she-family pronouns to ze/zir (Neutral)', () => {
    const { text } = normalizePronouns(
      "He offered his help, and she admired her work herself.",
      'ze',
    );
    expect(text).toBe('Ze offered zir help, and ze admired zir work zirself.');
  });

  it('preserves contractions like "he\'s" when rewriting', () => {
    const { text } = normalizePronouns("He's quite eager to help.", 'she');
    expect(text).toBe("She's quite eager to help.");
  });

  it('resolves ambiguous "her" as possessive when followed by a noun', () => {
    const { text } = normalizePronouns('I admired her vocabulary.', 'ze');
    expect(text).toBe('I admired zir vocabulary.');
  });

  it('resolves ambiguous "her" as object when followed by an auxiliary verb', () => {
    const { text } = normalizePronouns('Everyone agreed her was right.', 'ze');
    expect(text).toBe('Everyone agreed zir was right.');
  });

  it('rewrites singular "they/them" pronouns to ze/zir (Neutral disallows they/them per §1)', () => {
    // 代名詞トークン自体は変換するが、be/have/do 動詞の一致（are→is 等）は自動修正しない
    // （they が本当に複数を指す可能性を捨てきれないため）。theySubjectConverted で警告フラグを返す。
    const { text, changed, theySubjectConverted } = normalizePronouns(
      "They are full of energy; their tone shows it themselves.",
      'ze',
    );
    expect(text).toBe('Ze are full of energy; zir tone shows it zirself.');
    expect(changed).toBe(true);
    expect(theySubjectConverted).toBe(true);
  });

  it('does not flag theySubjectConverted when no "they" subject was involved', () => {
    const { theySubjectConverted } = normalizePronouns('He is lively and his tone is enthusiastic.', 'she');
    expect(theySubjectConverted).toBe(false);
  });

  it('leaves text untouched when policy is "avoid"', () => {
    const input = 'He is lively and his tone is enthusiastic.';
    const { text, changed } = normalizePronouns(input, 'avoid');
    expect(text).toBe(input);
    expect(changed).toBe(false);
  });

  it('is idempotent when the text already matches the target policy', () => {
    const input = 'She is lively; her tone and herself became more enthusiastic.';
    const { text, changed } = normalizePronouns(input, 'she');
    expect(text).toBe(input);
    expect(changed).toBe(false);
  });
});

describe('detectFirstPersonLeakage', () => {
  it('flags leaked first-person pronouns without rewriting', () => {
    expect(detectFirstPersonLeakage('I actively offer suggestions based on my skills.')).toEqual(
      expect.arrayContaining(['I', 'my']),
    );
  });

  it('returns an empty array when no first-person pronoun is present', () => {
    expect(detectFirstPersonLeakage('She actively offers suggestions based on her skills.')).toEqual([]);
  });
});

describe('detectCallingTermMismatch', () => {
  it('flags a generic calling phrase not present in the established term', () => {
    const hits = detectCallingTermMismatch(
      'Big bro, I\'m counting on you!',
      'Bro/Sis (aniki/aneki)',
    );
    expect(hits).toContain('big');
  });

  it('does not flag when the established term already covers the wording', () => {
    const hits = detectCallingTermMismatch(
      'Bro/sis, let me see that!',
      'Bro/Sis (aniki/aneki)',
    );
    expect(hits).toEqual([]);
  });

  it('returns an empty array when no established term is available', () => {
    expect(detectCallingTermMismatch('Big bro, nice to meet you!', undefined)).toEqual([]);
  });
});
