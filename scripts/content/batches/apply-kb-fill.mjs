#!/usr/bin/env node
/**
 * Применяет kb-наполнение (тексты из официальной Книги игрока 2024):
 *   data/kb-output-goliath-gnome.json, kb-output-aasimar-tiefling.json,
 *   kb-output-typos.json     → effects (name/description/detailed_description)
 *   data/kb-output-races.json           → races (description + traits)
 *   data/kb-output-race-descriptions.json → races (description по имени)
 * Запуск: node scripts/content/batches/apply-kb-fill.mjs [--apply]
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { apiRequest, fetchAll, login } from '../api.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
const APPLY = process.argv.includes('--apply');

const load = (f) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), 'utf8')) : null);

async function main() {
  const token = APPLY ? await login() : null;

  // ── Эффекты ──
  const effects = await fetchAll('/api/effects', 'effects');
  const effByCn = new Map(effects.map((e) => [e.card_number, e]));
  const effectFiles = ['kb-output-goliath-gnome.json', 'kb-output-aasimar-tiefling.json', 'kb-output-typos.json'];
  for (const f of effectFiles) {
    const rows = load(f);
    if (!rows) { console.log(`— нет файла ${f}`); continue; }
    for (const r of rows) {
      const e = effByCn.get(r.card_number);
      if (!e) { console.log(`  ✗ эффект не найден: ${r.card_number}`); continue; }
      const patch = {
        name: r.name || e.name,
        description: r.description,
        detailed_description: r.detailed_description ?? null,
      };
      console.log(`  effect ${r.card_number}: «${patch.description.slice(0, 60)}…»`);
      if (r.mechanics_note) console.log(`    ⚠ mechanics_note: ${r.mechanics_note}`);
      if (APPLY) await apiRequest(token, 'PUT', `/api/effects/${e.id}`, patch);
    }
  }

  // ── Расы: traits + description ──
  const races = await fetchAll('/api/races', 'races');
  const raceByCn = new Map(races.map((r) => [r.card_number, r]));
  const raceByName = new Map(races.map((r) => [r.name, r]));

  const fullRaceBody = (race, patch) => ({
    name: race.name, description: race.description || '', image_url: race.image_url || '',
    rarity: race.rarity || 'common', creature_type: race.creature_type, size: race.size,
    speed: race.speed, extra_speeds: race.extra_speeds, darkvision: race.darkvision,
    traits: race.traits, lineages: race.lineages, related_effects: race.related_effects,
    related_actions: race.related_actions, level_progression: race.level_progression,
    type: race.type, author: race.author || 'Admin', source: race.source, tags: race.tags,
    is_extended: race.is_extended, ...patch,
  });

  const raceRows = load('kb-output-races.json') || [];
  for (const r of raceRows) {
    const race = raceByCn.get(r.card_number) || raceByName.get(r.name);
    if (!race) { console.log(`  ✗ раса не найдена: ${r.name}`); continue; }
    console.log(`  race ${race.name}: traits ${r.traits?.length ?? 0}, desc «${(r.description || '').slice(0, 50)}…»`);
    if (APPLY) {
      await apiRequest(token, 'PUT', `/api/races/${race.id}`, fullRaceBody(race, {
        description: r.description || race.description,
        traits: r.traits ?? race.traits,
      }));
    }
  }

  const descRows = load('kb-output-race-descriptions.json') || [];
  for (const r of descRows) {
    const race = raceByName.get(r.name);
    if (!race) { console.log(`  ✗ раса не найдена: ${r.name}`); continue; }
    console.log(`  race-desc ${race.name}: «${r.description.slice(0, 60)}…»`);
    if (APPLY) {
      await apiRequest(token, 'PUT', `/api/races/${race.id}`, fullRaceBody(race, { description: r.description }));
    }
  }

  console.log(APPLY ? 'Готово.' : 'Dry-run (--apply для записи).');
}

main().catch((e) => { console.error(e); process.exit(1); });
