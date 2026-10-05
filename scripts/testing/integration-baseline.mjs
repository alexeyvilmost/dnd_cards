import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {repositoryRoot} from './runtime.mjs';
import {assertTestDsn} from './guards.mjs';
import {insertFixtureRows} from './fixtures.mjs';

const collections = ['classes', 'races', 'effects', 'actions', 'spells', 'feats', 'backgrounds', 'cards', 'resources', 'variables'];
const privateFields = new Set(['user_id', 'group_id', 'owner_id', 'user', 'group', 'author', 'support', 'created_at', 'updated_at', 'deleted_at',
  'created_by', 'updated_by', 'created_by_user_id', 'updated_by_user_id', 'image_url', 'image_url_spent', 'image_storage_id', 'image_cloudinary_id',
  'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'token_url', 'token_storage_id']);
export function publicFixtureRow(row) {
  if (row.user_id || row.group_id || row.owner_id || row.user || row.group || row.is_public === false || row.access_mode === 'owner') throw new Error('Private record is not eligible for a public fixture');
  return {...Object.fromEntries(Object.entries(row).filter(([key]) => !privateFields.has(key))), author: 'Local test fixture', support: {status: 'not_tested'}};
}
export async function restoreIntegrationBaseline(database, registry) {
  assertTestDsn(database.dsn, registry);
  if ((await database.query('SELECT run_id FROM test_run_ownership;')).trim() !== registry.runId) throw new Error('Integration target is not runner-owned');
  const root = path.join(repositoryRoot, 'scripts/testing/fixtures');
  const manifest = JSON.parse(await readFile(path.join(root, 'schema-manifest.json'), 'utf8'));
  const schema = (await readFile(path.join(root, 'schema.sql'), 'utf8')).replace(/\r+\n/g, '\n');
  const schemaHash = createHash('sha256').update(schema).digest('hex');
  if (manifest.format !== 1 || manifest.schemaSha256 !== schemaHash || manifest.historicalChainVerified !== false) throw new Error('Integration schema manifest/hash mismatch');
  if (/^\s*\\/m.test(schema) || /^(?:COPY|INSERT INTO) /m.test(schema)) throw new Error('Integration schema contains data or psql directives');
  await database.query(schema);
  // This is a versioned schema baseline, NOT an assertion that this run executed
  // old migrations. The separate fresh profile still runs the historical chain.
  const values = manifest.migrations.map(row => {
    if (!/^\d{3}_[a-z0-9_]+$/.test(row.version)) throw new Error('Invalid baseline migration identity');
    return `('${row.version}','Integration schema baseline; historical chain not executed',NOW())`;
  });
  if (!values.length || manifest.migrations.at(-1).version !== manifest.migrationBaseline) throw new Error('Invalid migration baseline');
  await database.query(`INSERT INTO schema_migrations(version,description,executed_at) VALUES ${values.join(',')};`);
  const catalog = [];
  // The checked-in public snapshot predates the stable spell-class references.
  // Apply the same metadata join documented by normalize_live_happy_path_content
  // while assembling fixtures. No name-specific gameplay branch is introduced.
  const classRows = JSON.parse(await readFile(path.join(repositoryRoot, 'officials/canon/prod-snapshot/classes.json')));
  const classReferences = new Map(classRows.filter(row => !row.is_subclass).flatMap(row => [row.name, row.name_en].filter(Boolean).map(label => [label.trim().toLowerCase(), row.card_number])));
  // The public snapshot is older than the checked-in declarative spell audit.
  // Import its content, never its review/certificate metadata. This fixture
  // composition is explicit and does not pretend to execute historical SQL.
  const spellSource = 'backend/migrations/data/catalog-audit-20260929/spells.json';
  const spellBytes = await readFile(path.join(repositoryRoot, spellSource));
  const spellDocument = JSON.parse(spellBytes);
  const spellAudit = new Map(spellDocument.entities.map(row => [row.id, row]));
  const conditionSource = 'frontend/src/canon/data/micro-mvp-l1-content-patch.v1.json';
  const conditionBytes = await readFile(path.join(repositoryRoot, conditionSource));
  const contentPatch = JSON.parse(conditionBytes);
  const weaponPatches = new Map(contentPatch.fieldPatches.filter(row => row.collection === 'cards').map(row => [row.entityId, row]));
  for (const table of collections) {
    const source = `officials/canon/prod-snapshot/${table}.json`;
    const bytes = await readFile(path.join(repositoryRoot, source));
    const rows = JSON.parse(bytes).map(publicFixtureRow);
    if (table === 'cards') for (const row of rows) {
      const patch = weaponPatches.get(row.id);
      if (patch) {
        if (patch.cardNumber !== row.card_number) throw new Error('Weapon fixture identity mismatch');
        Object.assign(row, patch.fields);
      }
    }
    if (table === 'spells') for (const row of rows) {
      const audited = spellAudit.get(row.id);
      if (audited) {
        if (audited.card_number !== row.card_number) throw new Error('Audited spell fixture identity mismatch');
        Object.assign(row, publicFixtureRow({...audited.preimage, ...audited.patch}));
      }
      if (row.mechanics && !row.mechanics.spell_class_list_ids && row.classes?.length) {
        const references = row.classes.map(label => classReferences.get(label.trim().toLowerCase()));
        if (references.some(reference => !reference)) throw new Error('Public spell fixture has an unresolved class identity');
        row.mechanics.spell_class_list_ids = [...new Set(references)].sort();
      }
    }
    await insertFixtureRows(database, table, rows);
    catalog.push({source, rows: rows.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  catalog.push({source: spellSource, sha256: createHash('sha256').update(spellBytes).digest('hex'), projection: 'public spell preimage + patch; no review/support'});
  // Reuse existing authoritative combat contract data for operations absent in
  // the older public catalog snapshot. Do not import its synthetic character.
  const combatSource = 'frontend/src/roguelike/pinnedFighter.fixture.json';
  const combatBytes = await readFile(path.join(repositoryRoot, combatSource));
  const combatFixture = JSON.parse(combatBytes);
  const tables = {race: 'races', class: 'classes', background: 'backgrounds', feat: 'feats', effect: 'effects', action: 'actions', spell: 'spells', card: 'cards', resource: 'resources'};
  for (const [kind, rows] of Object.entries(combatFixture.catalog.entities)) {
    if (!tables[kind]) throw new Error('Unsupported canonical combat fixture entity');
    await insertFixtureRows(database, tables[kind], rows.map(row => {
      const value = publicFixtureRow(row);
      // Frozen runtime projections predate current library visibility metadata.
      // Keep the existing public source rather than replacing it with null.
      delete value.source;
      return value;
    }), {replace: true});
  }
  catalog.push({source: combatSource, sha256: createHash('sha256').update(combatBytes).digest('hex'), projection: 'catalog.entities only; no character/owner'});
  // The spell audit carries its exact referenced effect declarations. Import
  // those guards as fixture data so closure resolution exercises real links.
  if (spellDocument.guards.some(row => row.entity_type !== 'effect')) throw new Error('Unsupported spell fixture dependency kind');
  await insertFixtureRows(database, 'effects', spellDocument.guards.map(row => publicFixtureRow({
    id: row.id, card_number: row.card_number, name: row.name, ...row.preimage,
  })), {replace: true});
  const conditionRows = contentPatch.conditionPatches.map(row => publicFixtureRow({
    id: row.entityId ?? row.fixtureEntityId, card_number: row.cardNumber, ...row.fields,
  }));
  if (conditionRows.length !== 15 || new Set(conditionRows.map(row => row.mechanics?.condition?.id)).size !== 15) throw new Error('Canonical condition fixture must contain exactly 15 unique declarations');
  await insertFixtureRows(database, 'effects', conditionRows, {replace: true});
  catalog.push({source: conditionSource, sha256: createHash('sha256').update(conditionBytes).digest('hex'), projection: 'conditionPatches.fields + card fieldPatches; no generated certificates'});
  const freeuseSource = 'backend/migrations/generic_spell_freeuses_297_manifest.json';
  const freeuseBytes = await readFile(path.join(repositoryRoot, freeuseSource));
  const fixtureEffectIds = new Set(JSON.parse((await database.query("SELECT json_agg(id) FROM effects;")).trim()));
  const freeuseRows = JSON.parse(freeuseBytes).entities.filter(row => row.table === 'effects');
  const selectedFreeuseRows = freeuseRows.filter(row => fixtureEffectIds.has(row.id));
  if (!selectedFreeuseRows.length) throw new Error('Generic freeuse fixture projection is empty');
  for (const row of selectedFreeuseRows) {
    if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('Invalid freeuse fixture identity');
    const mechanics = JSON.stringify(row.mechanics).replaceAll("'", "''");
    const changed = await database.query(`UPDATE ${row.table} SET mechanics='${mechanics}'::jsonb WHERE id='${row.id}' RETURNING id;`);
    if (!changed.includes(row.id)) throw new Error(`Generic freeuse fixture target is absent: ${row.table}/${row.id}`);
  }
  catalog.push({source: freeuseSource, sha256: createHash('sha256').update(freeuseBytes).digest('hex'), rows: selectedFreeuseRows.length,
    excludedEffectIds: freeuseRows.filter(row => !fixtureEffectIds.has(row.id)).map(row => row.id),
    projection: 'mechanics of effects present in this minimal public catalog only; item patches/new high-level effects excluded; generic pools remain virtual'});
  // The second-class preparation corpus uses this existing declaration. The
  // older snapshot's narrative-only spellcasting ability cannot be inferred by
  // the engine. Import the exact recorded content, without its certificate.
  const wizardSource = 'scripts/content/data/spell-grant-abilities-20261001.json';
  const wizardBytes = await readFile(path.join(repositoryRoot, wizardSource));
  const wizardEvidence = JSON.parse(wizardBytes).evidence.filter(row => row.table === 'effects' && row.card_number === 'EFF-wizard-spellcasting');
  if (wizardEvidence.length !== 1 || wizardEvidence[0].id !== 'bcb05701-70ac-4b48-8e60-4cf46f6ea544' ||
      wizardEvidence[0].fields.id !== wizardEvidence[0].id || wizardEvidence[0].fields.card_number !== wizardEvidence[0].card_number) throw new Error('Canonical wizard fixture identity mismatch');
  const wizard = wizardEvidence[0];
  const wizardMechanics = JSON.stringify(wizard.fields.mechanics).replaceAll("'", "''");
  const wizardUpdated = await database.query(`UPDATE effects SET mechanics='${wizardMechanics}'::jsonb WHERE id='${wizard.id}' AND card_number='${wizard.card_number}' RETURNING id;`);
  if (!wizardUpdated.includes(wizard.id)) throw new Error('Canonical wizard fixture target is absent');
  catalog.push({source: wizardSource, sha256: createHash('sha256').update(wizardBytes).digest('hex'), rows: 1,
    entityIds: [wizard.id], projection: 'evidence.fields.mechanics for existing EFF-wizard-spellcasting only; no certificates; not_tested',
    projectionSha256: createHash('sha256').update(JSON.stringify(wizard.fields.mechanics)).digest('hex')});
  // Two intentionally synthetic stat blocks share the normal operations but
  // have distinct range/damage/cost inputs. Slugs join the existing encounter
  // catalog; names/support explicitly identify the local fixtures.
  const actions = [
    {id: 'f1000000-0000-4000-8000-000000000001', name: 'Тестовый удар', card_number: 'TEST-ACTION-MELEE', resource: 'action', action_type: 'base_action', type: 'monster', mechanics: attack(5, '1d4', 'str', 3)},
    {id: 'f1000000-0000-4000-8000-000000000002', name: 'Тестовый выстрел', card_number: 'TEST-ACTION-RANGED', resource: 'action', action_type: 'base_action', type: 'monster', mechanics: attack(60, '1d6', 'dex', 4)},
  ].map(row => publicFixtureRow({...row, description: 'Synthetic integration fixture', rarity: 'common', source: 'Local tests'}));
  await insertFixtureRows(database, 'actions', actions);
  await insertFixtureRows(database, 'monsters', ['bandit', 'guard'].map((slug, index) => publicFixtureRow({
    id: `f2000000-0000-4000-8000-00000000000${index + 1}`, slug, name: `Тестовый противник ${index + 1}`, source: 'Local tests',
    size: 'medium', creature_type: 'humanoid', challenge_rating: '1/8', armor_class: 10 + index, max_hp: 10 + index * 2, speed: 30,
    abilities: {str: 12, dex: 14, con: 10, int: 10, wis: 10, cha: 10}, action_ids: [actions[index].id], effect_ids: [],
    ai: {strategy: 'tactical', preferred_range_ft: index ? 30 : 5},
  })));
  const tagIds = [1, 2, 3].map(value => `f2580000-0000-4000-8000-00000000000${value}`);
  await insertFixtureRows(database, 'entity_tag_definitions', tagIds.map((id, index) => ({id, name: `Local integration pool ${index + 1}`, description: 'Synthetic fixture membership; not a production pool'})));
  await insertFixtureRows(database, 'roguelike_shop_settings', [{id: 1, version: 1, config: {pool_tag: tagIds[0], starting_tag: tagIds[1], staple_tag: tagIds[2],
    supplies_price: 20, refresh_price: 5, levels: [1, 2, 3, 4, 5].map(level => ({level, slots: 0, magic_limit: 0, uncommon_bp: 0, rare_bp: 0, epic_bp: 0}))}}]);
  // Overlay writes can invalidate old support through normal DB triggers. New
  // synthetic catalog data has not undergone manual review in either case.
  for (const table of [...collections.filter(name => name !== 'variables'), 'monsters']) await database.query(`UPDATE ${table} SET support='{"status":"not_tested"}'::jsonb;`);
  return {profile: 'integration-baseline', schemaHash, migrationBaseline: manifest.migrationBaseline, historicalChainVerified: false,
    catalog, syntheticMonsters: 2, source: 'checked-in canonical catalog plus synthetic test creatures'};
}
function attack(range, damage, ability, bonus) {
  return {interaction: {intent: 'harmful'}, activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
    targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: range, requires_line_of_sight: true, allowed_relations: ['enemy']},
    effects: [{resolution: 'attack_roll', ability, attack_kind: range === 5 ? 'weapon_melee' : 'weapon_ranged', attack_bonus_override: bonus, vs: 'ac', on_hit: [{kind: 'damage', amount: damage, type: 'piercing'}]}]};
}
