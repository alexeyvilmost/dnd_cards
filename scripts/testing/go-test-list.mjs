import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Only discovery and explicitly test-free compilation are repeatable here.
// Failed actual tests never use these classifiers; failed discovery never
// supplies selected names.
function cleanupFailureLines(error, {platform, env}) {
  if (platform !== 'win32' || error?.code !== 1 || typeof error.output !== 'string') return null;
  const lines = error.output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const cleanup = lines.filter(line => /^go: unlinkat /.test(line));
  if (cleanup.length !== 1) return null;
  const match = cleanup[0].match(/^go: unlinkat ([A-Za-z]:\\[^\r\n]+): Access is denied\.$/);
  if (!match) return null;
  const roots = [env?.GOTMPDIR, env?.TEMP, env?.TMP].filter(root => typeof root === 'string' && root);
  if (!roots.some(root => /^go-build\d+\\b\d+\\[A-Za-z0-9_.-]+\.test\.exe$/.test(path.win32.relative(root, match[1])))) return null;
  return lines.filter(line => line !== cleanup[0]);
}

export function isWindowsGoListCleanup(error, {platform, packageName, env}) {
  const lines = cleanupFailureLines(error, {platform, env});
  if (!lines) return false;
  const summaries = lines.filter(line => /^ok\s/.test(line));
  if (summaries.length !== 1) return false;
  const summary = summaries[0].match(/^ok\s+(\S+)\s+\d+(?:\.\d+)?s$/);
  if (summary?.[1] !== packageName) return false;
  const names = lines.filter(line => /^Test[A-Za-z0-9_]+$/.test(line));
  return names.length > 0 && new Set(names).size === names.length
    && lines.length === names.length + 1;
}

function compileOnlyPackages(error, context) {
  const lines = cleanupFailureLines(error, context);
  if (!lines?.length) return null;
  const packages = lines.map(line => line.match(/^(?:ok\s+(\S+)\s+(?:\d+(?:\.\d+)?s|\(cached\))\s+\[no tests to run\]|\?\s+(\S+)\s+\[no test files\])$/))
    .map(match => match ? match[1] ?? match[2] : null);
  return packages.every(Boolean) && new Set(packages).size === packages.length ? packages : null;
}

export function isWindowsGoCompileCleanup(error, {platform, env, packages}) {
  const observed = compileOnlyPackages(error, {platform, env});
  return Boolean(observed && Array.isArray(packages) && packages.length && new Set(packages).size === packages.length
    && observed.length === packages.length && packages.every(name => observed.includes(name)));
}

export async function listGoTests({invoke, id, go, packagePath, packageName, settings, platform = process.platform,
  wait = signal => delay(250, undefined, {signal})}) {
  if (!/^\.(?:\/[A-Za-z0-9_-]+)*$/.test(packagePath) || !/^go-[A-Za-z0-9_-]+$/.test(id)) throw Error('Exact local Go discovery target required');
  const args = ['test', packagePath, '-list', '^Test'];
  try {
    return {output: await invoke(`${id}-list`, go, args, settings), attempts: 1};
  } catch (error) {
    if (settings.signal?.aborted || !isWindowsGoListCleanup(error, {platform, packageName, env: settings.env})) throw error;
    await wait(settings.signal);
    // Exactly one fresh Go invocation, with a separate retained log. Its exit
    // status remains authoritative; a second failure is not retried or parsed.
    return {output: await invoke(`${id}-list-retry-2`, go, args, settings), attempts: 2, retryReason: 'windows-go-list-cleanup'};
  }
}

export async function compileGoPackages({invoke, go, settings, platform = process.platform,
  wait = signal => delay(250, undefined, {signal})}) {
  const args = ['test', './...', '-run', '^$'];
  try {
    await invoke('backend-compile', go, args, settings);
    return {attempts: 1};
  } catch (error) {
    if (settings.signal?.aborted || !compileOnlyPackages(error, {platform, env: settings.env})) throw error;
    // Only after an otherwise successful compile do we enumerate its exact
    // package set. Missing results cannot be excused as a cleanup-only failure.
    const raw = await invoke('go-packages-before-compile-retry', go, ['list', './...'], settings);
    const packages = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!packages.every(name => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name))
      || !isWindowsGoCompileCleanup(error, {platform, env: settings.env, packages})) throw error;
    await wait(settings.signal);
    await invoke('backend-compile-retry-2', go, args, settings);
    return {attempts: 2, retryReason: 'windows-go-compile-cleanup'};
  }
}
