import {
  racesApi,
  classesApi,
  backgroundsApi,
  featsApi,
  effectsApi,
  actionsApi,
  spellsApi,
  resourcesApi,
  variablesApi,
} from '../api/client';
import type { Race, CharacterClass, Background, Feat, PassiveEffect, Action, Spell, LevelProgression, Variable, ResourceDefinition } from '../types';
import { collectVariablesFromEffects } from './variables';
import type { VariableValue } from '../engine/formula';
import { collectChoices, type PendingChoice, type ChoiceOrigin } from '../mechanics/collectChoices';
import { choiceKey, instanceFeatureId } from '../mechanics/choiceKey';
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
  const seenA = new Set<string>();
  // Эффекты НЕ дедупим по id здесь: повторяемые эффекты (repeatable) должны сохранить кратность
  // (одно прикрепление = одна бусина). Схлопывание неповторяемых по id делается после загрузки тел
  // (там известен флаг repeatable). Действия по-прежнему дедупим (repeatable у них нет).
  const pushE = (id: string | undefined, origin: ChoiceOrigin) => {
    if (id) effectRefs.push({ id, origin });
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
  /** Выбранный подвид-субрас (lineageId = UUID субраса). Для отображения имени линиджа на листе. */
  subrace?: Race | null;
  klass: CharacterClass | null;
  subclass?: CharacterClass | null;
  background: Background | null;
  feats: Feat[];
  effects: OriginEffect[];
  actions: OriginAction[];
  spells: Spell[];
  resources: ResourceDefinition[];
  pendingChoices: PendingChoice[];
  featAbilityIncreases: string[]; // информативно (не применяется автоматически в MVP)
  /** Активные переменные персонажа (martial_arts_die и т.п.) для формул. */
  variables: Record<string, VariableValue>;
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
  subrace?: Race | null;
  klass: CharacterClass | null;
  subclass?: CharacterClass | null;
  background: Background | null;
  feats: Feat[];
  effects: OriginEffect[];
  actions: OriginAction[];
  spells: Spell[];
  resources?: ResourceDefinition[];
  /** Справочник переменных (type/default) для сворачивания variable-payload'ов эффектов. */
  variableDefs?: Variable[];
}

// Чистая сборка из уже загруженных сущностей.
export function assemble(bundle: EntityBundle, draft: CharacterDraft): AssembledCharacter {
  const scores = draft.abilities;
  const pb = proficiencyBonusForLevel(draft.level);

  const pendingChoices: PendingChoice[] = [];
  for (const { effect, origin } of bundle.effects) {
    pendingChoices.push(...collectChoices(effect.mechanics, { ...origin, featureId: instanceFeatureId(effect.id, origin.instanceKey), featureName: effect.name }, draft.resolvedChoices));
  }
  for (const { action, origin } of bundle.actions) {
    pendingChoices.push(...collectChoices(action.mechanics, { ...origin, featureId: instanceFeatureId(action.id, origin.instanceKey), featureName: action.name }, draft.resolvedChoices));
  }

  const abilityMods = Object.fromEntries(
    ABILITY_KEYS.map((k) => [k, abilityMod(scores[k])]),
  ) as Record<AbilityKey, number>;

  // Переменные: свернуть variable-payload'ы эффектов И действий (в порядке
  // следования = по возрастанию уровня, поэтому старший уровень перекрывает младший).
  const variables = collectVariablesFromEffects(
    [
      ...bundle.effects.map((e) => e.effect.mechanics),
      ...bundle.actions.map((a) => a.action.mechanics),
    ],
    bundle.variableDefs ?? [],
  );

  return {
    race: bundle.race,
    subrace: bundle.subrace ?? null,
    klass: bundle.klass,
    subclass: bundle.subclass ?? null,
    background: bundle.background,
    feats: bundle.feats,
    effects: bundle.effects,
    actions: bundle.actions,
    spells: bundle.spells,
    resources: bundle.resources ?? [],
    pendingChoices,
    featAbilityIncreases: bundle.feats.flatMap((f) => f.ability_increase || []),
    variables,
    derived: {
      proficiencyBonus: pb,
      maxHP: computeMaxHP(bundle.klass?.hit_die, scores.con, draft.level),
      initiative: abilityMod(scores.dex),
      ac: 10 + abilityMod(scores.dex),
      speed: bundle.race?.speed ?? 30,
      abilityMods,
      spellcasting: spellcasting(bundle.klass?.name, scores, pb, bundle.subclass?.name),
    },
  };
}

