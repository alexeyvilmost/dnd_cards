import { cardsApi } from '../api/client';
import type { Card } from '../types';
import type { AssembledCharacter } from '../character/assemble';
import type { PatchCharacterRuntimeRequest } from '../character/api';
import { characterToDraft, resolveLineageName } from '../character/forgeHelpers';
import { readAttunedIds } from '../character/attunement';
import { forgeToRuntimeState } from '../character/runtime';
import { runtimeSeedFromSavePayload } from '../character/saveCharacter';
import { preparedSpellSelection } from '../character/sheetSpellPreparation';
import { projectSheetSpellGrantAccess } from '../character/sheetCanonicalWorld';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { ABILITY_IDS, SKILL_IDS, SKILL_ABILITY } from '../character/rules/foundation';
import type { CharacterRuleState } from '../character/rules/types';
import type { AbilityKey, CharacterDraft, ForgeCharacter, SaveForgeCharacterRequest } from '../character/types';
import type { RuntimeState } from '../mvp/contracts';
import { EQUIPMENT_SLOTS } from '../engine/equipment';
import { parseWeaponProfile } from '../engine/weaponProfile';
import resourceDeclarations from '../engine/data/resources.json';
import { resourceLabel } from '../utils/resourcePresentation';
import { calculateSheet, createPaperSheet, type PaperProgressionBaseline, type PaperSheetDocument } from './model';
import { loadPaperEquipmentEffects, projectPaperEquipment, type PaperGrantedEffectSnapshot } from './equipmentEffects';
import { loadPaperIdentityAssembly, loadPaperItemGrantedEffects } from './loadPaperIdentityAssembly';
import { paperIdentitySourceKey, projectPaperIdentityFeatures } from './identity';
import { PAPER_ENTITY_TOKEN_PATTERN, paperEntityToken, parsePaperEntityToken } from './references';
import { preparedSpellPatch, weaponCardPatch, weaponSpellPatch } from './rowAutofill';
import { MAX_PAPER_INVENTORY_ROWS } from './paperEquipment';

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const clone = <T,>(value: T): T => structuredClone(value);
const number = (value: number | undefined, fallback = 0) => String(value ?? fallback);
const offset = (expression: string, extra: number) => `=${expression}${extra ? ` ${extra < 0 ? '-' : '+'} ${Math.abs(extra)}` : ''}`;
const SIZE_KEYS = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const CURRENCY = { copper: 'coinCp', silver: 'coinSp', electrum: 'coinEp', gold: 'coinGp', platinum: 'coinPp' };
const BUILD_OFFSET_FIELDS = ['hpMax', 'speed', 'proficiency'] as const;
const buildOffsetKey = (field: typeof BUILD_OFFSET_FIELDS[number]) => `buildOffset.${field}`;
const storedOffset = (value: string | undefined): number | undefined => value?.trim() && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) && Number.isFinite(Number(value)) ? Number(value) : undefined;

export interface CharacterToPaperInput {
  character: ForgeCharacter;
  /** Canonical build assembly, before item-owned feat/effect expansion. */
  assembled: AssembledCharacter;
  cards: ReadonlyMap<string, Card>;
  draft?: CharacterDraft;
  runtime?: RuntimeState;
  /** Base build rules only: no equipment or temporary runtime sources. */
  ruleState?: CharacterRuleState;
  /** Required for a full item projection when an owned item grants another effect. Async entry points hydrate this. */
  equipmentEffects?: PaperGrantedEffectSnapshot;
}

export function paperProgressionBaseline(doc: PaperSheetDocument): PaperProgressionBaseline {
  return clone({ fields: doc.fields, checks: doc.checks, training: doc.training, sections: doc.sections,
    portrait: doc.portrait, weaponRows: doc.weaponRows, spellRows: doc.spellRows });
}

