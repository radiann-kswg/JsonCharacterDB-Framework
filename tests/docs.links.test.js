/**
 * ドキュメントリンク整合性テスト（軽量）
 *
 * - Markdown 内の既知の誤リンク（例: pages/character.html）を検知します。
 * - 仕様/URL は変わり得るため、ここでは「明確に誤りなもの」だけを対象にします。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = dirname(__dirname);

/**
 * リポジトリ内の Markdown を収集
 * @returns {string[]} 絶対パスの配列
 */
function listMarkdownFiles() {
  return globSync('**/*.md', {
    cwd: repoRoot,
    absolute: true,
    // 完了ログ退避先は git 管轄外
    ignore: ['**/node_modules/**', '_work_in_progress/.completed/**'],
  });
}

describe('docs link sanity', () => {
  it('does not contain known broken UI paths', () => {
    const files = listMarkdownFiles();
    expect(files.length).toBeGreaterThan(0);

    const errors = [];
    for (const absPath of files) {
      const rel = absPath.slice(repoRoot.length + 1).replaceAll('\\', '/');
      const txt = readFileSync(absPath, 'utf-8');

      // 旧ログ/説明で混入しやすい誤リンク（正: pages/characters.html）
      if (txt.includes('pages/character.html') || txt.includes('/pages/character.html')) {
        errors.push(`${rel}: contains pages/character.html (expected pages/characters.html)`);
      }

      // `pages/character.html` をコード表記で書いているケース
      if (txt.includes('`pages/character.html`') || txt.includes('`/pages/character.html`')) {
        errors.push(`${rel}: contains \`pages/character.html\``);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Found broken doc paths:\n${errors.join('\n')}`);
    }
  });
});
