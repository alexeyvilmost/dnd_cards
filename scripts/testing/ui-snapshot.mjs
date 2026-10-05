import {cp, readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertRealOwnedPath, assertRunId} from './guards.mjs';
import {runsRoot} from './runtime.mjs';

async function manifest(root, relative = '') {
  const result = [];
  for (const entry of (await readdir(path.join(root, relative), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('UI build cannot contain symlinks');
    if (entry.isDirectory()) result.push(...await manifest(root, name));
    else if (entry.isFile()) {
      const bytes = await readFile(path.join(root, name));
      result.push({path: name.replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
    } else throw new Error('UI build contains an unsupported filesystem entry');
  }
  return result;
}

export {manifest as inspectTestUIManifest};

export async function snapshotTestUI(source, registry) {
  assertRunId(registry.runId);
  await assertRealOwnedPath(runsRoot, registry.directory);
  if (path.basename(registry.directory) !== registry.runId) throw new Error('UI snapshot run ownership mismatch');
  const directory = path.join(registry.directory, 'ui-dist');
  const before = await manifest(source);
  if (!before.some(row => row.path === 'index.html')) throw new Error('UI build has no index');
  // A real copy preserves this run when a different agent rebuilds shared
  // frontend/dist. Before/after/content hashes fail closed on a raced copy.
  await cp(source, directory, {recursive: true, force: false, errorOnExist: true});
  const [after, copied] = await Promise.all([manifest(source), manifest(directory)]);
  if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(copied)) {
    throw new Error('UI build changed during snapshot; start a new owned run');
  }
  return {directory, indexHash: before.find(row => row.path === 'index.html').sha256,
    manifestHash: createHash('sha256').update(JSON.stringify(before)).digest('hex'), files: before.length,
    bytes: before.reduce((sum, row) => sum + row.bytes, 0)};
}
