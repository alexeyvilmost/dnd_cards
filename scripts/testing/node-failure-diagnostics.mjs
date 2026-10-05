import path from 'node:path';
import {fileURLToPath} from 'node:url';

const source = /^(?:scripts|frontend|backend|tests)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:test|spec)\.[cm]?[jt]sx?$/;
const failureTypes = new Set(['testCodeFailure', 'subtestsFailed', 'hookFailed', 'cancelledByParent', 'testTimeoutFailure', 'testAbortFailure']);
const codes = new Set(['ERR_ASSERTION', 'ERR_TEST_FAILURE', 'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_UNKNOWN_FILE_EXTENSION', 'ERR_UNSUPPORTED_DIR_IMPORT', 'ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'EADDRINUSE']);

// Reports are public CI artifacts. Never copy TAP error text, assertion values,
// test titles, arbitrary stack frames, stdout, SQL or environment into them.
// Locations must name an exact selected repository test; classifications come
// only from fixed vocabularies, and are diagnostic rather than pass evidence.
export function safeNodeFailureDiagnostics(output, {files, root}) {
  const allowed = new Set(files.filter(file => source.test(file)));
  const failures = [];
  const normalize = location => {
    const match = location.match(/^(.*):(\d+):(\d+)$/);
    if (!match) return null;
    let file = match[1];
    const windows = /^[A-Za-z]:[\\/]/.test(root);
    try {if (file.startsWith('file:')) file = fileURLToPath(file,{windows});} catch {return null;}
    const api = windows ? path.win32 : path.posix;
    const relative = api.isAbsolute(file) ? api.relative(root, file) : file;
    file = relative.replaceAll('\\', '/');
    const line = Number(match[2]), column = Number(match[3]);
    if (!allowed.has(file) || !source.test(file) || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) return null;
    return {file, line, column};
  };
  const blocks = String(output ?? '').split(/(?=^[ \t]*not ok \d+(?:\s|$))/m).filter(block => /^[ \t]*not ok \d+(?:\s|$)/.test(block));
  for (const block of blocks) {
    const yaml = block.match(/^([ \t]+)---\r?\n([\s\S]*?)^\1\.\.\.\s*$/m);
    if (!yaml) continue;
    const fields = new Map();
    for (const line of yaml[2].split(/\r?\n/)) {
      const match = line.match(new RegExp(`^${yaml[1]}(location|failureType|code): (.*)$`));
      if (!match || fields.has(match[1])) continue;
      const value = match[2];
      fields.set(match[1], /^['"].*['"]$/.test(value) ? value.slice(1, -1) : value);
    }
    const location = normalize(fields.get('location') ?? '');
    if (!location) continue;
    const row = {...location, ...(failureTypes.has(fields.get('failureType')) ? {failureType: fields.get('failureType')} : {}), ...(codes.has(fields.get('code')) ? {code: fields.get('code')} : {})};
    if (!failures.some(item => JSON.stringify(item) === JSON.stringify(row))) failures.push(row);
    if (failures.length === 100) break;
  }
  return {schemaVersion: 1, kind: 'safe-node-test-locations', failures, rawOutputIncluded: false};
}
