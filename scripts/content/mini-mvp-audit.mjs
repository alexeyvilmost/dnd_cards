#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { apiUrl, fetchAll } from './api.mjs';
import { buildCertificationIndex, certificationHashes } from './certification-hash.mjs';
import { hasMechanics } from './mechanics.mjs';
import {
  MINI_MVP_COLLECTION_ENTITY_TYPES,
  MINI_MVP_MANIFEST,
  flattenMiniMvpManifest,
  validateMiniMvpManifest,
} from './mini-mvp-manifest.mjs';

export const MINI_MVP_CERTIFICATION_VERSION = 'mini-mvp-l1-v1';
export const MINI_MVP_COVERAGE_SCOPE = 'mini-mvp-l1';

export const MINI_MVP_CATALOG_ENDPOINTS = Object.freeze({
  class: ['/api/classes', 'classes'],
  race: ['/api/races', 'races'],
  background: ['/api/backgrounds', 'backgrounds'],
  feat: ['/api/feats', 'feats'],
  spell: ['/api/spells', 'spells'],
  action: ['/api/actions', 'actions'],
  effect: ['/api/effects', 'effects'],
  card: ['/api/cards', 'cards'],
  resource: ['/api/resources', 'resources'],
  variable: ['/api/variables', 'variables'],
});

const MECHANICS_TYPES = new Set(['action', 'effect', 'spell']);
const CERTIFIED_STATUSES = new Set(['verified_mechanical', 'verified_partial']);

const issue = (kind, code, message) => ({ kind, code, message });
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
const refs = (entity) => [...strings(entity?.related_actions), ...strings(entity?.related_effects)];
const sorted = (values) => [...values].sort((left, right) => left.localeCompare(right, 'ru'));
const sameStrings = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function effectResultKinds(blocks) {
  const kinds = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.kind === 'string') kinds.add(value.kind);
    Object.values(value).forEach(visit);
  };
  visit(blocks);
  return kinds;
}

