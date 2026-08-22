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
import type { Background, Card, CharacterClass, Feat, Race } from '../src/types';

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
  class_id?: string | null;
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
  currency?: Record<string, number>;
  resolved_choices?: Record<string, string[]>;
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

interface CatalogSpell extends JsonRecord {
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
  roots: {
    fighter: CompiledDraftRoot;
    wizard: CompiledDraftRoot;
    magicInitiateFighter: CompiledDraftRoot;
  };
};

const miniMvpForgeSheetFixture = JSON.parse(readFileSync(new URL(
  '../src/canon/data/mini-mvp-forge-sheet-fixture.v1.json',
  import.meta.url,
), 'utf8')) as {
  schemaVersion: 2;
  strategy: 'cyclic-covering-set-with-lineages-v2';
  coverage: Record<'classes' | 'species' | 'lineages' | 'backgrounds' | 'originFeats', string[]>;
  roots: Array<{
    classCardNumber: string;
    raceCardNumber: string;
    lineageCardNumber?: string;
    backgroundCardNumber: string;
    featCardNumber: string;
    draft: CompiledDraftRoot['draft'];
  }>;
};

const miniMvpFightingStyleFixture = JSON.parse(readFileSync(new URL(
  '../src/canon/data/mini-mvp-fighting-style-fixture.v1.json',
  import.meta.url,
), 'utf8')) as {
  schemaVersion: 1;
  strategy: 'one-fighter-per-style-v1';
  base: {
    classCardNumber: string;
    raceCardNumber: string;
    backgroundCardNumber: string;
    originFeatCardNumber: string;
  };
  coverage: { fightingStyles: string[] };
  roots: Array<{
    styleCardNumber: string;
    draft: CompiledDraftRoot['draft'];
  }>;
};

const CERTIFIED_LONGBOW = {
  id: 'cc1ac793-af4f-45aa-87e2-bd563c734bef',
  card_number: 'CARD-0327',
} as const;
const CERTIFIED_ARROW = {
  id: '59b10a1e-8669-4bf6-88a5-69d0abfc76a6',
  card_number: 'CARD-0728',
} as const;
const THUNDERWAVE_SPELL_ID = '34518f38-b737-4a91-88ac-d5858d2d04a0';
const MAGE_HAND_SPELL_ID = '70e35366-5446-49ff-b0b9-759dbbff347e';
const ELEMENTALISM_SPELL_ID = 'b84d904f-4768-4a05-8803-7a0d0da28a00';

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

async function fetchAllLive<T extends { id: string }>(
  api: LiveAPI,
  path: string,
  key: string,
): Promise<T[]> {
  const items: T[] = [];
  const seenIds = new Set<string>();
  let total: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const body = await checkedJSON<Record<string, unknown>>(
      api,
      'get',
      `${path}${separator}page=${page}&limit=1000`,
    );
    const batch = body[key];
    if (!Array.isArray(batch)) throw new Error(`${path}: response is missing ${key}`);
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
      if (total !== null && total !== responseTotal) {
        throw new Error(`${path}: total changed from ${total} to ${responseTotal}`);
      }
      total = responseTotal;
    }
    for (const item of batch as T[]) {
      if (!item?.id || seenIds.has(item.id)) {
        throw new Error(`${path}: repeated or blank entity id ${item?.id ?? '<blank>'}`);
      }
      seenIds.add(item.id);
      items.push(item);
    }
    if (total !== null) {
      if (items.length === total) return items;
      if (items.length > total || batch.length === 0) {
        throw new Error(`${path}: received ${items.length}/${total} rows`);
      }
    } else if (batch.length < 1000) {
      return items;
    }
  }
  throw new Error(`${path}: pagination exceeded 100 pages`);
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
  root: Pick<CompiledDraftRoot, 'draft'>,
  name: string,
  cleanupMarker: string,
  apiOrigin: string,
  inspectCreateRequest?: (body: JsonRecord) => void,
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
  inspectCreateRequest?.(response.request().postDataJSON() as JsonRecord);
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

