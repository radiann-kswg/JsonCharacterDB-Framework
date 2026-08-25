"""
pronoun_normalize.py - GenderType に基づく代名詞の確定的正規化・簡易警告検知（Python 版）

`tools/deepl/pronoun-normalize.mjs` の移植。DeepL は LLM ではなく NMT のため、翻訳結果の
代名詞は「指示」で確実に統一できない。このモジュールは `docs/localization-en-rules.md` §1
（代名詞ルール）をコードに落とし込み、レコードの `GenderType` に基づいて DeepL の生訳文から
代名詞トークンを機械的に正規化する。あわせて、自動修正が危険な 2 種類の不整合
（一人称の混入・呼称の不一致）は書き換えず「検知して警告するだけ」に留める
（文法崩壊やレコード固有の呼称誤爆を避けるため）。

`draft_translate.py` から利用する。ネットワーク I/O は行わない純粋関数のみ。
動作要件: Python 3.9+（外部ライブラリ依存なし）
"""

from __future__ import annotations

import re
from typing import Literal, Optional

Policy = Literal["she", "he", "ze", "avoid"]


def pronoun_policy_for_gender_type(gender_type: Optional[str]) -> Policy:
    """GenderType から代名詞ポリシーを決定する（`docs/localization-en-rules.md` §1 準拠）。"""
    if gender_type in ("FemaleNeutral", "Female"):
        return "she"
    if gender_type in ("MaleNeutral", "Male"):
        return "he"
    if gender_type == "Neutral":
        return "ze"
    return "avoid"


# 代名詞トークン → 文法役割。'her' / 'zir' は目的格・所有格で綴りが同じため ambiguous とする。
# they/them/their/theirs/themselves（singular they）も対象に含める。
# Neutral（ze ポリシー）では they 系も ze/zir へ強制変換する
# （`docs/localization-en-rules.md` §1「Neutral は they/them・he/she・him/her を使わない」に従う）。
_ROLE_OF = {
    "he": "subject",
    "him": "object",
    "his": "possessive",
    "himself": "reflexive",
    "she": "subject",
    "her": "ambiguous",
    "hers": "possessive-standalone",
    "herself": "reflexive",
    "they": "subject",
    "them": "object",
    "their": "possessive",
    "theirs": "possessive-standalone",
    "themselves": "reflexive",
    "ze": "subject",
    "zir": "ambiguous",
    "zirself": "reflexive",
}

# 文法役割 → ポリシー別トークン（`docs/localization-en-rules.md` §1-1 の ze/zir 活用表準拠）。
_FORMS: dict[str, dict[str, str]] = {
    "he": {"subject": "he", "object": "him", "possessive": "his", "possessive-standalone": "his", "reflexive": "himself"},
    "she": {"subject": "she", "object": "her", "possessive": "her", "possessive-standalone": "hers", "reflexive": "herself"},
    "ze": {"subject": "ze", "object": "zir", "possessive": "zir", "possessive-standalone": "zir", "reflexive": "zirself"},
}

_TOKEN_RE = re.compile(
    r"\b(he|him|his|himself|she|her|hers|herself|they|them|their|theirs|themselves|ze|zir|zirself)('s|'ll|'d|'re|'ve)?\b",
    re.IGNORECASE,
)

# be/have/do 系の助動詞・引用動詞が続く場合は「〜は」（主語相当の目的格用法）とみなす
_VERB_LIKE = {
    "is", "was", "will", "would", "has", "had", "did", "does",
    "said", "says", "asked", "told", "looked", "smiled", "seemed",
}
_NEXT_WORD_RE = re.compile(r"^\s*([A-Za-z][A-Za-z'\-]*)")


def _resolve_ambiguous_role(text: str, after_index: int) -> str:
    """直後の語から `her` / `zir` の目的格・所有格を簡易推定する（辞書的ヒューリスティック）。"""
    after = text[after_index:]
    m = _NEXT_WORD_RE.match(after)
    if not m:
        return "object"
    next_word = m.group(1).lower()
    return "object" if next_word in _VERB_LIKE else "possessive"


