import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type PlaywrightWorkerArgs,
  type Request,
  type Response,
  type Route,
} from '@playwright/test';
import {
  assertLiveCanaryRequestOrigin,
  requiredLiveCanaryOrigin,
} from '../liveCanaryTargets';

type JsonRecord = Record<string, unknown>;
type RequestMethod = 'get' | 'post' | 'patch' | 'delete';

interface LiveCredentials {
  username: string;
  password: string;
}

interface AuthUser {
  id: string;
  username: string;
}

interface LiveAPI {
  label: string;
  origin: string;
  request: APIRequestContext;
}

interface AuthenticatedAPI {
  api: LiveAPI;
  user: AuthUser;
}

interface CompiledDraftRoot {
  stableKey: string;
  draft: JsonRecord & {
    name: string;
    description?: string;
    notes?: string;
    systemId: string;
    rulesetVersion: string;
    characterType: string;
    characterSchemaVersion: number;
    raceId: string;
    lineageId: string | null;
    classId: string;
    backgroundId: string;
    level: number;
    featIds: string[];
    spellIds: string[];
    actionIds: string[];
    effectIds: string[];
    resourceIds: string[];
    resolvedChoices: Record<string, string[]>;
  };
  actor: {
    ac: number;
    character: {
      abilityScores: JsonRecord;
      abilityMods: Record<string, number>;
      skillProficiencies: string[];
      skillExpertise: string[];
      saveProficiencies: string[];
      characterSpeed: number;
      profBonus: number;
    };
    runtime: {
      hp: { current: number; max: number; temp?: number };
      resources: JsonRecord;
      maxResources: JsonRecord;
      equipment: JsonRecord;
      inventory: unknown[];
      activeEffects: unknown[];
    };
  };
}

interface RuntimeEffect extends JsonRecord {
  id: string;
  name: string;
  mechanics: { kind: 'condition'; value: 'prone'; op: 'apply' };
  roundsLeft: number;
  expiry: string;
  source: string;
}

interface CharacterResponse extends JsonRecord {
  id: string;
  name: string;
  notes?: string;
  access_mode?: 'owner' | 'legacy_public_readonly';
  current_hp: number;
  max_hp: number;
  current_encounter_id?: string | null;
  active_effects?: RuntimeEffect[] | null;
  runtime_revision?: number;
  equipment?: JsonRecord;
  inventory_items?: Array<{ card_id: string; qty: number }>;
  resources?: JsonRecord;
  turn_state?: JsonRecord;
}

interface CatalogCard extends JsonRecord {
  id: string;
  card_number: string;
  name: string;
}

interface CatalogAction extends JsonRecord {
  id: string;
  card_number: string;
  name: string;
}

interface EncounterCombatant extends JsonRecord {
  actorId: string;
  characterId?: string;
  name: string;
  hp: number;
  activeEffects?: RuntimeEffect[];
  pendingSaves?: unknown[];
}

interface EncounterResponse extends JsonRecord {
  id: string;
  name: string;
  seq: number;
  state: {
    combatants: EncounterCombatant[];
    round: number;
    activeIndex: number;
  };
}

interface CharacterEventRow extends JsonRecord {
  id: string;
  type: string;
  payload: JsonRecord;
}

type EncounterApplyResponse = Pick<EncounterResponse, 'seq' | 'state'>;

const compiledFixture = JSON.parse(readFileSync(new URL(
  '../src/pages/rulesLabFixture.generated.json',
  import.meta.url,
), 'utf8')) as {
  roots: { fighter: CompiledDraftRoot; wizard: CompiledDraftRoot };
};