test('public sheet certificate: Forge Magic Initiate Fighter uses Longbow and Thunderwave', async ({
  browser,
  playwright,
}, testInfo) => {
  const frontendOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');
  const apiOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend');
  const expectedCommit = required('EXPECTED_DEPLOYED_COMMIT').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('EXPECTED_DEPLOYED_COMMIT must be an exact 40-hex Git commit');
  }
  const account = credentials('A');
  const marker = `public-sheet-certificate:${randomUUID()}`;
  const suffix = marker.slice(-8);
  const diagnostics: string[] = [];
  const cleanupErrors: string[] = [];
  let bodyError: unknown;
  let auth: AuthenticatedAPI | undefined;
  let context: BrowserContext | undefined;
  let character: CharacterResponse | undefined;
  let stopDiagnostics: (() => void) | undefined;

  try {
    auth = await authenticatedAPI(playwright, apiOrigin, account, 'sheet certificate account');
    const health = await checkedJSON<{ source_commit?: string }>(
      auth.api,
      'get',
      '/api/health',
    );
    const build = await checkedJSON<{ source_commit?: string }>(
      auth.api,
      'get',
      `/build-info.json?release=${expectedCommit}`,
    );
    expect(health.source_commit, 'public backend commit').toBe(expectedCommit);
    expect(build.source_commit, 'public frontend commit').toBe(expectedCommit);

    context = await browser.newContext({ baseURL: frontendOrigin, serviceWorkers: 'allow' });
    await context.addInitScript(() => {
      Math.random = () => 0.99;
    });
    await installBrowserOriginFence(context, new Set([frontendOrigin, apiOrigin]));
    const page = await context.newPage();
    stopDiagnostics = captureBrowserDiagnostics(
      page,
      'public Magic Initiate sheet certificate',
      [account.password],
      diagnostics,
    );
    await loginInBrowser(page, account, frontendOrigin, apiOrigin);
    const utilityRoot = structuredClone(compiledFixture.roots.magicInitiateFighter);
    utilityRoot.draft.spellIds = [
      THUNDERWAVE_SPELL_ID,
      MAGE_HAND_SPELL_ID,
      ELEMENTALISM_SPELL_ID,
    ];
    const cantripChoice = Object.keys(utilityRoot.draft.resolvedChoices)
      .find((key) => key.endsWith(':magic_initiate_wizard_cantrips'));
    if (!cantripChoice) throw new Error('Magic Initiate cantrip choice is missing from the compiled Forge root');
    utilityRoot.draft.resolvedChoices[cantripChoice] = [MAGE_HAND_SPELL_ID, ELEMENTALISM_SPELL_ID];
    character = await createCompiledCharacterInForge(
      page,
      utilityRoot,
      `Canary Magic Archer ${suffix}`,
      marker,
      apiOrigin,
    );

    const [longbow, arrow, basicActions] = await Promise.all([
      checkedJSON<CatalogCard>(auth.api, 'get', `/api/cards/${CERTIFIED_LONGBOW.id}`),
      checkedJSON<CatalogCard>(auth.api, 'get', `/api/cards/${CERTIFIED_ARROW.id}`),
      checkedJSON<{ actions?: CatalogAction[] }>(auth.api, 'get', '/api/actions?type=basic&limit=50'),
    ]);
    expect(longbow).toMatchObject(CERTIFIED_LONGBOW);
    expect(arrow).toMatchObject(CERTIFIED_ARROW);
    const weaponAction = basicActions.actions?.find((action) => (
      action.card_number === 'action_basic_weapon'
    ));
    if (!weaponAction) throw new Error('Live catalog misses the basic Weapon Attack');
    character = await checkedJSON<CharacterResponse>(
      auth.api,
      'patch',
      `/api/characters-v3/${character.id}/runtime`,
      {
        equipment: { main_hand: longbow.id },
        inventory_items: [
          { card_id: longbow.id, qty: 1 },
          { card_id: arrow.id, qty: 2 },
        ],
        turn_state: {
          ...(character.turn_state ?? {}),
          canonical_rules_world_v1: {
            schemaVersion: 1,
            primaryActorId: character.id,
            rulesetContentHash: 'sheet:previous-deployment',
            world: {},
          },
        },
      },
    );

    await page.goto(`/characters-v3/${character.id}`);
    await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);
    const weaponButton = page.locator(`[data-action-id="${weaponAction.id}"]`)
      .getByRole('button')
      .filter({ visible: true })
      .first();
    await expect(weaponButton).toBeEnabled({ timeout: 30_000 });
    await weaponButton.click();
    const targetDialog = page.getByRole('dialog', { name: 'Цели и факты боя' });
    await expect(targetDialog).toBeVisible();
    let dummy = targetDialog.locator('[data-target-id="scene-target:training-dummy"]');
    await expect(dummy.getByRole('checkbox')).toBeChecked();
    await dummy.locator('input[type="number"]').fill('30');
    let commandResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/characters-v3/runtime-commands'
    ));
    await targetDialog.getByRole('button', { name: 'Подтвердить цели' }).click();
    let commandResponse = await commandResponsePromise;
    assertLiveCanaryRequestOrigin(commandResponse.url(), apiOrigin, 'public Longbow command');
    expect(commandResponse.ok(), 'public Longbow command').toBe(true);
    await expect(page.getByText('Действие принято', { exact: true })).toBeVisible();

    const newTurnResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
    ));
    await page.getByRole('button', { name: 'Новый ход', exact: true }).click();
    expect((await newTurnResponsePromise).ok(), 'new turn before Thunderwave').toBe(true);

    const thunderwaveButton = page.locator(`[data-action-id="${THUNDERWAVE_SPELL_ID}"]`)
      .getByRole('button')
      .filter({ visible: true })
      .first();
    await expect(thunderwaveButton).toBeEnabled({ timeout: 30_000 });
    await thunderwaveButton.click();
    const cast = page.getByRole('dialog', { name: 'Выбор при действии' });
    await expect(cast).toBeVisible();
    await cast.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(targetDialog).toBeVisible();
    dummy = targetDialog.locator('[data-target-id="scene-target:training-dummy"]');
    await expect(dummy.getByRole('checkbox')).toBeChecked();
    await dummy.locator('input[type="number"]').fill('10');
    commandResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/characters-v3/runtime-commands'
    ));
    await targetDialog.getByRole('button', { name: 'Подтвердить цели' }).click();
    commandResponse = await commandResponsePromise;
    assertLiveCanaryRequestOrigin(commandResponse.url(), apiOrigin, 'public Thunderwave command');
    expect(commandResponse.ok(), 'public Thunderwave command').toBe(true);

    const save = page.getByTestId('sheet-combat-target-save').first();
    await expect(save).toBeVisible({ timeout: 30_000 });
    await expect(save).toContainText('Пугало');
    await save.getByRole('spinbutton', { name: 'Результат d20 спасброска' }).fill('1');
    const saveResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/characters-v3/runtime-commands'
    ));
    await save.getByRole('button', { name: 'Применить d20' }).click();
    expect((await saveResponsePromise).ok(), 'public Thunderwave save resolution').toBe(true);

    character = await checkedJSON<CharacterResponse>(
      auth.api,
      'get',
      `/api/characters-v3/${character.id}`,
    );
    expect(character.inventory_items).toEqual([
      { card_id: longbow.id, qty: 1 },
      { card_id: arrow.id, qty: 1 },
    ]);
    expect(character.resources?.action).toBe(0);
    expect(character.resources?.[`freeuse-${THUNDERWAVE_SPELL_ID}`]).toBe(0);

    const mageTurnPromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
    ));
    await page.getByRole('button', { name: 'Новый ход', exact: true }).click();
    expect((await mageTurnPromise).ok(), 'new turn before Mage Hand').toBe(true);
    const mageHandButton = page.locator(`[data-action-id="${MAGE_HAND_SPELL_ID}"]`)
      .getByRole('button').filter({ visible: true }).first();
    await expect(mageHandButton).toBeEnabled({ timeout: 30_000 });
    await mageHandButton.click();
    const mageConfirm = page.getByRole('dialog', { name: 'Подтверждение действия' });
    await expect(mageConfirm).toBeVisible();
    const mageRuntimePromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
    ));
    await mageConfirm.getByRole('button', { name: 'Применить', exact: true }).click();
    expect((await mageRuntimePromise).ok(), 'public Mage Hand runtime persistence').toBe(true);
    character = await checkedJSON<CharacterResponse>(auth.api, 'get', `/api/characters-v3/${character.id}`);
    expect((character.active_effects ?? []).some((effect) => (
      (effect.mechanics as JsonRecord)?.kind === 'remote_manipulator'
    ))).toBe(true);

    const elementalismTurnPromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
    ));
    await page.getByRole('button', { name: 'Новый ход', exact: true }).click();
    expect((await elementalismTurnPromise).ok(), 'new turn before Elementalism').toBe(true);
    const elementalismButton = page.locator(`[data-action-id="${ELEMENTALISM_SPELL_ID}"]`)
      .getByRole('button').filter({ visible: true }).first();
    await expect(elementalismButton).toBeEnabled({ timeout: 30_000 });
    await elementalismButton.click();
    const elementalismChoice = page.getByRole('dialog', { name: 'Выбор при действии' });
    await expect(elementalismChoice).toBeVisible();
    await elementalismChoice.getByRole('button', { name: 'Призыв воды', exact: true }).click();
    await elementalismChoice.getByRole('button', { name: 'Применить', exact: true }).click();
    const elementalismConfirm = page.getByRole('dialog', { name: 'Подтверждение действия' });
    await expect(elementalismConfirm).toBeVisible();
    const elementalismRuntimePromise = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
    ));
    await elementalismConfirm.getByRole('button', { name: 'Применить', exact: true }).click();
    expect((await elementalismRuntimePromise).ok(), 'public Elementalism runtime persistence').toBe(true);
    await page.getByRole('button', { name: 'Открыть журнал', exact: true }).click();
    const journal = page.getByRole('dialog', { name: 'Журнал действий' });
    await expect(journal).toBeVisible();
    await expect(journal.getByText(
      'Стихийность: Взаимодействие с миром: beckon_water',
      { exact: true },
    )).toBeVisible();
    await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
    if (diagnostics.length > 0) {
      throw new Error(`Browser diagnostics are not clean:\n${diagnostics.join('\n')}`);
    }
  } catch (error) {
    bodyError = error;
  } finally {
    if (diagnostics.length > 0) {
      await testInfo.attach('public-sheet-certificate-diagnostics', {
        body: diagnostics.join('\n'),
        contentType: 'text/plain',
      });
    }
    stopDiagnostics?.();
    await closeContext(context, 'public sheet certificate', cleanupErrors);
    if (auth) {
      await cleanupCharacterArtifacts(auth.api, character?.id, marker, cleanupErrors);
      try {
        await auth.api.request.dispose();
      } catch (error) {
        cleanupErrors.push(`API context cleanup: ${errorMessage(error)}`);
      }
    }
  }

  if (bodyError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [bodyError, ...cleanupErrors.map((message) => new Error(message))],
        'Public sheet certificate and cleanup both failed',
      );
    }
    throw bodyError;
  }
  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '));
});

