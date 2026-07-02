#!/usr/bin/env node
/**
 * Аудит slug-ссылок в механиках прод-контента.
 * Запуск: node scripts/audit-refs.mjs
 * Переменные: API_URL (по умолчанию Railway prod)
 */
const API_URL = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

async function fetchAll(path, key, retries = 3) {
  const items = [];
  let page = 1;
  const limit = 100;
  while (true) {
    let batch = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${API_URL}${path}?page=${page}&limit=${limit}`);
        if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
        const data = await res.json();
        batch = data[key] || [];
        break;
      } catch (err) {
        if (attempt === retries) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    items.push(...batch);
    if (batch.length < limit) break;
    page++;
  }
  return items;
}

function buildIndex(items) {
  const bySlug = new Set();
  for (const item of items) {
    if (item.card_number) bySlug.add(item.card_number);
    if (item.id) bySlug.add(item.id);
  }
  return bySlug;
}

function collectRefs(mechanics, source, out = []) {
  if (!mechanics || typeof mechanics !== 'object') return out;
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    const o = node;
    if (o.kind === 'grant_spell' && typeof o.value === 'string') {
      out.push({ kind: 'spell', slug: o.value, source: `${source}${path}` });
    }
    if (o.type === 'feat' && typeof o.value === 'string') {
      out.push({ kind: 'feat', slug: o.value, source: `${source}${path}` });
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk(mechanics, '');
  return out;
}

async function main() {
  console.log(`API: ${API_URL}`);
  const [effects, actions, spells, feats, races, classes, backgrounds] = await Promise.all([
    fetchAll('/api/effects', 'effects'),
    fetchAll('/api/actions', 'actions'),
    fetchAll('/api/spells', 'spells'),
    fetchAll('/api/feats', 'feats'),
    fetchAll('/api/races', 'races'),
    fetchAll('/api/classes', 'classes'),
    fetchAll('/api/backgrounds', 'backgrounds'),
  ]);

  const indexes = {
    spell: buildIndex(spells),
    action: buildIndex(actions),
    effect: buildIndex(effects),
    feat: buildIndex(feats),
  };

  const refs = [];
  for (const e of effects) collectRefs(e.mechanics, `effect:${e.card_number || e.id}`, refs);
  for (const a of actions) collectRefs(a.mechanics, `action:${a.card_number || a.id}`, refs);
  for (const s of spells) collectRefs(s.mechanics, `spell:${s.card_number || s.id}`, refs);
  for (const f of feats) collectRefs(f.mechanics, `feat:${f.card_number || f.id}`, refs);
  for (const r of races) collectRefs(r.mechanics, `race:${r.card_number || r.id}`, refs);
  for (const c of classes) collectRefs(c.mechanics, `class:${c.card_number || c.id}`, refs);
  for (const b of backgrounds) collectRefs(b.mechanics, `background:${b.card_number || b.id}`, refs);

  const unique = new Map();
  for (const r of refs) unique.set(`${r.kind}:${r.slug}`, r);

  const broken = [];
  for (const ref of unique.values()) {
    if (!indexes[ref.kind]?.has(ref.slug)) broken.push(ref);
  }

  console.log(`\nПроверено уникальных ссылок: ${unique.size}`);
  if (broken.length === 0) {
    console.log('✅ Битых slug-ссылок не найдено');
  } else {
    console.log(`❌ Битых ссылок: ${broken.length}`);
    for (const b of broken) console.log(`  [${b.kind}] ${b.slug} ← ${b.source}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
