/**
 * Регрессия незаклинательных способностей видов на живом контенте.
 *
 * В отличие от общего forge.sweep этот набор:
 *  - фиксирует точный инвентарь механических payload-ов видов (заклинания/заговоры исключены);
 *  - собирает каждый допустимый вид/подвид с каждым базовым классом на ключевых уровнях;
 *  - проверяет пассивы в ruleState/боевом движке и исполняет все доступные расовые действия;
 *  - держит явный baseline известных неполных/неточных реализаций, чтобы список не рос молча.
 *
 * Запуск: MVP_CONTENT=1 npm run test:mvp -- src/mvp/raceAbilities.mvp.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  assemble,
  gatherFeatureRefs,
  type EntityBundle,
} from '../character/assemble';
import { collectSheetActions } from '../character/actionSheet';
import { collectPassiveMechanics, syncRuntimeResources } from '../character/resourceInit';
import { buildCharacterContext } from '../character/runtime';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { emptyDraft, type CharacterDraft } from '../character/types';
import { applyIncomingDamage, executeAction } from '../engine/execute';
import { collectModifiers } from '../engine/modifiers';
import { optionsForChoiceSource } from '../mechanics/registries';
import type { PendingChoice } from '../mechanics/collectChoices';
import type { ExecuteContext, RuntimeState } from './contracts';
import { seededRng } from './fixtures';
import type { Action, CharacterClass, PassiveEffect, Race } from '../types';

const RUN = !!process.env.MVP_CONTENT;
const BASE = process.env.API_URL || 'https://backend-production-41c3.up.railway.app';
const d = describe.skipIf(!RUN);

type Dict = Record<string, unknown>;
type Feature = PassiveEffect | Action;
type RaceCombo = { race: Race; subrace?: Race };

const ABILITIES = { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 } as const;
const LEVELS = [1, 3, 5, 20] as const;

let classes: CharacterClass[] = [];
let races: Race[] = [];
let effects: PassiveEffect[] = [];
let actions: Action[] = [];
let effectsById = new Map<string, PassiveEffect>();
let actionsById = new Map<string, Action>();
let featuresByNumber = new Map<string, Feature>();
let combos: RaceCombo[] = [];

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`${BASE}${path}?page=${page}&limit=100`);
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    const batch = (data[key] || []) as T[];
    items.push(...batch);
    const total = Number(data.total ?? 0);
    if (batch.length === 0 || batch.length < 100 || (total > 0 && items.length >= total)) break;
  }
  return items;
}

function raceCombos(all: Race[]): RaceCombo[] {
  const out: RaceCombo[] = [];
  for (const race of all.filter((r) => !r.is_subrace)) {
    const subs = all.filter((r) => r.parent_race_id === race.id);
    if (!subs.length) out.push({ race });
    else for (const subrace of subs) out.push({ race, subrace });
  }
  return out;
}

function directPayloads(mechanics: Dict | null | undefined): Dict[] {
  const out: Dict[] = [];
  const scanPayload = (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return;
    const p = payload as Dict;
    if (typeof p.kind === 'string') out.push(p);
    if (p.kind === 'choice') {
      const options = p.options as Dict | undefined;
      for (const item of (options?.items as Dict[] | undefined) || []) {
        for (const grant of (item.grants as Dict[] | undefined) || []) scanPayload(grant);
      }
    }
  };
  for (const effect of (mechanics?.effects as Dict[] | undefined) || []) {
    if (effect.kind) scanPayload(effect);
    for (const key of ['result', 'results', 'on_fail', 'on_success', 'on_hit', 'on_miss']) {
      for (const payload of (effect[key] as unknown[] | undefined) || []) scanPayload(payload);
    }
  }
  return out;
}

function nonSpellKinds(feature: Feature): string[] {
  return [...new Set(
    directPayloads(feature.mechanics as Dict | null | undefined)
      .map((p) => String(p.kind))
      .filter((kind) => kind !== 'grant_spell'),
  )].sort();
}

function racialRefIds(): Set<string> {
  const ids = new Set<string>();
  for (const race of races) {
    for (const id of race.related_effects || []) ids.add(id);
    for (const id of race.related_actions || []) ids.add(id);
    for (const entry of Object.values(race.level_progression || {})) {
      for (const id of entry.effects || []) ids.add(id);
      for (const id of entry.actions || []) ids.add(id);
    }
  }
  return ids;
}

function selectedSubrace(combo: RaceCombo, level: number): Race | null {
  if (!combo.subrace) return null;
  return level >= Number(combo.race.subrace_level ?? 1) ? combo.subrace : null;
}

function optionsFor(pc: PendingChoice): string[] {
  if (pc.items?.length) return pc.items.map((item) => item.id);
  let pool = optionsForChoiceSource(pc.source).map((item) => item.id);
  if (Array.isArray(pc.filter)) {
    const allowed = new Set(pc.filter as string[]);
    pool = pool.filter((id) => allowed.has(id));
  }
  return pool;
}

function makeBundle(combo: RaceCombo, klass: CharacterClass, level: number): EntityBundle {
  const subrace = selectedSubrace(combo, level);
  // Изолируем расовый слой: класс присутствует в контексте и ресурсах, но его
  // собственные feature-карты не должны превращать проверку вида в тест класса.
  const refs = gatherFeatureRefs(combo.race, null, [], level, subrace);
  const missing = [
    ...refs.effectRefs.filter((ref) => !effectsById.has(ref.id)).map((ref) => ref.id),
    ...refs.actionRefs.filter((ref) => !actionsById.has(ref.id)).map((ref) => ref.id),
  ];
  if (missing.length) throw new Error(`Битые ссылки вида ${combo.race.name}: ${missing.join(', ')}`);
  return {
    race: combo.race,
    subrace,
    klass,
    subclass: null,
    background: null,
    feats: [],
    effects: refs.effectRefs.map((ref) => ({ effect: effectsById.get(ref.id)!, origin: ref.origin })),
    actions: refs.actionRefs.map((ref) => ({ action: actionsById.get(ref.id)!, origin: ref.origin })),
    spells: [],
  };
}

function build(combo: RaceCombo, klass: CharacterClass, level: number) {
  const bundle = makeBundle(combo, klass, level);
  const draft: CharacterDraft = {
    ...emptyDraft(),
    name: 'Матрица видов',
    raceId: combo.race.id,
    lineageId: bundle.subrace?.id ?? null,
    classId: klass.id,
    level,
    abilities: { ...ABILITIES },
  };
  let assembled = assemble(bundle, draft);
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const pc of assembled.pendingChoices) {
      if (pc.source === 'spell' || pc.context === 'in_play') continue;
      const selected = draft.resolvedChoices[pc.id] || [];
      if (selected.length >= pc.count) continue;
      const picked = optionsFor(pc).filter((id) => !selected.includes(id)).slice(0, pc.count - selected.length);
      if (picked.length) {
        draft.resolvedChoices[pc.id] = [...selected, ...picked];
        changed = true;
      }
    }
    if (!changed) break;
    assembled = assemble(bundle, draft);
  }
  return { draft, assembled, ruleState: resolveCharacterRules({ draft, assembled }) };
}

function emptyState(hp = 100): RuntimeState {
  return {
    hp: { current: hp, max: hp, temp: 0 },
    resources: { action: 99, bonus_action: 99, reaction: 99, free_action: 99 },
    maxResources: { action: 99, bonus_action: 99, reaction: 99, free_action: 99 },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function withoutCost(mechanics: Dict): Dict {
  const activation = (mechanics.activation as Dict | undefined) || {};
  return { ...mechanics, activation: { ...activation, mode: 'active', cost: [] } };
}

function inPlayChoices(mechanics: Dict): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  for (const payload of directPayloads(mechanics)) {
    if (payload.kind !== 'choice') continue;
    const options = payload.options as Dict | undefined;
    const first = ((options?.items as Dict[] | undefined) || [])[0];
    if (first?.id) selected[String(payload.id ?? 'choice')] = [String(first.id)];
  }
  return selected;
}

const EXPECTED_NON_SPELL_INVENTORY: Record<string, string[]> = {
  'ACT-aasimar-revelation': ['choice', 'narrative'],
  'ACT-breath-acid': ['damage'],
  'ACT-breath-cold': ['damage'],
  'ACT-breath-fire': ['damage'],
  'ACT-breath-lightning': ['damage'],
  'ACT-breath-poison': ['damage'],
  'ACT-goliath-cloud': ['narrative'],
  'ACT-goliath-fire': ['damage'],
  'ACT-goliath-frost': ['damage', 'modifier', 'narrative'],
  'ACT-goliath-hill': ['condition', 'narrative'],
  'ACT-goliath-storm': ['damage'],
  'ACTION-0002': ['modifier'],
  'EFF-darkvision-120': ['grant_sense'],
  'EFF-darkvision-60': ['grant_sense'],
  'EFF-tabaxi-feline': ['narrative'],
  'EFF-warforged-constructed': ['modifier', 'narrative'],
  'EFF-warforged-sentry-rest': ['narrative'],
  'RE-aasimar-2': ['resistance'],
  'RE-dragon-resist-acid': ['resistance'],
  'RE-dragon-resist-cold': ['resistance'],
  'RE-dragon-resist-fire': ['resistance'],
  'RE-dragon-resist-lightning': ['resistance'],
  'RE-dragon-resist-poison': ['resistance'],
  'RE-dragonborn-4': ['grant_speed'],
  'RE-dwarf-2': ['modifier', 'resistance'],
  'RE-dwarf-3': ['modifier'],
  'RE-dwarf-4': ['grant_sense'],
  'RE-elf-2': ['condition_immunity', 'modifier'],
  'RE-elf-3': ['choice'],
  'RE-gnome-2': ['modifier'],
  'RE-goliath-1': ['narrative', 'resource'],
  'RE-goliath-2': ['modifier', 'narrative'],
  'RE-goliath-3': ['modifier', 'narrative'],
  'RE-halfling-1': ['modifier'],
  'RE-halfling-2': ['narrative'],
  'RE-halfling-3': ['modifier'],
  'RE-halfling-4': ['narrative'],
  'RE-human-1': ['resource'],
  'RE-human-2': ['choice'],
  'RE-human-3': ['choice'],
  'RE-orc-2': ['modifier', 'narrative', 'temp_hp'],
  'RE-orc-3': ['set_value'],
  'RE-sub-abyssal': ['resistance'],
  'RE-sub-chthonic': ['resistance'],
  'RE-sub-cloud': ['narrative'],
  'RE-sub-drow': ['choice', 'grant_sense'],
  'RE-sub-fire': ['narrative'],
  'RE-sub-frost': ['narrative'],
  'RE-sub-high_elf': ['choice'],
  'RE-sub-hill': ['narrative'],
  'RE-sub-infernal': ['resistance'],
  'RE-sub-rock': ['narrative'],
  'RE-sub-stone': ['narrative', 'reduce_damage'],
  'RE-sub-storm': ['narrative'],
  'RE-sub-wood_elf': ['choice', 'grant_speed'],
  aasimar_healing_hands: ['healing'],
  tabaxi_unarmed_strike: ['damage'],
};

const KNOWN_RULE_DEVIATIONS = [
  'Аасимар — Целебные руки: число d4 равно уровню, должно равняться бонусу мастерства',
  'Аасимар — Небесное откровение: все три варианта дают только narrative-события',
  'Драконорождённый — Оружие дыхания: тратит всё действие и имеет только конус 15 фт вместо замены атаки с выбором конус/линия',
  'Драконорождённый — Драконий полёт с 5 уровня пока не меняет runtime-скорость после нажатия',
  'Дворф — Камнечувствие: tremorsense применяется постоянно, а при нажатии не исполняется движком',
  'Голиаф — Большая форма: длится 10 раундов и восстанавливается после короткого отдыха вместо 10 минут и длинного отдыха',
  'Голиаф — Мощное телосложение: преимущество на спасбросок для окончания Схваченного осталось narrative',
  'Эльф — Транс отсутствует и среди traits, и среди механических карточек',
  'Голиаф — Облачная телепортация даёт только narrative-событие и не меняет позицию',
  'Голиаф — Огненный, Морозный и Холмовой дары и Гром Шторма оформлены ручными active-действиями вместо триггеров попадания/получения урона',
  'Полурослик — Проворство и Природная скрытность существуют только как narrative-подсказки',
  'Табакси — Кошачья ловкость существует только как narrative-подсказка',
  'Кованый — Отдых часового существует только как narrative-подсказка',
  'Расовые Action-карточки показываются в группе class, а не race',
] as const;

beforeAll(async () => {
  [classes, races, effects, actions] = await Promise.all([
    fetchAll<CharacterClass>('/api/classes', 'classes'),
    fetchAll<Race>('/api/races', 'races'),
    fetchAll<PassiveEffect>('/api/effects', 'effects'),
    fetchAll<Action>('/api/actions', 'actions'),
  ]);
  classes = classes.filter((klass) => !klass.is_subclass);
  effectsById = new Map(effects.map((effect) => [effect.id, effect]));
  actionsById = new Map(actions.map((action) => [action.id, action]));
  featuresByNumber = new Map(
    [...effects, ...actions]
      .filter((feature) => feature.card_number)
      .map((feature) => [feature.card_number, feature]),
  );
  combos = raceCombos(races);
}, 120_000);

d('Незаклинательные способности видов: полный регрессионный контур', () => {
  it('фиксирует текущий состав: 13 классов, 12 базовых видов, 36 видов с подвидами и 31 допустимую комбинацию', () => {
    expect(classes.map((klass) => klass.name).sort()).toEqual([
      'Бард', 'Варвар', 'Воин', 'Волшебник', 'Друид', 'Жрец', 'Колдун',
      'Кулачник', 'Монах', 'Паладин', 'Плут', 'Следопыт', 'Чародей',
    ]);
    expect(races.filter((race) => !race.is_subrace)).toHaveLength(12);
    expect(races).toHaveLength(36);
    expect(combos).toHaveLength(31);
  });

  it('по PHB 2024 варианты Небесного откровения Аасимара — выбор в игре, а не подвиды', () => {
    const aasimar = races.find((race) => race.card_number === 'RACE-0010');
    expect(aasimar, 'базовый вид Аасимара должен быть в каталоге').toBeTruthy();
    expect(races.filter((race) => race.parent_race_id === aasimar!.id)).toEqual([]);
    const revelation = actionsById.get(
      Object.values(aasimar!.level_progression || {}).flatMap((entry) => entry.actions || [])[0],
    );
    expect(revelation?.card_number).toBe('ACT-aasimar-revelation');
    expect(nonSpellKinds(revelation!)).toContain('choice');
  });

  it('все расовые ссылки целы, а текущий инвентарь незаклинательных payload-ов зафиксирован', () => {
    const missing = [...racialRefIds()].filter((id) => !effectsById.has(id) && !actionsById.has(id));
    expect(missing, `Битые ссылки видов:\n${missing.join('\n')}`).toEqual([]);

    const actual: Record<string, string[]> = {};
    for (const id of racialRefIds()) {
      const feature = effectsById.get(id) ?? actionsById.get(id);
      if (!feature) continue;
      const kinds = nonSpellKinds(feature);
      if (kinds.length) actual[feature.card_number] = kinds;
    }
    expect(Object.fromEntries(Object.entries(actual).sort())).toEqual(EXPECTED_NON_SPELL_INVENTORY);
  });

  it('каждый вид/подвид собирается с каждым классом на уровнях 1/3/5/20 без потери способностей и error-конфликтов', () => {
    const failures: string[] = [];
    let builds = 0;
    for (const level of LEVELS) {
      for (const combo of combos) {
        for (const klass of classes) {
          builds++;
          const label = `${combo.race.name}${combo.subrace ? ` · ${combo.subrace.name}` : ''} / ${klass.name} / L${level}`;
          try {
            const { draft, assembled, ruleState } = build(combo, klass, level);
            const unresolved = assembled.pendingChoices
              .filter((pc) => pc.source !== 'spell' && pc.context !== 'in_play')
              .filter((pc) => (draft.resolvedChoices[pc.id] || []).length < pc.count);
            if (unresolved.length) failures.push(`${label}: не разрешены ${unresolved.map((pc) => `${pc.id}[${pc.source}]`).join(', ')}`);
            const errors = ruleState.conflicts.filter((conflict) => conflict.severity === 'error');
            if (errors.length) failures.push(`${label}: ${errors.map((error) => error.message).join('; ')}`);

            const expectedRefs = gatherFeatureRefs(combo.race, null, [], level, selectedSubrace(combo, level));
            if (assembled.effects.length !== expectedRefs.effectRefs.length) {
              failures.push(`${label}: эффектов ${assembled.effects.length}/${expectedRefs.effectRefs.length}`);
            }
            if (assembled.actions.length !== expectedRefs.actionRefs.length) {
              failures.push(`${label}: действий ${assembled.actions.length}/${expectedRefs.actionRefs.length}`);
            }

            const sheetIds = new Set(collectSheetActions(assembled).map((action) => action.id));
            for (const { effect, origin } of assembled.effects) {
              if (origin.kind !== 'race') continue;
              const mode = (effect.mechanics?.activation as Dict | undefined)?.mode;
              if (mode === 'active' && !sheetIds.has(effect.id)) failures.push(`${label}: активный эффект ${effect.card_number} не попал на лист`);
            }
            for (const { action, origin } of assembled.actions) {
              if (origin.kind !== 'race') continue;
              const mode = (action.mechanics?.activation as Dict | undefined)?.mode;
              if (mode === 'active' && !sheetIds.has(action.id)) failures.push(`${label}: действие ${action.card_number} не попало на лист`);
            }
          } catch (error) {
            failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    expect(builds).toBe(combos.length * classes.length * LEVELS.length);
    expect(failures, failures.join('\n')).toEqual([]);
  }, 120_000);

  it('пассивные сопротивления, чувства, скорости, ресурсы и модификаторы реально доходят до движка во всех классах', () => {
    const failures: string[] = [];
    for (const combo of combos) {
      for (const klass of classes) {
        const label = `${combo.race.name}${combo.subrace ? ` · ${combo.subrace.name}` : ''} / ${klass.name}`;
        const { draft, assembled, ruleState } = build(combo, klass, 20);
        const passives = collectPassiveMechanics(assembled, draft.resolvedChoices);
        const character = buildCharacterContext(ruleState, draft as CharacterDraft & { abilities: Record<string, number> }, [], klass);
        const synced = syncRuntimeResources(character, assembled);

        for (const { effect, origin } of assembled.effects) {
          if (origin.kind !== 'race') continue;
          const mode = (effect.mechanics?.activation as Dict | undefined)?.mode;
          for (const payload of directPayloads(effect.mechanics as Dict | null | undefined)) {
            if (payload.kind === 'grant_spell' || payload.kind === 'narrative' || payload.kind === 'choice') continue;
            if (payload.kind === 'resistance' && mode === 'passive') {
              const state = emptyState();
              const result = applyIncomingDamage(state, 10, {
                character,
                passives,
                rng: seededRng(1),
              } as unknown as ExecuteContext, { damageType: String(payload.damage_type) });
              if (result.state.hp.current !== 95) failures.push(`${label}: ${effect.card_number} resistance не уменьшило 10→5`);
            }
            if (payload.kind === 'grant_sense' && mode === 'passive') {
              const found = ruleState.senses.some((sense) =>
                sense.sense === String(payload.sense) && sense.range >= Number(payload.range || 0));
              if (!found) failures.push(`${label}: ${effect.card_number} grant_sense не попал в ruleState`);
            }
            if (payload.kind === 'grant_speed' && mode === 'passive') {
              const speedMode = String(payload.mode ?? 'walk');
              const found = speedMode === 'walk'
                ? ruleState.speed >= Number(payload.value || 0)
                : Number(ruleState.speeds[speedMode] || 0) > 0;
              if (!found) failures.push(`${label}: ${effect.card_number} grant_speed не попал в ruleState`);
            }
            if (payload.kind === 'resource' && payload.op === 'grant' && mode !== 'active') {
              const id = String(payload.id);
              if (!(Number(synced.maxResources[id]) > 0)) failures.push(`${label}: ресурс ${id} не инициализирован`);
            }
            if (payload.kind === 'modifier' && mode === 'passive') {
              const applies = payload.applies_to as Dict | undefined;
              if (!applies?.roll) continue;
              const collected = collectModifiers(emptyState(), passives, {
                roll: String(applies.roll),
                filter: applies.filter as Dict | undefined,
                formulaCtx: {
                  abilityMods: character.abilityMods,
                  profBonus: character.profBonus,
                  selfLevel: character.level,
                  characterSpeed: character.characterSpeed,
                },
              });
              const observed = collected.modifiers.length + collected.ops.length + collected.rules.length
                + Number(collected.advantage !== 'none') + Number(collected.autoFail) + Number(collected.denied);
              if (!observed) failures.push(`${label}: ${effect.card_number} modifier ${String(applies.roll)} инертен`);
            }
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  }, 120_000);

  it('все расовые кнопки исполняются каждым классом; текущие неподдержанные payload-ы зафиксированы', () => {
    const failures: string[] = [];
    const notImplemented = new Set<string>();
    let executions = 0;
    for (const combo of combos) {
      for (const klass of classes) {
        const { draft, assembled, ruleState } = build(combo, klass, 20);
        const character = buildCharacterContext(ruleState, draft as CharacterDraft & { abilities: Record<string, number> }, [], klass);
        const racialFeatureIds = new Set([
          ...assembled.effects.filter(({ origin }) => origin.kind === 'race').map(({ effect }) => effect.id),
          ...assembled.actions.filter(({ origin }) => origin.kind === 'race').map(({ action }) => action.id),
        ]);
        for (const sheetAction of collectSheetActions(assembled).filter((action) => racialFeatureIds.has(action.id))) {
          executions++;
          try {
            const state = emptyState(50);
            const targetState = emptyState();
            const result = executeAction(state, withoutCost(sheetAction.mechanics), {
              character,
              target: {
                ac: 1,
                saveMods: { str: -20, dex: -20, con: -20, int: -20, wis: -20, cha: -20 },
                characterContext: character,
                runtimeState: targetState,
              },
              choices: inPlayChoices(sheetAction.mechanics),
              rng: seededRng(17),
            });
            for (const event of result.events) {
              if (event.type !== 'narrative') continue;
              const match = /NOT_IMPLEMENTED payload: ([\w_]+)/.exec(event.text);
              if (match) notImplemented.add(`${sheetAction.effectRef?.card_number || sheetAction.actionRef?.card_number}:${match[1]}`);
            }
            if (!result.events.length
              && JSON.stringify(result.state) === JSON.stringify(state)
              && JSON.stringify(result.targetState) === JSON.stringify(targetState)) {
              failures.push(`${klass.name}: ${sheetAction.name} исполнилось вхолостую`);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const unsupported = /UNKNOWN_PAYLOAD .*payload kind «([^»]+)»/.exec(message);
            if (unsupported) {
              notImplemented.add(`${sheetAction.effectRef?.card_number || sheetAction.actionRef?.card_number}:${unsupported[1]}`);
              continue;
            }
            failures.push(`${klass.name}: ${sheetAction.name}: ${message}`);
          }
        }
      }
    }
    expect(executions).toBeGreaterThan(0);
    expect(failures, failures.join('\n')).toEqual([]);
    expect([...notImplemented].sort()).toEqual([
      'RE-dragonborn-4:grant_speed',
    ]);
  }, 120_000);

  it('явно фиксирует известные расхождения с PHB 2024 вместо ложного заявления «работает всё»', () => {
    const deviations: string[] = [];
    const healing = featuresByNumber.get('aasimar_healing_hands');
    const healingAmount = directPayloads(healing?.mechanics as Dict | null | undefined)
      .find((payload) => payload.kind === 'healing')?.amount;
    if (healingAmount !== 'prof_bonus d4') deviations.push(KNOWN_RULE_DEVIATIONS[0]);

    const revelation = featuresByNumber.get('ACT-aasimar-revelation');
    const revelationKinds = nonSpellKinds(revelation!);
    if (revelationKinds.every((kind) => kind === 'choice' || kind === 'narrative')) deviations.push(KNOWN_RULE_DEVIATIONS[1]);

    const breath = featuresByNumber.get('ACT-breath-fire');
    const breathActivation = breath?.mechanics?.activation as Dict | undefined;
    const breathArea = breath?.mechanics?.targeting as Dict | undefined;
    const area = breathArea?.area as Dict | undefined;
    if (breathActivation?.mode === 'active'
      && ((breathActivation.cost as Dict[] | undefined) || []).some((cost) => cost.resource === 'action')
      && area?.kind === 'cone') deviations.push(KNOWN_RULE_DEVIATIONS[2]);

    const dragon = races.find((race) => race.card_number === 'RACE-0008')!;
    const dwarf = races.find((race) => race.card_number === 'RACE-0003')!;
    const klass = classes[0];
    const dragonL1 = build({ race: dragon }, klass, 1);
    const dragonL5 = build({ race: dragon }, klass, 5);
    const flight = featuresByNumber.get('RE-dragonborn-4');
    const flightPayload = directPayloads(flight?.mechanics as Dict | null | undefined)
      .find((payload) => payload.kind === 'grant_speed');
    const flightButtonAtL1 = collectSheetActions(dragonL1.assembled).find((action) => action.id === flight?.id);
    const flightButtonAtL5 = collectSheetActions(dragonL5.assembled).find((action) => action.id === flight?.id);
    expect(flightButtonAtL1).toBeUndefined();
    expect(flightButtonAtL5).toBeTruthy();
    let flightRuntimeImplemented = false;
    if (flightButtonAtL5) {
      const character = buildCharacterContext(
        dragonL5.ruleState,
        dragonL5.draft as CharacterDraft & { abilities: Record<string, number> },
        [],
        klass,
      );
      const initial = emptyState();
      try {
        const result = executeAction(initial, withoutCost(flightButtonAtL5.mechanics), {
          character,
          rng: seededRng(19),
        });
        flightRuntimeImplemented = result.events.length > 0
          || JSON.stringify(result.state) !== JSON.stringify(initial);
      } catch {
        flightRuntimeImplemented = false;
      }
    }
    if (flightPayload && !flightRuntimeImplemented) {
      deviations.push(KNOWN_RULE_DEVIATIONS[3]);
    }
    const dwarfL1 = build({ race: dwarf }, klass, 1).ruleState;
    if (dwarfL1.senses.some((sense) => sense.sense === 'tremorsense')) deviations.push(KNOWN_RULE_DEVIATIONS[4]);

    const largeForm = featuresByNumber.get('RE-goliath-2');
    const largeUses = largeForm?.mechanics?.uses as Dict | undefined;
    const largeDuration = directPayloads(largeForm?.mechanics as Dict | null | undefined)
      .find((payload) => payload.kind === 'modifier')?.duration as Dict | undefined;
    if (largeUses?.per === 'short_rest' && largeDuration?.type === 'rounds' && largeDuration.amount === 10) {
      deviations.push(KNOWN_RULE_DEVIATIONS[5]);
    }

    const powerfulBuild = featuresByNumber.get('RE-goliath-3');
    const hasGrappleSave = directPayloads(powerfulBuild?.mechanics as Dict | null | undefined).some((payload) =>
      payload.kind === 'modifier'
      && (payload.applies_to as Dict | undefined)?.roll === 'saving_throw'
      && JSON.stringify(payload).includes('grappled'));
    if (!hasGrappleSave) deviations.push(KNOWN_RULE_DEVIATIONS[6]);

    const elf = races.find((race) => race.card_number === 'RACE-0004')!;
    const hasTrance = (elf.traits || []).some((trait) => /транс/i.test(`${trait.name} ${trait.description}`))
      || (elf.related_effects || []).some((id) => /транс/i.test(effectsById.get(id)?.name || ''));
    if (!hasTrance) deviations.push(KNOWN_RULE_DEVIATIONS[7]);

    const cloud = featuresByNumber.get('ACT-goliath-cloud');
    if (nonSpellKinds(cloud!).every((kind) => kind === 'narrative')) {
      deviations.push(KNOWN_RULE_DEVIATIONS[8]);
    }

    const manuallyActivatedGiantGifts = [
      'ACT-goliath-fire',
      'ACT-goliath-frost',
      'ACT-goliath-hill',
      'ACT-goliath-storm',
    ].every((cardNumber) =>
      (featuresByNumber.get(cardNumber)?.mechanics?.activation as Dict | undefined)?.mode === 'active');
    if (manuallyActivatedGiantGifts) deviations.push(KNOWN_RULE_DEVIATIONS[9]);

    const narrativeOnly = (cardNumber: string) => {
      const feature = featuresByNumber.get(cardNumber);
      return !!feature && nonSpellKinds(feature).every((kind) => kind === 'narrative');
    };
    if (narrativeOnly('RE-halfling-2') && narrativeOnly('RE-halfling-4')) {
      deviations.push(KNOWN_RULE_DEVIATIONS[10]);
    }
    if (narrativeOnly('EFF-tabaxi-feline')) deviations.push(KNOWN_RULE_DEVIATIONS[11]);
    if (narrativeOnly('EFF-warforged-sentry-rest')) deviations.push(KNOWN_RULE_DEVIATIONS[12]);

    const dragonCombo = combos.find((combo) => combo.race.id === dragon.id)!;
    const dragonBuild = build(dragonCombo, klass, 20);
    const racialActionIds = new Set(
      dragonBuild.assembled.actions
        .filter(({ origin }) => origin.kind === 'race')
        .map(({ action }) => action.id),
    );
    const hasMisgroupedRacialAction = collectSheetActions(dragonBuild.assembled)
      .some((action) => racialActionIds.has(action.id) && action.group === 'class');
    if (hasMisgroupedRacialAction) deviations.push(KNOWN_RULE_DEVIATIONS[13]);

    expect(deviations).toEqual(KNOWN_RULE_DEVIATIONS);
  });
});