function validateShape(entry, entity) {
  const issues = [];
  const expected = entry.expected ?? {};

  if (entity.name !== entry.label) {
    issues.push(issue('data', 'name_mismatch', `ожидалось имя «${entry.label}», получено «${entity.name ?? ''}»`));
  }
  if (expected.source && entity.source !== expected.source) {
    issues.push(issue('data', 'source_mismatch', `ожидался источник ${expected.source}, получено ${entity.source ?? 'null'}`));
  }
  if (Number.isInteger(expected.level) && entity.level !== expected.level) {
    issues.push(issue('data', 'level_mismatch', `ожидался уровень ${expected.level}, получено ${entity.level ?? 'null'}`));
  }
  if (expected.category && entity.category !== expected.category) {
    issues.push(issue('data', 'category_mismatch', `ожидалась категория ${expected.category}, получено ${entity.category ?? 'null'}`));
  }

  if (entry.collection === 'classes') {
    if (!/^d\d+$/u.test(entity.hit_die ?? '')) {
      issues.push(issue('data', 'class_hit_die_missing', 'не задана кость хитов класса'));
    }
    if (strings(entity.saving_throws).length !== 2) {
      issues.push(issue('data', 'class_saves_invalid', 'класс должен задавать ровно два спасброска'));
    }
    const skillCount = entity.skill_choices?.count;
    const skillOptions = strings(entity.skill_choices?.options);
    if (!Number.isInteger(skillCount) || skillCount < 1 || skillOptions.length < skillCount) {
      issues.push(issue('data', 'class_skills_invalid', 'не задан корректный выбор навыков класса'));
    }
    const levelOne = entity.level_progression?.['1'];
    if (!levelOne || refs({ related_actions: levelOne.actions, related_effects: levelOne.effects }).length === 0) {
      issues.push(issue('data', 'class_level_one_empty', 'прогрессия первого уровня не выдаёт действий или эффектов'));
    }
    if (!entity.equipment_options?.option_a || !entity.equipment_options?.option_b) {
      issues.push(issue('data', 'class_equipment_incomplete', 'не заданы оба варианта стартового снаряжения класса'));
    }
  }

  if (entry.collection === 'species') {
    if (!Number.isFinite(entity.speed) || entity.speed <= 0) {
      issues.push(issue('data', 'species_speed_missing', 'не задана положительная скорость вида'));
    }
    if (refs(entity).length === 0) {
      issues.push(issue('data', 'species_features_missing', 'вид не ссылается ни на одно действие или эффект'));
    }
    const actualVariants = (Array.isArray(entity.lineages) ? entity.lineages : [])
      .map((lineage) => lineage?.name)
      .filter((name) => typeof name === 'string' && name);
    const expectedVariants = expected.variantNames ?? [];
    if (!sameStrings(actualVariants, expectedVariants)) {
      issues.push(issue(
        'data',
        'species_variants_mismatch',
        `варианты 2024: ожидались [${expectedVariants.join(', ')}], получены [${actualVariants.join(', ')}]`,
      ));
    }
  }

  if (entry.collection === 'backgrounds') {
    if (new Set(strings(entity.ability_scores)).size !== 3) {
      issues.push(issue('data', 'background_abilities_invalid', 'предыстория должна задавать три разные характеристики'));
    }
    if (new Set(strings(entity.skill_proficiencies)).size !== 2) {
      issues.push(issue('data', 'background_skills_invalid', 'предыстория должна задавать два разных навыка'));
    }
    if (typeof entity.origin_feat !== 'string' || !entity.origin_feat) {
      issues.push(issue('data', 'background_feat_missing', 'не задана черта происхождения'));
    }
    if (!entity.equipment_options?.option_a || !entity.equipment_options?.option_b) {
      issues.push(issue('data', 'background_equipment_incomplete', 'не заданы оба варианта стартового снаряжения'));
    }
  }

  if (entry.collection === 'originFeats' || entry.collection === 'fightingStyles') {
    if (refs(entity).length === 0) {
      issues.push(issue('mechanics', 'feat_mechanics_missing', 'черта не ссылается ни на одно исполнимое действие или эффект'));
    }
  }

  if (entry.collection === 'cantrips' || entry.collection === 'firstLevelSpells') {
    if (!hasMechanics(entity)) {
      issues.push(issue('mechanics', 'spell_mechanics_missing', 'у заклинания нет data-driven механики'));
    } else {
      if (!['active', 'triggered', 'reaction'].includes(entity.mechanics?.activation?.mode)) {
        issues.push(issue('mechanics', 'spell_activation_invalid', 'заклинание не имеет исполнимой активации'));
      }
      const hasEffects = Array.isArray(entity.mechanics?.effects) && entity.mechanics.effects.length > 0;
      const hasPrimitive = entity.mechanics?.primitive && typeof entity.mechanics.primitive === 'object';
      if (!hasEffects && !hasPrimitive) {
        issues.push(issue('mechanics', 'spell_resolution_empty', 'заклинание не содержит результатов или исполнимого примитива'));
      } else if (!hasPrimitive) {
        const resultKinds = effectResultKinds(entity.mechanics.effects);
        const hasImmediateResolution = entity.mechanics.effects.some((block) => block?.resolution === 'immediate');
        if (![...resultKinds].some((kind) => kind !== 'narrative') && !hasImmediateResolution) {
          issues.push(issue('mechanics', 'spell_narrative_only', 'заклинание описано текстом, но не изменяет состояние движка'));
        }
      }
    }
  }
  return issues;
}

function validateCertification(entity, entityType, index, { dependency = false } = {}) {
  const issues = [];
  const support = entity?.support;
  const prefix = dependency ? 'dependency_' : '';
  if (!support || typeof support !== 'object') {
    return [issue('certification', `${prefix}certification_missing`, 'нет сертификата mini-MVP')];
  }
  if (!CERTIFIED_STATUSES.has(support.status)) {
    issues.push(issue('certification', `${prefix}status_unverified`, `статус ${support.status ?? 'null'} не является проверенным`));
  }
  if (support.certification_version !== MINI_MVP_CERTIFICATION_VERSION) {
    issues.push(issue(
      'certification',
      `${prefix}certification_version_mismatch`,
      `ожидалась версия ${MINI_MVP_CERTIFICATION_VERSION}, получено ${support.certification_version ?? 'null'}`,
    ));
  }
  const coverage = support.test_coverage;
  if (coverage?.scope !== MINI_MVP_COVERAGE_SCOPE
    || coverage?.percent !== 100
    || !Number.isInteger(coverage?.required)
    || coverage.required < 1
    || coverage.passed !== coverage.required) {
    issues.push(issue('certification', `${prefix}coverage_incomplete`, 'нет полного покрытия в области mini-mvp-l1'));
  }
  const hashes = certificationHashes(entity, entityType, index);
  if (support.content_hash !== hashes.contentHash) {
    issues.push(issue('certification', `${prefix}content_hash_stale`, 'сертификат не соответствует текущим данным сущности'));
  }
  if (support.dependency_hash !== hashes.dependencyHash) {
    issues.push(issue('certification', `${prefix}dependency_hash_stale`, 'сертификат не соответствует текущим зависимостям'));
  }
  if (MECHANICS_TYPES.has(entityType) && support.mechanics_locked !== true) {
    issues.push(issue('certification', `${prefix}mechanics_unlocked`, 'сертифицированная механическая сущность не закреплена'));
  }
  return issues;
}

