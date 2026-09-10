import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {buildCertificationIndex, dependencySnapshot} from './certification-hash.mjs';
import {ROGUELIKE_FIGHTER_MANIFEST, flattenRoguelikeFighterManifest, validateRoguelikeFighterManifest} from './roguelike-fighter-l1-5-manifest.mjs';

const fighterClasses = new Set(['CLASS-warrior', 'fighter_battle_master', 'fighter_champion', 'fighter_eldritch_knight', 'fighter_psi_warrior']);

/** Level scope applies before reference traversal. A referenced spell-list
 * class is metadata, not a grant of that class's features to the Fighter. */
export function projectFighterCoverageEntity(entity, type) {
  if (type !== 'class' && type !== 'race') return entity;
  const projected = {...entity};
  if (type === 'class' && !fighterClasses.has(entity.card_number)) {
    delete projected.level_progression;
    delete projected.related_actions;
    delete projected.related_effects;
    delete projected.resources;
    return projected;
  }
  if (entity.level_progression != null) {
    if (typeof entity.level_progression !== 'object' || Array.isArray(entity.level_progression)
      || Object.keys(entity.level_progression).some(level => !/^[1-9]\d*$/.test(level))) {
      throw Error(`Unrecognized progression shape: ${entity.card_number ?? entity.id}`);
    }
    projected.level_progression = Object.fromEntries(Object.entries(entity.level_progression)
      .filter(([level]) => Number(level) <= 5));
  }
  return projected;
}

export function auditRoguelikeFighterCatalog(catalog, manifest = ROGUELIKE_FIGHTER_MANIFEST) {
  const issues = validateRoguelikeFighterManifest(manifest).map(message => ({kind: 'manifest', message}));
  const index = buildCertificationIndex(catalog);
  const dependencies = new Map();
  const roots = flattenRoguelikeFighterManifest(manifest).map(root => {
    if (root.entityType === 'rule') return {...root, presence: 'rule-contract', evidence: 'not-evaluated'};
    const matches = (index.byReference.get(root.selector.cardNumber) ?? []).filter(record => record.type === root.entityType);
    if (matches.length !== 1) {
      issues.push({kind: matches.length ? 'duplicate' : 'missing', entityType: root.entityType, cardNumber: root.selector.cardNumber});
      return {...root, presence: matches.length ? 'duplicate' : 'missing', evidence: 'not-evaluated'};
    }
    const record = matches[0];
    let refs = [];
    try {
      refs = dependencySnapshot(record.entity, record.type, index, {projectEntity: projectFighterCoverageEntity});
    } catch (error) {
      issues.push({kind: 'progression', cardNumber: root.selector.cardNumber, message: error.message});
    }
    for (const reference of refs) {
      const dependency = index.byIdentity.get(reference.identity);
      const accumulated = dependencies.get(reference.identity) ?? {
        identity: reference.identity, entityType: dependency.type, cardNumber: dependency.entity.card_number ?? null,
        label: dependency.entity.name ?? reference.identity, roots: [],
        referenceOnlyClass: dependency.type === 'class' && !fighterClasses.has(dependency.entity.card_number),
      };
      accumulated.roots.push(root.selector.cardNumber);
      dependencies.set(reference.identity, accumulated);
    }
    return {...root, id: record.entity.id, presence: 'present', evidence: 'not-evaluated',
      catalogReportedStatus: record.entity.support?.status ?? null,
      structuralDependencies: refs.map(reference => reference.identity)};
  });
  return {
    schemaVersion: 1, release: manifest.release, manifestVersion: manifest.manifestVersion,
    auditScope: 'catalog-presence-and-scoped-references',
    // Structural references are a conservative discovery list. Conditional
    // branches, prerequisites and executable support still need scenario QA.
    mechanicalAcceptanceComplete: false,
    summary: {roots: roots.length, presentEntities: roots.filter(root => root.presence === 'present').length,
      ruleContracts: roots.filter(root => root.presence === 'rule-contract').length, issues: issues.length,
      structuralDependencies: dependencies.size},
    issues, roots, dependencies: [...dependencies.values()].sort((left, right) => left.identity.localeCompare(right.identity)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [catalogFile, outputFile] = process.argv.slice(2);
  if (!catalogFile || !outputFile) throw Error('Usage: node roguelike-fighter-audit.mjs private-catalog.json report.json');
  const report = auditRoguelikeFighterCatalog(JSON.parse(await readFile(catalogFile, 'utf8')));
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({release: report.release, auditScope: report.auditScope, ...report.summary, mechanicalAcceptanceComplete: false}));
  if (report.issues.length) process.exitCode = 1;
}
