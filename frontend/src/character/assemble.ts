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
import { createRegistry } from '../engine/registry';
import { createApiResolver } from '../engine/apiResolver';
import { isEntityUuid } from '../engine/ids';
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
  subrace?: Race | null,
  subclass?: CharacterClass | null,
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
  if (subrace) {
    // Подвид работает как вид: его эффекты/действия добавляются с race-источником.
    const origin: ChoiceOrigin = { kind: 'race', id: subrace.id, name: subrace.name };
    (subrace.related_effects || []).forEach((id) => pushE(id, origin));
    (subrace.related_actions || []).forEach((id) => pushA(id, origin));
    addLevelProg(subrace.level_progression, origin);
  }
  if (klass) {
    const origin: ChoiceOrigin = { kind: 'class', id: klass.id, name: klass.name };
    addLevelProg(klass.level_progression, origin);
  }
  if (subclass) {
    // Подкласс работает как класс: его эффекты/действия добавляются с class-источником.
    const origin: ChoiceOrigin = { kind: 'class', id: subclass.id, name: subclass.name };
    (subclass.related_effects || []).forEach((id) => pushE(id, origin));
    (subclass.related_actions || []).forEach((id) => pushA(id, origin));
    addLevelProg(subclass.level_progression, origin);
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
  subclass?: CharacterClass | null;
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
  subclass?: CharacterClass | null;
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
    pendingChoices.push(...collectChoices(effect.mechanics, { ...origin, featureId: effect.id, featureName: effect.name }));
  }
  for (const { action, origin } of bundle.actions) {
    pendingChoices.push(...collectChoices(action.mechanics, { ...origin, featureId: action.id, featureName: action.name }));
  }

  const abilityMods = Object.fromEntries(
    ABILITY_KEYS.map((k) => [k, abilityMod(scores[k])]),
  ) as Record<AbilityKey, number>;

  return {
    race: bundle.race,
    klass: bundle.klass,
    subclass: bundle.subclass ?? null,
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

  // Подвид — отдельный вид-сущность, ссылка хранится в draft.lineageId (UUID).
  const subraceId = draft.lineageId && isEntityUuid(draft.lineageId) ? draft.lineageId : null;
  const subrace = subraceId ? await racesApi.getRace(subraceId).catch(() => null) : null;

  // Подкласс — отдельный класс-сущность (is_subclass), выбранный на своём уровне.
  const subclassId = draft.subclassId && isEntityUuid(draft.subclassId) ? draft.subclassId : null;
  const subclass = subclassId ? await classesApi.getClass(subclassId).catch(() => null) : null;
  // Ресурсы подкласса вливаются в ресурсы класса (лист читает klass.resources).
  const klassWithSub = klass && subclass?.resources
    ? { ...klass, resources: { ...(klass.resources || {}), ...subclass.resources } }
    : klass;

  const { effectRefs, actionRefs } = gatherFeatureRefs(race, klass, feats, draft.level, subrace, subclass);

  const baseEffects = (
    await Promise.all(
      effectRefs.map((r) =>
        effectsApi.getEffect(r.id).then((effect) => ({ effect, origin: r.origin })).catch(() => null),
      ),
    )
  ).filter((x): x is OriginEffect => !!x);

  const resolveEffect = (slug: string) =>
    entityRegistry.resolve<PassiveEffect>('effect', slug).catch(() => null);

  // Эффекты-«контейнеры»: разворачиваем ссылки на другие эффекты (grant_effect /
  // choice source:effect) в самостоятельные бусины-эффекты с тем же источником.
  let effects = await expandEffectGrants(baseEffects, draft, resolveEffect);

  // Черты, выбранные через choice(source:"feat") в механике эффектов (боевой
  // стиль воина/паладина/следопыта, черты происхождения): подгружаем сами черты
  // и их related_effects/related_actions, чтобы механика стиля попала в сборку.
  const knownFeatIds = new Set(feats.map((f) => f.id));
  const chosenFeatIds = [...new Set(
    effects.flatMap(({ effect, origin }) => collectFeatChoiceRefs(effect.mechanics, effect.id, origin, draft)),
  )].filter((id) => isEntityUuid(id) && !knownFeatIds.has(id));
  const chosenFeats = (
    await Promise.all(chosenFeatIds.map((id) => featsApi.getFeat(id).catch(() => null)))
  ).filter((f): f is Feat => !!f);
  const allFeats = [...feats, ...chosenFeats];

  if (chosenFeats.length) {
    const featRefs = gatherFeatureRefs(null, null, chosenFeats, draft.level);
    const loadedEffectIds = new Set(effects.map((e) => e.effect.id));
    const featEffects = (
      await Promise.all(
        featRefs.effectRefs
          .filter((r) => !loadedEffectIds.has(r.id))
          .map((r) =>
            effectsApi.getEffect(r.id).then((effect) => ({ effect, origin: r.origin })).catch(() => null),
          ),
      )
    ).filter((x): x is OriginEffect => !!x);
    effects = await expandEffectGrants([...effects, ...featEffects], draft, resolveEffect);
    const knownActionIds = new Set(actionRefs.map((r) => r.id));
    actionRefs.push(...featRefs.actionRefs.filter((r) => !knownActionIds.has(r.id)));
  }

  const actions = (
    await Promise.all(
      actionRefs.map((r) =>
        actionsApi.getAction(r.id).then((action) => ({ action, origin: r.origin })).catch(() => null),
      ),
    )
  ).filter((x): x is OriginAction => !!x);

  return { race, klass: klassWithSub, subclass, background, feats: allFeats, effects, actions, spells: [] };
}

