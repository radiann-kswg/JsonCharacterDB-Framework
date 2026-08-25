# CreationsDB Python モジュール
#
# 100BeautiesLab_CreationsDB をサブモジュールとして導入した
# Python 環境から DB レコードを取得・検索するためのクライアントライブラリ。
# 外部ライブラリに依存せず、標準ライブラリ (json, pathlib, re) のみで動作します。
#
# 動作要件: Python 3.9+

"""
CreationsDB Python クライアントライブラリ

Usage:
    from creationsdb import CreationsDBClient

    db = CreationsDBClient()  # サブモジュール配置時はパス省略可
    works = db.list_works()
    records = db.get_records('NumberTales', 'Primary')

    # インデックスキーはスキーマ ($IndexDef) から自動解決される
    record = db.get_record('FLInvestigator78', 'Primary', 'Major')

非公開（isPrivate / Works_Hidden / DB_Hidden）のデータは既定で除外され、
直接アクセスも CreationsDBNotFoundError で遮断されます。
"""

from .client import CreationsDBClient, CreationsDBNotFoundError

__all__ = ['CreationsDBClient', 'CreationsDBNotFoundError']
__version__ = '1.1.0'