const CERTIFIED_LONGBOW = {
  id: 'cc1ac793-af4f-45aa-87e2-bd563c734bef',
  card_number: 'CARD-0327',
} as const;
const CERTIFIED_ARROW = {
  id: '59b10a1e-8669-4bf6-88a5-69d0abfc76a6',
  card_number: 'CARD-0728',
} as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live browser canary`);
  return value;
}

function credentials(suffix: 'A' | 'B'): LiveCredentials {
  return {
    username: required(`LIVE_BROWSER_USER_${suffix}`),
    password: required(`LIVE_BROWSER_PASSWORD_${suffix}`),
  };
}

async function liveRequest(
  api: LiveAPI,
  method: RequestMethod,
  path: string,
  data?: unknown,
): Promise<APIResponse> {
  const response = await api.request.fetch(path, {
    method: method.toUpperCase(),
    maxRedirects: 0,
    ...(data === undefined ? {} : { data }),
  });
  assertLiveCanaryRequestOrigin(
    response.url(),
    api.origin,
    `${api.label} ${method.toUpperCase()} ${path}`,
  );
  return response;
}

async function checkedJSON<T>(
  api: LiveAPI,
  method: RequestMethod,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await liveRequest(api, method, path, data);
  if (!response.ok()) {
    throw new Error(`${method.toUpperCase()} ${path} failed with HTTP ${response.status()}`);
  }
  return response.json() as Promise<T>;
}

async function expectStatus(
  api: LiveAPI,
  method: RequestMethod,
  path: string,
  status: number,
  data?: unknown,
): Promise<void> {
  const response = await liveRequest(api, method, path, data);
  expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(status);
}

async function applyEncounter(
  api: LiveAPI,
  current: EncounterResponse,
  operation: JsonRecord,
): Promise<EncounterResponse> {
  const applied = await checkedJSON<EncounterApplyResponse>(
    api,
    'post',
    `/api/encounters/${current.id}/apply`,
    { ...operation, expected_seq: current.seq },
  );
  return { ...current, ...applied };
}

async function authenticatedAPI(
  playwright: PlaywrightWorkerArgs['playwright'],
  apiBaseURL: string,
  account: LiveCredentials,
  label: string,
): Promise<AuthenticatedAPI> {
  const anonymous = await playwright.request.newContext({ baseURL: apiBaseURL });
  try {
    const response = await anonymous.post('/api/auth/login', { data: account, maxRedirects: 0 });
    assertLiveCanaryRequestOrigin(response.url(), apiBaseURL, `${label} API login`);
    if (!response.ok()) throw new Error(`${label} API login failed with HTTP ${response.status()}`);

    const body = await response.json() as { token?: string; user?: AuthUser };
    if (!body.token || !body.user?.id || !body.user.username) {
      throw new Error(`${label} API login returned an incomplete session`);
    }

    const request = await playwright.request.newContext({
      baseURL: apiBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
    });
    const api: LiveAPI = { label, origin: apiBaseURL, request };
    try {
      const profile = await checkedJSON<AuthUser>(api, 'get', '/api/auth/profile');
      expect(profile).toMatchObject({ id: body.user.id, username: body.user.username });
      return { api, user: body.user };
    } catch (error) {
      await request.dispose();
      throw error;
    }
  } finally {
    await anonymous.dispose();
  }
}

function characterPayload(
  root: CompiledDraftRoot,
  name: string,
  cleanupMarker: string,
): JsonRecord {
  const { draft, actor } = root;
  const wisdom = actor.character.abilityMods.wis ?? 0;
  const perceptionProficient = actor.character.skillProficiencies.includes('perception');
  return {
    name,
    description: 'Temporary automated release canary; safe to delete.',
    notes: cleanupMarker,
    system_id: draft.systemId,
    ruleset_version: draft.rulesetVersion,
    character_type: draft.characterType,
    character_schema_version: draft.characterSchemaVersion,
    race_id: draft.raceId,
    lineage_id: draft.lineageId,
    class_id: draft.classId,
    background_id: draft.backgroundId,
    level: draft.level,
    feat_ids: draft.featIds,
    spell_ids: draft.spellIds,
    action_ids: draft.actionIds,
    effect_ids: draft.effectIds,
    resource_ids: draft.resourceIds,
    abilities: actor.character.abilityScores,
    skill_proficiencies: actor.character.skillProficiencies,
    skill_expertise: actor.character.skillExpertise,
    saving_throw_proficiencies: actor.character.saveProficiencies,
    tool_proficiencies: [],
    tool_expertise: [],
    languages: [],
    resolved_choices: draft.resolvedChoices,
    rule_state: {
      source: 'live-browser-canary-v2',
      compiled_root: root.stableKey,
      cleanup_marker: cleanupMarker,
    },
    max_hp: actor.runtime.hp.max,
    current_hp: actor.runtime.hp.current,
    speed: actor.character.characterSpeed,
    proficiency_bonus: actor.character.profBonus,
    armor_class: actor.ac,
    initiative_bonus: actor.character.abilityMods.dex ?? 0,
    passive_perception: 10 + wisdom + (perceptionProficient ? actor.character.profBonus : 0),
    equipment: actor.runtime.equipment,
    inventory_items: actor.runtime.inventory,
    resources: actor.runtime.resources,
    max_resources: actor.runtime.maxResources,
    active_effects: actor.runtime.activeEffects,
    turn_state: { temp_hp: actor.runtime.hp.temp ?? 0 },
    currency: {},
  };
}

function combatant(actorId: string, character: CharacterResponse, ac: number): JsonRecord {
  return {
    actorId,
    characterId: character.id,
    name: character.name,
    maxHp: character.max_hp,
    hp: character.current_hp,
    temp: 0,
    ac,
    activeEffects: [],
    pendingSaves: [],
    pendingAttacks: [],
    initiative: 10,
  };
}

async function loginInBrowser(
  page: Page,
  account: LiveCredentials,
  frontendOrigin: string,
  apiOrigin: string,
): Promise<void> {
  await page.goto('/login');
  expect(new URL(page.url()).origin).toBe(frontendOrigin);
  await page.getByLabel('Имя пользователя').fill(account.username);
  await page.getByLabel('Пароль').fill(account.password);

  const loginResponsePromise = page.waitForResponse((response) => {
    try {
      return response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/auth/login';
    } catch {
      return false;
    }
  });
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const loginResponse = await loginResponsePromise;
  assertLiveCanaryRequestOrigin(loginResponse.url(), apiOrigin, 'browser login request');
  expect(loginResponse.ok(), 'browser login response').toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
  expect(new URL(page.url()).origin).toBe(frontendOrigin);
}

async function createCompiledCharacterInForge(
  page: Page,
  root: CompiledDraftRoot,
  name: string,
  cleanupMarker: string,
  apiOrigin: string,
): Promise<CharacterResponse> {
  const draft = structuredClone(root.draft);
  draft.name = name;
  draft.description = 'Temporary automated release canary; safe to delete.';
  draft.notes = cleanupMarker;

  // Restore a complete canonical draft through the real Forge UI. This keeps
  // the live canary deterministic while still exercising Forge assembly,
  // validation, POST serialization, navigation and the resulting live sheet.
  await page.goto('/');
  await page.evaluate((value) => {
    localStorage.setItem('forge-draft', JSON.stringify(value));
  }, draft);
  await page.goto('/character-forge');
  await expect(page.getByRole('dialog')).toContainText(
    'Продолжить создание незавершённого персонажа?',
  );
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  const mobileSuggestion = page.getByRole('complementary', {
    name: 'Предложение мобильной версии',
  });
  if (await mobileSuggestion.isVisible()) {
    await mobileSuggestion.getByRole('button', { name: 'Не сейчас', exact: true }).click();
  }
  const createButton = page.getByRole('button', { name: 'Создать персонажа', exact: true });
  if (await createButton.count() === 0) {
    await page.getByRole('button', { name: 'Общее', exact: true }).click();
  }
  await expect(createButton).toBeEnabled();
  const responsePromise = page.waitForResponse((response) => {
    try {
      return response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/characters-v3';
    } catch {
      return false;
    }
  });
  await createButton.click();
  const response = await responsePromise;
  assertLiveCanaryRequestOrigin(response.url(), apiOrigin, 'Forge character creation');
  expect(response.status(), 'Forge character creation response').toBe(201);
  const character = await response.json() as CharacterResponse;
  expect(character).toMatchObject({ name, notes: cleanupMarker, access_mode: 'owner' });
  await expect(page).toHaveURL(new RegExp(`/characters-v3/${character.id}$`));
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);
  return character;
}

function redactDiagnostic(value: string, secrets: string[]): string {
  let redacted = value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function captureBrowserDiagnostics(
  page: Page,
  label: string,
  secrets: string[],
  errors: string[],
): () => void {
  const record = (value: string) => errors.push(redactDiagnostic(`${label}: ${value}`, secrets));
  const onPageError = (error: Error) => record(`pageerror: ${error.message}`);
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === 'error') record(`console: ${message.text()}`);
  };
  const onRequestFailed = (request: Request) => {
    const reason = request.failure()?.errorText ?? 'unknown network error';
    if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(reason)) return;
    record(`requestfailed: ${reason} ${request.url()}`);
  };
  const onResponse = (response: Response) => {
    if (response.status() >= 400) {
      record(`response: HTTP ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  return () => {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
  };
}

