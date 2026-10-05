import { test as base, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { localAcceptanceContext } from '../../scripts/testing/acceptance-context.mjs';
import { arrangeMovementEncounter, updateTrainingEntity, restoreTrainingEntities } from '../../scripts/testing/movement-encounter-fixture.mjs';

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex');
export type LocalAPI = Awaited<ReturnType<typeof connectAPI>>;
export async function connectAPI(local: any, role: 'player' | 'admin' | 'peer' = 'player') {
  if (!local[role]) throw new Error(`Runner-provisioned ${role} account required`);
  let token = '';
  async function request(method: string, resource: string, body?: unknown, status = 200): Promise<any> {
    const response = await local.request(`/api${resource}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`${method} ${resource}: non-JSON response; body omitted`); }
    if (response.status !== status) throw new Error(`${method} ${resource}: HTTP ${response.status}, expected ${status}; code=${typeof data.code === 'string' ? data.code.slice(0, 80) : 'absent'}`);
    return data;
  }
  const auth = await local.authenticate(role); token = auth.token;
  return { request, auth, local };
}

export const test = base.extend<{ local: any; api: LocalAPI }>({
  local: async ({ context }, use, testInfo) => {
    const local = await localAcceptanceContext();
    await local.isolateBrowser(context);
    await context.addInitScript(() => localStorage.setItem('boh:mobile-suggestion-dismissed', '1'));
    const requests = new Map<any, { method: string; path: string; started: number; status?: number; finished?: boolean; requestId?: string }>();
    context.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) requests.set(request, { method: request.method(), path: url.pathname, started: Date.now() });
    });
    context.on('response', response => {
      const record = requests.get(response.request());
      if (record) { record.status = response.status(); record.requestId = response.headers()['x-request-id']; }
    });
    context.on('requestfinished', request => { const row = requests.get(request); if (row) row.finished = true; });
    context.on('requestfailed', request => { const row = requests.get(request); if (row) row.finished = false; });
    try { await use(local); }
    finally {
      if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('safe-network-diagnostics', {
        body: Buffer.from(JSON.stringify([...requests.values()].map(row => ({ ...row, ageMs: Date.now() - row.started })), null, 2)), contentType: 'application/json',
      });
    }
  },
  api: async ({ local }, use) => { await use(await connectAPI(local)); },
});
export { expect };

export async function signIn(page: Page, api: LocalAPI) {
  // Tests other than the explicit login test use real auth obtained from the
  // owned API, not fabricated successful responses or fixture JWTs.
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('auth_token', token); localStorage.setItem('user', JSON.stringify(user));
  }, api.auth);
}

export async function copyPreset(api: LocalAPI, key = 'line') {
  const catalog = await api.request('GET', '/character-templates');
  const template = catalog.templates.find((row: any) => row.preset_key === key);
  expect(Boolean(template), `Required canonical preset ${key} missing`).toBe(true);
  return api.request('POST', `/character-templates/${template.id}/copies`, { name: `Local ${key} ${randomUUID().slice(0, 8)}` }, 201);
}

export async function createRun(api: LocalAPI, key = 'line') {
  const source = await copyPreset(api, key);
  const sourceBefore = await api.request('GET', `/characters-v3/${source.id}`);
  let run = (await api.request('POST', '/roguelike/runs', { source_character_id: source.id }, 201)).run;
  const command = async (type: string, payload: unknown = {}, retry = true) => {
    const body = { command_id: randomUUID(), expected_revision: run.revision, type, payload };
    const result = await api.request('POST', `/roguelike/runs/${run.id}/commands`, body);
    if (retry) expect(hash(await api.request('POST', `/roguelike/runs/${run.id}/commands`, body)), `${type} retry changed the saved outcome`).toBe(hash(result));
    run = result.run;
    return { body, result };
  };
  return { source, sourceBefore, get run() { return run; }, command,
    reload: async () => { run = (await api.request('GET', `/roguelike/runs/${run.id}`)).run; return run; },
    verifySource: async () => expect(hash(await api.request('GET', `/characters-v3/${source.id}`))).toBe(hash(sourceBefore)),
  };
}

// Set up declared catalog inputs before the worker pins the encounter. Never
// patch a saved combat state, RNG seed, damage result or command receipt.
export async function initializeFixtureEncounter(api: LocalAPI, fixture: Awaited<ReturnType<typeof createRun>>, profile: 'durable' | 'passive', movementOutcome?: 'hit' | 'miss') {
  const admin = await connectAPI(api.local, 'admin');
  const monsters = (await admin.request('GET', '/monsters?limit=100')).monsters;
  expect(monsters.length).toBe(2);
  expect(monsters.every((row: any) => row.source === 'Local tests')).toBe(true);
  const changes: any[] = [];
  const changedActions: any[] = [];
  let trainingEffect: any;
  try {
    if (movementOutcome) {
      expect(profile).toBe('durable');
      const declarationId = randomUUID();
      trainingEffect = await admin.request('POST', '/effects', {
        name: `Local movement ${movementOutcome}`, description: 'Synthetic movement continuation fixture; not ordinary hit probability',
        card_number: `TEST-MOVE-${declarationId.slice(0, 12)}`, source: 'Local tests', rarity: 'common', effect_type: 'passive',
        mechanics: { id: declarationId, kind: 'modifier', op: 'outcome', value: movementOutcome,
          natural: { min: 1, max: 20 }, applies_to: { roll: 'attack' } },
      }, 201);
    }
    for (const id of new Set<string>(monsters.flatMap((row: any) => row.action_ids))) {
      const action = await admin.request('GET', `/actions/${id}`);
      expect(action.source).toBe('Local tests');
      const mechanics = structuredClone(action.mechanics);
      // Both UI training profiles retain real attack rolls/opportunity hits
      // and reaction decisions without a random lethal damage race. Durable
      // only changes target HP; the existing passive/victory profile is intact.
      for (const effect of mechanics.effects) for (const payload of effect.on_hit ?? []) {
        if (payload.kind === 'damage') payload.amount = 0;
      }
      changedActions.push(action);
      await updateTrainingEntity(admin, changes, 'actions', action, { mechanics });
    }
    for (const row of monsters) {
      await updateTrainingEntity(admin, changes, 'monsters', row, { ...row,
        max_hp: profile === 'durable' ? 1000 : 1,
        ...(profile === 'passive' ? { armor_class: 1 } : {}),
        ...(movementOutcome ? {
          initiative_bonus: 100, speed: 90,
          action_ids: [changedActions.find(action => action.mechanics.effects.some((effect: any) => effect.attack_kind === 'weapon_melee')).id],
          effect_ids: [trainingEffect.id], ai: { ...row.ai, preferred_range_ft: 5 },
        } : {}),
      });
    }
    await fixture.command('start_encounter');
    if (movementOutcome) { await arrangeMovementEncounter(fixture.run, api.auth.user.id); await fixture.reload(); }
    await fixture.command('initialize_combat');
  } finally {
    await restoreTrainingEntities(admin, changes, trainingEffect?.id);
  }
  const combatants: any[] = Object.values(fixture.run.combat_state.world.actors).filter((row: any) => row.kind === 'monster');
  expect(combatants.length).toBeGreaterThan(0);
  expect(combatants.every(row => row.runtime.hp.max === (profile === 'durable' ? 1000 : 1))).toBe(true);
  if (profile === 'passive') expect(combatants.every(row => row.capabilities.actionIds.length > 0)).toBe(true);
  if (movementOutcome) {
    expect(fixture.run.combat_state.battleMap.generation?.templateId ?? fixture.run.combat_state.battleMap.id).toBe('clearing-v1');
    for (const actor of combatants) expect(actor.passives).toContainEqual(trainingEffect.mechanics);
    // A stale caller cannot use this setup seam to rewrite an initialized run.
    await expect(arrangeMovementEncounter({ ...fixture.run, combat_state: undefined, revision: 1 }, api.auth.user.id)).rejects.toThrow(/refused/);
  }
}

export function declinePendingIntent(state: any): any | undefined {
  if (state.pendingAlertSwapActorIds?.length) return { type: 'alert_swap', actorId: state.pendingAlertSwapActorIds[0], allyActorId: null };
  if (state.pendingD20Interrupt) return { type: 'd20_interrupt', actorId: null };
  if (state.pendingTriggeredAction) return { type: 'triggered_action', actionId: null };
  if (state.world.pendingResolution?.request.type === 'reaction') return { type: 'reaction', response: { kind: 'reaction', actionId: null } };
  if (state.world.pendingResolution?.request.type === 'saving_throw') return { type: 'saving_throw' };
  if (state.world.scene.initiative[state.world.scene.activeIndex] !== state.characterId) return { type: 'resume' };
}

export function watchPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.name));
  return () => expect(errors, 'Browser raised an uncaught application exception').toEqual([]);
}

export function watchConcurrentReads(page: Page) {
  const active = new Map<string, number>(), requests = new Map<unknown, string>(), duplicates = new Set<string>();
  // A hard navigation destroys the old JS cache and cancels its transport.
  // Compare overlapping reads within one document, not across two documents.
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) { active.clear(); requests.clear(); } });
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() !== 'GET' || !url.pathname.startsWith('/api/')) return;
    const key = `${url.pathname}${url.search}`;
    if ((active.get(key) ?? 0) > 0) duplicates.add(key);
    active.set(key, (active.get(key) ?? 0) + 1); requests.set(request, key);
  });
  const finish = (request: unknown) => {
    const key = requests.get(request); if (!key) return;
    active.set(key, Math.max(0, (active.get(key) ?? 1) - 1)); requests.delete(request);
  };
  page.on('requestfinished', finish); page.on('requestfailed', finish);
  return () => expect([...duplicates].sort(), 'Duplicate concurrent catalog reads').toEqual([]);
}
