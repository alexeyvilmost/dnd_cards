import {readFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
import {assertSourceContentManifest} from './source-content-manifest.mjs';

const manifestPath = 'infra/release-content-manifest.json';
const configPath = 'infra/release-build-config.json';
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));

// Generated checksums are evidence, not a runtime dependency of every image.
// Keep the conservative selection whenever the complete derivation is unavailable.
export function selectGeneratedSourceProvenance({repo, selection, config, contentManifest, previousManifest, readBaselineFile}) {
  if (selection.full_fallback || !previousManifest || !selection.changed_files.includes(manifestPath)) return selection;
  let previousContent, previousConfig, currentConfig;
  try {
    previousContent = JSON.parse(readBaselineFile(manifestPath));
    previousConfig = JSON.parse(readBaselineFile(configPath));
    if (!lstatSync(path.join(repo, configPath)).isFile() || lstatSync(path.join(repo, configPath)).isSymbolicLink()) return selection;
    currentConfig = JSON.parse(readFileSync(path.join(repo, configPath), 'utf8'));
    if (evidenceHash(assertSourceContentManifest(repo, currentConfig)) !== evidenceHash(contentManifest)) return selection;
  } catch { return selection; }
  const oldHash = evidenceHash(previousContent), newHash = evidenceHash(contentManifest);
  if (oldHash === newHash || previousManifest.contentManifestHash !== oldHash || previousConfig.contentManifestHash !== oldHash
    || currentConfig.contentManifestHash !== newHash || evidenceHash(config) !== evidenceHash(currentConfig)
    || evidenceHash(without(previousConfig, 'contentManifestHash')) !== evidenceHash(without(currentConfig, 'contentManifestHash'))
    || evidenceHash(without(previousContent, 'files')) !== evidenceHash(without(contentManifest, 'files'))
    || !Array.isArray(previousContent.files) || previousContent.files.some(row => !row || typeof row.path !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(row.sha256 ?? '') || !Number.isSafeInteger(row.bytes) || row.bytes < 0
      || evidenceHash(Object.keys(row).sort()) !== evidenceHash(['bytes', 'path', 'sha256']))) return selection;
  const oldFiles = new Map(previousContent.files.map(row => [row.path, row]));
  const newFiles = new Map(contentManifest.files.map(row => [row.path, row]));
  if (oldFiles.size !== previousContent.files.length || newFiles.size !== contentManifest.files.length) return selection;
  const changedFiles = new Set(selection.changed_files);
  const sourceChanges = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(file =>
    evidenceHash(oldFiles.get(file) ?? null) !== evidenceHash(newFiles.get(file) ?? null));
  if (!sourceChanges.length || sourceChanges.some(file => !changedFiles.has(file))) return selection;
  const generatedFiles = new Set([manifestPath, configPath]);
  const reasons = selection.reasons.map(reason => generatedFiles.has(reason.path)
    ? {...reason, rule: 'generated-source-provenance', original_rule: reason.rule,
      components: reason.worker_graph_input ? ['worker'] : [],
      derivation: {previousHash: oldHash, currentHash: newHash, sourceChanges}}
    : reason);
  const selected = new Set(reasons.flatMap(reason => reason.components));
  return {...selection, reasons, components: Object.fromEntries(Object.keys(selection.components).map(name => [name, selected.has(name)]))};
}
