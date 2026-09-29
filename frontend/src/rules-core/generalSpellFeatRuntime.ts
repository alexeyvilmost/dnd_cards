import type { RuleActionDefinition } from './domain';

type Dict = Record<string, unknown>;

function record(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function payloads(value: unknown): Dict[] {
  const result: Dict[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const row = record(candidate);
    if (!row) return;
    if (typeof row.kind === 'string') result.push(row);
    Object.values(row).forEach(visit);
  };
  visit(value);
  return result;
}

function rule(passives: readonly Dict[], reason: string): Dict | undefined {
  return passives.flatMap(payloads).find((payload) => (
    payload.kind === 'modifier' && payload.reason === reason
  ));
}

function isSpellAttack(action: RuleActionDefinition): boolean {
  return action.kind === 'spell' && Array.isArray(action.mechanics.effects)
    && action.mechanics.effects.some((candidate) => record(candidate)?.resolution === 'attack_roll');
}

/** Apply source-owned Spell Sniper range without mutating the library spell. */
export function applyGeneralSpellFeatActionRules(
  action: RuleActionDefinition,
  passives: readonly Dict[],
): RuleActionDefinition {
  const teleportBonuses=passives.flatMap(payloads).filter(payload=>payload.kind==='spell_teleport_range')
    .map(payload=>Number(payload.bonus_ft)).filter(value=>Number.isFinite(value)&&value>0);
  const teleportBonus=teleportBonuses.reduce((sum,value)=>sum+value,0);
  const hasTeleport=action.kind==='spell'&&payloads(action.mechanics).some(payload=>payload.kind==='movement'&&payload.value==='teleport');
  let projected=action;
  if(hasTeleport&&teleportBonus>0){
    projected=clone(action);
    const apply=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.map(apply);
      const row=record(value);
      if(!row)return value;
      return Object.fromEntries(Object.entries(row).map(([key,entry])=>{
      if(key==='distance'&&row.kind==='movement'&&row.value==='teleport'
        &&(typeof entry==='number'||typeof entry==='string'&&/^\d+$/.test(entry))){
        const distance=Number(entry);
        if(Number.isSafeInteger(distance)&&distance>=0)return [key,distance+teleportBonus];
      }
      return [key,apply(entry)];
    }));
    };
    projected.mechanics=apply(projected.mechanics) as RuleActionDefinition['mechanics'];
    if(projected.targeting&&projected.targeting.rangeFt>0){
      projected.targeting={...projected.targeting,rangeFt:projected.targeting.rangeFt+teleportBonus};
      const targeting=record(projected.mechanics.targeting);
      if(targeting&&typeof targeting.range_ft==='number')projected.mechanics.targeting={...targeting,range_ft:targeting.range_ft+teleportBonus};
    }
  }
  if (!isSpellAttack(projected) || !projected.targeting || projected.targeting.rangeFt < 10) return projected;
  const rangeRule = rule(passives, 'spell_sniper_range_ft');
  const bonus = Number(rangeRule?.value ?? 0);
  if (!Number.isFinite(bonus) || bonus <= 0) return projected;
  const next = clone(projected);
  next.targeting = { ...next.targeting!, rangeFt: next.targeting!.rangeFt + bonus };
  const targeting = record(next.mechanics.targeting);
  if (targeting && typeof targeting.range_ft === 'number') {
    next.mechanics.targeting = { ...targeting, range_ft: targeting.range_ft + bonus };
  }
  return next;
}

/** Cover is board input; only an explicit data rule can erase its AC bonus. */
export function spellAttackIgnoresCover(
  passives: readonly Dict[],
  cover: 'none' | 'half' | 'three_quarters' | 'total',
): boolean {
  if (cover === 'none' || cover === 'total') return false;
  return passives.flatMap(payloads).some((payload) => {
    const applies = record(payload.applies_to);
    const filter = record(applies?.filter);
    return payload.kind === 'modifier' && payload.op === 'deny'
      && payload.reason === 'spell_sniper_ignore_cover'
      && applies?.roll === 'attack' && filter?.attackKind === 'spell' && filter.cover === cover;
  });
}

