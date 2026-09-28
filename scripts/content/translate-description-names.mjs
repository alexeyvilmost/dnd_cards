// Draft English labels for names without an existing/original match.
// This is a read-only translation lookup; the output is reviewed by the content builder.
import fs from 'node:fs/promises';

const directory = process.argv[2];
if (!directory) throw new Error('Pass the local editorial output directory');
const source = JSON.parse(await fs.readFile(`${directory}/source.json`, 'utf8')).catalogs;
const official = JSON.parse(await fs.readFile(`${directory}/english-reference.json`, 'utf8'));
const path = `${directory}/english-fallback.json`;
let translated = {};
try { translated = JSON.parse(await fs.readFile(path, 'utf8')); } catch { /* new lookup */ }
const names = [...new Set(['spells', 'feats', 'actions', 'effects']
  .flatMap((catalog) => source[catalog])
  .filter((entry) => !entry.name_en && !official[entry.name.trim().toLowerCase()])
  .map((entry) => entry.name))].filter((name) => !translated[name]);
for (let offset = 0; offset < names.length; offset += 10) {
  const batch = names.slice(offset, offset + 10);
  const query = batch.map((name, index) => `${index} | ${name}`).join('\n');
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t&q='
    + encodeURIComponent(query);
  let lines;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      lines = body[0].map((segment) => segment[0]).join('').split('\n');
      if (lines.length !== batch.length) throw new Error(`Expected ${batch.length} lines, got ${lines.length}`);
      break;
    } catch (error) {
      if (attempt === 2) throw new Error(`Translate batch ${offset}: ${error}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  for (let index = 0; index < batch.length; index++) {
    const match = lines[index].match(/^\s*\d+\s*\|\s*(.*)$/);
    if (!match) throw new Error(`Unmapped translation: ${lines[index]}`);
    translated[batch[index]] = match[1].trim();
  }
  await fs.writeFile(path, `${JSON.stringify(translated, null, 2)}\n`);
  if ((offset / 10) % 10 === 0) console.log(`${Math.min(offset + batch.length, names.length)}/${names.length}`);
}
console.log(`Translated ${Object.keys(translated).length} unique names`);