/** Pure conversion: read saved pools, never rest, roll dice, or persist the source character. */
export function characterToPaperSheet(input: CharacterToPaperInput): PaperSheetDocument {
  const { character, assembled, cards } = input;
  const draft = input.draft ?? characterToDraft(character);
  const runtime = input.runtime ?? forgeToRuntimeState(character);
  const rules = input.ruleState ?? resolveCharacterRules({ draft, assembled });
  const savedOffset = (current: number | undefined, base: number | undefined) => Number.isFinite(current) && Number.isFinite(base) ? current! - base! : 0;
  const speedOffset = savedOffset(character.speed, character.rule_state?.speed);
  const proficiencyOffset = savedOffset(character.proficiency_bonus, character.rule_state?.proficiencyBonus);
  const doc = createPaperSheet();
  if (speedOffset) doc.fields[buildOffsetKey('speed')] = number(speedOffset);
  if (proficiencyOffset) doc.fields[buildOffsetKey('proficiency')] = number(proficiencyOffset);
  const section = (key: string, text: string) => { if (text) doc.sections[key] = { text, fontSize: 12 }; };
  const itemToken = (id: string) => {
    const card = cards.get(id);
    if (!card) throw new Error(`Не загрузился предмет ${id}. Бумажный лист не изменён.`);
    return paperEntityToken({ type: 'card', id: card.id, name: card.name });
  };
  doc.identity = {
    ...(draft.raceId ? { speciesId: draft.raceId } : {}), ...(assembled.subrace?.id ? { subspeciesId: assembled.subrace.id } : {}),
    ...(draft.classId ? { classId: draft.classId } : {}), ...(draft.subclassId ? { subclassId: draft.subclassId } : {}),
    ...(draft.backgroundId ? { backgroundId: draft.backgroundId } : {}),
  };
  if (!assembled.subrace && draft.lineageId && assembled.race?.lineages?.some(lineage => lineage.name === draft.lineageId || (lineage as { id?: string }).id === draft.lineageId)) doc.fields['identity.inlineLineageId'] = draft.lineageId;
  const classes = assembled.classes ?? (assembled.klass ? [assembled.klass] : []);
  Object.assign(doc.fields, {
    name: draft.name, level: number(draft.level), class: classes.map(entry => `${entry.name}${classes.length > 1 ? ` ${draft.classLevels[entry.id] ?? 0}` : ''}`).join(' / '),
    subclass: (assembled.subclasses ?? (assembled.subclass ? [assembled.subclass] : [])).map(entry => entry.name).join(' / '),
    species: assembled.race?.name ?? '', subspecies: resolveLineageName(draft.lineageId, { subraces: assembled.subrace ? [assembled.subrace] : [], lineages: assembled.race?.lineages }) ?? '',
    background: assembled.background?.name ?? '', size: SIZE_KEYS[rules.size] ?? '', proficiency: number(rules.proficiencyBonus + proficiencyOffset),
    hpCurrent: number(runtime.hp.current), hpTemp: number(runtime.hp.temp), speed: number(rules.speed + speedOffset),
    hpMax: offset(`${rules.maxHP - rules.abilityMods.con * draft.level} + [CON] * ${draft.level}`, 0),
    ac: rules.armorClass === 10 + rules.abilityMods.dex ? '=10 + [DEX]' : number(rules.armorClass),
    initiative: offset('[DEX]', rules.initiativeBonus - rules.abilityMods.dex),
    passive: offset('10 + [skill.perception]', rules.passivePerception - 10 - (rules.skillBonuses.perception ?? rules.abilityMods.wis)),
    capacity: number(rules.carryingCapacity), hitDie: assembled.klass?.hit_die ?? '',
  });
  for (const ability of ABILITY_IDS) {
    doc.fields[ability] = number(rules.abilities[ability], draft.abilities[ability] ?? 10);
    const rank = rules.proficiencies.savingThrows.includes(ability) ? 1 : 0;
    doc.training[`save.${ability}`] = rank;
    const extra = rules.savingThrowBonuses[ability] - rules.abilityMods[ability] - rank * rules.proficiencyBonus;
    if (extra) doc.fields[`save.${ability}`] = offset(`[${ability.toUpperCase()}] + [PROF] * ${rank}`, extra);
  }
  for (const skill of SKILL_IDS) {
    const rank = rules.expertise.skills.includes(skill) ? 2 : rules.proficiencies.skills.includes(skill) ? 1 : 0;
    doc.training[skill] = rank;
    const ability = SKILL_ABILITY[skill] as AbilityKey;
    const extra = (rules.skillBonuses[skill] ?? rules.abilityMods[ability]) - rules.abilityMods[ability] - rank * rules.proficiencyBonus;
    if (extra) doc.fields[`skill.${skill}`] = offset(`[${ability.toUpperCase()}] + [PROF] * ${rank}`, extra);
  }
  for (const [id, field] of [['light', 'lightArmor'], ['medium', 'mediumArmor'], ['heavy', 'heavyArmor'], ['shield', 'shield']] as const) doc.checks[`proficiency.${field}`] = rules.proficiencies.armor.includes(id);
  for (const [id, field] of [['simple', 'simpleWeapons'], ['martial', 'martialWeapons']] as const) doc.checks[`proficiency.${field}`] = rules.proficiencies.weapons.includes(id);
  if (rules.spellcasting) {
    doc.fields.spellAbility = rules.spellcasting.ability;
    doc.fields.spellDC = offset('8 + [PROF] + [spellMod]', rules.spellcasting.saveDC - 8 - rules.proficiencyBonus - rules.abilityMods[rules.spellcasting.ability]);
    doc.fields.spellAttack = offset('[PROF] + [spellMod]', rules.spellcasting.attack - rules.proficiencyBonus - rules.abilityMods[rules.spellcasting.ability]);
  }
  section('proficiencies', [rules.proficiencies.tools.length ? `Инструменты: ${rules.proficiencies.tools.join(', ')}` : '', rules.expertise.tools.length ? `Экспертиза инструментов: ${rules.expertise.tools.join(', ')}` : '', rules.proficiencies.languages.length ? `Языки: ${rules.proficiencies.languages.join(', ')}` : '', rules.proficiencies.weapons.length ? `Оружие: ${rules.proficiencies.weapons.join(', ')}` : '', rules.proficiencies.armor.length ? `Доспехи: ${rules.proficiencies.armor.join(', ')}` : ''].filter(Boolean).join('\n'));
  section('appearance', draft.description ?? character.description ?? '');
  section('notes1', draft.notes ?? character.notes ?? '');
  doc.portrait = draft.avatarUrl ?? character.avatar_url ?? '';
  const features = [...assembled.actions.map(({ action }) => paperEntityToken({ type: 'action', id: action.id, name: action.name })), ...assembled.effects.map(({ effect }) => paperEntityToken({ type: 'effect', id: effect.id, name: effect.name }))];
  section('features', [...new Set(features)].join('\n'));
  section('traits', [...new Set(assembled.feats.map(feat => paperEntityToken({ type: 'feat', id: feat.id, name: feat.name })))].join('\n'));

  if (runtime.inventory.length > MAX_PAPER_INVENTORY_ROWS) throw new Error(`В персонаже больше ${MAX_PAPER_INVENTORY_ROWS} строк инвентаря. Перенос остановлен без потери предметов.`);
  doc.fields.inventoryRows = number(Math.max(28, runtime.inventory.length));
  const containers: string[] = [];
  runtime.inventory.forEach((row, index) => {
    doc.fields[`inventory.${index}.item`] = itemToken(row.cardId);
    doc.fields[`inventory.${index}.quantity`] = number(row.qty);
    if (row.containerId) {
      doc.fields[`inventory.${index}.containerId`] = row.containerId;
      containers.push(`${itemToken(row.cardId)} × ${row.qty}: ${itemToken(row.containerId)}`);
    }
  });
  for (const [slot, id] of Object.entries(runtime.equipment)) if (id) doc.fields[`equipment.${slot}`] = itemToken(id);
  section('equipment', containers.length ? `Содержимое контейнеров\n${containers.join('\n')}` : '');
  const attuned = readAttunedIds(character.turn_state);
  doc.fields.attunementSlots = number(Math.max(3, attuned.length));
  attuned.forEach((id, index) => { doc.fields[`attunementName${index}`] = itemToken(id); doc.checks[`attunement${index}`] = true; });
  for (const [key, field] of Object.entries(CURRENCY)) doc.fields[field] = number(character.currency?.[key]);
  for (let level = 1; level <= 9; level++) {
    const key = `spell_slot_${level}`;
    if (runtime.maxResources[key] !== undefined || runtime.resources[key] !== undefined) {
      const max = runtime.maxResources[key] ?? runtime.resources[key] ?? 0;
      doc.fields[`slot${level}Max`] = number(max);
      doc.fields[`slot${level}Used`] = number(max - (runtime.resources[key] ?? max));
    }
  }
  const hitKeys = Object.values(resourceDeclarations.hit_dice).filter(key => runtime.maxResources[key] !== undefined || runtime.resources[key] !== undefined);
  if (hitKeys.length) {
    doc.fields.hitDiceMax = number(hitKeys.reduce((sum, key) => sum + (runtime.maxResources[key] ?? 0), 0));
    doc.fields.hitDiceCurrent = number(hitKeys.reduce((sum, key) => sum + (runtime.resources[key] ?? runtime.maxResources[key] ?? 0), 0));
  }
  doc.checks.inspiration = (runtime.resources.heroic_inspiration ?? 0) > 0;
  for (let count = 1; count <= 3; count++) {
    doc.checks[`death.success.${count}`] = (runtime.deathSaves?.successes ?? 0) >= count;
    doc.checks[`death.failure.${count}`] = (runtime.deathSaves?.failures ?? 0) >= count;
  }
  const options = assembled.resources.map(resource => ({ id: resource.resource_id, label: resource.name }));
  const resourceIds = [...new Set([...Object.keys(runtime.maxResources), ...Object.keys(runtime.resources)])].filter(id => !/^spell_slot_[1-9]$/.test(id));
  const resourceNames = resourceIds.map(id => resourceLabel(options, id));
  const resourceNotes = resourceIds.map((id, index) => {
    const label = `${resourceNames[index]}${resourceNames.indexOf(resourceNames[index]) !== resourceNames.lastIndexOf(resourceNames[index]) ? ` (${id})` : ''}`.replace(/[|{}\r\n]/g, ' ');
    doc.fields[`resourceLabel.${id}`] = label;
    return `{{ресурс:${label}|${runtime.resources[id] ?? runtime.maxResources[id] ?? 0}|${runtime.maxResources[id] ?? ''}}}`;
  });
  const effects = runtime.activeEffects.map(effect => `${effect.name}${effect.roundsLeft === undefined ? '' : ` (${effect.roundsLeft} раунд.)`}`);
  doc.fields.conditions = effects.join(', ');
  section('additional', [...resourceNotes, ...(effects.length ? ['Эффекты на момент переноса (снимок)', ...effects] : []), ...(runtime.deathSaves?.stable ? ['Стабилен'] : []), ...(runtime.deathSaves?.dead ? ['Мёртв'] : []), ...Object.entries(character.currency ?? {}).filter(([key]) => !(key in CURRENCY)).map(([key, value]) => `Валюта ${key}: ${value}`)].join('\n'));

  const known = [...new Map(assembled.spells.map(spell => [spell.id, spell])).values()];
  const selected = new Set(assembled.pendingChoices.filter(choice => choice.source === 'prepared_spell').flatMap(choice => preparedSpellSelection(character, choice)));
  const spells = known.filter(spell => {
    const grants = rules.appliedGrants.filter(grant => grant.kind === 'spell' && (grant.value === spell.id || grant.value === spell.card_number));
    if (!grants.length) return true;
    return grants.some(grant => {
      const { access } = projectSheetSpellGrantAccess({ spell, grant, assembled });
      return access === 'spellbook' ? selected.has(spell.id) || selected.has(spell.card_number) : access !== 'unavailable';
    });
  });
  const preparedIds = new Set(spells.map(spell => spell.id));
  section('notes2', known.filter(spell => !preparedIds.has(spell.id)).map(spell => `${paperEntityToken({ type: 'spell', id: spell.id, name: spell.name })} — известно, не подготовлено`).join('\n'));
  if (spells.length > 100) throw new Error('В персонаже больше 100 заклинаний. Перенос остановлен без потери записей.');
  spells.forEach((spell, index) => { const patch = preparedSpellPatch(index, spell); Object.assign(doc.fields, patch.fields); Object.assign(doc.checks, patch.checks); });
  doc.spellRows = Math.max(38, spells.length);
  const ownedIds = [...new Set([...EQUIPMENT_SLOTS.flatMap(slot => runtime.equipment[slot] ? [runtime.equipment[slot]!] : []), ...runtime.inventory.map(row => row.cardId)])];
  const weapons = ownedIds.flatMap(id => { const card = cards.get(id); return card && (card.type === 'weapon' || parseWeaponProfile(card).valid) ? [card] : []; });
  const cantrips = spells.filter(spell => spell.level === 0);
  if (weapons.length + cantrips.length > 30) throw new Error('В персонаже больше 30 оружий и заговоров. Перенос остановлен без потери записей.');
  weapons.forEach((card, index) => Object.assign(doc.fields, weaponCardPatch(index, card).fields));
  cantrips.forEach((spell, index) => Object.assign(doc.fields, weaponSpellPatch(weapons.length + index, spell).fields));
  doc.weaponRows = Math.max(1, weapons.length + cantrips.length);
  // The saved rules are the unequipped Forge baseline. A stale base maximum must not cancel live item grants.
  // Preserve a distinct rolled/manual maximum only when neither that baseline nor the current projection explains it.
  const projectedMaximum = calculateSheet(doc, projectPaperEquipment(doc, new Map(cards), input.equipmentEffects)).values.hpMax;
  const savedBaseMaximum = character.rule_state?.maxHP;
  if (Number.isFinite(savedBaseMaximum) && Number.isFinite(runtime.hp.max) && Number.isFinite(projectedMaximum) && runtime.hp.max !== savedBaseMaximum && runtime.hp.max !== projectedMaximum) {
    const hpOffset = runtime.hp.max - projectedMaximum;
    doc.fields.hpMax = offset(`(${doc.fields.hpMax.slice(1)})`, hpOffset);
    doc.fields[buildOffsetKey('hpMax')] = number(hpOffset);
  }
  else if (!Number.isFinite(savedBaseMaximum) && runtime.hp.max !== projectedMaximum) {
    section('additional', [doc.sections.additional?.text, `Сохранённый максимум хитов: ${runtime.hp.max}; происхождение ручной поправки неизвестно.`].filter(Boolean).join('\n'));
  }
  const storedDraft = clone(draft); delete storedDraft.id;
  doc.progression = { draft: storedDraft, baseline: paperProgressionBaseline(doc) };
  doc.identityFeatures = projectPaperIdentityFeatures(assembled, paperIdentitySourceKey(doc), true);
  return doc;
}

