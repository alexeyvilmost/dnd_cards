import type { Card, Spell } from '../types';
import { parseWeaponProfile } from '../engine/weaponProfile';
import { abilityFullRu, parseMechanicsStats } from '../engine/describeMechanics';
import { getDamageLabel } from '../utils/damageTypes';
import { paperEntityToken } from './references';
import { evaluatePaperFormula, type PaperEquipmentProjection, type PaperSheetDocument } from './model';

export type PaperRowKind = 'weapon' | 'preparedSpell';
export interface PaperRowPatch {
  fields: Record<string, string>;
  checks: Record<string, boolean>;
  notice?: string;
}

function plus(value: number): string { return value ? ` + ${value}` : ''; }

/** The canonical preview chooses attack/save and damage from mechanics first. */
function spellDamage(spell: Spell): string {
  const stats = parseMechanicsStats(spell.mechanics);
  const damage = stats.damage.length ? stats.damage : (spell.damage ?? []).map(entry => ({ value: entry.dice, type: entry.damage_type }));
  // Scalar placeholders keep worksheet modifiers live. Dice remain text, never rolls.
  const formula = (text: string) => text.replace(/\b(str|dex|con|int|wis|cha|spellcasting|prof_bonus|prof|self_level)\b/g, token => {
    const reference = token === 'spellcasting' ? 'spellMod' : token === 'self_level' ? 'LVL' : token.startsWith('prof') ? 'PROF' : token.toUpperCase();
    return `{{[${reference}]}}`;
  });
  return damage.map(entry => `${formula(entry.value)} ${getDamageLabel(entry.type).toLowerCase()}`).join(' + ');
}

export function preparedSpellPatch(row: number, spell: Spell): PaperRowPatch {
  const prefix = `spellRow${row}`;
  const notes = [spell.duration ? `Длительность: ${spell.duration}` : '', spell.component_material && spell.material_text ? `М: ${spell.material_text}` : ''].filter(Boolean).join('; ');
  return {
    fields: { [`${prefix}Name`]: paperEntityToken({ type: 'spell', id: spell.id, name: spell.name }), [`${prefix}Level`]: String(spell.level), [`${prefix}Time`]: spell.casting_time ?? '', [`${prefix}Range`]: spell.range ?? '', [`${prefix}Notes`]: notes },
    checks: { [`${prefix}Concentration`]: spell.concentration, [`${prefix}Ritual`]: spell.ritual, [`${prefix}Material`]: spell.component_material },
  };
}

export function weaponCardPatch(row: number, card: Card): PaperRowPatch {
  const prefix = `weapon.${row}.`;
  const fields: Record<string, string> = { [`${prefix}name`]: paperEntityToken({ type: 'card', id: card.id, name: card.name }), [`${prefix}bonus`]: '', [`${prefix}damage`]: '', [`${prefix}notes`]: '' };
  const parsed = parseWeaponProfile(card);
  if (!parsed.valid) {
    const notice = 'В карточке нет полного оружейного профиля. Бонус и урон заполните вручную.';
    fields[`${prefix}notes`] = notice;
    return { fields, checks: {}, notice };
  }
  const profile = parsed.profile;
  const ability = profile.attackAbility === 'finesse' ? 'max([STR], [DEX])' : `[${profile.attackAbility.toUpperCase()}]`;
  fields[`${prefix}bonus`] = `=${ability} + [PROF] * [weapon_proficiency.${profile.proficiencyCategory}]${plus(profile.enchantment.attackBonus)}`;
  fields[`${prefix}damage`] = [...profile.damageLines, ...profile.enchantment.extraDamageLines].map((line, index) => `${line.dice}${index === 0 ? ` + {{${ability}${plus(profile.enchantment.damageBonus)}}}` : ''} ${getDamageLabel(line.type).toLowerCase()}`).join(' + ');
  fields[`${prefix}notes`] = [
    ...profile.attackModes.map(mode => mode.kind === 'melee' ? `Досягаемость ${mode.reachFt} фт.` : `Дальность ${mode.normalFt}/${mode.longFt} фт.`),
    profile.attunement.required ? 'Требуется настройка' : '',
  ].filter(Boolean).join('; ');
  return { fields, checks: {} };
}

export function weaponSpellPatch(row: number, spell: Spell): PaperRowPatch {
  const prefix = `weapon.${row}.`;
  const stats = parseMechanicsStats(spell.mechanics);
  const notes = [spell.range, stats.save ? `Спасбросок: ${abilityFullRu(stats.saveAbility) || 'по описанию'}` : '', spell.duration ? `Длительность: ${spell.duration}` : ''].filter(Boolean).join('; ');
  return { fields: { [`${prefix}name`]: paperEntityToken({ type: 'spell', id: spell.id, name: spell.name }), [`${prefix}bonus`]: stats.attack ? '=[spellAttack]' : stats.save ? '=[spellDC]' : '', [`${prefix}damage`]: spellDamage(spell), [`${prefix}notes`]: notes }, checks: {} };
}

/** A late network response must not replace edits made while the row was loading. */
export function canApplyPaperRowPatch(current: PaperSheetDocument, original: PaperSheetDocument, patch: PaperRowPatch): boolean {
  return Object.keys(patch.fields).every(key => current.fields[key] === original.fields[key])
    && Object.keys(patch.checks).every(key => current.checks[key] === original.checks[key]);
}

export function applyPaperRowPatch(document: PaperSheetDocument, patch: PaperRowPatch): PaperSheetDocument {
  return { ...document, fields: { ...document.fields, ...patch.fields }, checks: { ...document.checks, ...patch.checks } };
}

export function renderPaperRollText(source: string, document: PaperSheetDocument, equipment?: PaperEquipmentProjection): { text: string; error?: string } {
  let error: string | undefined;
  const text = source.replace(/\{\{([^{}]+)\}\}/g, (token, expression: string) => {
    const result = evaluatePaperFormula(expression, document, equipment);
    if (result.error) { error ??= result.error; return token; }
    return String(Number(result.value!.toFixed(2)));
  }).replace(/\+\s*-/g, '- ');
  return { text, ...(error ? { error } : {}) };
}