test('public sheet certificate: Forge Wizard casts utility world primitives', async ({
  browser,
  playwright,
}, testInfo) => {
  const frontendOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');
  const apiOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend');
  const expectedCommit = required('EXPECTED_DEPLOYED_COMMIT').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('EXPECTED_DEPLOYED_COMMIT must be an exact 40-hex Git commit');
  }
  const account = credentials('A');
  const marker = `public-sheet-utility-certificate:${randomUUID()}`;
  const suffix = marker.slice(-8);
  const diagnostics: string[] = [];
  const cleanupErrors: string[] = [];
  let bodyError: unknown;
  let auth: AuthenticatedAPI | undefined;
  let context: BrowserContext | undefined;
  let character: CharacterResponse | undefined;
  let stopDiagnostics: (() => void) | undefined;

  try {
    auth = await authenticatedAPI(playwright, apiOrigin, account, 'utility sheet certificate account');
    const [health, build, catalog] = await Promise.all([
      checkedJSON<{ source_commit?: string }>(auth.api, 'get', '/api/health'),
      checkedJSON<{ source_commit?: string }>(
        auth.api, 'get', `/build-info.json?release=${expectedCommit}`,
      ),
      checkedJSON<{ spells?: CatalogSpell[] }>(auth.api, 'get', '/api/spells?page=1&limit=1000'),
    ]);
    expect(health.source_commit, 'public backend commit').toBe(expectedCommit);
    expect(build.source_commit, 'public frontend commit').toBe(expectedCommit);

    const requiredSpellNumbers = [
      'SPELL-0161', // illusion
      'SPELL-0232', // world entity
      'SPELL-0245', // information reveal
      'SPELL-0288', // world zone + in-play choice
    ] as const;
    const utilitySpells = requiredSpellNumbers.map((cardNumber) => {
      const matches = (catalog.spells ?? []).filter((spell) => spell.card_number === cardNumber);
      if (matches.length !== 1) throw new Error(`${cardNumber}: expected one live spell, got ${matches.length}`);
      return matches[0];
    });

    context = await browser.newContext({ baseURL: frontendOrigin, serviceWorkers: 'allow' });
    await context.addInitScript(() => { Math.random = () => 0.99; });
    await installBrowserOriginFence(context, new Set([frontendOrigin, apiOrigin]));
    const page = await context.newPage();
    stopDiagnostics = captureBrowserDiagnostics(
      page,
      'public Wizard utility sheet certificate',
      [account.password],
      diagnostics,
    );
    await loginInBrowser(page, account, frontendOrigin, apiOrigin);

    const root = structuredClone(compiledFixture.roots.wizard);
    const cantripChoice = Object.keys(root.draft.resolvedChoices)
      .find((key) => key.endsWith(':wizard_cantrips'));
    const spellbookChoice = Object.keys(root.draft.resolvedChoices)
      .find((key) => key.endsWith(':wizard_spellbook_level_1'));
    const preparedChoice = Object.keys(root.draft.resolvedChoices)
      .find((key) => key.endsWith(':wizard_prepared_spells_level_1'));
    if (!cantripChoice || !spellbookChoice || !preparedChoice) {
      throw new Error('Wizard spell choices are missing from the compiled Forge root');
    }
    const originalSpellbook = root.draft.resolvedChoices[spellbookChoice];
    const utilityIds = utilitySpells.map((spell) => spell.id);
    const fillers = originalSpellbook.filter((id) => !utilityIds.includes(id)).slice(0, 2);
    root.draft.resolvedChoices[spellbookChoice] = [...utilityIds, ...fillers];
    root.draft.resolvedChoices[preparedChoice] = [...utilityIds];
    root.draft.spellIds = [
      ...root.draft.resolvedChoices[cantripChoice],
      ...root.draft.resolvedChoices[spellbookChoice],
    ];

    character = await createCompiledCharacterInForge(
      page,
      root,
      `Canary Utility Wizard ${suffix}`,
      marker,
      apiOrigin,
    );
    character = await checkedJSON<CharacterResponse>(
      auth.api,
      'patch',
      `/api/characters-v3/${character.id}/runtime`,
      { resources: { ...(character.resources ?? {}), spell_slot_1: 6 } },
    );
    await page.goto(`/characters-v3/${character.id}`);
    await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);

    const castWorldSpell = async (
      spell: CatalogSpell,
      choiceName?: string,
    ): Promise<void> => {
      const turnResponse = page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
      ));
      await page.getByRole('button', { name: 'Новый ход', exact: true }).click();
      expect((await turnResponse).ok(), `new turn before ${spell.card_number}`).toBe(true);

      const actionButton = page.locator(`[data-action-id="${spell.id}"]`)
        .getByRole('button').filter({ visible: true }).first();
      await expect(actionButton, `${spell.card_number} sheet action`).toBeEnabled({ timeout: 30_000 });
      await actionButton.click();

      const choiceDialog = page.getByRole('dialog', { name: 'Выбор при действии' });
      if (await choiceDialog.isVisible()) {
        if (choiceName) {
          await choiceDialog.getByRole('button', { name: choiceName, exact: true }).click();
        }
        await choiceDialog.getByRole('button', { name: 'Применить', exact: true }).click();
      }
      const confirm = page.getByRole('dialog', { name: 'Подтверждение действия' });
      await expect(confirm).toBeVisible();
      const runtimeResponse = page.waitForResponse((response) => (
        response.request().method() === 'PATCH'
        && new URL(response.url()).pathname === `/api/characters-v3/${character!.id}/runtime`
      ));
      await confirm.getByRole('button', { name: 'Применить', exact: true }).click();
      expect((await runtimeResponse).ok(), `${spell.card_number} runtime persistence`).toBe(true);
      await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
    };

    await castWorldSpell(utilitySpells[0]);
    character = await checkedJSON<CharacterResponse>(auth.api, 'get', `/api/characters-v3/${character.id}`);
    expect((character.active_effects ?? []).some((effect) => (
      (effect.mechanics as JsonRecord)?.kind === 'illusion'
    ))).toBe(true);

    await castWorldSpell(utilitySpells[1]);
    character = await checkedJSON<CharacterResponse>(auth.api, 'get', `/api/characters-v3/${character.id}`);
    expect((character.active_effects ?? []).some((effect) => (
      (effect.mechanics as JsonRecord)?.kind === 'world_entity'
    ))).toBe(true);

    await castWorldSpell(utilitySpells[2]);
    await expect.poll(async () => {
      const identifyEvents = await checkedJSON<CharacterEventRow[]>(
        auth!.api, 'get', `/api/characters-v3/${character!.id}/events`,
      );
      return identifyEvents.some((event) => (
        event.type === 'world_interaction'
        && event.payload.type === 'world_interaction'
        && event.payload.operation === 'reveal_information'
      ));
    }, { message: 'Identify world-interaction event must reach the durable journal' }).toBe(true);

    await castWorldSpell(utilitySpells[3], 'Мысленная тревога');
    character = await checkedJSON<CharacterResponse>(auth.api, 'get', `/api/characters-v3/${character.id}`);
    expect((character.active_effects ?? []).some((effect) => (
      (effect.mechanics as JsonRecord)?.kind === 'world_zone'
      && (effect.mechanics as JsonRecord)?.alarm_mode === 'mental'
    ))).toBe(true);

    if (diagnostics.length > 0) {
      throw new Error(`Browser diagnostics are not clean:\n${diagnostics.join('\n')}`);
    }
  } catch (error) {
    bodyError = error;
  } finally {
    if (diagnostics.length > 0) {
      await testInfo.attach('public-utility-sheet-certificate-diagnostics', {
        body: diagnostics.join('\n'),
        contentType: 'text/plain',
      });
    }
    stopDiagnostics?.();
    await closeContext(context, 'public utility sheet certificate', cleanupErrors);
    if (auth) {
      await cleanupCharacterArtifacts(auth.api, character?.id, marker, cleanupErrors);
      try {
        await auth.api.request.dispose();
      } catch (error) {
        cleanupErrors.push(`API context cleanup: ${errorMessage(error)}`);
      }
    }
  }

  if (bodyError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [bodyError, ...cleanupErrors.map((message) => new Error(message))],
        'Public utility sheet certificate and cleanup both failed',
      );
    }
    throw bodyError;
  }
  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '));
});