async function loadOwnedCards(character: ForgeCharacter): Promise<Map<string, Card>> {
  const ids = [...new Set([...Object.values(character.equipment ?? {}), ...(character.inventory_items ?? []).flatMap(row => [row.card_id, row.container_id]), ...readAttunedIds(character.turn_state)].filter((id): id is string => !!id))];
  const cards = await Promise.all(ids.map(async id => {
    const card = await cardsApi.getCard(id);
    if (!card || card.id !== id) throw new Error(`Не загрузился предмет ${id}. Бумажный лист не изменён.`);
    return card;
  }));
  return new Map(cards.map(card => [card.id, card]));
}

export async function exportInteractiveCharacterToPaper(character: ForgeCharacter): Promise<PaperSheetDocument> {
  const draft = characterToDraft(character);
  const [assembled, cards] = await Promise.all([loadPaperIdentityAssembly(draft), loadOwnedCards(character)]);
  return hydratedPaperSheet({ character, draft, assembled, cards });
}

async function hydratedPaperSheet(input: CharacterToPaperInput): Promise<PaperSheetDocument> {
  // The shared loader keys only build abilities, level and eligible item mechanics; HP correction cannot change its identity.
  const initial = characterToPaperSheet(input);
  const equipmentEffects = await loadPaperEquipmentEffects(initial, new Map(input.cards), loadPaperItemGrantedEffects);
  return characterToPaperSheet({ ...input, equipmentEffects });
}

