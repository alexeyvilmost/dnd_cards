import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import type { SnapshotCatalogs } from '../src/canon/prodSnapshotL1Fixtures';

type JsonRecord = Record<string, unknown>;

interface CollectionDefinition {
  responseKey: string;
  rows: JsonRecord[];
}

interface FixtureContentPatch {
  mechanicsPatches: Record<string, Array<{
    entityId: string;
    cardNumber: string;
    mechanics: JsonRecord;
  }>>;
  fieldPatches: Array<{
    collection: string;
    entityId: string;
    cardNumber: string;
    fields: JsonRecord;
    entityReferences?: Array<{ collection: string; entityId: string; cardNumber: string }>;
  }>;
  createEntities: Array<{ collection: string; entity: JsonRecord }>;
  conditionPatches: Array<{
    cardNumber: string;
    entityId: string | null;
    fixtureEntityId: string;
    fields: JsonRecord;
    createFields: JsonRecord;
  }>;
}

/**
 * Exact, Playwright-only subject for the persisted sheet/mastery scenario.
 * The production snapshot row predates strict weapon profiles, so the browser
 * fixture declares the missing executable data against both stable identities.
 */
export const PERSISTED_SHEET_WEAPON_FIXTURE = {
  card: {
    entityId: 'e68a30ff-b0e5-41cf-b007-ddc5eb319750',
    cardNumber: 'CARD-0319',
  },
  mastery: {
    entityId: '4cfe0660-ba1c-415b-b1ed-15e3c708a8e3',
    cardNumber: 'EFFECT-0249',
  },
} as const;

export interface ForgeApiFixture {
  createdCharacters: JsonRecord[];
  runtimeCommandRequests: JsonRecord[];
  runtimePatchRequests: JsonRecord[];
  /** Current server-side projection for assertions after intercepted writes. */
  getCharacter: (id: string) => JsonRecord | undefined;
  /** Atomically committed event rows for one isolated character. */
  getEvents: (id: string) => readonly JsonRecord[];
  /** Read-only materialized catalog used by this isolated browser server. */
  getCatalogRows: (collection: string) => readonly JsonRecord[];
  seedCharacter: (character: JsonRecord) => void;
  /** Commit the next command but drop its response, exercising idempotent replay. */
  loseNextRuntimeCommandResponse: () => void;
}

