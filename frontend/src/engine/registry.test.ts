import { describe, expect, it } from 'vitest';
import { createRegistry, collectMechanicRefs } from './registry';
import { isEntityUuid, splitRefs } from './ids';
import { collectChosenSpellUuids, grantedSpellSlugs, splitStoredSpellIds } from './spellRefs';

describe('ids', () => {
  it('различает UUID и slug', () => {
    expect(isEntityUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
    expect(isEntityUuid('light')).toBe(false);
    expect(isEntityUuid('barbarian-rage')).toBe(false);
  });

  it('splitRefs', () => {
    const { uuids, slugs } = splitRefs(['light', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11']);
    expect(slugs).toEqual(['light']);
    expect(uuids).toHaveLength(1);
  });
});

describe('registry', () => {
  it('кэширует резолв', async () => {
    let calls = 0;
    const registry = createRegistry({
      resolveSpell: async (slug) => { calls++; return slug === 'light' ? { id: '1', card_number: 'light' } : null; },
      resolveAction: async () => null,
      resolveEffect: async () => null,
      resolveFeat: async () => null,
    });
    await registry.resolve('spell', 'light');
    await registry.resolve('spell', 'light');
    expect(calls).toBe(1);
  });

  it('auditRefs находит битые ссылки', async () => {
    const registry = createRegistry({
      resolveSpell: async (slug) => (slug === 'light' ? { id: '1' } : null),
      resolveAction: async () => null,
      resolveEffect: async () => null,
      resolveFeat: async () => null,
    });
    const broken = await registry.auditRefs([
      { kind: 'spell', slug: 'light', source: 'test' },
      { kind: 'spell', slug: 'missing', source: 'test' },
    ]);
    expect(broken).toHaveLength(1);
    expect(broken[0].slug).toBe('missing');
  });

  it('collectMechanicRefs из grant_spell', () => {
    const refs = collectMechanicRefs(
      { effects: [{ resolution: 'auto', result: [{ kind: 'grant_spell', value: 'light' }] }] },
      'effect:foo',
    );
    expect(refs).toEqual([{ kind: 'spell', slug: 'light', source: 'effect:foo.effects[0].result[0].grant_spell' }]);
  });
});

describe('spellRefs', () => {
  it('collectChosenSpellUuids из resolvedChoices', () => {
    const uuids = collectChosenSpellUuids(
      {
        name: 'x',
        raceId: null,
        lineageId: null,
        classId: null,
        subclassId: null,
        backgroundId: null,
        level: 1,
        classEquipmentOption: 'a',
        featIds: [],
        spellIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
        abilities: {},
        abilityMethod: 'point_buy',
        abilityBonuses: { mode: 'two_one', assignments: {}, anyAbilities: false },
        equipmentOption: 'a',
        classSkillChoices: [],
        resolvedChoices: { spell_pick: ['b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'] },
      },
      {
        pendingChoices: [{ id: 'spell_pick', source: 'spell', count: 1, prompt: 'p', origin: { kind: 'class', id: 'c', name: 'C' } }],
      } as never,
    );
    expect(uuids).toHaveLength(2);
  });

  it('grantedSpellSlugs фильтрует UUID', () => {
    expect(grantedSpellSlugs(['light', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'])).toEqual(['light']);
  });

  it('splitStoredSpellIds для legacy данных', () => {
    const { uuids, slugs } = splitStoredSpellIds(['light', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11']);
    expect(slugs).toEqual(['light']);
    expect(uuids).toHaveLength(1);
  });
});
