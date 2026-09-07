/**
 * Vitest 設定
 *
 * @description
 * 既定のテスト探索範囲から `.cache/` を除外することだけが目的。
 *
 * AGENTS.md は「一時的に生成するキャッシュ・出力ファイルは `./.cache/` 配下に格納する」と定めており、
 * 実際に検証用スクリプトや `npm pack` で取得した配布物の展開先として使われる。
 * 一方 Vitest の既定の探索パターンは `**\/*.{test,spec}.?(c|m)[jt]s?(x)` で `.cache/` も走査するため、
 * **展開した第三者パッケージ側のテストファイルを拾って `npm test` が失敗する**という事故が起きる
 * （実例: `npm pack cytoscape` の展開物に含まれる `playwright-tests/renderer.spec.js` と
 * `tests-examples/demo-todo-app.spec.js` を収集してしまい、2 ファイルが失敗した）。
 *
 * `.cache/` は `.gitignore` 対象でリポジトリの管轄外なので、テスト対象からも外すのが正しい。
 */
import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: [
			...configDefaults.exclude,
			'.cache/**',
			// 完了ログの退避先と個人メモも Git 管轄外なので走査しない
			'_work_in_progress/.completed/**',
			'**/.private/**'
		]
	}
});
