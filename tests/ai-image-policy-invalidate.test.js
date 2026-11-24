import { beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ write: vi.fn(), mkdir: vi.fn(), exec: vi.fn() }));
vi.mock('node:fs', async original => ({ ...await original(), writeFileSync: io.write, mkdirSync: io.mkdir }));
vi.mock('node:child_process', () => ({ execFileSync: io.exec }));
import { invalidateAIImagePolicy } from '../pkg/cloudflare/scripts/migrate-common.mjs';
beforeEach(() => vi.clearAllMocks());

it('dry-run では書込みもネットワーク操作も行わない', () => {
  invalidateAIImagePolicy({ repoRoot: '.', bucket: 'test-bucket', dryRun: true });
  expect(io.write).not.toHaveBeenCalled();
  expect(io.exec).not.toHaveBeenCalled();
});

it('同期前に無効な許可表をリモートへ投入し、失敗を握りつぶさない', () => {
  invalidateAIImagePolicy({ repoRoot: '.', bucket: 'test-bucket', dryRun: false });
  expect(JSON.parse(io.write.mock.calls[0][1])).toMatchObject({ complete: false, paths: [], references: [], records: {} });
  expect(io.exec.mock.calls[0][1]).toContain('test-bucket/policy/ai-image-policy.json');
  expect(io.exec.mock.calls[0][1]).toContain('--remote');
  io.exec.mockImplementationOnce(() => { throw new Error('R2 unavailable'); });
  expect(() => invalidateAIImagePolicy({ repoRoot: '.', bucket: 'test-bucket', dryRun: false })).toThrow('R2 unavailable');
});

it('不正なバケット名は子プロセスへ渡さない', () => {
  expect(() => invalidateAIImagePolicy({ repoRoot: '.', bucket: 'bad;command', dryRun: false })).toThrow();
  expect(io.exec).not.toHaveBeenCalled();
});
