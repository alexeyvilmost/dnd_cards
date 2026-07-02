#!/usr/bin/env node
/**
 * Аудит контента Фазы A5: дубли черт, ру-строки владений, пустые lineages.
 * Запуск: node scripts/audit-content.mjs
 */
const API_URL = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const CYRILLIC = /[а-яА-ЯёЁ]/;

async function fetchAll(path, key) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${API_URL}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = data[key] || [];
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return items;
}

async function main() {
  console.log(`API: ${API_URL}`);
  const issues = [];

  const feats = await fetchAll('/api/feats', 'feats');
  const byName = new Map();
  for (const f of feats) {
    const key = (f.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(f.card_number || f.id);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) issues.push(`Дубли черт «${name}»: ${ids.join(', ')}`);
  }

  const backgrounds = await fetchAll('/api/backgrounds', 'backgrounds');
  for (const b of backgrounds) {
    const skills = b.skill_proficiencies || [];
    for (const s of skills) {
      if (typeof s === 'string' && CYRILLIC.test(s)) {
        issues.push(`Предыстория ${b.card_number || b.id}: skill_proficiencies содержит «${s}» (нужен id)`);
      }
    }
    if (b.origin_feat && CYRILLIC.test(String(b.origin_feat))) {
      issues.push(`Предыстория ${b.card_number || b.id}: origin_feat «${b.origin_feat}» похож на название, не slug`);
    }
  }

  const races = await fetchAll('/api/races', 'races');
  for (const r of races) {
    const lineages = r.lineages;
    if (lineages && typeof lineages === 'object' && !Array.isArray(lineages)) {
      const items = lineages.items || lineages.options || [];
      if (Array.isArray(items) && items.length === 0) {
        issues.push(`Вид ${r.card_number || r.id}: пустые lineages`);
      }
    }
  }

  if (issues.length === 0) {
    console.log('✅ Аудит контента: замечаний нет');
  } else {
    console.log(`❌ Замечаний: ${issues.length}`);
    for (const i of issues) console.log(`  - ${i}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