def _capitalize_like(sample: str, word: str) -> str:
    if sample and sample[0].isalpha() and sample[0] == sample[0].upper():
        return word[0].upper() + word[1:]
    return word


class NormalizeResult:
    """`normalize_pronouns()` の戻り値。dict のようにも属性のようにもアクセスできる薄いラッパー。"""

    __slots__ = ("text", "changed", "they_subject_converted")

    def __init__(self, text: str, changed: bool, they_subject_converted: bool) -> None:
        self.text = text
        self.changed = changed
        self.they_subject_converted = they_subject_converted

    def __iter__(self):
        # `text, changed, converted = normalize_pronouns(...)` のようなアンパックも許容する
        return iter((self.text, self.changed, self.they_subject_converted))

    def __repr__(self) -> str:  # pragma: no cover - デバッグ用
        return (
            f"NormalizeResult(text={self.text!r}, changed={self.changed!r}, "
            f"they_subject_converted={self.they_subject_converted!r})"
        )


def normalize_pronouns(text: Optional[str], target_policy: Policy) -> NormalizeResult:
    """
    英文中の代名詞トークンを target_policy へ強制変換する。
    `avoid` の場合は変換せずそのまま返す（代名詞を避けるルールは自動書き換えでは実現できないため）。

    **既知の制約**: `they/them`（singular they）を主語として変換した場合、対応する be/have/do 動詞
    （are→is 等）の一致は自動修正しない（"they" が本当に複数を指している可能性を捨てきれず、
    誤った文法修正で意味を変えるリスクの方が高いため）。この場合 `they_subject_converted=True` を返すので、
    呼び出し側（`draft_translate.py`）はこれを警告として提示し、動詞一致は人間が確認すること。
    """
    if target_policy == "avoid" or not isinstance(text, str) or not text:
        return NormalizeResult(text, False, False)

    changed = False
    they_subject_converted = False

    def _sub(m: re.Match) -> str:
        nonlocal changed, they_subject_converted
        base = m.group(1)
        suffix = m.group(2) or ""
        lower = base.lower()
        role = _ROLE_OF[lower]
        if role == "ambiguous":
            role = _resolve_ambiguous_role(text, m.end(1))
        if lower == "they" and role == "subject":
            they_subject_converted = True
        forms = _FORMS[target_policy]
        replacement = forms.get(role, forms["object"])
        cased = _capitalize_like(base, replacement) + suffix
        if cased.lower() != m.group(0).lower():
            changed = True
        return cased

    out = _TOKEN_RE.sub(_sub, text)
    return NormalizeResult(out, changed, they_subject_converted)


_FIRST_PERSON_RE = re.compile(r"\b(I|my|me|mine|myself)\b")


def detect_first_person_leakage(text: Optional[str]) -> list[str]:
    """一人称の混入トークンを検知する（書き換えはしない。文法崩壊のリスクがあるため人手確認に回す）。"""
    if not isinstance(text, str):
        return []
    seen: dict[str, None] = {}
    for m in _FIRST_PERSON_RE.finditer(text):
        seen.setdefault(m.group(1), None)
    return list(seen.keys())


_CALLING_MARKER_WORDS = [
    "big", "bro", "sis", "brother", "sister",
    "master", "boss", "leader", "senpai", "sensei",
]


def detect_calling_term_mismatch(text: Optional[str], established_en: Optional[str]) -> list[str]:
    """
    訳文に、そのキャラの確定済み呼称（例: `ForMasterCalling_EN`）に含まれない
    呼称語（bro/sis 等）が現れていないかを検知する簡易ヒューリスティック。
    誤検知はあり得るため「候補提示」用途に限定し、自動置換はしない。
    """
    if not isinstance(text, str) or not text or not established_en:
        return []
    established_lower = established_en.lower()
    hits = []
    for w in _CALLING_MARKER_WORDS:
        if re.search(rf"\b{re.escape(w)}\b", text, re.IGNORECASE) and w not in established_lower:
            hits.append(w)
    return hits