const entityRegistry = createRegistry(createApiResolver());

// ─── Эффекты, ссылающиеся на другие эффекты (композиция «как бусины») ─────────
// Поддерживает два режима из унифицированной схемы:
//   • grant_effect { value | values } — получить весь заготовленный набор;
//   • choice { source:"effect", items:[{id:<slug>}] } — выбрать X из списка.
// Ссылки — slug (card_number) или UUID эффекта.

type RefDict = Record<string, unknown>;

export function collectEffectGrantRefs(
  mechanics: RefDict | null | undefined,
  effectId: string,
  origin: ChoiceOrigin,
  draft: CharacterDraft,
): string[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as RefDict).effects;
  if (!Array.isArray(effects)) return [];
  const refs: string[] = [];
  const pushVal = (v: unknown) => {
    if (typeof v === 'string' && v) refs.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && x) refs.push(x);
  };
  const scan = (payload: RefDict) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.kind === 'grant_effect') {
      pushVal(payload.value ?? payload.values);
      return;
    }
    if (payload.kind === 'choice') {
      const opts = (payload.options || {}) as RefDict;
      if (String(opts.source) !== 'effect') return;
      const rawChoiceId = String(payload.id ?? 'choice');
      const instanceId = `${origin.kind}:${origin.id}:${effectId}:${rawChoiceId}`;
      const selected = draft.resolvedChoices[instanceId] || draft.resolvedChoices[rawChoiceId] || [];
      const items = Array.isArray(opts.items) ? (opts.items as RefDict[]) : [];
      for (const sel of selected) {
        const item = items.find((it) => String(it.id) === sel);
        pushVal((item?.value as string) ?? sel); // item.value переопределяет slug, иначе id === slug
      }
    }
  };
  for (const it of effects as RefDict[]) {
    if (it?.kind) scan(it);
    else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result as RefDict[]) scan(p);
    }
  }
  return refs;
}

// Черты, выбранные через choice { source:"feat" } (id — UUID черты).
// Параллельно collectEffectGrantRefs: сканирует механику эффекта и достаёт
// значения из draft.resolvedChoices по instance-id выбора.
export function collectFeatChoiceRefs(
  mechanics: RefDict | null | undefined,
  effectId: string,
  origin: ChoiceOrigin,
  draft: CharacterDraft,
): string[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as RefDict).effects;
  if (!Array.isArray(effects)) return [];
  const refs: string[] = [];
  const scan = (payload: RefDict) => {
    if (!payload || typeof payload !== 'object' || payload.kind !== 'choice') return;
    const opts = (payload.options || {}) as RefDict;
    if (String(opts.source) !== 'feat') return;
    const rawChoiceId = String(payload.id ?? 'choice');
    const instanceId = `${origin.kind}:${origin.id}:${effectId}:${rawChoiceId}`;
    const selected = draft.resolvedChoices[instanceId] || draft.resolvedChoices[rawChoiceId] || [];
    for (const sel of selected) {
      if (typeof sel === 'string' && sel) refs.push(sel);
    }
  };
  for (const it of effects as RefDict[]) {
    if (it?.kind) scan(it);
    else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
      for (const p of it.result as RefDict[]) scan(p);
    }
  }
  return refs;
}

export type EffectResolver = (slug: string) => Promise<PassiveEffect | null>;

export async function expandEffectGrants(
  base: OriginEffect[],
  draft: CharacterDraft,
  resolve: EffectResolver,
): Promise<OriginEffect[]> {
  const result: OriginEffect[] = [...base];
  const seen = new Set<string>();
  const mark = (e: OriginEffect) => {
    seen.add(e.effect.id);
    if (e.effect.card_number) seen.add(e.effect.card_number);
  };
  base.forEach(mark);

  let frontier = base;
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const wanted: { slug: string; origin: ChoiceOrigin }[] = [];
    for (const { effect, origin } of frontier) {
      for (const slug of collectEffectGrantRefs(effect.mechanics, effect.id, origin, draft)) {
        if (!seen.has(slug)) wanted.push({ slug, origin });
      }
    }
    if (!wanted.length) break;

    const resolved = await Promise.all(
      wanted.map((w) => resolve(w.slug).catch(() => null)),
    );
    const next: OriginEffect[] = [];
    resolved.forEach((eff, i) => {
      seen.add(wanted[i].slug); // помечаем slug, чтобы не перезапрашивать (в т.ч. битые ссылки)
      if (!eff || seen.has(eff.id)) return;
      const oe: OriginEffect = { effect: eff, origin: wanted[i].origin };
      mark(oe);
      result.push(oe);
      next.push(oe);
    });
    frontier = next;
  }
  return result;
}

// Загружает все сущности черновика (включая заклинания) и собирает персонажа.
export async function loadAssembly(draft: CharacterDraft): Promise<AssembledCharacter> {
  const bundle = await loadBundle(draft);
  const uuids = (draft.spellIds || []).filter(isEntityUuid);
  const slugs = [...new Set(draft.grantedSpellSlugs || [])];

  const byId = new Map<string, Spell>();
  const uuidSpells = await Promise.all(uuids.map((id) => spellsApi.getSpell(id).catch(() => null)));
  for (const s of uuidSpells) {
    if (s) byId.set(s.id, s);
  }

  const slugSpells = await entityRegistry.resolveMany<Spell>('spell', slugs);
  for (const s of slugSpells) {
    if (s?.id) byId.set(s.id, s);
  }

  return assemble({ ...bundle, spells: [...byId.values()] }, draft);
}