function directReferenceValues(entity, entry) {
  const values = [...refs(entity)];
  if (entry.collection === 'classes') {
    values.push(...strings(entity.level_progression?.['1']?.actions));
    values.push(...strings(entity.level_progression?.['1']?.effects));
  }
  if (entry.collection === 'backgrounds' && typeof entity.origin_feat === 'string') {
    values.push(entity.origin_feat);
  }
  const equipment = entity.equipment_options;
  for (const option of [equipment?.option_a, equipment?.option_b]) {
    for (const item of Array.isArray(option?.items) ? option.items : []) {
      if (typeof item?.card_id === 'string' && item.card_id) values.push(item.card_id);
    }
  }
  return [...new Set(values)];
}

function inspectDependencies(entity, entityType, index, entry, dependencyRecords) {
  const issues = [];
  for (const reference of directReferenceValues(entity, entry)) {
    if ((index.byReference.get(reference) ?? []).length === 0) {
      issues.push(issue('dependency', 'reference_unresolved', `не разрешается ссылка ${reference}`));
    }
  }
  const hashes = certificationHashes(entity, entityType, index);
  const notReady = [];
  for (const dependency of hashes.dependencies) {
    const record = index.byIdentity.get(dependency.identity);
    if (!record) {
      issues.push(issue('dependency', 'dependency_missing', `не найдена зависимость ${dependency.identity}`));
      continue;
    }
    let assessed = dependencyRecords.get(dependency.identity);
    if (!assessed) {
      const dependencyRecordIssues = [];
      if (MECHANICS_TYPES.has(record.type) && !hasMechanics(record.entity)) {
        dependencyRecordIssues.push(issue('dependency', 'dependency_mechanics_missing', 'отсутствует data-driven механика'));
      }
      dependencyRecordIssues.push(...validateCertification(record.entity, record.type, index, { dependency: true }));
      assessed = {
        identity: dependency.identity,
        entityType: record.type,
        entityId: record.entity.id ?? null,
        cardNumber: record.entity.card_number ?? null,
        name: record.entity.name ?? null,
        ready: dependencyRecordIssues.length === 0,
        issues: dependencyRecordIssues,
        requiredBy: new Set(),
      };
      dependencyRecords.set(dependency.identity, assessed);
    }
    assessed.requiredBy.add(entry.key);
    if (!assessed.ready) notReady.push(dependency.identity);
  }
  if (notReady.length > 0) {
    issues.push(issue(
      'dependency',
      'dependency_not_ready',
      `${notReady.length} зависимостей не сертифицированы: ${notReady.slice(0, 5).join(', ')}`,
    ));
  }
  return issues;
}