export interface ForgeCharacterToPaperInput {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  payload: SaveForgeCharacterRequest;
  initialRuntime?: PatchCharacterRuntimeRequest;
  existing?: PaperSheetDocument;
}

export async function forgeCharacterToPaper(input: ForgeCharacterToPaperInput): Promise<PaperSheetDocument> {
  const character = runtimeSeedFromSavePayload({ ...input.payload, ...input.initialRuntime });
  const cards = await loadOwnedCards(character);
  const next = await hydratedPaperSheet({ ...input, character, cards });
  if (!input.existing) return next;
  inheritBuildOffsets(next, input.existing);
  const merged = mergePaperProgression(input.existing, next);
  // Provenance is generated metadata, not a player-editable statistic. Never trust an edited current marker.
  for (const field of BUILD_OFFSET_FIELDS) {
    const key = buildOffsetKey(field);
    if (own(next.fields, key)) merged.fields[key] = next.fields[key];
  }
  return merged;
}

function inheritBuildOffsets(next: PaperSheetDocument, existing: PaperSheetDocument): void {
  for (const field of BUILD_OFFSET_FIELDS) {
    const key = buildOffsetKey(field);
    const inherited = storedOffset(existing.progression?.baseline?.fields?.[key]);
    if (inherited === undefined) continue; // Old native sheets have no authoritative offset to infer.
    const fresh = storedOffset(next.fields[key]) ?? 0;
    const difference = inherited - fresh;
    if (difference) {
      const value = next.fields[field];
      next.fields[field] = value.startsWith('=') ? offset(`(${value.slice(1)})`, difference) : number(Number(value) + difference);
    }
    next.fields[key] = number(inherited);
  }
  // Capture the newly calculated base plus exactly one inherited adjustment before preserving manual edits.
  if (next.progression) next.progression.baseline = paperProgressionBaseline(next);
}

