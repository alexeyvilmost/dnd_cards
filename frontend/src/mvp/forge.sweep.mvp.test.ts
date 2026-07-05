/**
 * Живой свип кузницы (гейт MVP_CONTENT=1, ходит в прод):
 * КАЖДЫЙ класс и КАЖДАЯ раса (включая подвиды) должны собираться в валидного
 * персонажа при авторазрешении всех выборов реальным конвейером кузницы
 * (loadBundle → assemble → resolveCharacterRules → completionIssues).
 *
 * Ловит: неразрешимые выборы (нет вариантов), error-конфликты правил
 * (инвертированная экспертиза, дубли), битые slug-и grant_spell,
 * отсутствующие recommended_abilities.
 */
import { beforeAll, describe, expect, it } from 'vitest';

// apiClient (axios) читает localStorage в интерсепторе токена — в node его нет.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}
import { assemble, loadBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, ABILITY_KEYS, type AbilityKey, type CharacterDraft } from '../character/types';
import { completionIssues, classSkillChoice } from '../character/forgeHelpers';
import { getSkillGrantSource, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { PendingChoice } from '../mechanics/collectChoices';
import { LANGUAGES, ORIGIN_FEATS, SKILLS } from '../mechanics/registries';
import { bonusOf } from '../character/pointBuy';
import { isEntityUuid } from '../engine/ids';
import type { Background, CharacterClass, Race, Spell } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json();
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

let classes: CharacterClass[] = [];
let races: Race[] = [];
let backgrounds: Background[] = [];
let spellSlugs = new Set<string>();

/** Первые доступные варианты выбора (логика ChoiceList/ChoiceResolver). */
function pickChoiceOptions(
  pc: PendingChoice,
  ruleState: ReturnType<typeof resolveCharacterRules>,
  already: string[],
): string[] {
  const picked: string[] = [...already];
  const need = pc.count - picked.length;
  if (need <= 0) return picked;

  let pool: string[] = [];
  if (pc.source === 'subfeature' || pc.source === 'explicit' || pc.source === 'effect') {
    pool = (pc.items || []).map((it) => it.id);
  } else if (pc.source === 'feat') {
    pool = (pc.items?.length ? pc.items.map((it) => it.id) : ORIGIN_FEATS.map((f) => f.id));
  } else if (pc.source === 'skill') {
    const isExpertise = pc.filter === 'proficient';
    const base = Array.isArray(pc.filter)
      ? (pc.filter as string[])
      : SKILLS.map((s) => s.id);
    pool = base.filter((id) => {
      const granted = !!getSkillGrantSource(ruleState, id);
      return isExpertise ? granted : !granted;
    });
  } else if (pc.source === 'language') {
    pool = LANGUAGES.map((l) => l.id).filter((id) => !ruleState.proficiencies.languages.includes(id));
  } else if (pc.source === 'spell') {
    // выбор заклинаний закрывается отдельно (spellIds), для валидатора
    // достаточно проставить count позиций слагами из фильтра-списка
    pool = Array.isArray(pc.filter) ? (pc.filter as string[]) : [];
  } else {
    pool = (pc.items || []).map((it) => it.id);
  }
  for (const id of pool) {
    if (picked.length >= pc.count) break;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

/**
 * Авторазрешение всех выборов ПОСЛЕДОВАТЕЛЬНО, как это делает игрок:
 * после каждого выбора состояние правил пересчитывается, чтобы дубли
 * навыков отфильтровывались (в UI занятые чипы задизейблены).
 */
async function autoBuild(draft: CharacterDraft): Promise<{
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  issues: string[];
  unresolved: string[];
}> {
  let current = { ...draft, resolvedChoices: { ...draft.resolvedChoices } };
  let assembled: AssembledCharacter = assemble({ ...(await loadBundle(current)), spells: [] }, current);

  for (let pass = 0; pass < 6; pass++) {
    let changed = false;

    // навыки класса — по одному, с пересчётом правил после каждого
    const sc = classSkillChoice(assembled);
    while (sc && current.classSkillChoices.length < sc.count) {
      const ruleState = resolveCharacterRules({ draft: current, assembled });
      const next = sc.options
        .map((o) => o.toLowerCase())
        .find((o) => !getSkillGrantSource(ruleState, o) && !current.classSkillChoices.includes(o));
      if (!next) break;
      current.classSkillChoices = [...current.classSkillChoices, next];
      changed = true;
    }

    for (const pc of assembled.pendingChoices) {
      const sel = current.resolvedChoices[pc.id] || [];
      if (sel.length >= pc.count) continue;
      const ruleState = resolveCharacterRules({ draft: current, assembled });
      const picked = pickChoiceOptions(pc, ruleState, sel);
      if (picked.length !== sel.length) {
        current.resolvedChoices[pc.id] = picked;
        changed = true;
      }
    }
    if (!changed && pass > 0) break;
    assembled = assemble({ ...(await loadBundle(current)), spells: [] }, current);
  }

  // характеристики: рекомендация класса + бонусы предыстории (+2/+1 первым двум)
  const rec = (classes.find((c) => c.id === current.classId)?.recommended_abilities
    ?? {}) as Partial<Record<AbilityKey, number>>;
  const bg = backgrounds.find((b) => b.id === current.backgroundId);
  const bgAb = ((bg?.ability_scores || []) as AbilityKey[]);
  if (bgAb.length >= 2) {
    current.abilityBonuses = {
      mode: 'two_one',
      assignments: { [bgAb[0]]: 2, [bgAb[1]]: 1 },
      anyAbilities: false,
    };
  }
  const abilities: Partial<Record<AbilityKey, number>> = {};
  for (const k of ABILITY_KEYS) {
    abilities[k] = (rec[k] ?? 8) + bonusOf(current.abilityBonuses, k);
  }
  current.abilities = abilities;
  current.name = 'Свип-тест';

  const unresolved = assembled.pendingChoices
    .filter((pc) => (current.resolvedChoices[pc.id] || []).length < pc.count)
    .map((pc) => `${pc.prompt} [${pc.source}] (${(current.resolvedChoices[pc.id] || []).length}/${pc.count})`);

  return { draft: current, assembled, issues: completionIssues(current, assembled), unresolved };
}

describe.skipIf(!RUN)('Свип кузницы: все классы и расы собираются (живой прод)', () => {
  beforeAll(async () => {
    [classes, races, backgrounds] = await Promise.all([
      fetchAll<CharacterClass>('/api/classes', 'classes'),
      fetchAll<Race>('/api/races', 'races'),
      fetchAll<Background>('/api/backgrounds', 'backgrounds'),
    ]);
    const spells = await fetchAll<Spell>('/api/spells', 'spells');
    spellSlugs = new Set(spells.map((s) => s.card_number).filter(Boolean));
  }, 120_000);

  it('каждый класс: авторазрешение выборов → 0 проблем создания', async () => {
    const human = races.find((r) => r.name === 'Человек');
    const bg = backgrounds.find((b) => b.name === 'Стражник') ?? backgrounds[0];
    expect(human && bg).toBeTruthy();

    const failures: string[] = [];
    for (const cls of classes) {
      const draft: CharacterDraft = {
        ...emptyDraft(),
        raceId: human!.id,
        classId: cls.id,
        backgroundId: bg!.id,
      };
      try {
        const res = await autoBuild(draft);
        // страховка от «вхолостую»: loadBundle глотает сетевые ошибки catch(()=>null)
        if (!res.assembled.klass) failures.push(`${cls.name}: bundle не загрузил класс (сеть/apiClient?)`);
        if (!res.assembled.race) failures.push(`${cls.name}: bundle не загрузил вид`);
        // выбор заклинаний в кузнице закрывается отдельным UI — не считаем проблемой валидатора
        const issues = res.issues.filter((i) => !/заклинан|заговор/i.test(i));
        const unresolved = res.unresolved.filter((u) => !u.includes('[spell]'));
        if (issues.length || unresolved.length) {
          failures.push(`${cls.name}: issues=[${issues.join('; ')}] unresolved=[${unresolved.join('; ')}]`);
        }
        if (!cls.recommended_abilities) failures.push(`${cls.name}: нет recommended_abilities`);
      } catch (e) {
        failures.push(`${cls.name}: EXCEPTION ${String(e).slice(0, 160)}`);
      }
    }
    expect(failures, failures.join('\n')).toHaveLength(0);
  }, 600_000);

  it('каждая раса и каждый подвид: выборы разрешимы, слаги заклинаний существуют', async () => {
    const warrior = classes.find((c) => c.card_number === 'CLASS-warrior');
    const bg = backgrounds.find((b) => b.name === 'Благородный') ?? backgrounds[0];

    const failures: string[] = [];
    const combos: Array<{ race: Race; subrace?: Race }> = [];
    for (const race of races.filter((r) => !r.is_subrace)) {
      const subs = races.filter((r) => r.parent_race_id === race.id);
      if (subs.length === 0) combos.push({ race });
      for (const sub of subs) combos.push({ race, subrace: sub });
    }

    for (const { race, subrace } of combos) {
      const label = subrace ? `${race.name} · ${subrace.name}` : race.name;
      const draft: CharacterDraft = {
        ...emptyDraft(),
        raceId: race.id,
        lineageId: subrace?.id ?? null,
        classId: warrior!.id,
        backgroundId: bg!.id,
      };
      try {
        const res = await autoBuild(draft);
        if (!res.assembled.race) failures.push(`${label}: bundle не загрузил вид (сеть/apiClient?)`);
        const issues = res.issues.filter((i) => !/заклинан|заговор/i.test(i));
        const unresolved = res.unresolved.filter((u) => !u.includes('[spell]'));
        if (issues.length || unresolved.length) {
          failures.push(`${label}: issues=[${issues.join('; ')}] unresolved=[${unresolved.join('; ')}]`);
        }
        // выданные заклинания (слаги) должны существовать в БД
        const ruleState = resolveCharacterRules({ draft: res.draft, assembled: res.assembled });
        for (const slug of ruleState.spells.known.filter((s) => !isEntityUuid(s))) {
          if (!spellSlugs.has(slug)) failures.push(`${label}: grant_spell «${slug}» не найден в БД`);
        }
      } catch (e) {
        failures.push(`${label}: EXCEPTION ${String(e).slice(0, 160)}`);
      }
    }
    expect(failures, failures.join('\n')).toHaveLength(0);
  }, 900_000);
});
