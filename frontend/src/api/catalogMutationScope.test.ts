import {describe, expect, it} from 'vitest';
import {createCatalogMutationScope} from './catalogMutationScope';

const character = (revision = 1, extra = {}) => ({id: 'hero', user_id: 'owner', character_type: 'character',
  runtime_revision: revision, equipment: {main_hand: 'sword'}, inventory_items: [{card_id: 'sword', quantity: 1}], ...extra});
const run = (revision = 1, extra = {}) => ({run: {id: 'battle', user_id: 'owner', character_id: 'hero', revision,
  status: 'active', party: ['hero'], shop: [], last_reward: null, character: character(revision), ...extra}});
const request = (data: unknown, method = 'get', url = '/api/characters-v3/hero', session = 'owner') => ({data, method, url, session});

describe('catalog invalidation based on authoritative ownership postimages', () => {
  it('keeps identical membership through HP, resources, turn and equipment slot changes', () => {
    const observe = createCatalogMutationScope();
    expect(observe(request(character()))).toBe(false);
    expect(observe(request(character(2, {current_hp: 2, current_resources: {energy: 0}}), 'put', '/api/characters-v3/hero/runtime'))).toBe(true);
    expect(observe(request(character(3, {equipment: {off_hand: 'sword'}}), 'post', '/api/characters-v3/hero/equipment-commands'))).toBe(true);
    observe(request(run(), 'get', '/api/roguelike/runs/battle'));
    expect(observe(request(run(4), 'post', '/api/roguelike/runs/battle/commands'))).toBe(true);
  });

  it.each([
    {inventory_items: [{card_id: 'sword'}, {card_id: 'new-item'}]},
    {inventory_items: [], equipment: {}},
    {user_id: 'another-owner'},
    {character_type: 'template'},
  ])('invalidates acquisition, sale and ownership changes: %j', extra => {
    const observe = createCatalogMutationScope(); observe(request(character()));
    expect(observe(request(character(2, extra), 'post', '/api/characters-v3/hero/equipment-commands'))).toBe(false);
  });

  it.each([{shop: [{id: 'new'}]}, {last_reward: {cards: ['new']}}, {party: ['hero', 'other']}, {status: 'completed'}])('invalidates changed run membership and offers: %j', extra => {
    const observe = createCatalogMutationScope(); observe(request(run(), 'get', '/api/roguelike/runs/battle'));
    expect(observe(request(run(2, extra), 'post', '/api/roguelike/runs/battle/commands'))).toBe(false);
  });

  it('fails closed for unknown preimage, partial DTO, invalid membership, and broad editing routes', () => {
    const observe = createCatalogMutationScope();
    expect(observe(request(character(), 'put', '/api/characters-v3/hero/runtime'))).toBe(false);
    for (const row of [{runtime_revision: 2}, character(2, {equipment: 'bad'}), character(2, {inventory_items: null})]) {
      expect(observe(request(row, 'put', '/api/characters-v3/hero/runtime'))).toBe(false);
    }
    expect(observe(request(character(2), 'put', '/api/characters-v3/hero'))).toBe(false);
  });

  it('does not let an old receipt replace a newer acquisition or a session switch retain a preimage', () => {
    const observe = createCatalogMutationScope(); observe(request(character(3, {inventory_items: [{card_id: 'new'}]})));
    expect(observe(request(character(1), 'put', '/api/characters-v3/hero/runtime'))).toBe(false);
    expect(observe(request(character(4, {inventory_items: [{card_id: 'new'}]}), 'put', '/api/characters-v3/hero/runtime'))).toBe(true);
    expect(observe(request(character(5, {inventory_items: [{card_id: 'new'}]}), 'put', '/api/characters-v3/hero/runtime', 'new-session'))).toBe(false);
  });

  it('checks every returned participant, not only the first unchanged character', () => {
    const observe = createCatalogMutationScope(); observe(request(character()));
    observe(request(character(1, {id: 'ally'}), 'get', '/api/characters-v3/ally'));
    expect(observe(request({participants: [{character: character(2)}, {character: character(2, {id: 'ally', inventory_items: [{card_id: 'gift'}]})}]}, 'post', '/api/characters-v3/runtime-commands'))).toBe(false);
  });
});