const runtimeField = (key: string) => /^(?:hpCurrent|hpTemp|hitDiceCurrent|conditions|coin\w+|slot\d+Used|inventoryRows|inventory\.|equipment\.|attunement)/.test(key);
const runtimeCheck = (key: string) => /^(?:death\.|exhaustion\.|inspiration$|attunement)/.test(key);
const tableField = (key: string) => /^(?:spellRow\d+|weapon\.\d+\.)/.test(key);
const entityKey = (text: string) => { const entity = parsePaperEntityToken(text); return entity ? `${entity.type}:${entity.id}` : text; };
const RETAINED_ROW_NOTE = 'Больше не выбрано в сборке; ручная запись сохранена.';

function mergeResourceNotes(current: string, previous: string, next: string, previousFields: Record<string, string> = {}, nextFields: Record<string, string> = {}): string {
  const pattern = /\{\{ресурс:([^|{}]+)\|([^|{}]*)\|([^|{}]*)\}\}/g;
  const renamed = new Map(Object.entries(previousFields).flatMap(([key, label]) => key.startsWith('resourceLabel.') && nextFields[key] && label !== nextFields[key] ? [[label, nextFields[key]]] : []));
  const rename = (text: string) => text.replace(pattern, (token, name: string, remaining: string, maximum: string) => renamed.has(name) ? `{{ресурс:${renamed.get(name)}|${remaining}|${maximum}}}` : token);
  current = rename(current); previous = rename(previous);
  const entries = (text: string) => new Map([...text.matchAll(pattern)].map(match => [match[1], { token: match[0], max: match[3] }]));
  const before = entries(previous), after = entries(next), present = entries(current);
  const updated = current.replace(pattern, (token, name: string, remaining: string, maximum: string) => {
    const old = before.get(name), fresh = after.get(name);
    return old && fresh && old.max === maximum ? `{{ресурс:${name}|${remaining}|${fresh.max}}}` : token;
  });
  const additions = [...after].filter(([name]) => !before.has(name) && !present.has(name)).map(([, value]) => value.token);
  return [updated, ...additions].filter(Boolean).join('\n');
}