export function assessMiniMvpCatalogs(catalogs, {
  manifest = MINI_MVP_MANIFEST,
  includeDependencyCertification = true,
} = {}) {
  const manifestIssues = validateMiniMvpManifest(manifest);
  if (manifestIssues.length > 0) {
    throw new Error(`Invalid mini-MVP manifest:\n${manifestIssues.join('\n')}`);
  }
  const index = buildCertificationIndex(catalogs);
  const records = [];
  const dependencyRecords = new Map();

  for (const entry of flattenMiniMvpManifest(manifest)) {
    const entityType = MINI_MVP_COLLECTION_ENTITY_TYPES[entry.collection]
      ?? manifest.collectionEntityTypes?.[entry.collection];
    const matches = (catalogs[entityType] ?? []).filter((entity) => (
      entity.card_number === entry.selector.cardNumber
    ));
    const issues = [];
    const entity = matches[0] ?? null;
    if (matches.length === 0) {
      issues.push(issue('data', 'entity_missing', `не найдена сущность ${entry.selector.cardNumber}`));
    } else if (matches.length > 1) {
      issues.push(issue('data', 'entity_duplicate', `найдено ${matches.length} сущностей ${entry.selector.cardNumber}`));
    }
    if (entity) {
      issues.push(...validateShape(entry, entity));
      issues.push(...validateCertification(entity, entityType, index));
      if (includeDependencyCertification) {
        issues.push(...inspectDependencies(entity, entityType, index, entry, dependencyRecords));
      }
    }
    records.push({
      key: entry.key,
      collection: entry.collection,
      entityType,
      cardNumber: entry.selector.cardNumber,
      expectedName: entry.label,
      entityId: entity?.id ?? null,
      actualName: entity?.name ?? null,
      ready: issues.length === 0,
      issues,
    });
  }

  const byCollection = Object.fromEntries(Object.keys(manifest.collections).map((collection) => {
    const collectionRecords = records.filter((record) => record.collection === collection);
    return [collection, {
      required: collectionRecords.length,
      ready: collectionRecords.filter((record) => record.ready).length,
      issues: collectionRecords.reduce((sum, record) => sum + record.issues.length, 0),
    }];
  }));
  const dependencies = [...dependencyRecords.values()].map((record) => ({
    ...record,
    requiredBy: sorted(record.requiredBy),
  })).sort((left, right) => left.identity.localeCompare(right.identity));
  const issueKinds = {};
  const issueCodes = {};
  for (const record of [...records, ...dependencies]) {
    for (const found of record.issues) {
      issueKinds[found.kind] = (issueKinds[found.kind] ?? 0) + 1;
      issueCodes[found.code] = (issueCodes[found.code] ?? 0) + 1;
    }
  }
  const ready = records.filter((record) => record.ready).length;
  const rootIssueCount = records.reduce((sum, record) => sum + record.issues.length, 0);
  const dependencyIssueCount = dependencies.reduce((sum, record) => sum + record.issues.length, 0);
  return {
    schemaVersion: 1,
    release: manifest.release,
    manifestVersion: manifest.manifestVersion,
    certificationVersion: MINI_MVP_CERTIFICATION_VERSION,
    coverageScope: MINI_MVP_COVERAGE_SCOPE,
    generatedAt: new Date().toISOString(),
    apiUrl: null,
    summary: {
      required: records.length,
      resolved: records.filter((record) => record.entityId).length,
      ready,
      percent: records.length > 0 ? Math.floor((ready * 100) / records.length) : 0,
      issueCount: rootIssueCount + dependencyIssueCount,
      rootIssueCount,
      dependencyIssueCount,
      dependenciesRequired: dependencies.length,
      dependenciesReady: dependencies.filter((record) => record.ready).length,
      issueKinds,
      issueCodes,
      byCollection,
    },
    records,
    dependencies,
  };
}

export async function fetchMiniMvpCatalogs(options = {}) {
  const entries = await Promise.all(Object.entries(MINI_MVP_CATALOG_ENDPOINTS).map(async ([type, [path, key]]) => (
    [type, await fetchAll(path, key, { limit: 1_000, ...options })]
  )));
  return Object.fromEntries(entries);
}

function printHuman(report) {
  console.log(`mini-MVP: ${report.summary.ready}/${report.summary.required} готовы (${report.summary.percent}%)`);
  console.log(`Проблем: ${report.summary.issueCount}; API: ${report.apiUrl}`);
  for (const [collection, result] of Object.entries(report.summary.byCollection)) {
    console.log(`  ${collection}: ${result.ready}/${result.required}, проблем ${result.issues}`);
  }
  const topCodes = Object.entries(report.summary.issueCodes).sort((left, right) => right[1] - left[1]).slice(0, 20);
  if (topCodes.length > 0) {
    console.log('Основные причины:');
    for (const [code, count] of topCodes) console.log(`  ${code}: ${count}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const jsonArg = process.argv.slice(2).find((value) => value.startsWith('--json-out='));
  const catalogs = await fetchMiniMvpCatalogs();
  const report = assessMiniMvpCatalogs(catalogs);
  report.apiUrl = apiUrl();
  if (args.has('--json')) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (jsonArg) {
    const path = jsonArg.slice('--json-out='.length);
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`JSON: ${path}`);
  }
  if (args.has('--strict') && report.summary.ready !== report.summary.required) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
