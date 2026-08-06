import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Fail-closed filesystem boundary for release artifacts that contain
 * production preimages, restore metadata, or attestations.  POSIX mode bits
 * are not meaningful on Windows, so type/symlink checks remain mandatory there
 * while permission fixtures are asserted on POSIX hosts.
 */
export function assertPrivateRegularFile(path, label, { allowMissing = false } = {}) {
  const resolved = resolve(path);
  const entry = lstatIfPresent(resolved);
  if (!entry) {
    if (allowMissing) return { exists: false, path: resolved, stat: null };
    throw new Error(`${label} must point to an existing regular file`);
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${label} must be a regular file and must not be a symlink`);
  }
  if (process.platform !== 'win32' && (entry.mode & 0o077) !== 0) {
    throw new Error(`${label} permissions must not allow group/world access`);
  }
  return { exists: true, path: resolved, stat: entry };
}
