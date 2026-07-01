import {
  racesApi,
  classesApi,
  backgroundsApi,
  featsApi,
  effectsApi,
  actionsApi,
  spellsApi,
} from '../api/client';
import type { Race, CharacterClass, Background, Feat, PassiveEffect, Action, Spell, LevelProgression } from '../types';
import { collectChoices, type PendingChoice, type ChoiceOrigin } from '../mechanics/collectChoices';
import {
  abilityMod,
  computeMaxHP,
  proficiencyBonusForLevel,
  spellcasting,
  type Spellcasting,
} from './derive';
import { ABILITY_KEYS, type AbilityKey, type CharacterDraft } from './types';

// ─── Сбор ссылок на эффекты/действия из выбранных сущностей ──────────────────

type Ref = { id: string; origin: ChoiceOrigin };

// Источники эффектов/действий: виды (related + по уровням), классы (по уровням),
// черты (related). Предыстории эффектов не добавляют — их вклад через прямые поля.
export function gatherFeatureRefs(
  race: Race | null,
  klass: CharacterClass | null,
  feats: Feat[],
  level: number,
): { effectRefs: Ref[]; actionRefs: Ref[] } {
  const effectRefs: Ref[] = [];
  const actionRefs: Ref[] = [];
  const seenE = new Set<string>();
  const seenA = new Set<string>();
  const pushE = (id: string | undefined, origin: ChoiceOrigin) => {
    if (id && !seenE.has(id)) { seenE.add(id); effectRefs.push({ id, origin }); }
  };
  const pushA = (id: string | undefined, origin: ChoiceOrigin) => {
    if (id && !seenA.has(id)) { seenA.add(id); actionRefs.push({ id, origin }); }
  };
  const addLevelProg = (lp: LevelProgression | null | undefined, origin: ChoiceOrigin) => {
    if (!lp) return;
    for (const [lvl, entry] of Object.entries(lp)) {
      if (Number(lvl) <= level) {
        (entry?.effects || []).forEach((id) => pushE(id, origin));
        (entry?.actions || []).forEach((id) => pushA(id, origin));
      }
    }
  };

  if (race) {
    const origin: ChoiceOrigin = { kind: 'race', id: race.id, name: race.name };
    (race.related_effects || []).forEach((id) => pushE(id, origin));
    (race.related_actions || []).forEach((id) => pushA(id, origin));
    addLevelProg(race.level_progression, origin);
  }
  if (klass) {
    const origin: ChoiceOrigin = { kind: 'class', id: klass.id, name: klass.name };
    addLevelProg(klass.level_progression, origin);
  }
  for (const f of feats) {
    const origin: ChoiceOrigin = { kind: 'feat', id: f.id, name: f.name };
    (f.related_effects || []).forEach((id) => pushE(id, origin));
    (f.related_actions || []).forEach((id) => pushA(id, origin));
  }
  return { effectRefs, actionRefs };
}

// ─── Собранный персонаж ──────────────────────────────────────────────────────

export interface OriginEffect { effect: PassiveEffect; origin: ChoiceOrigin; }
export interface OriginAction { action: Action; origin: ChoiceOrigin; }

export interface AssembledCharacter {
  race: Race | null;
  klass: CharacterClass | null;
  background: Background | null;
  feats: Feat[];
  effects: OriginEffect[];
  actions: OriginAction[];
  spells: Spell[];
  pendingChoices: PendingChoice[];
  featAbilityIncreases: string[]; // информативно (не применяется автоматически в MVP)
  derived: {
    proficiencyBonus: number;
    maxHP: number;
    initiative: number;
    ac: number;
    speed: number;
    abilityMods: Record<AbilityKey, number>;
    spellcasting: Spellcasting;
  };
}

export interface EntityBundle {
  race: Race | null;
  klass: CharacterClass | null;
  background: Background | null;
  feats: Feat[];
  effects: OriginEffect[];
  actions: OriginAction[];
  spells: Spell[];
}

// Чистая сборка из уже загруженных сущностей.
export function assemble(bundle: EntityBundle, draft: CharacterDraft): AssembledCharacter {
  const scores = draft.abilities;
  const pb = proficiencyBonusForLevel(draft.level);

  const pendingChoices: PendingChoice[] = [];
  for (const { effect, origin } of bundle.effects) {
    pendingChoices.push(...collectChoices(effect.mechanics, origin));
  }
  for (const { action, origin } of bundle.actions) {
    pendingChoices.push(...collectChoices(action.mechanics, origin));
  }

  const abilityMods = Object.fromEntries(
    ABILITY_KEYS.map((k) => [k, abilityMod(scores[k])]),
  ) as Record<AbilityKey, number>;

  return {
    race: bundle.race,
    klass: bundle.klass,
    background: bundle.background,
    feats: bundle.feats,
    effects: bundle.effects,
    actions: bundle.actions,
    spells: bundle.spells,
    pendingChoices,
    featAbilityIncreases: bundle.feats.flatMap((f) => f.ability_increase || []),
    derived: {
      proficiencyBonus: pb,
      maxHP: computeMaxHP(bundle.klass?.hit_die, scores.con, draft.level),
      initiative: abilityMod(scores.dex),
      ac: 10 + abilityMod(scores.dex),
      speed: bundle.race?.speed ?? 30,
      abilityMods,
      spellcasting: spellcasting(bundle.klass?.name, scores, pb),
    },
  };
}

// Загружает сущности и связанные эффекты/действия (без заклинаний — их удобнее
// брать из уже загруженного списка редактора). Спелы возвращаются пустыми.
export async function loadBundle(draft: CharacterDraft): Promise<EntityBundle> {
  const [race, klass, background] = await Promise.all([
    draft.raceId ? racesApi.getRace(draft.raceId).catch(() => null) : Promise.resolve(null),
    draft.classId ? classesApi.getClass(draft.classId).catch(() => null) : Promise.resolve(null),
    draft.backgroundId ? backgroundsApi.getBackground(draft.backgroundId).catch(() => null) : Promise.resolve(null),
  ]);

  const feats = (
    await Promise.all((draft.featIds || []).map((id) => featsApi.getFeat(id).catch(() => null)))
  ).filter((f): f is Feat => !!f);

  const { effectRefs, actionRefs } = gatherFeatureRefs(race, klass, feats, draft.level);

  const effects = (
    await Promise.all(
      effectRefs.map((r) =>
        effectsApi.getEffect(r.id).then((effect) => ({ effect, origin: r.origin })).catch(() => null),
      ),
    )
  ).filter((x): x is OriginEffect => !!x);

  const actions = (
    await Promise.all(
      actionRefs.map((r) =>
        actionsApi.getAction(r.id).then((action) => ({ action, origin: r.origin })).catch(() => null),
      ),
    )
  ).filter((x): x is OriginAction => !!x);

  return { race, klass, background, feats, effects, actions, spells: [] };
}

// Загружает все сущности черновика (включая заклинания) и собирает персонажа.
export async function loadAssembly(draft: CharacterDraft): Promise<AssembledCharacter> {
  const bundle = await loadBundle(draft);
  const spells = (
    await Promise.all((draft.spellIds || []).map((id) => spellsApi.getSpell(id).catch(() => null)))
  ).filter((s): s is Spell => !!s);
  return assemble({ ...bundle, spells }, draft);
}
