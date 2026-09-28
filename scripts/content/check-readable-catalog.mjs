import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.join(process.cwd(), 'output/content-readability-20260927');
const before = JSON.parse(await fs.readFile(path.join(out, 'source.json'), 'utf8')).catalogs;
const after = JSON.parse(await fs.readFile(path.join(out, 'preview.json'), 'utf8')).catalogs;
const concepts = new Set(before.concepts.map((row) => row.concept_id));
const strip = (value) => (value || '')
  .replace(/\[\[([^|]+)\|[^\]]+\]\]/g, '$1')
  .replace(/\[([a-z_]+)\]([\s\S]*?)\[\/\1\]/g, '$2')
  .replace(/:[a-z_]+:/g, '')
  .replace(/\*\*|__|\*/g, '')
  .replace(/\s+/g, ' ').trim().replace(/КЗ/g, 'КД');
const problems = [];
let links = 0;
let damageIcons = 0;
let resourceIcons = 0;
for (const kind of ['spells', 'feats', 'actions', 'effects']) {
  let changed = 0;
  let moved = 0;
  for (let i = 0; i < after[kind].length; i++) {
    const old = before[kind][i];
    const next = after[kind][i];
    if (!next.name_en?.trim()) problems.push(`${kind}/${old.card_number}: English title missing`);
    if (/[А-Яа-яЁё]/.test(next.name_en || '')) problems.push(`${kind}/${old.card_number}: English title contains Cyrillic`);
    if ((next.name_en || '').length > 255) problems.push(`${kind}/${old.card_number}: English title exceeds column`);
    if (!["Player's Handbook", "Master's Guide", 'Monster Manual', 'Bag of Holding'].includes(next.source)) {
      problems.push(`${kind}/${old.card_number}: source ${next.source}`);
    }
    const wasNameOnly = (kind === 'actions' || kind === 'effects') && (!old.description || old.description.trim() === old.name.trim());
    const hadDetail = Boolean(old.detailed_description);
    const relocated = !hadDetail && next.detailed_description && next.description !== old.description;
    if (relocated) moved++;
    if (old.description !== next.description) changed++;
    if (!wasNameOnly && !(kind === 'spells' && /^.*?\) Длительность:/.test(old.description || ''))) {
      const actual = relocated ? next.detailed_description : next.description;
      if (!relocated && hadDetail && old.description.length > (kind === 'spells' || kind === 'feats' ? 400 : 620)) {
        // Existing short description is replaced with an essence; the original full rules stay in detail.
      } else if (strip(old.description) !== strip(actual)) {
        problems.push(`${kind}/${old.card_number}: text changed outside markup`);
      }
    }
    if (kind === 'spells' && next.description.length > 500) problems.push(`${kind}/${old.card_number}: main description too long`);
    if (kind === 'feats' && next.description.length > 500 && !next.detailed_description) problems.push(`${kind}/${old.card_number}: long feat without detailed description`);
    if (wasNameOnly && strip(next.description) === old.name) problems.push(`${kind}/${old.card_number}: not enriched`);
    for (const field of ['description', 'detailed_description', 'upcast_description']) {
      const text = next[field] || '';
      if ((text.match(/\*\*/g) || []).length % 2) problems.push(`${kind}/${old.card_number}/${field}: odd bold markers`);
      if ((text.match(/__/g) || []).length % 2) problems.push(`${kind}/${old.card_number}/${field}: odd underline markers`);
      if (/:(?:action|bonus_action|reaction)::(?:action|bonus_action|reaction):/.test(text)) problems.push(`${kind}/${old.card_number}/${field}: duplicate action icon`);
      for (const link of text.matchAll(/\[\[[^|]+\|concept:([^\]]+)\]\]/g)) {
        links++;
        if (!concepts.has(link[1])) problems.push(`${kind}/${old.card_number}/${field}: unknown concept ${link[1]}`);
      }
      damageIcons += (text.match(/:(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder|bludgeoning|piercing|slashing):/g) || []).length;
      resourceIcons += (text.match(/:(?:action|bonus_action|reaction):/g) || []).length;
    }
  }
  console.log(`${kind}: ${after[kind].length} rows, ${changed} main descriptions revised, ${moved} full texts moved`);
}
const localPath = path.join(out, 'local-final.json');
if (await fs.stat(localPath).catch(() => null)) {
  const local = JSON.parse(await fs.readFile(localPath, 'utf8'));
  for (const kind of ['spells', 'feats', 'actions', 'effects']) {
    if (local[kind].length !== after[kind].length) problems.push(`local ${kind}: row count mismatch`);
    for (const row of local[kind]) {
      if (!row.name_en?.trim() || /[А-Яа-яЁё]/.test(row.name_en)) problems.push(`local ${kind}/${row.card_number}: invalid English title`);
      if (!["Player's Handbook", "Master's Guide", 'Monster Manual', 'Bag of Holding'].includes(row.source)) problems.push(`local ${kind}/${row.card_number}: invalid source`);
      if ((kind === 'spells' || kind === 'feats') && row.description.length > 500 && !row.detailed_description) problems.push(`local ${kind}/${row.card_number}: long main text without details`);
      if ((kind === 'actions' || kind === 'effects') && (!row.description || row.description.trim() === row.name.trim())) problems.push(`local ${kind}/${row.card_number}: name-only description`);
      for (const field of ['description', 'detailed_description', 'upcast_description']) {
        const value = row[field] || '';
        if ((value.match(/\*\*/g) || []).length % 2) problems.push(`local ${kind}/${row.card_number}/${field}: odd bold markers`);
        if ((value.match(/__/g) || []).length % 2) problems.push(`local ${kind}/${row.card_number}/${field}: odd underline markers`);
        for (const link of value.matchAll(/\[\[[^|]+\|concept:([^\]]+)\]\]/g)) {
          if (!concepts.has(link[1])) problems.push(`local ${kind}/${row.card_number}/${field}: unknown concept ${link[1]}`);
        }
      }
    }
  }
  console.log('local database snapshot: checked');
}
console.log({ links, damageIcons, resourceIcons, problems: problems.length });
if (problems.length) {
  console.log(problems.slice(0, 100).join('\n'));
  process.exitCode = 1;
}