export function spellAttackIgnoresAdjacentDisadvantage(passives: readonly Dict[]): boolean {
  return rule(passives, 'spell_sniper_ignore_adjacent_disadvantage') !== undefined;
}

/** Quick Ritual is one shared pool and applies to every prepared ritual spell. */
export function hasRitualCasterQuickRitual(passives: readonly Dict[]): boolean {
  return passives.flatMap(payloads).some((payload) => (
    payload.kind === 'resource'
      && payload.id === 'ritual_caster_quick_ritual'
      && (payload.op === 'grant' || payload.op === 'set_max')
  ));
}

export interface ElementalAdeptPolicy {
  ignoreResistance: boolean;
  minimumNaturalDamageDie: number;
}

export function elementalAdeptPolicy(
  passives: readonly Dict[],
  damageType: string,
): ElementalAdeptPolicy {
  const matching = passives.flatMap(payloads).filter((payload) => {
    const applies = record(payload.applies_to);
    const filter = record(applies?.filter);
    return payload.kind === 'modifier' && applies?.roll === 'damage'
      && filter?.attackKind === 'spell' && filter.damageType === damageType;
  });
  return {
    ignoreResistance: matching.some((payload) => (
      payload.op === 'deny' && payload.reason === 'ignore_spell_damage_resistance'
    )),
    minimumNaturalDamageDie: Math.max(0, ...matching.flatMap((payload) => (
      payload.op === 'minimum_die' && payload.reason === 'elemental_adept_minimum_die'
        ? [Number(payload.value) || 0]
        : []
    ))),
  };
}

export function warCasterAllowsSomaticWithOccupiedHands(passives: readonly Dict[]): boolean {
  return rule(passives, 'war_caster_somatic_components') !== undefined;
}

/** Build the exact single-target Action spell as a reaction cast for War Caster. */
export function warCasterOpportunitySpellVersion(
  action: RuleActionDefinition,
  passives: readonly Dict[],
): RuleActionDefinition | null {
  if (!rule(passives, 'war_caster_opportunity_spell') || action.kind !== 'spell'
    || !action.targeting || action.targeting.maxTargets !== 1
    || action.targeting.allowedRelations?.includes('enemy') !== true) return null;
  const activation = record(action.mechanics.activation);
  const costs = Array.isArray(activation?.cost) ? activation.cost.map(record).filter(Boolean) as Dict[] : [];
  if (activation?.mode !== 'active' || !costs.some((cost) => cost.resource === 'action')) return null;
  const next = clone(action);
  next.id = `${action.id}:war-caster-opportunity`;
  next.name = `${action.name} — Воинственная магия`;
  next.mechanics.activation = {
    ...activation,
    mode: 'reaction',
    cost: costs.map((cost) => cost.resource === 'action'
      ? { resource: 'reaction', amount: Number(cost.amount ?? 1) }
      : cost),
    trigger: { events: ['opportunity_attack'] },
  };
  return next;
}

export function mageSlayerBreaksConcentration(passives: readonly Dict[]): boolean {
  return rule(passives, 'mage_slayer_break_concentration') !== undefined;
}

export function mageSlayerProtectedMindOption(input: {
  passives: readonly Dict[];
  ability: string;
  outcome: string;
  resources: Readonly<Record<string, number>>;
}): { resource: string } | null {
  if (input.outcome === 'success' || !['int', 'wis', 'cha'].includes(input.ability)) return null;
  const payload = rule(input.passives, 'mage_slayer_protected_mind');
  const filter = record(record(payload?.applies_to)?.filter);
  const resource = typeof filter?.resource === 'string' ? filter.resource : '';
  return resource && (input.resources[resource] ?? 0) > 0 ? { resource } : null;
}
