import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MicroMvpEvidenceExecutionManifestError,
  validateMicroMvpEvidenceExecutionManifest,
  type ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';

const FRONTEND_ROOT = join(import.meta.dirname, '../../..');
const DESCRIPTOR_PATH = join(FRONTEND_ROOT, 'micro-mvp-evidence.config.json');

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new MicroMvpEvidenceExecutionManifestError([{
      code: 'invalid_manifest',
      message: `missing current-run environment variable ${key}`,
    }]);
  }
  return value;
}

export function currentMicroMvpEvidenceConfigHash(): string {
  const descriptor = JSON.parse(readFileSync(DESCRIPTOR_PATH, 'utf8')) as {
    hashInputs: readonly string[];
  };
  const hasher = createHash('sha256');
  for (const relativePath of descriptor.hashInputs) {
    const source = readFileSync(resolve(FRONTEND_ROOT, relativePath));
    hasher.update(relativePath).update('\0').update(String(source.byteLength)).update('\0').update(source);
  }
  return `sha256:${hasher.digest('hex')}`;
}

export function readCurrentMicroMvpEvidenceExecutionManifest(): ValidatedMicroMvpEvidenceExecutionManifest {
  const descriptor = JSON.parse(readFileSync(DESCRIPTOR_PATH, 'utf8')) as {
    manifestRelativePath: string;
  };
  const expectedConfigHash = currentMicroMvpEvidenceConfigHash();
  const runnerConfigHash = requiredEnvironment('MICRO_MVP_EVIDENCE_CONFIG_HASH');
  if (runnerConfigHash !== expectedConfigHash) {
    throw new MicroMvpEvidenceExecutionManifestError([{
      code: 'config_hash_mismatch',
      message: 'runner configuration hash does not match the checked-in evidence descriptor',
    }]);
  }
  const manifestPath = resolve(FRONTEND_ROOT, descriptor.manifestRelativePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new MicroMvpEvidenceExecutionManifestError([{
      code: 'invalid_manifest',
      message: `cannot read current execution manifest: ${error instanceof Error ? error.message : String(error)}`,
    }]);
  }
  const manifest = validateMicroMvpEvidenceExecutionManifest(parsed, {
    runId: requiredEnvironment('MICRO_MVP_EVIDENCE_RUN_ID'),
    startedAt: requiredEnvironment('MICRO_MVP_EVIDENCE_RUN_STARTED_AT'),
    configHash: expectedConfigHash,
  });
  if (manifest.runResult !== 'passed' || manifest.unhandledErrorCount !== 0) {
    throw new MicroMvpEvidenceExecutionManifestError([{
      code: 'invalid_manifest',
      message: `collection run is ${manifest.runResult} with ${manifest.unhandledErrorCount} unhandled error(s)`,
    }]);
  }
  return manifest;
}
