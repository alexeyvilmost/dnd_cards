import { projectRuleAction } from '../canon/ruleActionProjection';
import { validateMechanics } from '../engine/validateMechanics';
import { sheetPrimitiveDisabledReason, sheetPrimitiveType } from '../character/sheetPrimitiveUi';
import { materializeDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import type { Spell } from '../types';

type ManifestSpell = {
  key: string;
  label: string;
  selector: { cardNumber?: string };
  expected?: { level?: unknown };
};

export interface MiniMvpSpellActivationManifest {
  manifestVersion: string;
  collections: {
    cantrips: readonly ManifestSpell[];
    firstLevelSpells: readonly ManifestSpell[];
  };
}

export interface VerifiedMiniMvpSpellActivation {
  cardNumber: string;
  entityId: string;
  name: string;
  level: 0 | 1;
  activationMode: 'active' | 'reaction' | 'triggered';
  classListIds: readonly string[];
  primitive: string | null;
  evidence: readonly [
    'exact-live-row',
    'schema-valid',
    'sheet-projection',
    'resource-contract',
    'activation-contract',
  ];
}

export const MINI_MVP_SPELL_ACTIVATION_CATALOG_VERSION =
  'mini-mvp-spell-activation-v1' as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fail(cardNumber: string, message: string): never {
  throw new Error(`${cardNumber}: ${message}`);
}

/**
 * Compile the exact 98-card mini-MVP denominator through the same schema and
 * immutable sheet projection used by Forge/Character Sheet.  This is an
 * activation/access certificate; individual spell outcomes remain covered by
 * their semantic packages and the browser checklist.
 */
export function buildMiniMvpSpellActivationCatalog(
  manifest: MiniMvpSpellActivationManifest,
  liveSpells: readonly Spell[],
): VerifiedMiniMvpSpellActivation[] {
  const denominator = [
    ...manifest.collections.cantrips.map((entry) => ({ entry, level: 0 as const })),
    ...manifest.collections.firstLevelSpells.map((entry) => ({ entry, level: 1 as const })),
  ];
  if (denominator.length !== 98) {
    throw new Error(`mini-MVP spell denominator must contain 98 rows, got ${denominator.length}`);
  }

  const cardNumbers = denominator.map(({ entry }) => entry.selector.cardNumber);
  if (cardNumbers.some((cardNumber) => !cardNumber)
    || new Set(cardNumbers).size !== denominator.length) {
    throw new Error('mini-MVP spell denominator has a blank or duplicate card number');
  }

  const issues: string[] = [];
  const verified = denominator.flatMap(({ entry, level }) => {
    const cardNumber = entry.selector.cardNumber!;
    try {
      const matches = liveSpells.filter((spell) => spell.card_number === cardNumber);
      if (matches.length !== 1) fail(cardNumber, `expected one live row, got ${matches.length}`);
      const spell = matches[0];
      if (spell.name !== entry.label) fail(cardNumber, `expected name «${entry.label}», got «${spell.name}»`);
      if (spell.level !== level || Number(entry.expected?.level) !== level) {
        fail(cardNumber, `expected level ${level}, got ${spell.level}`);
      }

    const mechanics = object(spell.mechanics);
    if (!mechanics) fail(cardNumber, 'mechanics are missing');
    const schema = validateMechanics(mechanics, { id: spell.id, name: spell.name, kind: 'spell' });
    if (!schema.valid) fail(cardNumber, `schema invalid: ${schema.errors.join('; ')}`);

    const activation = object(mechanics.activation);
    if (!activation) fail(cardNumber, 'activation is missing');
    const mode = activation?.mode;
    if (mode !== 'active' && mode !== 'reaction' && mode !== 'triggered') {
      fail(cardNumber, `unsupported activation mode ${String(mode)}`);
    }
    const costs = activation.cost;
    if (!Array.isArray(costs)) fail(cardNumber, 'activation.cost must be explicit');
    const costRows = costs.map(object);
    if (costRows.some((cost) => !cost)) fail(cardNumber, 'activation.cost contains a malformed row');
    const slotCosts = costRows.filter((cost) => cost?.resource === 'spell_slot');
    if (level === 0 && slotCosts.length > 0) fail(cardNumber, 'cantrip spends a spell slot');
    if (level === 1 && (slotCosts.length !== 1 || Number(slotCosts[0]?.level) !== 1)) {
      fail(cardNumber, 'level-1 spell must spend exactly one level-1 spell-slot resource');
    }
    if ((mode === 'active' || mode === 'reaction') && !object(mechanics.targeting)) {
      fail(cardNumber, `${mode} spell has no declared targeting`);
    }
    if (mode === 'triggered') {
      const trigger = object(activation.trigger);
      if (!trigger || typeof trigger.event !== 'string' || !trigger.event.trim()) {
        fail(cardNumber, 'triggered spell has no explicit trigger event');
      }
    }

    const sheetMechanics = mechanics.targeting === undefined
      ? mechanics
      : materializeDeclaredMechanicsTargeting(mechanics);
    const projection = projectRuleAction({ ...spell, mechanics: sheetMechanics }, {
      sourceClass: 'mini-mvp-activation-audit',
      grantScopeId: `audit:${spell.id}`,
    });
    if (projection.kind !== 'spell' || projection.spell.level !== level) {
      fail(cardNumber, 'sheet projection did not retain spell level');
    }
    const classListIds = projection.spell.classListIds;
    if (!classListIds?.length) fail(cardNumber, 'spell has no immutable class-list ids');

    const primitive = sheetPrimitiveType(projection.mechanics);
    const disabled = primitive ? sheetPrimitiveDisabledReason(primitive) : null;
    if (disabled) fail(cardNumber, disabled);

      return [{
        cardNumber,
        entityId: spell.id,
        name: spell.name,
        level,
        activationMode: mode,
        classListIds,
        primitive,
        evidence: [
          'exact-live-row',
          'schema-valid',
          'sheet-projection',
          'resource-contract',
          'activation-contract',
        ],
      } satisfies VerifiedMiniMvpSpellActivation];
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `${cardNumber}: ${String(error)}`);
      return [];
    }
  });
  if (issues.length) {
    throw new Error(`mini-MVP spell activation catalog has ${issues.length} issue(s):\n${issues.join('\n')}`);
  }
  return verified;
}
