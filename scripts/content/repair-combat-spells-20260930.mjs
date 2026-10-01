import {apiRequest, fetchAll, login} from './api.mjs';
import {fileURLToPath} from 'node:url';
import {sha256Canonical} from './certification-hash.mjs';
import {readFile} from 'node:fs/promises';

// Entity data, consumed by the ordinary rules executor in both sheet and combat.
export function repairCombatSpellMechanics(spell) {
  const mechanics = structuredClone(spell.mechanics);
  if (['SPELL-0164', 'SPELL-0254', 'SPELL-0186'].includes(spell.card_number)) {
    mechanics.activation.trigger = {...mechanics.activation.trigger,
      requires_melee_hit: true, requires_weapon_or_unarmed_hit: true};
    mechanics.targeting = {...mechanics.targeting, domain: 'actor', actor_targets: true,
      shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5,
      range_from_triggering_attack: true, requires_line_of_sight: false,
      allowed_relations: ['self', 'ally', 'enemy', 'neutral']};
  }
  if (spell.card_number === 'SPELL-0260') {
    mechanics.targeting = {...mechanics.targeting, filter: 'any', domain: 'actor', actor_targets: true,
      shape: 'single', min_targets: 1, max_targets: 1, range_ft: 60, requires_sight: true,
      requires_line_of_sight: true, allowed_relations: ['self', 'ally', 'enemy', 'neutral']};
    mechanics.effects = [{resolution: 'save', who: 'target', ability: 'wis', dc: '8 + prof + spellcasting',
      on_success: [], on_fail: [
        {kind: 'damage', dice: '1d8', type: 'necrotic', scaling: {dice: '1d8', per: 'character_level'},
          when: [{kind: 'not', of: {kind: 'target_hp_fraction_below', value: 1}}]},
        {kind: 'damage', dice: '1d12', type: 'necrotic', scaling: {dice: '1d12', per: 'character_level'},
          when: [{kind: 'target_hp_fraction_below', value: 1}]},
      ]}];
  } else if (spell.card_number === 'SPELL-0254') {
    const stackId = 'spell:searing-smite:burning';
    mechanics.effects = [{resolution: 'auto', who: 'target', result: [
      {kind: 'damage', dice: '1d6', type: 'fire', scaling: {dice: '1d6', per: 'spell_slot_above'}},
      {kind: 'triggered_effect', event: 'turn_start', duration: {type: 'rounds', amount: 10, round_boundary: 'end'},
        stack_id: stackId, stack_type: 'overwrite',
        formula_bindings: {searing_dice: '1 + spell_slot_above', searing_dc: '8 + prof + spellcasting'},
        effects: [
          {resolution: 'auto', who: 'self', result: [{kind: 'damage', dice: 'searing_dice d6', type: 'fire', inherit_attack_critical: false}]},
          {resolution: 'save', who: 'self', ability: 'con', dc: 'searing_dc', on_fail: [],
            on_success: [{kind: 'remove_effect', stack_id: stackId}]},
        ]},
    ]}];
  } else if (spell.card_number === 'SPELL-0164') {
    // The captured triggering attack owns the hit creature and melee reach.
    mechanics.effects[0].result = [
      {kind: 'damage', dice: '2d8', type: 'radiant', scaling: {dice: '1d8', per: 'spell_slot_above'}},
      {kind: 'damage', dice: '1d8', type: 'radiant',
        when: [{kind: 'target_creature_type_in', values: ['fiend', 'undead']}]},
    ];
  } else if (spell.card_number === 'SPELL-0186') {
    mechanics.effects[0].who = 'target';
  } else throw new Error(`Unsupported repair: ${spell.card_number}`);
  if (['SPELL-0164', 'SPELL-0254', 'SPELL-0186'].includes(spell.card_number)) {
    for (const effect of mechanics.effects) {
      if (effect.resolution !== 'auto') continue;
      for (const payload of effect.result ?? []) {
        if (payload.kind === 'damage') payload.inherit_attack_critical = true;
      }
    }
  }
  return mechanics;
}

export const COMBAT_SPELL_REPAIRS = ['SPELL-0260', 'SPELL-0254', 'SPELL-0164', 'SPELL-0186'];
export async function repairCombatSpells({apply = false} = {}) {
  const specifications = JSON.parse(await readFile(new URL('./data/combat-spell-repairs-20260930.json', import.meta.url), 'utf8'));
  const listed = await fetchAll('/api/spells', 'spells');
  const token = await login();
  const result = [];
  for (const cardNumber of COMBAT_SPELL_REPAIRS) {
    const matches = listed.filter(spell => spell.card_number === cardNumber);
    if (matches.length !== 1) throw new Error(`${cardNumber}: expected one entity`);
    const spell = await apiRequest(token, 'GET', `/api/spells/${matches[0].id}`);
    const specification = specifications.find(spec => spec.card_number === cardNumber);
    if (!specification) throw new Error(`${cardNumber}: no reviewed migration`);
    const mechanics = specification.mechanics;
    const currentHash = sha256Canonical(spell.mechanics), afterHash = sha256Canonical(mechanics);
    if (currentHash !== specification.expected_before && currentHash !== afterHash) throw new Error(`${cardNumber}: mechanics drift`);
    const changed = afterHash !== currentHash;
    if (changed && apply) {
      // The API's update contract also carries name_en; retain its preimage.
      await apiRequest(token, 'PUT', `/api/spells/${spell.id}`, {mechanics, name_en: spell.name_en});
      const persisted = await apiRequest(token, 'GET', `/api/spells/${spell.id}`);
      if (sha256Canonical(persisted.mechanics) !== sha256Canonical(mechanics)) throw new Error(`${cardNumber}: postimage mismatch`);
    }
    result.push({card_number: cardNumber, changed, applied: changed && apply});
  }
  return result;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  repairCombatSpells({apply: process.argv.includes('--apply')}).then(result => console.log(JSON.stringify(result)))
    .catch(error => {console.error(error); process.exitCode = 1;});
}