test('public mini-MVP sheet certificate: every root and Fighting Style crosses Forge and the live sheet', async ({
  browser,
  playwright,
}, testInfo) => {
  test.setTimeout(900_000);
  const frontendOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_BASE_URL', 'frontend');
  const apiOrigin = requiredLiveCanaryOrigin('LIVE_BROWSER_API_URL', 'backend');
  const expectedCommit = required('EXPECTED_DEPLOYED_COMMIT').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
    throw new Error('EXPECTED_DEPLOYED_COMMIT must be an exact 40-hex Git commit');
  }
  const account = credentials('A');
  const runMarker = `public-mini-forge-sheet:${randomUUID()}`;
  const diagnostics: string[] = [];
  const cleanupErrors: string[] = [];
  const characters: CharacterResponse[] = [];
  let bodyError: unknown;
  let auth: AuthenticatedAPI | undefined;
  let context: BrowserContext | undefined;
  let stopDiagnostics: (() => void) | undefined;

  try {
    auth = await authenticatedAPI(playwright, apiOrigin, account, 'mini-MVP Forge sheet account');
    const [health, build, classes, races, backgrounds, feats, cards] = await Promise.all([
      checkedJSON<{ source_commit?: string }>(auth.api, 'get', '/api/health'),
      checkedJSON<{ source_commit?: string }>(
        auth.api,
        'get',
        `/build-info.json?release=${expectedCommit}`,
      ),
      fetchAllLive<CharacterClass>(auth.api, '/api/classes?fields=list', 'classes'),
      fetchAllLive<Race>(auth.api, '/api/races?fields=list', 'races'),
      fetchAllLive<Background>(auth.api, '/api/backgrounds?fields=list', 'backgrounds'),
      fetchAllLive<Feat>(auth.api, '/api/feats?fields=list', 'feats'),
      fetchAllLive<Card>(auth.api, '/api/cards?fields=list', 'cards'),
    ]);
    expect(health.source_commit, 'public backend commit').toBe(expectedCommit);
    expect(build.source_commit, 'public frontend commit').toBe(expectedCommit);

    const manifestUrl = new URL('../../scripts/content/mini-mvp-manifest.mjs', import.meta.url);
    const { MINI_MVP_MANIFEST } = await import(/* @vite-ignore */ manifestUrl.href) as {
      MINI_MVP_MANIFEST: {
        collections: Record<string, Array<{
          key: string;
          selector: { cardNumber?: string };
          expected?: {
            variantSelectors?: Array<{ cardNumber: string; label: string }>;
          };
        }>>;
      };
    };
    const resolveManifest = <T extends { card_number: string }>(
      collection: string,
      catalog: T[],
    ): T[] => MINI_MVP_MANIFEST.collections[collection].map((entry) => {
      const matches = catalog.filter((entity) => entity.card_number === entry.selector.cardNumber);
      if (matches.length !== 1) {
        throw new Error(`${entry.key}: expected one ${entry.selector.cardNumber}, got ${matches.length}`);
      }
      return matches[0];
    });
    const scopedClasses = resolveManifest('classes', classes);
    const scopedRaces = resolveManifest('species', races);
    const scopedBackgrounds = resolveManifest('backgrounds', backgrounds);
    const scopedFeats = resolveManifest('originFeats', feats);
    const scopedFightingStyles = resolveManifest('fightingStyles', feats);
    expect(scopedClasses).toHaveLength(12);
    expect(scopedRaces).toHaveLength(10);
    expect(scopedBackgrounds).toHaveLength(16);
    expect(scopedFeats).toHaveLength(10);
    expect(scopedFightingStyles).toHaveLength(10);

    const cardById = new Map(cards.map((card) => [card.id, card]));
    const scopedLineages = scopedRaces.flatMap((race) => (
      (MINI_MVP_MANIFEST.collections.species.find((entry) => (
        entry.selector.cardNumber === race.card_number
      ))?.expected?.variantSelectors ?? []).map((selector) => selector.cardNumber)
    ));
    expect(miniMvpForgeSheetFixture.schemaVersion).toBe(2);
    expect(miniMvpForgeSheetFixture.roots.length).toBeGreaterThanOrEqual(24);
    expect(miniMvpForgeSheetFixture.coverage).toEqual({
      classes: scopedClasses.map((entity) => entity.card_number),
      species: scopedRaces.map((entity) => entity.card_number),
      lineages: scopedLineages,
      backgrounds: scopedBackgrounds.map((entity) => entity.card_number),
      originFeats: scopedFeats.map((entity) => entity.card_number),
    });
    expect(miniMvpFightingStyleFixture).toMatchObject({
      schemaVersion: 1,
      strategy: 'one-fighter-per-style-v1',
      base: {
        classCardNumber: 'CLASS-warrior',
        raceCardNumber: 'RACE-0003',
        backgroundCardNumber: 'BG-0012',
        originFeatCardNumber: 'FEAT-0005',
      },
      coverage: { fightingStyles: scopedFightingStyles.map((entity) => entity.card_number) },
    });
    expect(miniMvpFightingStyleFixture.roots).toHaveLength(10);

    context = await browser.newContext({ baseURL: frontendOrigin, serviceWorkers: 'allow' });
    await installBrowserOriginFence(context, new Set([frontendOrigin, apiOrigin]));
    const page = await context.newPage();
    stopDiagnostics = captureBrowserDiagnostics(
      page,
      'public mini-MVP Forge sheet certificate',
      [account.password],
      diagnostics,
    );
    await loginInBrowser(page, account, frontendOrigin, apiOrigin);

    // This 16-row covering set reaches every class/species/background/origin
    // feat at least once.  It is deliberately
    // smaller than the cartesian product while retaining per-entity evidence.
    for (const [index, root] of miniMvpForgeSheetFixture.roots.entries()) {
      const exact = <T extends { id: string; card_number: string }>(
        catalog: T[],
        cardNumber: string,
      ): T => {
        const matches = catalog.filter((entity) => entity.card_number === cardNumber);
        if (matches.length !== 1) throw new Error(`${cardNumber}: expected one live entity, got ${matches.length}`);
        return matches[0];
      };
      const klass = exact(classes, root.classCardNumber);
      const race = exact(races, root.raceCardNumber);
      const lineage = root.lineageCardNumber ? exact(races, root.lineageCardNumber) : undefined;
      const background = exact(backgrounds, root.backgroundCardNumber);
      const feat = exact(feats, root.featCardNumber);
      expect(root.draft.classId, `${klass.card_number} fixture class`).toBe(klass.id);
      expect(root.draft.raceId, `${race.card_number} fixture species`).toBe(race.id);
      expect(root.draft.lineageId, `${lineage?.card_number ?? race.card_number} fixture lineage`)
        .toBe(lineage?.id ?? null);
      expect(root.draft.backgroundId, `${background.card_number} fixture background`).toBe(background.id);
      expect(root.draft.featIds, `${feat.card_number} fixture origin feat`).toContain(feat.id);

      const marker = `${runMarker}:${index}:${klass.card_number}`;
      let submittedCreate: JsonRecord | undefined;
      const character = await createCompiledCharacterInForge(
        page,
        { draft: root.draft },
        `Canary ${klass.name} ${index + 1} ${runMarker.slice(-8)}`,
        marker,
        apiOrigin,
        (body) => { submittedCreate = body; },
      );
      characters.push(character);
      const persisted = await checkedJSON<CharacterResponse>(
        auth.api,
        'get',
        `/api/characters-v3/${character.id}`,
      );
      expect(persisted.class_id, `${klass.card_number} persisted class`).toBe(klass.id);
      expect(persisted.lineage_id, `${lineage?.card_number ?? race.card_number} persisted lineage`)
        .toBe(lineage?.id ?? null);

      const classOption = klass.equipment_options?.option_a;
      const backgroundOption = background.equipment_options?.option_a;
      expect(classOption, `${klass.card_number} option A`).toBeTruthy();
      expect(backgroundOption, `${background.card_number} option A`).toBeTruthy();
      const actualQuantities = new Map(
        (persisted.inventory_items ?? []).map((item) => [item.card_id, item.qty]),
      );
      const submittedQuantities = new Map(
        ((submittedCreate?.inventory_items ?? []) as Array<{ card_id: string; qty: number }>)
          .map((item) => [item.card_id, item.qty]),
      );
      for (const item of classOption?.items ?? []) {
        expect(
          submittedQuantities.get(item.card_id) ?? 0,
          `${klass.card_number} submitted ${cardById.get(item.card_id)?.card_number ?? item.card_id}; `
            + `inventory=${JSON.stringify(submittedCreate?.inventory_items ?? null)}`,
        ).toBeGreaterThanOrEqual(item.quantity);
        expect(
          actualQuantities.get(item.card_id) ?? 0,
          `${klass.card_number} ${cardById.get(item.card_id)?.card_number ?? item.card_id}`,
        ).toBeGreaterThanOrEqual(item.quantity);
      }
      const expectedGold = Number(classOption?.gold ?? 0) + Number(backgroundOption?.gold ?? 0);
      expect(persisted.currency?.gold ?? 0, `${klass.card_number} starting gold`).toBe(expectedGold);

      const visibleClassItem = (classOption?.items ?? [])
        .map((item) => cardById.get(item.card_id))
        .find((card): card is Card => Boolean(card));
      if (visibleClassItem) {
        await expect(
          page.getByTitle(visibleClassItem.name, { exact: true }).first(),
          `${klass.card_number} item on the real sheet`,
        ).toBeVisible();
      }
      await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);
      await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
    }

    // Every style is selected through the Fighter's real data-driven choice,
    // serialized by Forge, reloaded from the API, and rendered in the live sheet.
    for (const [index, root] of miniMvpFightingStyleFixture.roots.entries()) {
      const matches = feats.filter((feat) => feat.card_number === root.styleCardNumber);
      if (matches.length !== 1) {
        throw new Error(`${root.styleCardNumber}: expected one live Fighting Style, got ${matches.length}`);
      }
      const style = matches[0];
      expect(Object.values(root.draft.resolvedChoices).flat(), `${style.card_number} fixture choice`)
        .toContain(style.id);
      const marker = `${runMarker}:style:${index}:${style.card_number}`;
      let submittedCreate: JsonRecord | undefined;
      const character = await createCompiledCharacterInForge(
        page,
        { draft: root.draft },
        `Canary ${style.name} ${runMarker.slice(-8)}`,
        marker,
        apiOrigin,
        (body) => { submittedCreate = body; },
      );
      characters.push(character);
      const submittedChoices = submittedCreate?.resolved_choices as Record<string, string[]> | undefined;
      expect(Object.values(submittedChoices ?? {}).flat(), `${style.card_number} submitted choice`)
        .toContain(style.id);
      const persisted = await checkedJSON<CharacterResponse>(
        auth.api,
        'get',
        `/api/characters-v3/${character.id}`,
      );
      expect(Object.values(persisted.resolved_choices ?? {}).flat(), `${style.card_number} persisted choice`)
        .toContain(style.id);
      await expect(
        page.getByTitle(style.name, { exact: true }).first(),
        `${style.card_number} on the real sheet`,
      ).toBeVisible();
      await expect(page.getByTestId('offline-rules-authority')).toHaveCount(0);
      await expect(page.getByTestId('sheet-action-error')).toHaveCount(0);
    }

    if (diagnostics.length > 0) {
      throw new Error(`Browser diagnostics are not clean:\n${diagnostics.join('\n')}`);
    }
  } catch (error) {
    bodyError = error;
  } finally {
    if (diagnostics.length > 0) {
      await testInfo.attach('public-mini-forge-sheet-certificate-diagnostics', {
        body: diagnostics.join('\n'),
        contentType: 'text/plain',
      });
    }
    stopDiagnostics?.();
    await closeContext(context, 'public mini-MVP Forge sheet certificate', cleanupErrors);
    if (auth) {
      for (const character of characters) {
        await cleanupCharacterArtifacts(auth.api, character.id, character.notes ?? '', cleanupErrors);
      }
      try {
        await auth.api.request.dispose();
      } catch (error) {
        cleanupErrors.push(`API context cleanup: ${errorMessage(error)}`);
      }
    }
  }

  if (bodyError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [bodyError, ...cleanupErrors.map((message) => new Error(message))],
        'Public mini-MVP Forge sheet certificate and cleanup both failed',
      );
    }
    throw bodyError;
  }
  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join('; '));
});

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
