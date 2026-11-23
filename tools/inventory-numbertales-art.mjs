/**
 * NumberTales の制作候補と合同絵の確認候補を、CreationsAI の検証済み出力から集計する。
 * 実行例: node tools/inventory-numbertales-art.mjs ../100BeautiesLab_CreationsAI/ai-dataset
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [directory] = process.argv.slice(2);
if (!directory || process.argv.length !== 3) throw new Error('検証済み ai-dataset のディレクトリを1つ指定してください');
const workKey = '#Works_NumberTales';
const index = JSON.parse(readFileSync(join(directory, 'image-index.json'), 'utf8'));
const lines = readFileSync(join(directory, 'manifest-training.jsonl'), 'utf8').trim().split(/\r?\n/);
const [header, ...records] = lines.map(line => JSON.parse(line));
if (!index._generated_at || index._generated_at !== header.generated_at) {
  throw new Error('同じビルドで生成した image-index と manifest-training を指定してください');
}
const allowedDbs = new Set(index.works[workKey].ai_training.allowed_db_keys);
// 別作品を指す合同絵も、権利判定済みの実パスで照合する。言語差分は枚数に含めない。
const indexedImages = Object.values(index.works).flatMap(work => [...work.images, ...(work.references ?? [])]);
const allowedImages = new Set([...indexedImages, ...index.general_images]
  .filter(image => image.is_language_variant === false).map(image => image.path));
const shared = new Map();
const confirmedCharacters = new Map();
const groups = {
  'arts・corefolder ともに0枚': [],
  'arts あり・corefolder 形態の確認待ち': [],
  'arts の形態確認済み・corefolder 0枚': [],
  'corefolder あり・arts 0枚': [],
  'corefolder 形態・arts ともにあり': [],
};

for (const record of records) {
  if (record._type !== 'character' || record.work_key !== workKey || record.ai_training?.allowed !== true) continue;
  const db = /^data\/Works_NumberTales\/DataBases\/db_(\w+)\.json$/.exec(record.db_source)?.[1];
  if (!allowedDbs.has(`#DB_${db}`)) continue;
  const badge = String(record.data.Num_Badge ?? record.data.Num);
  const character = `${db}/${badge}`;
  const arts = (record.images?.arts ?? []).filter(art => allowedImages.has(art.path));
  const hasCore = (record.images?.corefolder ?? []).some(path => allowedImages.has(path))
    || arts.some(art => art.form === 'corefolder' || art.forms?.includes('corefolder'));
  if (!arts.length) {
    groups[hasCore ? 'corefolder あり・arts 0枚' : 'arts・corefolder ともに0枚'].push(character);
  } else if (!hasCore && arts.every(art => art.form || art.forms?.length)) {
    groups['arts の形態確認済み・corefolder 0枚'].push(character);
  } else {
    groups[hasCore ? 'corefolder 形態・arts ともにあり' : 'arts あり・corefolder 形態の確認待ち'].push(character);
  }
  for (const { path, characters } of arts) {
    if (!shared.has(path)) shared.set(path, new Set());
    shared.get(path).add(character);
    if (Array.isArray(characters)) {
      if (!confirmedCharacters.has(path)) confirmedCharacters.set(path, new Set());
      for (const id of characters) confirmedCharacters.get(path).add(id);
    }
  }
}

// ギャラリーで同じ絵を参照するレコードは、登場人物を確認するための候補として出力する。
const sharedArts = Object.fromEntries([...shared].filter(([, owners]) => owners.size > 1)
  .map(([path, owners]) => [path, [...owners]]));
console.log(JSON.stringify({ source: header.submodule_commit, groups, sharedArts,
  confirmedCharacters: Object.fromEntries([...confirmedCharacters].map(([path, ids]) => [path, [...ids]])),
}, null, 2));
