#!/usr/bin/env node
// Build-time only. Runtime release variables must never become component provenance.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Versioned source constants; runtime environment never declares reader support.
const frontendReaderCapabilities = Object.freeze(['image-job-v1']);

export function assertOCIMediaDisabled(environment = {}) {
  if ((environment.VITE_MEDIA_VARIANTS ?? '0') !== '0' || (environment.MEDIA_VARIANTS_BUNDLE ?? '') !== '') {
    throw Error('Enabled media variants are not supported by release schema v1; an explicit bundle input contract and OCI acceptance are required');
  }
  return {VITE_MEDIA_VARIANTS: '0'};
}

export function buildIdentity({component, sourceCommit = '', inputFingerprint = '', artifact, mediaEnvironment = {}}) {
  if (!['frontend', 'rulesWorker'].includes(component)) throw Error('Unknown component');
  if (component === 'frontend') assertOCIMediaDisabled(mediaEnvironment);
  if (sourceCommit && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('Invalid component source commit');
  if (inputFingerprint && !/^sha256:[a-f0-9]{64}$/.test(inputFingerprint)) throw Error('Invalid component input fingerprint');
  if (Boolean(sourceCommit) !== Boolean(inputFingerprint)) throw Error('Both component identities are required together');
  const identity = {identitySchemaVersion: 1, component, provenance: sourceCommit ? 'baked' : 'unverified',
    sourceCommit: sourceCommit || null, source_commit: sourceCommit || null, inputFingerprint: inputFingerprint || null,
    apiProtocolVersion: 1};
  if (component === 'frontend') identity.readerCapabilities = [...frontendReaderCapabilities];
  if (component === 'rulesWorker') {
    if (!artifact) throw Error('Worker artifact is required');
    Object.assign(identity, {artifactHash: `sha256:${createHash('sha256').update(artifact).digest('hex')}`,
      workerProtocolVersion: 1, supportedWorldSchemaVersions: [5],
      capabilities: ['pinned-artifact-routing', 'pending-decision-pass-through'],
      workerRuntime: {name: 'node', version: process.versions.node}});
  }
  return identity;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [component, output, artifactFile] = process.argv.slice(2);
  if (!output) throw Error('Usage: write-build-identity.mjs <frontend|rulesWorker> <output> [artifact]');
  const identity = buildIdentity({component, sourceCommit: process.env.COMPONENT_SOURCE_COMMIT,
    inputFingerprint: process.env.COMPONENT_INPUT_FINGERPRINT, artifact: artifactFile && readFileSync(artifactFile), mediaEnvironment: process.env});
  writeFileSync(output, `${JSON.stringify(identity)}\n`, {flag: 'wx'});
}