// Загружает сущности и связанные эффекты/действия (без заклинаний — их удобнее
// брать из уже загруженного списка редактора). Спелы возвращаются пустыми.
export async function loadBundle(draft: CharacterDraft): Promise<EntityBundle> {
  // B5: справочник переменных ни от чего не зависит — стартуем сразу, ждём в конце.
  const variableDefsP = variablesApi
    .getVariables()
    .then((r) => r.variables ?? [])
    .catch(() => []);

  // B5: все независимые справочные загрузки — одним Promise.all (раньше был водопад
  // race/klass/background → manualFeats → subrace → subclass). Зависят только от
  // полей draft, поэтому запускаются параллельно. subrace/subclass — по UUID из draft.
  const [race, klass, background, manualFeatsRaw, subrace, subclass] = await Promise.all([
    draft.raceId ? racesApi.getRace(draft.raceId).catch(() => null) : Promise.resolve(null),
    draft.classId ? classesApi.getClass(draft.classId).catch(() => null) : Promise.resolve(null),
    draft.backgroundId ? backgroundsApi.getBackground(draft.backgroundId).catch(() => null) : Promise.resolve(null),
    Promise.all((draft.featIds || []).map((id) => featsApi.getFeat(id).catch(() => null))),
    draft.lineageId && isEntityUuid(draft.lineageId) ? racesApi.getRace(draft.lineageId).catch(() => null) : Promise.resolve(null),
    draft.subclassId && isEntityUuid(draft.subclassId) ? classesApi.getClass(draft.subclassId).catch(() => null) : Promise.resolve(null),
  ]);
  const manualFeats = manualFeatsRaw.filter((f): f is Feat => !!f);

  // Origin-черта предыстории (по card_number/uuid): действует по умолчанию,
  // пока игрок не заменил её (флаг swapFeat → выбор в FeatSection). Так черта
  // предыстории попадает в сборку и overview даже без «Сменить черту».
  // Зависит от background + manualFeats, поэтому после Promise.all выше.
  const originFeat = !draft.swapFeat && background?.origin_feat
    ? await featsApi.getFeat(background.origin_feat).catch(() => null)
    : null;
  const feats = originFeat && !manualFeats.some((f) => f.id === originFeat.id)
    ? [...manualFeats, originFeat]
    : manualFeats;

  // Ресурсы подкласса вливаются в ресурсы класса (лист читает klass.resources).
  const klassWithSub = klass && subclass?.resources
    ? { ...klass, resources: { ...(klass.resources || {}), ...subclass.resources } }
    : klass;

  const { effectRefs, actionRefs } = gatherFeatureRefs(race, klass, feats, draft.level, subrace, subclass);
  const manualOrigin = (kind: 'effect' | 'action', index: number): ChoiceOrigin => ({
    kind: 'other',
    id: `manual-${kind}-${index}`,
    name: 'Добавлено игроком',
    instanceKey: `manual:${kind}:${index}`,
  });
  (draft.effectIds || []).forEach((id, index) => {
    if (id) effectRefs.push({ id, origin: manualOrigin('effect', index) });
  });
  const knownManualActionIds = new Set(actionRefs.map((ref) => ref.id));
  (draft.actionIds || []).forEach((id, index) => {
    if (!id || knownManualActionIds.has(id)) return;
    knownManualActionIds.add(id);
    actionRefs.push({ id, origin: manualOrigin('action', index) });
  });

  // Тела эффектов грузим по УНИКАЛЬНЫМ id (refs могут дублироваться для повторяемых), затем собираем
  // список с учётом повторяемости: неповторяемый — 1 раз (дедуп по id); повторяемый — по одной бусине
  // на каждое прикрепление с РАЗНЫМ instanceKey (стек-ключи и вложенные выборы не сталкиваются).
  const uniqueEffectIds = [...new Set(effectRefs.map((r) => r.id))];
  const effBodyById = new Map<string, PassiveEffect>();
  await Promise.all(
    uniqueEffectIds.map((id) => effectsApi.getEffect(id).then((e) => { effBodyById.set(id, e); }).catch(() => {})),
  );
  const baseEffects: OriginEffect[] = [];
  {
    const seenNonRep = new Set<string>();
    const repN = new Map<string, number>();
    for (const r of effectRefs) {
      const effect = effBodyById.get(r.id);
      if (!effect) continue;
      if (effect.repeatable) {
        const n = repN.get(r.id) ?? 0;
        repN.set(r.id, n + 1);
        const instanceKey = r.origin.instanceKey ?? `${r.origin.kind}:${r.origin.id}:${r.id}:${n}`;
        baseEffects.push({ effect, origin: { ...r.origin, instanceKey } });
      } else {
        if (seenNonRep.has(r.id)) continue;
        seenNonRep.add(r.id);
        baseEffects.push({ effect, origin: r.origin });
      }
    }
  }

  // Материализуем choice(source:"effect_type"): выбор N эффектов заданного
  // типа (Дар договора, Мистическое воззвание). Тип разворачивается в обычный
  // choice(source:"effect") со списком эффектов этого типа — дальше работает
  // штатная машинерия (показ вариантов + expandEffectGrants даёт их механику).
  await materializeEffectTypeChoices(baseEffects);

  const resolveEffect = (slug: string) =>
    entityRegistry.resolve<PassiveEffect>('effect', slug).catch(() => null);

  // Эффекты-«контейнеры»: разворачиваем ссылки на другие эффекты (grant_effect /
  // choice source:effect) в самостоятельные бусины-эффекты с тем же источником.
  let effects = await expandEffectGrants(baseEffects, draft, resolveEffect);

  // Черты, выбранные через choice(source:"feat") в механике эффектов (боевой
  // стиль воина/паладина/следопыта, черты происхождения, бонусная черта Человека):
  // подгружаем сами черты и их related_effects/related_actions.
  // ВАЖНО: повторяемую (repeatable) черту допускаем из НЕСКОЛЬКИХ источников
  // (напр. Человек + предыстория дают одну и ту же «Одарённый») — она попадает
  // в assembled.feats столько раз, сколько выбрана; неповторяемая — один раз.
  const chosenFeatPicks = effects
    .flatMap(({ effect, origin }) => collectFeatChoiceRefs(effect.mechanics, effect.id, origin, draft))
    .filter((p) => isEntityUuid(p.featId));
  const chosenById = new Map<string, Feat>(
    (await Promise.all([...new Set(chosenFeatPicks.map((p) => p.featId))].map((id) => featsApi.getFeat(id).catch(() => null))))
      .filter((f): f is Feat => !!f)
      .map((f) => [f.id, f]),
  );

  // Сборка итогового списка черт с учётом повторяемости (по одной записи на каждый пик).
  const allFeats: Feat[] = [];
  const seenNonRepeatable = new Set<string>();
  const pushFeat = (f: Feat) => {
    if (f.repeatable) { allFeats.push(f); return; } // повторяемую — сколько выбрана
    if (seenNonRepeatable.has(f.id)) return;
    seenNonRepeatable.add(f.id);
    allFeats.push(f);
  };
  for (const f of feats) pushFeat(f);
  for (const p of chosenFeatPicks) { const f = chosenById.get(p.featId); if (f) pushFeat(f); }

  const baseFeatIds = new Set(feats.map((f) => f.id));

  // Догрузка эффектов/действий выбранных черт.
  //  • Неповторяемые — как раньше: один раз, origin без instanceKey (стабильный ключ, совместимость).
  //  • Повторяемые — ПО ЭКЗЕМПЛЯРУ: origin.instanceKey = id слота-пикера, чтобы вложенные выборы
  //    разных получений (ASI на 4 и 8 ур.) не сталкивались. Один и тот же эффект попадает в
  //    список несколько раз с разным origin — expandEffectGrants сохраняет дубли базы.
  const repeatablePicks = chosenFeatPicks.filter((p) => chosenById.get(p.featId)?.repeatable);
  const nonRepeatableChosen = [...chosenById.values()].filter((f) => !f.repeatable && !baseFeatIds.has(f.id));

  const effCache = new Map<string, PassiveEffect | null>();
  const getEff = async (id: string) => {
    if (!effCache.has(id)) effCache.set(id, await effectsApi.getEffect(id).catch(() => null));
    return effCache.get(id) ?? null;
  };

  const extraEffects: OriginEffect[] = [];
  const loadedEffectIds = new Set(effects.map((e) => e.effect.id));
  const knownActionIds = new Set(actionRefs.map((r) => r.id));

  if (nonRepeatableChosen.length) {
    const refs = gatherFeatureRefs(null, null, nonRepeatableChosen, draft.level);
    for (const r of refs.effectRefs) {
      if (loadedEffectIds.has(r.id)) continue;
      loadedEffectIds.add(r.id);
      const eff = await getEff(r.id);
      if (eff) extraEffects.push({ effect: eff, origin: r.origin });
    }
    for (const r of refs.actionRefs) {
      if (knownActionIds.has(r.id)) continue;
      knownActionIds.add(r.id);
      actionRefs.push(r);
    }
  }

  for (const pick of repeatablePicks) {
    const feat = chosenById.get(pick.featId);
    if (!feat) continue;
    const origin: ChoiceOrigin = { kind: 'feat', id: feat.id, name: feat.name, instanceKey: pick.instanceKey };
    for (const eid of feat.related_effects || []) {
      const eff = await getEff(eid);
      if (eff) extraEffects.push({ effect: eff, origin }); // экземпляр (instanceKey)
    }
    // Действия дедупим по id (не по экземпляру): дублировать одно и то же действие незачем.
    for (const aid of feat.related_actions || []) {
      if (knownActionIds.has(aid)) continue;
      knownActionIds.add(aid);
      actionRefs.push({ id: aid, origin: { kind: 'feat', id: feat.id, name: feat.name } });
    }
  }

  if (extraEffects.length) {
    effects = await expandEffectGrants([...effects, ...extraEffects], draft, resolveEffect);
  }

  const actions = (
    await Promise.all(
      actionRefs.map((r) =>
        actionsApi.getAction(r.id).then((action) => ({ action, origin: r.origin })).catch(() => null),
      ),
    )
  ).filter((x): x is OriginAction => !!x);

  // Справочник переменных (type/default) для сворачивания variable-payload'ов.
  // B5: загрузка стартовала в начале функции (variableDefsP) — здесь только ждём.
  const [variableDefs, resources] = await Promise.all([
    variableDefsP,
    Promise.all((draft.resourceIds || []).map((id) => resourcesApi.getResource(id).catch(() => null)))
      .then((items) => items.filter((item): item is ResourceDefinition => !!item)),
  ]);

  return {
    race,
    subrace,
    klass: klassWithSub,
    subclass,
    background,
    feats: allFeats,
    effects,
    actions,
    spells: [],
    resources,
    variableDefs,
  };
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
      const instanceId = choiceKey({ kind: origin.kind, id: origin.id, featureId: instanceFeatureId(effectId, origin.instanceKey) }, rawChoiceId);
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

/** Выбор черты через пикер: id черты + instanceKey (id эффекта-пикера, уникален на слот). */
export type FeatPick = { featId: string; instanceKey: string };

// Черты, выбранные через choice { source:"feat" } (id — UUID черты).
// Параллельно collectEffectGrantRefs: сканирует механику эффекта и достаёт значения из
// draft.resolvedChoices по instance-id выбора. Возвращает и instanceKey (id эффекта-пикера),
// чтобы одна и та же повторяемая черта на разных слотах давала независимые экземпляры.
export function collectFeatChoiceRefs(
  mechanics: RefDict | null | undefined,
  effectId: string,
  origin: ChoiceOrigin,
  draft: CharacterDraft,
): FeatPick[] {
  if (!mechanics || typeof mechanics !== 'object') return [];
  const effects = (mechanics as RefDict).effects;
  if (!Array.isArray(effects)) return [];
  const refs: FeatPick[] = [];
  const scan = (payload: RefDict) => {
    if (!payload || typeof payload !== 'object' || payload.kind !== 'choice') return;
    const opts = (payload.options || {}) as RefDict;
    if (String(opts.source) !== 'feat') return;
    const rawChoiceId = String(payload.id ?? 'choice');
    const instanceId = choiceKey({ kind: origin.kind, id: origin.id, featureId: instanceFeatureId(effectId, origin.instanceKey) }, rawChoiceId);
    const selected = draft.resolvedChoices[instanceId] || draft.resolvedChoices[rawChoiceId] || [];
    for (const sel of selected) {
      if (typeof sel === 'string' && sel) refs.push({ featId: sel, instanceKey: effectId });
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

// Кэш «тип эффекта → список эффектов» на время одной сборки.
const effectTypeCache = new Map<string, { id: string; name: string; card_number: string }[]>();

async function effectsOfType(type: string): Promise<{ id: string; name: string; card_number: string }[]> {
  if (effectTypeCache.has(type)) return effectTypeCache.get(type)!;
  try {
    const res = await effectsApi.getEffects({ type, limit: 200, fields: 'list' });
    const list = (res.effects || []).map((e) => ({ id: e.id, name: e.name, card_number: e.card_number }));
    effectTypeCache.set(type, list);
    return list;
  } catch {
    effectTypeCache.set(type, []);
    return [];
  }
}

/**
 * Разворачивает choice(source:"effect_type") в choice(source:"effect") со
 * списком эффектов заданного типа. Мутирует mechanics загруженных эффектов
 * (объекты одноразовые, из свежего fetch). count:"all" → все эффекты типа.
 */
async function materializeEffectTypeChoices(effects: OriginEffect[]): Promise<void> {
  const scanTargets: RefDict[] = [];
  const collect = (mech: unknown) => {
    if (!mech || typeof mech !== 'object') return;
    const list = (mech as RefDict).effects;
    if (!Array.isArray(list)) return;
    for (const it of list as RefDict[]) {
      if (it?.kind === 'choice' && ((it.options as RefDict)?.source === 'effect_type')) scanTargets.push(it);
      else if (it?.resolution === 'auto' && Array.isArray(it.result)) {
        for (const p of it.result as RefDict[]) {
          if (p?.kind === 'choice' && ((p.options as RefDict)?.source === 'effect_type')) scanTargets.push(p);
        }
      }
    }
  };
  for (const { effect } of effects) collect(effect.mechanics);
  if (!scanTargets.length) return;

  await Promise.all(scanTargets.map(async (choice) => {
    const opts = choice.options as RefDict;
    const type = String(opts.type ?? '');
    if (!type) return;
    const list = await effectsOfType(type);
    // id варианта = card_number (slug) → collectEffectGrantRefs резолвит его.
    opts.source = 'effect';
    opts.items = list.map((e) => ({ id: e.card_number || e.id, name: e.name, value: e.card_number || e.id }));
    delete opts.type;
    if (choice.count === 'all' || opts.count === 'all') choice.count = list.length || 1;
  }));
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

/**
 * S3 «предмет=эффект»: разворачивает `grant_effect` ПРЕДМЕТОВ (прошедших гейт) в самостоятельные
 * эффекты-бусины ТОЙ ЖЕ машинерией, что и эффекты класса/черт (повязка → эффект «Тёмное зрение»,
 * пока надета). Вход — прошедшие гейт предметы; выход — ТОЛЬКО загруженные выданные эффекты (без
 * самих предметов). Роль источника 'item' навешивается на листе через RuntimeRuleSource — так
 * выданный эффект наследует item-семантику (подавление числовых ролей, фильтр КЗ) из слайса 1.
 */
export async function expandItemGrantedEffects(
  items: { id: string; name: string; mechanics: Record<string, unknown> | null | undefined }[],
  draft: CharacterDraft,
): Promise<PassiveEffect[]> {
  if (!items.length) return [];
  const pseudo: OriginEffect[] = items.map((it) => ({
    effect: { id: it.id, name: it.name, mechanics: it.mechanics, card_number: '' } as PassiveEffect,
    origin: { kind: 'other', id: it.id, name: it.name },
  }));
  const resolveEffect: EffectResolver = (slug) =>
    entityRegistry.resolve<PassiveEffect>('effect', slug).catch(() => null);
  const expanded = await expandEffectGrants(pseudo, draft, resolveEffect);
  const pseudoIds = new Set(pseudo.map((p) => p.effect.id));
  return expanded.filter((oe) => !pseudoIds.has(oe.effect.id)).map((oe) => oe.effect);
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
