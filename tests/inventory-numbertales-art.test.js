import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

it('許可された実画像を数え、連名参照をまとめ、未確認の形態を空き扱いしない', () => {
  const workspace = resolve('.cache');
  mkdirSync(workspace, { recursive: true });
  const dir = mkdtempSync(join(workspace, 'art-inventory-'));
  try {
    const key = '#Works_NumberTales';
    const image = { path: 'shared.png', is_language_variant: false };
    const work = { ai_training: { allowed_db_keys: ['#DB_Primary'] }, images: [
      image, { path: 'variant.png', is_language_variant: true },
    ] };
    const index = { _generated_at: 'sample', works: { [key]: work }, general_images: [] };
    writeFileSync(join(dir, 'image-index.json'), JSON.stringify(index));
    const record = (badge, arts, db = 'Primary', allowed = true) => ({
      _type: 'character', work_key: key, ai_training: { allowed }, data: { Num_Badge: badge },
      db_source: `data/Works_NumberTales/DataBases/db_${db}.json`, images: { arts },
    });
    const shared = { path: image.path, form: null };
    const rows = [{ generated_at: 'sample' },
      record('01', [shared]), record('02', [{ ...shared, forms: ['humanoid', 'corefolder'], characters: ['02'] }]),
      record('03', [{ path: 'denied.png' }, { path: 'variant.png' }]),
      record('04', [shared], 'Hidden'), record('05', [shared], 'Primary', false),
    ];
    writeFileSync(join(dir, 'manifest-training.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
    const output = JSON.parse(execFileSync(process.execPath, ['tools/inventory-numbertales-art.mjs', dir], { encoding: 'utf8' }));
    expect(output.groups).toEqual({
      'arts・corefolder ともに0枚': ['Primary/03'],
      'arts あり・corefolder 形態の確認待ち': ['Primary/01'],
      'arts の形態確認済み・corefolder 0枚': [],
      'corefolder あり・arts 0枚': [],
      'corefolder 形態・arts ともにあり': ['Primary/02'],
    });
    expect(output.sharedArts).toEqual({ 'shared.png': ['Primary/01', 'Primary/02'] });
    expect(output.confirmedCharacters).toEqual({ 'shared.png': ['02'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
