/**
 * pages/characters.js の構文スモークテスト
 *
 * ブラウザ専用コードのため実行までは行わず、まずは Node の構文検査で
 * 「トップレベルへ不正な return が混入した」類の事故を即検知する。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('pages/characters.js syntax', () => {
  it('passes node syntax check', () => {
    const filePath = path.resolve(process.cwd(), 'pages/characters.js');

    expect(() => {
      execFileSync(process.execPath, ['--check', filePath], {
        stdio: 'pipe'
      });
    }).not.toThrow();
  });
});