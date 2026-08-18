import { describe, expect, it } from 'vitest';
import {
  attackSequenceComplete,
  attackSequenceInvariantHolds,
  beginAttackSequence,
  performSequenceAttack,
  performUnarmedStrike,
  performWeaponSequenceAttack,
  replaceSequenceAttack,
  type AttackSequenceState,
} from './attackSequence';

describe('Attack-action sequence and replacement primitives', () => {
  it('replaces the only level-1 attack with Dragonborn Breath Weapon', () => {
    const sequence = replaceSequenceAttack({
      sequence: beginAttackSequence({ id: 'turn-1:attack', actorId: 'dragonborn', totalAttacks: 1 }),
      actionId: 'dragonborn:breath-weapon:red',
      replacementKey: 'dragonborn:breath-weapon',
      sourceEntityIds: ['RACE-0008', 'lineage:red'],
    });
    expect(attackSequenceComplete(sequence)).toBe(true);
    expect(sequence.entries).toEqual([{
      ordinal: 1,
      kind: 'replacement',
      actionId: 'dragonborn:breath-weapon:red',
      replacementKey: 'dragonborn:breath-weapon',
      sourceEntityIds: ['RACE-0008', 'lineage:red'],
    }]);
  });

  it('preserves a second attack after a replacement and rejects a repeated singular replacement', () => {
    const started = beginAttackSequence({ id: 'turn-5:attack', actorId: 'dragonborn', totalAttacks: 2 });
    const breathed = replaceSequenceAttack({
      sequence: started,
      actionId: 'dragonborn:breath-weapon:gold',
      replacementKey: 'dragonborn:breath-weapon',
      sourceEntityIds: ['RACE-0008', 'lineage:gold'],
    });
    expect(breathed.attacksRemaining).toBe(1);
    expect(attackSequenceComplete(breathed)).toBe(false);
    expect(() => replaceSequenceAttack({
      sequence: breathed,
      actionId: 'dragonborn:breath-weapon:gold',
      replacementKey: 'dragonborn:breath-weapon',
      sourceEntityIds: ['RACE-0008', 'lineage:gold'],
    })).toThrow(/already used/);
    const finished = performSequenceAttack({
      sequence: breathed,
      actionId: 'weapon:longsword',
      sourceEntityIds: ['ITEM-longsword'],
    });
    expect(attackSequenceComplete(finished)).toBe(true);
    expect(finished.entries.map((entry) => entry.kind)).toEqual(['replacement', 'weapon_attack']);
  });

  it('models Pact Chain substitution with a separate replacement key', () => {
    const sequence = replaceSequenceAttack({
      sequence: beginAttackSequence({ id: 'turn-2:attack', actorId: 'warlock', totalAttacks: 1 }),
      actionId: 'familiar:imp:sting',
      replacementKey: 'pact-chain:familiar-attack',
      sourceEntityIds: ['EFF-pact-chain', 'familiar:imp'],
    });
    expect(sequence.entries[0]).toMatchObject({
      kind: 'replacement',
      actionId: 'familiar:imp:sting',
      replacementKey: 'pact-chain:familiar-attack',
    });
  });

  it('fails closed when a caller tries to exceed the sequence budget', () => {
    const finished = performSequenceAttack({
      sequence: beginAttackSequence({ id: 'attack', actorId: 'fighter', totalAttacks: 1 }),
      actionId: 'weapon:longsword',
      sourceEntityIds: ['ITEM-longsword'],
    });
    expect(() => performSequenceAttack({
      sequence: finished,
      actionId: 'weapon:longsword',
      sourceEntityIds: ['ITEM-longsword'],
    })).toThrow(/no remaining attacks/);
    expect(() => beginAttackSequence({ id: 'bad', actorId: 'fighter', totalAttacks: 0 }))
      .toThrow(/positive integer/);
    expect(() => beginAttackSequence({ id: 'bad', actorId: 'fighter', totalAttacks: 1.5 }))
      .toThrow(/positive integer/);
    expect(() => beginAttackSequence({ id: ' ', actorId: 'fighter', totalAttacks: 1 }))
      .toThrow(/stable sequence/);
    expect(() => beginAttackSequence({ id: 'attack', actorId: ' ', totalAttacks: 1 }))
      .toThrow(/stable sequence/);
    expect(() => replaceSequenceAttack({
      sequence: beginAttackSequence({ id: 'bad-key', actorId: 'fighter', totalAttacks: 1 }),
      actionId: 'replacement',
      replacementKey: '   ',
      sourceEntityIds: ['test'],
    })).toThrow(/stable key/);
  });

  it('allows an explicitly repeatable replacement policy without weakening the attack budget', () => {
    const first = replaceSequenceAttack({
      sequence: beginAttackSequence({ id: 'repeatable', actorId: 'fighter', totalAttacks: 2 }),
      actionId: 'replacement', replacementKey: 'repeatable', sourceEntityIds: ['test'],
      oncePerSequence: false,
    });
    const second = replaceSequenceAttack({
      sequence: first,
      actionId: 'replacement', replacementKey: 'repeatable', sourceEntityIds: ['test'],
      oncePerSequence: false,
    });
    expect(attackSequenceComplete(second)).toBe(true);
    expect(second.usedReplacementKeys).toEqual(['repeatable']);
  });

  it('records every Unarmed Strike option as one canonical attack entry', () => {
    const options = ['damage', 'grapple', 'shove'] as const;
    let sequence = beginAttackSequence({
      id: 'unarmed-sequence', actorId: 'monk', totalAttacks: options.length,
    });
    for (const option of options) {
      sequence = performUnarmedStrike({
        sequence,
        actionId: `core.attack.unarmed.${option}`,
        option,
        sourceEntityIds: [`system:dnd5e-2024:unarmed-strike:${option}`],
      });
    }
    expect(sequence.entries).toEqual(options.map((option, index) => ({
      ordinal: index + 1,
      kind: 'unarmed_strike',
      actionId: `core.attack.unarmed.${option}`,
      option,
      sourceEntityIds: [`system:dnd5e-2024:unarmed-strike:${option}`],
    })));
    expect(attackSequenceComplete(sequence)).toBe(true);
    expect(() => performUnarmedStrike({
      sequence: beginAttackSequence({ id: 'invalid-option', actorId: 'monk', totalAttacks: 1 }),
      actionId: 'core.attack.unarmed.invalid',
      option: 'trip' as never,
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike'],
    })).toThrow(/Unsupported Unarmed Strike option/);
  });

  it('keeps legacy weapon entries compatible and gives the canonical path an item reference', () => {
    const started = beginAttackSequence({ id: 'weapons', actorId: 'fighter', totalAttacks: 2 });
    const legacy = performSequenceAttack({
      sequence: started,
      actionId: 'legacy.weapon.attack',
      sourceEntityIds: ['ITEM-longsword'],
    });
    const canonical = performWeaponSequenceAttack({
      sequence: legacy,
      actionId: 'core.attack.weapon',
      weaponCardId: 'card:longsword',
      sourceEntityIds: ['system:dnd5e-2024:weapon-attack', 'card:longsword'],
    });
    expect(canonical.entries).toEqual([
      {
        ordinal: 1,
        kind: 'weapon_attack',
        actionId: 'legacy.weapon.attack',
        sourceEntityIds: ['ITEM-longsword'],
      },
      {
        ordinal: 2,
        kind: 'weapon_attack',
        actionId: 'core.attack.weapon',
        weaponCardId: 'card:longsword',
        sourceEntityIds: ['system:dnd5e-2024:weapon-attack', 'card:longsword'],
      },
    ]);
    expect(() => performWeaponSequenceAttack({
      sequence: started,
      actionId: 'core.attack.weapon',
      weaponCardId: ' ',
      sourceEntityIds: ['system:dnd5e-2024:weapon-attack'],
    })).toThrow(/stable weapon Card ID/);
  });

  it('is pure across attack counts and survives a JSON checkpoint', {
    meta: { basicPrimitive: 'attack', evidenceKind: 'unit' },
  }, () => {
    for (let totalAttacks = 1; totalAttacks <= 8; totalAttacks += 1) {
      const started = beginAttackSequence({
        id: `property:${totalAttacks}`,
        actorId: 'fighter',
        totalAttacks,
      });
      const originalSources: [string, ...string[]] = ['system:weapon', `budget:${totalAttacks}`];
      let sequence = started;
      for (let index = 0; index < totalAttacks; index += 1) {
        sequence = index % 2 === 0
          ? performWeaponSequenceAttack({
            sequence,
            actionId: 'core.attack.weapon',
            weaponCardId: `weapon:${index}`,
            sourceEntityIds: originalSources,
          })
          : performUnarmedStrike({
            sequence,
            actionId: 'core.attack.unarmed.damage',
            option: 'damage',
            sourceEntityIds: ['system:unarmed'],
          });
        expect(sequence.attacksRemaining).toBe(totalAttacks - index - 1);
        expect(sequence.entries[index].ordinal).toBe(index + 1);
        expect(attackSequenceInvariantHolds(sequence)).toBe(true);
      }
      originalSources[0] = 'mutated-outside';
      expect(sequence.entries[0].sourceEntityIds[0]).toBe('system:weapon');
      expect(started).toEqual({
        id: `property:${totalAttacks}`,
        actorId: 'fighter',
        totalAttacks,
        attacksRemaining: totalAttacks,
        entries: [],
        usedReplacementKeys: [],
      });
      expect(attackSequenceComplete(sequence)).toBe(true);
      expect(JSON.parse(JSON.stringify(sequence))).toEqual(sequence);
    }
  });

  it('rejects malformed restored state and unstable entry provenance before consuming budget', () => {
    const valid = beginAttackSequence({ id: 'valid', actorId: 'fighter', totalAttacks: 1 });
    const corruptions: AttackSequenceState[] = [
      { ...valid, id: ' ' },
      { ...valid, actorId: ' ' },
      { ...valid, totalAttacks: 1.5 },
      { ...valid, totalAttacks: 0 },
      { ...valid, attacksRemaining: 0.5 },
      { ...valid, attacksRemaining: -1 },
      { ...valid, attacksRemaining: 2 },
      { ...valid, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: 'weapon', sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 2, kind: 'weapon_attack', actionId: 'weapon', sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: ' ', sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: 'weapon', sourceEntityIds: [] as never,
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: 'weapon', sourceEntityIds: [' '],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: 'weapon',
        sourceEntityIds: ['source', 'source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'forged' as 'weapon_attack', actionId: 'weapon',
        sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'weapon_attack', actionId: 'weapon', weaponCardId: ' ',
        sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'replacement', actionId: 'replacement', replacementKey: ' ',
        sourceEntityIds: ['source'],
      }] },
      { ...valid, attacksRemaining: 0, entries: [{
        ordinal: 1, kind: 'unarmed_strike', actionId: 'unarmed', option: 'trip' as never,
        sourceEntityIds: ['source'],
      }] },
      { ...valid, usedReplacementKeys: ['ghost'] },
      { ...valid, entries: null as unknown as AttackSequenceState['entries'] },
      { ...valid, usedReplacementKeys: null as unknown as string[] },
      { ...valid, usedReplacementKeys: [' '] },
    ];
    corruptions.forEach((state) => {
      expect(attackSequenceInvariantHolds(state)).toBe(false);
      expect(attackSequenceComplete(state)).toBe(false);
    });
    expect(() => performSequenceAttack({
      sequence: corruptions[0], actionId: 'weapon', sourceEntityIds: ['source'],
    })).toThrow(/Invalid attack sequence state/);
    expect(() => replaceSequenceAttack({
      sequence: corruptions.at(-2)!, actionId: 'replacement',
      replacementKey: 'replacement', sourceEntityIds: ['source'],
    })).toThrow(/Invalid attack sequence state/);
    expect(() => performSequenceAttack({
      sequence: valid, actionId: ' ', sourceEntityIds: ['source'],
    })).toThrow(/stable action and source IDs/);
    expect(() => performSequenceAttack({
      sequence: valid, actionId: 'weapon', sourceEntityIds: [] as never,
    })).toThrow(/stable action and source IDs/);
    expect(() => performSequenceAttack({
      sequence: valid, actionId: 'weapon', sourceEntityIds: [' '],
    })).toThrow(/stable action and source IDs/);
    expect(() => performSequenceAttack({
      sequence: valid, actionId: 'weapon', sourceEntityIds: ['source', 'source'],
    })).toThrow(/stable action and source IDs/);
  });
});