function readSnapshot(fileName: string): JsonRecord[] {
  return JSON.parse(readFileSync(new URL(
    `../../officials/canon/prod-snapshot/${fileName}.json`,
    import.meta.url,
  ), 'utf8')) as JsonRecord[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function exactFixtureEntity(
  catalogs: Record<string, JsonRecord[]>,
  collection: string,
  identity: { entityId: string; cardNumber: string },
): JsonRecord {
  const rows = catalogs[collection];
  if (!rows) throw new Error(`Fixture patch references unknown collection ${collection}`);
  const byId = rows.filter((row) => row.id === identity.entityId);
  const byCard = rows.filter((row) => row.card_number === identity.cardNumber);
  if (byId.length !== 1 || byCard.length !== 1 || byId[0] !== byCard[0]) {
    throw new Error(
      `Fixture patch identity is missing, duplicated, or split: `
      + `${collection}:${identity.cardNumber}/${identity.entityId}`,
    );
  }
  return byId[0];
}

/**
 * Playwright serves the same completely materialized catalog as the migration
 * tests. Apart from the exact persisted-sheet weapon subject declared above,
 * it intentionally interprets only generic replace/create operations; no
 * class, spell, or feature rule is inferred by this fixture.
 */
function materializeFixturePatch(source: Record<string, JsonRecord[]>): Record<string, JsonRecord[]> {
  const catalogs = cloneJson(source);
  const patch = JSON.parse(readFileSync(new URL(
    '../src/canon/data/micro-mvp-l1-content-patch.v1.json',
    import.meta.url,
  ), 'utf8')) as FixtureContentPatch;

  for (const [collection, declarations] of Object.entries(patch.mechanicsPatches)) {
    for (const declaration of declarations) {
      exactFixtureEntity(catalogs, collection, declaration).mechanics = cloneJson(
        declaration.mechanics,
      );
    }
  }
  for (const declaration of patch.fieldPatches) {
    for (const reference of declaration.entityReferences ?? []) {
      exactFixtureEntity(catalogs, reference.collection, reference);
    }
    Object.assign(
      exactFixtureEntity(catalogs, declaration.collection, declaration),
      cloneJson(declaration.fields),
    );
  }
  for (const declaration of patch.createEntities) {
    const rows = catalogs[declaration.collection];
    if (!rows) throw new Error(`Fixture create references unknown collection ${declaration.collection}`);
    const cardNumber = String(declaration.entity.card_number ?? '');
    const matches = rows.filter((row) => row.card_number === cardNumber);
    if (matches.length > 1) throw new Error(`Fixture create duplicates ${cardNumber}`);
    if (!matches.length) rows.push(cloneJson(declaration.entity));
    else Object.assign(matches[0], Object.fromEntries(
      Object.entries(cloneJson(declaration.entity)).filter(([key]) => (
        !['id', 'created_at', 'updated_at', 'deleted_at'].includes(key)
      )),
    ));
  }
  for (const declaration of patch.conditionPatches) {
    const matches = catalogs.effects.filter((row) => row.card_number === declaration.cardNumber);
    if (matches.length > 1) throw new Error(`Fixture condition duplicates ${declaration.cardNumber}`);
    if (matches.length) {
      if (declaration.entityId && matches[0].id !== declaration.entityId) {
        throw new Error(`Fixture condition identity drifted: ${declaration.cardNumber}`);
      }
      Object.assign(matches[0], cloneJson(declaration.fields));
    } else {
      catalogs.effects.push({
        ...cloneJson(declaration.createFields),
        id: declaration.fixtureEntityId,
        created_at: '2026-08-05T00:00:00.000Z',
        updated_at: '2026-08-05T00:00:00.000Z',
      });
    }
  }

  const persistedWeapon = exactFixtureEntity(
    catalogs,
    'cards',
    PERSISTED_SHEET_WEAPON_FIXTURE.card,
  );
  const persistedMastery = exactFixtureEntity(
    catalogs,
    'effects',
    PERSISTED_SHEET_WEAPON_FIXTURE.mastery,
  );
  if (persistedWeapon.mastery !== persistedMastery.id) {
    throw new Error('Persisted sheet weapon mastery reference drifted');
  }
  persistedWeapon.mechanics = {
    weapon_profile: {
      weapon_type: 'longsword',
      proficiency_category: 'martial',
      attack_ability: 'str',
      damage_lines: [{ dice: '1d8', type: 'slashing' }],
      versatile_grip: { dice: '1d10', type: 'slashing' },
      default_attack_mode: 'melee',
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: ['versatile'],
      mastery_effect_id: persistedMastery.id,
      ammo: null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  };
  return catalogs;
}

function visible(rows: JsonRecord[]): JsonRecord[] {
  return rows.map((row) => ({
    ...row,
    support: {
      status: 'verified_mechanical',
      certification_version: 'playwright-pinned-fixture-v1',
      content_hash: 'sha256:playwright',
      dependency_hash: 'sha256:playwright',
    },
  }));
}

const PATCHED_CATALOGS = materializeFixturePatch({
  cards: readSnapshot('cards'),
  races: readSnapshot('races'),
  classes: readSnapshot('classes'),
  backgrounds: readSnapshot('backgrounds'),
  feats: readSnapshot('feats'),
  spells: readSnapshot('spells'),
  effects: readSnapshot('effects'),
  actions: readSnapshot('actions'),
  resources: readSnapshot('resources'),
  variables: readSnapshot('variables'),
}) as unknown as SnapshotCatalogs;

const COLLECTIONS: Readonly<Record<string, CollectionDefinition>> = {
  cards: { responseKey: 'cards', rows: PATCHED_CATALOGS.cards as unknown as JsonRecord[] },
  races: { responseKey: 'races', rows: visible(PATCHED_CATALOGS.races as unknown as JsonRecord[]) },
  classes: { responseKey: 'classes', rows: visible(PATCHED_CATALOGS.classes as unknown as JsonRecord[]) },
  backgrounds: { responseKey: 'backgrounds', rows: visible(PATCHED_CATALOGS.backgrounds as unknown as JsonRecord[]) },
  feats: { responseKey: 'feats', rows: visible(PATCHED_CATALOGS.feats as unknown as JsonRecord[]) },
  spells: { responseKey: 'spells', rows: visible(PATCHED_CATALOGS.spells as unknown as JsonRecord[]) },
  effects: { responseKey: 'effects', rows: PATCHED_CATALOGS.effects as unknown as JsonRecord[] },
  actions: { responseKey: 'actions', rows: PATCHED_CATALOGS.actions as unknown as JsonRecord[] },
  resources: { responseKey: 'resources', rows: PATCHED_CATALOGS.resources as unknown as JsonRecord[] },
  variables: { responseKey: 'variables', rows: PATCHED_CATALOGS.variables as unknown as JsonRecord[] },
};

function entityByReference(rows: readonly JsonRecord[], reference: string): JsonRecord | undefined {
  return rows.find((row) => row.id === reference || row.card_number === reference);
}

async function json(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

/**
 * GET-only catalog responses are exact repository snapshot rows. Character
 * writes are captured in memory and never reach a backend or production DB.
 */
export async function installForgeApiFixture(page: Page): Promise<ForgeApiFixture> {
  const createdCharacters: JsonRecord[] = [];
  const charactersById = new Map<string, JsonRecord>();
  const runtimeCommandRequests: JsonRecord[] = [];
  const runtimePatchRequests: JsonRecord[] = [];
  const eventsByCharacterId = new Map<string, JsonRecord[]>();
  const runtimeCommandLedger = new Map<string, {
    request: string;
    response: JsonRecord;
  }>();
  let loseNextRuntimeCommandResponse = false;
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'playwright-character-v3-jwt');
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api') {
      await route.abort('blockedbyclient');
      return;
    }

    if (segments[1] === 'auth' && segments[2] === 'profile' && request.method() === 'GET') {
      await json(route, 200, {
        id: 'playwright-user',
        username: 'playwright',
        email: 'playwright@example.test',
        display_name: 'Playwright',
        created_at: '2026-08-05T00:00:00Z',
        updated_at: '2026-08-05T00:00:00Z',
      });
      return;
    }

    if (segments[1] === 'characters-v3') {
      const id = segments[2];
      if (id === 'runtime-commands' && request.method() === 'POST') {
        const payload = request.postDataJSON() as JsonRecord & {
          command_id?: string;
          participants?: Array<{
            character_id?: string;
            expected_runtime_revision?: number;
            patch?: JsonRecord;
          }>;
        };
        runtimeCommandRequests.push(payload);
        const commandId = String(payload.command_id ?? '');
        const bytes = JSON.stringify(payload);
        const replay = runtimeCommandLedger.get(commandId);
        if (replay) {
          if (replay.request !== bytes) {
            await json(route, 409, { code: 'command_id_reuse' });
            return;
          }
          await json(route, 200, { ...replay.response, replayed: true });
          return;
        }
        const participants = payload.participants ?? [];
        const staged = new Map<string, JsonRecord>();
        for (const participant of participants) {
          const characterId = String(participant.character_id ?? '');
          const current = charactersById.get(characterId);
          if (!current
            || Number(current.runtime_revision) !== participant.expected_runtime_revision) {
            await json(route, 409, { code: 'runtime_revision_conflict' });
            return;
          }
          const patch = participant.patch ?? {};
          staged.set(characterId, {
            ...current,
            ...patch,
            ...(patch.turn_state && typeof patch.turn_state === 'object'
              ? { turn_state: { ...((current.turn_state as JsonRecord | undefined) ?? {}), ...patch.turn_state } }
              : {}),
            runtime_revision: Number(current.runtime_revision) + 1,
          });
        }
        const stagedEvents: Array<{ characterId: string; row: JsonRecord }> = [];
        const eventRows = Array.isArray(payload.events) ? payload.events as JsonRecord[] : [];
        for (let index = 0; index < eventRows.length; index += 1) {
          const event = eventRows[index];
          const characterId = String(event.character_id ?? '');
          if (!staged.has(characterId)) {
            await json(route, 422, { code: 'invalid_runtime_command_event' });
            return;
          }
          stagedEvents.push({
            characterId,
            row: {
              id: `playwright-event-${runtimeCommandLedger.size + 1}-${index + 1}`,
              character_id: characterId,
              ts: '2026-08-06T00:00:00Z',
              type: event.type,
              payload: cloneJson(event.payload),
              created_at: '2026-08-06T00:00:00Z',
            },
          });
        }
        // No character or event changes until every CAS and payload has staged successfully.
        for (const [characterId, next] of staged) charactersById.set(characterId, next);
        for (const event of stagedEvents) {
          eventsByCharacterId.set(event.characterId, [
            ...(eventsByCharacterId.get(event.characterId) ?? []),
            event.row,
          ]);
        }
        const response: JsonRecord = {
          command_id: commandId,
          replayed: false,
          participants: participants.map((participant) => {
            const characterId = String(participant.character_id);
            const next = charactersById.get(characterId)!;
            return {
              character_id: characterId,
              runtime_revision: next.runtime_revision,
              character: next,
            };
          }),
        };
        runtimeCommandLedger.set(commandId, { request: bytes, response });
        if (loseNextRuntimeCommandResponse) {
          loseNextRuntimeCommandResponse = false;
          await route.abort('failed');
          return;
        }
        await json(route, 200, response);
        return;
      }
      if (id && segments[3] === 'events') {
        await json(route, 200, eventsByCharacterId.get(id) ?? []);
        return;
      }
      if (request.method() === 'POST' && !id) {
        const payload = request.postDataJSON() as JsonRecord;
        const created = {
          ...payload,
          id: `playwright-character-${createdCharacters.length + 1}`,
          user_id: 'playwright-user',
          access_mode: 'owner',
          runtime_revision: 0,
        };
        createdCharacters.push(created);
        charactersById.set(String(created.id), created);
        await json(route, 201, created);
        return;
      }
      if (request.method() === 'PATCH' && id && segments[3] === 'runtime') {
        runtimePatchRequests.push(request.postDataJSON() as JsonRecord);
        const current = charactersById.get(id);
        if (!current) {
          await json(route, 404, { error: 'unknown isolated character' });
          return;
        }
        const updated = {
          ...current,
          ...(request.postDataJSON() as JsonRecord),
          runtime_revision: Number(current.runtime_revision ?? 0) + 1,
        };
        charactersById.set(id, updated);
        await json(route, 200, updated);
        return;
      }
      if (request.method() === 'GET' && id) {
        const current = charactersById.get(id);
        await json(route, current ? 200 : 404, current ?? { error: 'unknown isolated character' });
        return;
      }
      await json(route, 200, [...charactersById.values()]);
      return;
    }

    const collection = COLLECTIONS[segments[1]];
    if (!collection || request.method() !== 'GET') {
      await json(route, 404, { error: `unsupported isolated API path ${url.pathname}` });
      return;
    }
    const reference = segments[2] ? decodeURIComponent(segments[2]) : null;
    if (reference) {
      const entity = entityByReference(collection.rows, reference);
      await json(route, entity ? 200 : 404, entity ?? { error: `missing ${segments[1]} ${reference}` });
      return;
    }
    await json(route, 200, {
      [collection.responseKey]: collection.rows,
      total: collection.rows.length,
      page: 1,
      limit: collection.rows.length,
    });
  });
  return {
    createdCharacters,
    runtimeCommandRequests,
    runtimePatchRequests,
    getCharacter: (id) => charactersById.get(id),
    getEvents: (id) => eventsByCharacterId.get(id) ?? [],
    getCatalogRows: (collection) => COLLECTIONS[collection]?.rows ?? [],
    seedCharacter: (character) => {
      const id = String(character.id ?? '');
      if (!id) throw new Error('seeded CharacterV3 requires id');
      charactersById.set(id, {
        user_id: 'playwright-user',
        access_mode: 'owner',
        runtime_revision: 0,
        current_encounter_id: null,
        created_at: '2026-08-06T00:00:00Z',
        updated_at: '2026-08-06T00:00:00Z',
        ...character,
      });
    },
    loseNextRuntimeCommandResponse: () => { loseNextRuntimeCommandResponse = true; },
  };
}
