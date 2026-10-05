import { randomUUID } from 'node:crypto';
import { test, expect, connectAPI, createRun, hash } from './fixtures';
import { readRunInvariant } from '../../scripts/testing/acceptance-observer.mjs';

test('S07 real authorization, stale revisions and duplicate concurrent run commands fail closed', async ({ api, local }) => {
  const peer = await connectAPI(local, 'peer');
  const fixture = await createRun(api);
  await peer.request('GET', `/characters-v3/${fixture.source.id}`, undefined, 403);
  await peer.request('GET', `/roguelike/runs/${fixture.run.id}`, undefined, 404);
  await peer.request('POST', '/roguelike/runs', { source_character_id: fixture.source.id }, 403);
  const templates = await api.request('GET', '/character-templates');
  await api.request('PUT', `/character-templates/${templates.templates[0].id}`, { name: 'Forbidden update' }, 403);
  const response = await local.request(`/api/characters-v3/${fixture.source.id}`, { headers: { authorization: 'Bearer invalid-local-session' } });
  expect(response.status).toBe(401);
  const body = { command_id: randomUUID(), expected_revision: fixture.run.revision, type: 'camp_turn', payload: {} };
  const results = await Promise.all([api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, body), api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, body)]);
  expect(hash(results[0])).toBe(hash(results[1]));
  const saved = await fixture.reload(); expect(saved.revision).toBe(body.expected_revision + 1);
  expect((await readRunInvariant(local, saved.id, body.command_id)).command_receipts).toBe(1);
  await api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, { ...body, command_id: randomUUID() }, 409);
  expect(hash(await fixture.reload())).toBe(hash(saved)); await fixture.verifySource();
});

test('S08 camp purchase, sale and authoritative rest commit once and reject partial carts', async ({ api, local }) => {
  const fixture = await createRun(api, 'swordsman');
  await fixture.reload();
  const suppliesOffer = fixture.run.shop.staples.find((row: any) => row.id === 'staple:supplies');
  expect(Boolean(suppliesOffer), 'Camp supplies must come from the real shop DTO').toBe(true);
  const beforeCart = hash(fixture.run);
  const privateBefore = await readRunInvariant(local, fixture.run.id);
  await api.request('POST', `/roguelike/runs/${fixture.run.id}/commands`, {
    command_id: randomUUID(), expected_revision: fixture.run.revision, type: 'buy_cart',
    payload: { items: [{ offer_id: suppliesOffer.id, quantity: 1 }, { offer_id: 'missing-local-offer', quantity: 1 }] },
  }, 404);
  expect(hash(await fixture.reload())).toBe(beforeCart);
  expect(hash(await readRunInvariant(local, fixture.run.id))).toBe(hash(privateBefore));
  const supplies = fixture.run.supplies, gold = fixture.run.gold;
  const purchase = await fixture.command('buy', { offer_id: suppliesOffer.id });
  expect(fixture.run.supplies).toBe(supplies + suppliesOffer.quantity);
  expect(fixture.run.gold).toBeLessThan(gold);
  expect((await readRunInvariant(local, fixture.run.id, purchase.body.command_id)).command_receipts).toBe(1);

  const character = await api.request('GET', `/characters-v3/${fixture.run.character_id}`);
  const equipped = new Set(Object.values(character.equipment ?? {}));
  let sale: any;
  for (const item of character.inventory_items.filter((row: any) => !row.container_id && row.qty > 0 && !equipped.has(row.card_id))) {
    const card = await api.request('GET', `/cards/${item.card_id}`);
    if (card.price > 0) { sale = item; break; }
  }
  expect(Boolean(sale), 'Preset must own a sellable item').toBe(true);
  const sold = await fixture.command('sell', { card_id: sale.card_id, quantity: 1, price: 999999 });
  const afterSale = await api.request('GET', `/characters-v3/${fixture.run.character_id}`);
  expect(afterSale.inventory_items.find((row: any) => row.card_id === sale.card_id)?.qty ?? 0).toBe(sale.qty - 1);
  expect(fixture.run.gold).toBeLessThan(999999);
  expect((await readRunInvariant(local, fixture.run.id, sold.body.command_id)).command_receipts).toBe(1);
  const short = await fixture.command('short_rest', { hit_die_rolls: [], runtime: { current_hp: 999999, resources: { forged_local_resource: 100 } } });
  const afterShort = await api.request('GET', `/characters-v3/${fixture.run.character_id}`);
  expect(afterShort.current_hp).toBeLessThanOrEqual(afterShort.max_hp);
  expect(afterShort.resources.forged_local_resource).toBeUndefined();
  expect((await readRunInvariant(local, fixture.run.id, short.body.command_id)).command_receipts).toBe(1);
  const beforeRestSupplies = fixture.run.supplies;
  const long = await fixture.command('long_rest', { runtime: { current_hp: 999999 } });
  expect(fixture.run.supplies).toBe(beforeRestSupplies - 1);
  const afterLong = await api.request('GET', `/characters-v3/${fixture.run.character_id}`);
  expect(afterLong.current_hp).toBe(afterLong.max_hp);
  expect((await readRunInvariant(local, fixture.run.id, long.body.command_id)).command_receipts).toBe(1);
  await fixture.verifySource();
});