/** Upgrade only generated values that the player has not changed since the previous build. */
export function mergePaperProgression(existing: PaperSheetDocument, next: PaperSheetDocument): PaperSheetDocument {
  const output = clone(existing);
  const before = existing.progression?.baseline;
  const baseline = clone(next.progression?.baseline ?? paperProgressionBaseline(next));
  for (const group of ['fields', 'checks'] as const) {
    const values: Record<string, string | boolean> = { ...baseline[group] };
    for (const key of Object.keys(values)) if (tableField(key)) delete values[key];
    for (const [key, value] of Object.entries(before?.[group] ?? {})) if (tableField(key)) Object.assign(values, { [key]: value });
    Object.assign(baseline, { [group]: values });
  }
  for (const [key, value] of Object.entries(next.fields)) {
    if (tableField(key)) continue;
    if (!own(existing.fields, key) || (!runtimeField(key) && before?.fields && own(before.fields, key) && existing.fields[key] === before.fields[key])) output.fields[key] = value;
  }
  for (const key of Object.keys(before?.fields ?? {})) if (!tableField(key) && !runtimeField(key) && !own(next.fields, key) && existing.fields[key] === before!.fields![key]) delete output.fields[key];
  if (calculateSheet(existing).values.level !== calculateSheet(next).values.level) output.fields.level = next.fields.level;
  for (const [key, value] of Object.entries(next.checks)) {
    if (tableField(key)) continue;
    if (!own(existing.checks, key) || (!runtimeCheck(key) && before?.checks && own(before.checks, key) && existing.checks[key] === before.checks[key])) output.checks[key] = value;
  }
  for (const [key, value] of Object.entries(next.training)) if (!own(existing.training, key) || (before?.training && own(before.training, key) && existing.training[key] === before.training[key])) output.training[key] = value;
  const nextSections = { ...next.sections };
  for (const key of ['features', 'traits', 'notes2']) if (before?.sections?.[key] && !nextSections[key]) nextSections[key] = { ...before.sections[key], text: '' };
  for (const [key, value] of Object.entries(nextSections)) {
    const current = existing.sections[key];
    if (!current) { output.sections[key] = clone(value); continue; }
    const previous = before?.sections?.[key];
    if (!previous) continue;
    if (key === 'additional') { output.sections[key] = { ...current, text: mergeResourceNotes(current.text, previous.text, value.text, before?.fields, next.fields) }; continue; }
    if (['notes1', 'appearance', 'equipment'].includes(key)) continue;
    if (current.text === previous.text) output.sections[key] = { ...current, text: value.text };
    else if (key === 'features' || key === 'traits') {
      const priorTokens = new Map([...previous.text.matchAll(PAPER_ENTITY_TOKEN_PATTERN)].map(match => [entityKey(match[0]), match[0]]));
      const prior = new Set(priorTokens.keys());
      const nextIds = new Set([...value.text.matchAll(PAPER_ENTITY_TOKEN_PATTERN)].map(match => entityKey(match[0])));
      // Only whole generated lines are removed. A player-renamed link or inline prose is a manual edit.
      const retained = current.text.split('\n').filter(line => !(priorTokens.get(entityKey(line)) === line && !nextIds.has(entityKey(line)))).join('\n');
      const currentIds = new Set([...retained.matchAll(PAPER_ENTITY_TOKEN_PATTERN)].map(match => entityKey(match[0])));
      const added = [...value.text.matchAll(PAPER_ENTITY_TOKEN_PATTERN)].map(match => match[0]).filter(token => !prior.has(entityKey(token)) && !currentIds.has(entityKey(token)));
      output.sections[key] = { ...current, text: [retained, ...added].filter(Boolean).join('\n') };
    }
  }
  for (const kind of ['spell', 'weapon'] as const) {
    const pendingFields: Record<string, string> = {}, pendingChecks: Record<string, boolean> = {};
    const removedBaselineKeys = new Set<string>();
    const pattern = kind === 'spell' ? /^spellRow(\d+)Name$/ : /^weapon\.(\d+)\.name$/;
    const prefix = (index: number) => kind === 'spell' ? `spellRow${index}` : `weapon.${index}.`;
    const rowKey = (key: string, index: number) => key.startsWith(prefix(index)) && !(kind === 'spell' && /^\d/.test(key.slice(prefix(index).length)));
    const names = (fields: Record<string, string>) => Object.entries(fields).flatMap(([key, value]) => { const match = pattern.exec(key); return match && value ? [{ index: Number(match[1]), key: entityKey(value) }] : []; }).sort((first, second) => first.index - second.index);
    const oldNames = names(before?.fields ?? {}), currentNames = names(existing.fields);
    const incomingNames = names(next.fields), incomingIds = new Set(incomingNames.map(row => row.key));
    const vacated: number[] = [];
    // Owned card weapons remain even when a Forge payload does not repeat inventory/equipment.
    for (const previousRow of oldNames.filter(row => !incomingIds.has(row.key) && (kind === 'spell' || row.key.startsWith('spell:')))) {
      const currentRow = currentNames.find(row => row.key === previousRow.key);
      if (!currentRow) continue;
      const untouched = (['fields', 'checks'] as const).every(group => {
        const oldEntries = Object.entries(before?.[group] ?? {}).filter(([key]) => rowKey(key, previousRow.index));
        const currentEntries = Object.entries(existing[group]).filter(([key]) => rowKey(key, currentRow.index));
        return oldEntries.length === currentEntries.length && oldEntries.every(([key, value]) => existing[group][prefix(currentRow.index) + key.slice(prefix(previousRow.index).length)] === value);
      });
      if (untouched) {
        for (const group of ['fields', 'checks'] as const) {
          for (const key of Object.keys(output[group])) if (rowKey(key, currentRow.index)) delete output[group][key];
          for (const key of Object.keys(before?.[group] ?? {})) if (rowKey(key, previousRow.index)) removedBaselineKeys.add(key);
        }
        vacated.push(currentRow.index);
      } else {
        const notesKey = prefix(currentRow.index) + (kind === 'spell' ? 'Notes' : 'notes');
        const notes = output.fields[notesKey] ?? '';
        if (!notes.includes(RETAINED_ROW_NOTE)) output.fields[notesKey] = [notes, RETAINED_ROW_NOTE].filter(Boolean).join('\n');
      }
    }
    let last = Math.max(-1, ...Object.keys({ ...existing.fields, ...existing.checks }).flatMap(key => { const match = (kind === 'spell' ? /^spellRow(\d+)/ : /^weapon\.(\d+)\./).exec(key); return match ? [Number(match[1])] : []; }));
    for (const row of incomingNames) {
      const currentRow = currentNames.find(item => item.key === row.key);
      const previousRow = oldNames.find(item => item.key === row.key);
      if (!currentRow && previousRow) continue; // Explicitly removed by the player.
      const destination = currentRow?.index ?? vacated.shift() ?? ++last;
      if (destination >= (kind === 'spell' ? 100 : 30)) throw new Error('Недостаточно строк для новых записей. Существующий лист не изменён.');
      const restoredNotesKey = prefix(destination) + (kind === 'spell' ? 'Notes' : 'notes');
      if (currentRow && output.fields[restoredNotesKey]?.split('\n').includes(RETAINED_ROW_NOTE)) output.fields[restoredNotesKey] = output.fields[restoredNotesKey].split('\n').filter(line => line !== RETAINED_ROW_NOTE).join('\n');
      for (const group of ['fields', 'checks'] as const) for (const [key, value] of Object.entries(next[group])) {
        if (!rowKey(key, row.index)) continue;
        const suffix = key.slice(prefix(row.index).length);
        const target = prefix(destination) + suffix;
        const oldKey = previousRow ? prefix(previousRow.index) + suffix : '';
        if (!currentRow || (previousRow && before?.[group] && own(before[group], oldKey) && existing[group][target] === before[group][oldKey])) Object.assign(output[group], { [target]: value });
        if (previousRow && oldKey !== target) removedBaselineKeys.add(oldKey);
        Object.assign(group === 'fields' ? pendingFields : pendingChecks, { [target]: value });
      }
    }
    // Apply all removals before writes: two rows can exchange positions without deleting one another's new baseline.
    for (const key of removedBaselineKeys) { delete baseline.fields![key]; delete baseline.checks![key]; }
    Object.assign(baseline.fields!, pendingFields); Object.assign(baseline.checks!, pendingChecks);
    if (kind === 'spell') output.spellRows = Math.max(existing.spellRows, last + 1);
    else output.weaponRows = Math.max(existing.weaponRows, last + 1);
  }
  if (before?.portrait !== undefined && existing.portrait === before.portrait) output.portrait = next.portrait;
  for (const [id, field] of [['classId', 'class'], ['subclassId', 'subclass'], ['speciesId', 'species'], ['subspeciesId', 'subspecies'], ['backgroundId', 'background']] as const) {
    if (existing.identity?.[id] !== next.identity?.[id] && own(next.fields, field)) output.fields[field] = next.fields[field];
  }
  const inlineLineageKey = 'identity.inlineLineageId';
  if (next.fields[inlineLineageKey] && next.fields[inlineLineageKey] !== existing.fields[inlineLineageKey]) {
    output.fields[inlineLineageKey] = next.fields[inlineLineageKey];
    output.fields.subspecies = next.fields.subspecies;
  }
  output.identity = clone(next.identity);
  output.progression = next.progression ? { draft: clone(next.progression.draft), baseline } : undefined;
  output.identityFeatures = clone(next.identityFeatures);
  return output;
}
