#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  MICRO_MVP_COLLECTION_ENTITY_TYPES,
  MICRO_MVP_MANIFEST,
  flattenMicroMvpManifest,
  validateMicroMvpManifest,
} from './micro-mvp-manifest.mjs';
import { fetchRequiredCollection } from './api.mjs';
import {
  buildCertificationIndex,
  certificationHashes,
} from './certification-hash.mjs';

export const ENTITY_ENDPOINTS = {
  class: ['/api/classes', 'classes'],
  race: ['/api/races', 'races'],
  background: ['/api/backgrounds', 'backgrounds'],
  feat: ['/api/feats', 'feats'],
  spell: ['/api/spells', 'spells'],
  card: ['/api/cards', 'cards'],
  action: ['/api/actions', 'actions'],
  effect: ['/api/effects', 'effects'],
};

export const COLLECTION_ENTITY_TYPES = MICRO_MVP_COLLECTION_ENTITY_TYPES;

const normalized = (value) => String(value ?? '').trim().toLocaleLowerCase('en');

export function resolveManifestEntry(item, entities, certificationContext = null) {
  const selector = item.selector ?? {};
  const matches = entities.filter((entity) => {
    if (selector.id) return entity.id === selector.id;
    if (selector.cardNumber) return entity.card_number === selector.cardNumber;
    if (selector.nameEn) return normalized(entity.name_en) === normalized(selector.nameEn);
    return false;
  });

  if (matches.length === 0) return { status: 'missing', entity: null };
  if (matches.length > 1) return { status: 'duplicate', entity: null, count: matches.length };

  const entity = matches[0];
  if (item.expected.level !== undefined && entity.level !== item.expected.level) {
    return {
      status: 'wrong_shape',
      entity,
      reason: `expected level ${item.expected.level}, got ${String(entity.level)}`,
    };
  }

  if (item.expected.category) {
    const category = normalized(entity.category ?? entity.feat_category);
    if (category !== normalized(item.expected.category)) {
      return {
        status: 'wrong_shape',
        entity,
        reason: `expected category ${item.expected.category}, got ${category || '<empty>'}`,
      };
    }
  }

  if (!selector.id && !selector.cardNumber) {
    return { status: 'unstable_identity', entity };
  }

  const supportStatus = entity.support?.status ?? 'untested';
  if (!MICRO_MVP_MANIFEST.defaultVisibleStatuses.includes(supportStatus)) {
    return { status: 'not_certified', entity, supportStatus };
  }
  const certificationIssues = [];
  if (!entity.support?.certification_version) certificationIssues.push('missing certification_version');
  if (!entity.support?.content_hash) certificationIssues.push('missing content_hash');
  if (!entity.support?.dependency_hash) certificationIssues.push('missing dependency_hash');
  if (
    supportStatus === 'verified_partial'
    && !entity.support?.limitations?.some?.((limitation) => String(limitation).trim())
  ) {
    certificationIssues.push('verified_partial has no limitations');
  }
  if (certificationIssues.length > 0) {
    return { status: 'invalid_certification', entity, supportStatus, certificationIssues };
  }

  if (certificationContext) {
    const hashes = certificationHashes(
      entity,
      certificationContext.entityType,
      certificationContext.index,
    );
    const staleFields = [];
    if (entity.support.content_hash !== hashes.contentHash) staleFields.push('content_hash');
    if (entity.support.dependency_hash !== hashes.dependencyHash) staleFields.push('dependency_hash');
    if (staleFields.length > 0) {
      return {
        status: 'stale_certification',
        entity,
        supportStatus,
        staleFields,
        currentHashes: hashes,
      };
    }
    return { status: 'ready', entity, supportStatus, currentHashes: hashes };
  }

  return { status: 'ready', entity, supportStatus };
}

export function assessMicroMicroContent(catalogs) {
  const manifestIssues = validateMicroMvpManifest();
  const entityGroups = Object.fromEntries(
    Object.entries(ENTITY_ENDPOINTS).map(([entityType]) => [
      entityType,
      catalogs[entityType]
        ?? catalogs[
          Object.entries(COLLECTION_ENTITY_TYPES)
            .find(([, type]) => type === entityType)?.[0]
        ]
        ?? [],
    ]),
  );
  const certificationIndex = buildCertificationIndex(entityGroups);
  const results = flattenMicroMvpManifest().map((item) => {
    const entities = catalogs[item.collection] ?? [];
    return {
      ...item,
      ...resolveManifestEntry(item, entities, {
        entityType: COLLECTION_ENTITY_TYPES[item.collection],
        index: certificationIndex,
      }),
    };
  });

  return {
    ready: manifestIssues.length === 0 && results.every((result) => result.status === 'ready'),
    manifestIssues,
    results,
    summary: Object.fromEntries(
      [...new Set(results.map((result) => result.status))].map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
  };
}

export const assessMicroMvpContent = assessMicroMicroContent;

async function fetchCatalog(baseUrl, path, key) {
  const timeoutMs = Number(process.env.CONTENT_GATE_TIMEOUT_MS || 60_000);
  return fetchRequiredCollection(path, key, {
    baseUrl,
    limit: 1000,
    fetchImpl: (url) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  });
}

export async function runLiveGate({
  baseUrl = process.env.API_URL || 'http://localhost:8080',
} = {}) {
  const entityGroups = Object.fromEntries(await Promise.all(
    Object.entries(ENTITY_ENDPOINTS).map(async ([entityType, [path, key]]) => [
      entityType,
      await fetchCatalog(baseUrl, path, key),
    ]),
  ));
  const catalogs = {
    ...entityGroups,
    ...Object.fromEntries(
      Object.entries(COLLECTION_ENTITY_TYPES).map(([collection, entityType]) => [
        collection,
        entityGroups[entityType],
      ]),
    ),
  };

  return { baseUrl, ...assessMicroMicroContent(catalogs) };
}

async function main() {
  const json = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');
  const report = await runLiveGate();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`micro-MVP content gate — ${report.baseUrl}`);
    console.log(`ready: ${report.ready ? 'yes' : 'no'}`);
    console.log(`summary: ${JSON.stringify(report.summary)}`);
    for (const result of report.results.filter((item) => item.status !== 'ready')) {
      const details = result.reason
        || result.certificationIssues?.join(', ')
        || result.staleFields?.join(', ')
        || result.supportStatus
        || '';
      console.log(`- ${result.key}: ${result.status}${details ? ` (${details})` : ''}`);
    }
    for (const issue of report.manifestIssues) console.log(`- manifest: ${issue}`);
  }

  if (strict && !report.ready) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
