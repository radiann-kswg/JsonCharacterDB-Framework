"""tools/deepl_py - DeepL 下書き翻訳ツール（Python 版）

`tools/deepl/*.mjs`（Node.js 版）の CLI と対になる、外部ライブラリ非依存の Python 実装。
用語集の作成・同期（build-glossary-source / sync-glossary）は Node 側に一元化し、
本パッケージは `.cache/deepl/glossary-ids.json`（Node 側が生成した用語集 ID）を読むだけに留める。

詳細: docs/deepl-localization.md
"""