async function installBrowserOriginFence(
  context: BrowserContext,
  allowedOrigins: ReadonlySet<string>,
): Promise<void> {
  const stubbedPresentationOrigins = new Set([
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://dnd-cards-images.storage.yandexcloud.net',
  ]);
  await context.route('**/*', async (route: Route) => {
    let parsed: URL;
    try {
      parsed = new URL(route.request().url());
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !allowedOrigins.has(parsed.origin)) {
      // The application stylesheet references public fonts. Keep the canary's
      // credential boundary at the two pinned origins while replacing those
      // presentation-only requests locally, so no third-party request occurs.
      if (stubbedPresentationOrigins.has(parsed.origin) && route.request().method() === 'GET') {
        await route.fulfill({
          status: parsed.hostname === 'dnd-cards-images.storage.yandexcloud.net' ? 204 : 200,
          contentType: parsed.hostname === 'fonts.googleapis.com'
            ? 'text/css'
            : parsed.hostname === 'fonts.gstatic.com' ? 'font/woff2' : 'image/png',
          body: '',
        });
        return;
      }
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function deleteAndVerify(
  api: LiveAPI,
  path: string,
  label: string,
  cleanupErrors: string[],
): Promise<void> {
  try {
    const deletion = await liveRequest(api, 'delete', path);
    if (deletion.status() !== 404 && !deletion.ok()) {
      cleanupErrors.push(`${label}: DELETE returned HTTP ${deletion.status()}`);
      return;
    }
    const afterDelete = await liveRequest(api, 'get', path);
    if (afterDelete.status() !== 404) {
      cleanupErrors.push(`${label}: GET after delete returned HTTP ${afterDelete.status()}`);
    }
  } catch (error) {
    cleanupErrors.push(`${label}: ${errorMessage(error)}`);
  }
}

async function cleanupEncounterArtifacts(
  api: LiveAPI,
  knownEncounterId: string | undefined,
  markerName: string,
  cleanupErrors: string[],
): Promise<void> {
  const ids = new Set<string>();
  if (knownEncounterId) ids.add(knownEncounterId);
  try {
    const list = await checkedJSON<{ encounters?: EncounterResponse[] }>(api, 'get', '/api/encounters');
    for (const candidate of list.encounters ?? []) {
      if (candidate.name === markerName) ids.add(candidate.id);
    }
  } catch (error) {
    cleanupErrors.push(`encounter marker sweep: ${errorMessage(error)}`);
  }
  for (const id of ids) {
    await deleteAndVerify(api, `/api/encounters/${id}`, `encounter ${id} cleanup`, cleanupErrors);
  }
}

async function cleanupCharacterArtifacts(
  api: LiveAPI,
  knownCharacterId: string | undefined,
  marker: string,
  cleanupErrors: string[],
): Promise<void> {
  const ids = new Set<string>();
  if (knownCharacterId) ids.add(knownCharacterId);
  try {
    const list = await checkedJSON<CharacterResponse[]>(api, 'get', '/api/characters-v3');
    for (const candidate of list) {
      if (candidate.notes === marker) ids.add(candidate.id);
    }
  } catch (error) {
    cleanupErrors.push(`${api.label} character marker sweep: ${errorMessage(error)}`);
  }
  for (const id of ids) {
    await deleteAndVerify(api, `/api/characters-v3/${id}`, `${api.label} character ${id} cleanup`, cleanupErrors);
  }
}

async function closeContext(
  context: BrowserContext | undefined,
  label: string,
  cleanupErrors: string[],
): Promise<void> {
  if (!context) return;
  try {
    await context.close();
  } catch (error) {
    cleanupErrors.push(`${label} browser cleanup: ${errorMessage(error)}`);
  }
}

test('persists a two-account UI turn, failed save, HP loss and canonical condition', async ({
  browser,
  playwright,
}, testInfo) => {
  const frontendOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');
  const apiOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend');
  const accountA = credentials('A');
  const accountB = credentials('B');
  if (accountA.username === accountB.username) {
    throw new Error('LIVE_BROWSER_USER_A and LIVE_BROWSER_USER_B must be distinct accounts');
  }

  const marker = `live-browser-canary:${randomUUID()}`;
  const suffix = marker.slice(-8);
  const encounterName = `Canary Encounter ${marker}`;
  const browserDiagnostics: string[] = [];
  const stopDiagnostics: Array<() => void> = [];
  const cleanupErrors: string[] = [];
  let bodyError: unknown;
  let authA: AuthenticatedAPI | undefined;
  let authB: AuthenticatedAPI | undefined;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  let characterA: CharacterResponse | undefined;
  let characterB: CharacterResponse | undefined;
  let encounter: EncounterResponse | undefined;

  try {
    authA = await authenticatedAPI(playwright, apiOrigin, accountA, 'account A');
    authB = await authenticatedAPI(playwright, apiOrigin, accountB, 'account B');
    expect(authA.user.id).not.toBe(authB.user.id);

    // Every canary uses a fresh non-persistent context, so it cannot inherit a
    // stale worker. Keep service workers enabled to exercise the real PWA
    // registration/update path instead of manufacturing console failures.
    contextA = await browser.newContext({ baseURL: frontendOrigin, serviceWorkers: 'allow' });
    await contextA.addInitScript(() => {
      Math.random = () => 0.99;
    });
    const browserOrigins = new Set([frontendOrigin, apiOrigin]);
    await installBrowserOriginFence(contextA, browserOrigins);
    const pageAForge = await contextA.newPage();
    stopDiagnostics.push(captureBrowserDiagnostics(
      pageAForge,
      'account A forge and sheet',
      [accountA.password, accountB.password],
      browserDiagnostics,
    ));
    await loginInBrowser(pageAForge, accountA, frontendOrigin, apiOrigin);
    characterA = await createCompiledCharacterInForge(
      pageAForge,
      compiledFixture.roots.fighter,
      `Canary Fighter ${suffix}`,
      marker,
      apiOrigin,
    );
    const longbow = await checkedJSON<CatalogCard>(
      authA.api,
      'get',
      `/api/cards/${CERTIFIED_LONGBOW.id}`,
    );
    const arrow = await checkedJSON<CatalogCard>(
      authA.api,
      'get',
      `/api/cards/${CERTIFIED_ARROW.id}`,
    );
    expect(longbow).toMatchObject(CERTIFIED_LONGBOW);
    expect(arrow).toMatchObject(CERTIFIED_ARROW);
    characterA = await checkedJSON<CharacterResponse>(
      authA.api,
      'patch',
      `/api/characters-v3/${characterA.id}/runtime`,
      {
        equipment: { main_hand: longbow.id },
        inventory_items: [
          { card_id: longbow.id, qty: 1 },
          { card_id: arrow.id, qty: 3 },
        ],
      },
    );
    const basicActions = await checkedJSON<{ actions?: CatalogAction[] }>(
      authA.api,
      'get',
      '/api/actions?type=basic&limit=50',
    );
    const weaponAction = basicActions.actions?.find((action) => (
      action.card_number === 'action_basic_weapon'
    ));
    if (!weaponAction) throw new Error('Live catalog misses the basic Weapon Attack');
    await pageAForge.goto(`/characters-v3/${characterA.id}`);
    const weaponButton = pageAForge.locator(`[data-action-id="${weaponAction.id}"]`)
      .getByRole('button')
      .filter({ visible: true })
      .first();
    await expect(weaponButton).toBeEnabled({ timeout: 30_000 });
    await weaponButton.click();
    const targetDialog = pageAForge.getByRole('dialog', { name: 'Цели и факты боя' });
    await expect(targetDialog).toBeVisible();
    const dummy = targetDialog.locator('[data-target-id="scene-target:training-dummy"]');
    await expect(dummy.getByRole('checkbox')).toBeChecked();
    await expect(dummy.getByRole('combobox')).toHaveCount(0);
    await dummy.locator('input[type="number"]').fill('30');
    const commandResponsePromise = pageAForge.waitForResponse((response) => {
      try {
        return response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/characters-v3/runtime-commands';
      } catch {
        return false;
      }
    });
    await targetDialog.getByRole('button', { name: 'Подтвердить цели' }).click();
    const commandResponse = await commandResponsePromise;
    assertLiveCanaryRequestOrigin(commandResponse.url(), apiOrigin, 'live sheet weapon command');
    expect(commandResponse.ok(), 'live sheet weapon command').toBe(true);
    await expect(pageAForge.getByText('Действие принято', { exact: true })).toBeVisible();
    characterA = await checkedJSON<CharacterResponse>(
      authA.api,
      'get',
      `/api/characters-v3/${characterA.id}`,
    );
    expect(characterA.inventory_items).toEqual([
      { card_id: longbow.id, qty: 1 },
      { card_id: arrow.id, qty: 2 },
    ]);
    expect(characterA.resources?.action).toBe(0);
    expect(characterA.turn_state?.canonical_pending_combat_v1).toBeTruthy();

    // A real sheet turn write increments runtime_revision outside the atomic
    // combat endpoint. The next attack must rebuild from that fresh sheet and
    // must not keep an obsolete continuation that makes the button a dead end.
    const newTurnResponsePromise = pageAForge.waitForResponse((response) => {
      try {
        return response.request().method() === 'PATCH'
          && new URL(response.url()).pathname === `/api/characters-v3/${characterA!.id}/runtime`;
      } catch {
        return false;
      }
    });
    await pageAForge.getByRole('button', { name: 'Новый ход', exact: true }).click();
    const newTurnResponse = await newTurnResponsePromise;
    expect(newTurnResponse.ok(), 'live sheet new turn').toBe(true);
    await expect(weaponButton).toBeEnabled({ timeout: 30_000 });
    await weaponButton.click();
    await expect(targetDialog).toBeVisible();
    await expect(dummy.getByRole('checkbox')).toBeChecked();
    await dummy.locator('input[type="number"]').fill('30');
    const secondCommandResponsePromise = pageAForge.waitForResponse((response) => {
      try {
        return response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/characters-v3/runtime-commands';
      } catch {
        return false;
      }
    });
    await targetDialog.getByRole('button', { name: 'Подтвердить цели' }).click();
    const secondCommandResponse = await secondCommandResponsePromise;
    expect(secondCommandResponse.ok(), 'live sheet weapon command after a new turn').toBe(true);
    characterA = await checkedJSON<CharacterResponse>(
      authA.api,
      'get',
      `/api/characters-v3/${characterA.id}`,
    );
    expect(characterA.inventory_items).toEqual([
      { card_id: longbow.id, qty: 1 },
      { card_id: arrow.id, qty: 1 },
    ]);
    expect(characterA.resources?.action).toBe(0);
    await pageAForge.close();
    characterB = await checkedJSON<CharacterResponse>(
      authB.api,
      'post',
      '/api/characters-v3',
      characterPayload(compiledFixture.roots.wizard, `Canary Wizard ${suffix}`, marker),
    );

    await expectStatus(authA.api, 'get', `/api/characters-v3/${characterB.id}`, 403);
    await expectStatus(authA.api, 'get', `/api/characters-v3/${characterB.id}/events`, 403);
    await expectStatus(authB.api, 'get', `/api/characters-v3/${characterA.id}`, 403);
    await expectStatus(authB.api, 'get', `/api/characters-v3/${characterA.id}/events`, 403);

    encounter = await checkedJSON<EncounterResponse>(authA.api, 'post', '/api/encounters', {
      name: encounterName,
    });
    await expectStatus(authB.api, 'get', `/api/encounters/${encounter.id}`, 403);
    encounter = await applyEncounter(authA.api, encounter, {
      add: [combatant('canary-fighter', characterA, compiledFixture.roots.fighter.actor.ac)],
    });

    const invite = await checkedJSON<{ token: string }>(
      authA.api,
      'post',
      `/api/encounters/${encounter.id}/invite`,
      {},
    );
    await checkedJSON<EncounterResponse>(
      authB.api,
      'post',
      `/api/encounters/${encounter.id}/join`,
      { invite_token: invite.token },
    );
    encounter = await applyEncounter(authB.api, encounter, {
      add: [combatant('canary-wizard', characterB, compiledFixture.roots.wizard.actor.ac)],
    });

    await expectStatus(authB.api, 'delete', `/api/encounters/${encounter.id}`, 403);
    await expectStatus(authB.api, 'post', `/api/encounters/${encounter.id}/apply`, 403, {
      expected_seq: encounter.seq,
      patches: [{ actor_id: 'canary-fighter', set: { hp: Math.max(0, characterA.current_hp - 1) } }],
    });
    const afterForbiddenPatch = await checkedJSON<EncounterResponse>(
      authA.api,
      'get',
      `/api/encounters/${encounter.id}`,
    );
    expect(afterForbiddenPatch.seq).toBe(encounter.seq);
    expect(afterForbiddenPatch.state.combatants.find((row) => row.actorId === 'canary-fighter')?.hp)
      .toBe(characterA.current_hp);

    const protectedRuntimeWrite = await liveRequest(
      authB.api,
      'patch',
      `/api/characters-v3/${characterB.id}/runtime`,
      {
        current_hp: Math.max(0, characterB.current_hp - 1),
      },
    );
    // Current compatibility PATCH returns 200 after omitting encounter-owned
    // fields; a future stricter adapter may reject the whole request with 409.
    expect([200, 409]).toContain(protectedRuntimeWrite.status());
    const afterDirectRuntimeWrite = await checkedJSON<CharacterResponse>(
      authB.api,
      'get',
      `/api/characters-v3/${characterB.id}`,
    );
    expect(afterDirectRuntimeWrite.current_hp).toBe(characterB.current_hp);

    await expectStatus(authB.api, 'post', `/api/encounters/${encounter.id}/apply`, 409, {
      expected_seq: encounter.seq - 1,
      patches: [{ actor_id: 'canary-wizard', set: { pendingSaves: [] } }],
    });
    const afterStaleApply = await checkedJSON<EncounterResponse>(
      authA.api,
      'get',
      `/api/encounters/${encounter.id}`,
    );
    expect(afterStaleApply.seq).toBe(encounter.seq);

    encounter = await applyEncounter(authA.api, encounter, { round: 1, active_index: 0 });
    const prone = await checkedJSON<{
      id: string;
      name: string;
      mechanics: JsonRecord & { condition?: { id?: string } };
    }>(authA.api, 'get', '/api/effects/COND-prone');
    expect(prone.mechanics).toMatchObject({ condition: { id: 'prone' } });

    const runtimeProne: RuntimeEffect = {
      id: `canary-effect-${suffix}`,
      name: prone.name,
      mechanics: { kind: 'condition', value: 'prone', op: 'apply' },
      roundsLeft: 1,
      expiry: 'rounds',
      source: `canary-save-${suffix}`,
    };
    const pendingSave = {
      id: `canary-save-${suffix}`,
      sourceName: characterA.name,
      actionName: 'Canary save interaction',
      ability: 'dex',
      dc: 99,
      onFail: {
        hpDelta: -3,
        tempDelta: 0,
        damageType: 'force',
        addEffects: [runtimeProne],
      },
      onSuccess: { hpDelta: 0, tempDelta: 0, addEffects: [] },
      avoidsConditions: ['prone'],
    };

    contextB = await browser.newContext({ baseURL: frontendOrigin, serviceWorkers: 'allow' });
    await installBrowserOriginFence(contextB, browserOrigins);
    const pageAEncounter = await contextA.newPage();
    const pageBEncounter = await contextB.newPage();
    stopDiagnostics.push(captureBrowserDiagnostics(
      pageAEncounter,
      'account A encounter',
      [accountA.password, accountB.password],
      browserDiagnostics,
    ));
    stopDiagnostics.push(captureBrowserDiagnostics(
      pageBEncounter,
      'account B encounter',
      [accountA.password, accountB.password],
      browserDiagnostics,
    ));
    await loginInBrowser(pageBEncounter, accountB, frontendOrigin, apiOrigin);

    await pageAEncounter.goto(`/encounter/${encounter.id}`);
    await pageBEncounter.goto(`/encounter/${encounter.id}`);
    for (const page of [pageAEncounter, pageBEncounter]) {
      await expect(page.getByText(characterA.name, { exact: true })).toBeVisible();
      await expect(page.getByText(characterB.name, { exact: true })).toBeVisible();
      await expect(page.locator('[title="подключено (realtime)"]')).toBeVisible();
    }
    await pageBEncounter.getByRole('button', { name: /Журнал боя/ }).click();

    const pageBSheet = await contextB.newPage();
    stopDiagnostics.push(captureBrowserDiagnostics(
      pageBSheet,
      'account B sheet',
      [accountA.password, accountB.password],
      browserDiagnostics,
    ));
    await pageBSheet.goto(`/characters-v3/${characterB.id}`);
    await expect(pageBSheet.getByText(characterB.name, { exact: true }).first()).toBeVisible();
    await expect(pageBSheet.locator('.sheet-hp-main strong')).toHaveText(String(characterB.current_hp));

    encounter = await applyEncounter(authA.api, encounter, {
      patches: [{ actor_id: 'canary-wizard', set: { pendingSaves: [pendingSave] } }],
      log: [{ message: `${characterA.name} requested a Dexterity save` }],
    });

    const saveDialog = pageBSheet.getByRole('dialog', { name: 'Бросок кубов' });
    await expect(saveDialog).toBeVisible();
    await expect(saveDialog).toContainText('Входящий спасбросок — Canary save interaction');
    await saveDialog.locator('input[type="number"]').fill('1');
    await saveDialog.getByRole('button', { name: 'Использовать мои кубы' }).click();
    await expect(saveDialog).toBeHidden();

    const hpAfter = Math.max(0, characterB.current_hp - 3);
    await expect.poll(async () => {
      try {
        const persisted = await checkedJSON<CharacterResponse>(
          authB!.api,
          'get',
          `/api/characters-v3/${characterB!.id}`,
        );
        const effect = persisted.active_effects?.find((candidate) => candidate.id === runtimeProne.id);
        return { hp: persisted.current_hp, effect };
      } catch {
        return null;
      }
    }, { message: 'failed save must persist HP and the canonical condition primitive' }).toEqual({
      hp: hpAfter,
      effect: runtimeProne,
    });

    encounter = await checkedJSON<EncounterResponse>(
      authA.api,
      'get',
      `/api/encounters/${encounter.id}`,
    );
    const persistedCombatantB = encounter.state.combatants.find((row) => row.actorId === 'canary-wizard');
    expect(persistedCombatantB).toMatchObject({
      hp: hpAfter,
      pendingSaves: [],
      activeEffects: [runtimeProne],
    });

    const characterEvents = await checkedJSON<CharacterEventRow[]>(
      authB.api,
      'get',
      `/api/characters-v3/${characterB.id}/events`,
    );
    expect(characterEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'condition_applied',
        payload: expect.objectContaining({
          type: 'condition_applied',
          condition: prone.name,
          source: characterA.name,
        }),
      }),
      expect.objectContaining({
        type: 'damage',
        payload: expect.objectContaining({
          type: 'damage',
          amount: 3,
          damageType: 'force',
          source: characterA.name,
        }),
      }),
      expect.objectContaining({
        type: 'roll',
        payload: expect.objectContaining({ type: 'roll' }),
      }),
    ]));

    await expect(pageBSheet.locator('.sheet-hp-main strong')).toHaveText(String(hpAfter));
    await expect(pageBSheet.locator('.sheet-condition-name')).toContainText(prone.name);
    await expect(pageAEncounter.locator('[title="Снять"]').filter({ hasText: prone.name }).first())
      .toBeVisible();
    await expect(pageBEncounter.getByText(
      `${characterB.name}: спасбросок Ловкость — провал, урон 3`,
    ).first()).toBeVisible();

    await pageAEncounter.getByRole('button', { name: 'Следующий ход →', exact: true }).click();
    await expect.poll(async () => {
      const current = await checkedJSON<EncounterResponse>(
        authA!.api,
        'get',
        `/api/encounters/${encounter!.id}`,
      );
      return current.state.activeIndex;
    }, { message: 'owner UI must advance the authoritative turn' }).toBe(1);
    await expect(pageBEncounter.getByText(`Ход: ${characterB.name}`).first()).toBeVisible();

    await pageBSheet.reload();
    await expect(pageBSheet.locator('.sheet-hp-main strong')).toHaveText(String(hpAfter));
    await expect(pageBSheet.locator('.sheet-condition-name')).toContainText(prone.name);
    if (browserDiagnostics.length > 0) {
      throw new Error(`Browser diagnostics are not clean:\n${browserDiagnostics.join('\n')}`);
    }

    // Complete the same live flow through the personal library and its UI
    // deletion. Legacy-public rows must not be injected into this private list.
    await expectStatus(authA.api, 'delete', `/api/encounters/${encounter.id}`, 200);
    encounter = undefined;
    await pageAEncounter.goto('/characters-forge');
    await expect(pageAEncounter.getByText('только чтение')).toHaveCount(0);
    const characterCard = pageAEncounter.locator('.forge-char-card').filter({
      hasText: characterA.name,
    });
    await expect(characterCard).toBeVisible();
    await characterCard.getByTitle('Удалить персонажа').click();
    const deleteResponsePromise = pageAEncounter.waitForResponse((response) => {
      try {
        return response.request().method() === 'DELETE'
          && new URL(response.url()).pathname === `/api/characters-v3/${characterA!.id}`;
      } catch {
        return false;
      }
    });
    await characterCard.getByRole('button', { name: 'Удалить?', exact: true }).click();
    const deleteResponse = await deleteResponsePromise;
    assertLiveCanaryRequestOrigin(deleteResponse.url(), apiOrigin, 'character library deletion');
    expect(deleteResponse.status()).toBe(200);
    await expect(characterCard).toHaveCount(0);
    await expectStatus(authA.api, 'get', `/api/characters-v3/${characterA.id}`, 404);
  } catch (error) {
    bodyError = error;
  } finally {
    if (browserDiagnostics.length > 0) {
      await testInfo.attach('live-browser-diagnostics', {
        body: browserDiagnostics.join('\n'),
        contentType: 'text/plain',
      });
    }
    stopDiagnostics.forEach((stop) => stop());
    await closeContext(contextA, 'account A', cleanupErrors);
    await closeContext(contextB, 'account B', cleanupErrors);

    if (authA) {
      await cleanupEncounterArtifacts(authA.api, encounter?.id, encounterName, cleanupErrors);
    }
    if (authA) {
      await cleanupCharacterArtifacts(authA.api, characterA?.id, marker, cleanupErrors);
    }
    if (authB) {
      await cleanupCharacterArtifacts(authB.api, characterB?.id, marker, cleanupErrors);
    }

    const disposals = await Promise.allSettled([
      ...(authA ? [authA.api.request.dispose()] : []),
      ...(authB ? [authB.api.request.dispose()] : []),
    ]);
    for (const disposal of disposals) {
      if (disposal.status === 'rejected') {
        cleanupErrors.push(`API context cleanup: ${errorMessage(disposal.reason)}`);
      }
    }
  }

  if (bodyError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [bodyError, ...cleanupErrors.map((message) => new Error(message))],
        'Live browser canary and cleanup both failed',
      );
    }
    throw bodyError;
  }
  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '));
});
