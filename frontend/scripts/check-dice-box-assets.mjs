import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = resolve(HERE, '..');

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function portable(root, path) {
  return relative(root, path).split(sep).join('/');
}

function snapshotRegularFiles(root, label) {
  if (!existsSync(root)) throw new Error(`${label} is missing`);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }

  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link`);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        files.set(
          portable(root, path),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        );
      } else {
        throw new Error(`${label} contains a non-regular entry`);
      }
    }
  };
  visit(root);
  return new Map([...files].sort(([left], [right]) => left.localeCompare(right)));
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The dependency's postinstall copies assets into public/assets, but the app
 * serves a reviewed, Git-bound copy from /assets/dice-box. Install scripts are
 * disabled; this check proves that the reviewed copy is still byte-identical
 * to the exact package-lock-installed dependency before every build.
 */
export function checkDiceBoxAssets({ frontendRoot = FRONTEND_ROOT } = {}) {
  const packageJson = readJson(resolve(frontendRoot, 'package.json'), 'frontend package.json');
  const packageLock = readJson(resolve(frontendRoot, 'package-lock.json'), 'frontend package-lock.json');
  const installedRoot = resolve(frontendRoot, 'node_modules/@3d-dice/dice-box');
  const installedPackage = readJson(resolve(installedRoot, 'package.json'), 'installed dice-box package');
  const lockEntry = packageLock?.packages?.['node_modules/@3d-dice/dice-box'];
  const declaredRange = packageJson?.dependencies?.['@3d-dice/dice-box'];
  if (!nonBlank(declaredRange) || !lockEntry || !nonBlank(lockEntry.version)
    || !nonBlank(lockEntry.integrity) || !lockEntry.integrity.startsWith('sha512-')) {
    throw new Error('dice-box dependency must be declared and integrity-pinned in package-lock.json');
  }
  if (installedPackage?.version !== lockEntry.version) {
    throw new Error('installed dice-box version differs from package-lock.json');
  }

  const packageAssets = snapshotRegularFiles(
    resolve(installedRoot, 'dist/assets'),
    'installed dice-box assets',
  );
  const canonicalAssets = snapshotRegularFiles(
    resolve(frontendRoot, 'public/assets/dice-box'),
    'reviewed dice-box assets',
  );
  if (JSON.stringify([...packageAssets]) !== JSON.stringify([...canonicalAssets])) {
    throw new Error('reviewed dice-box assets differ from the package-lock-installed dependency');
  }
  return {
    version: lockEntry.version,
    integrity: lockEntry.integrity,
    fileCount: canonicalAssets.size,
  };
}

/** Proves the deployable Vite output contains only the reviewed runtime path. */
export function checkDiceBoxBuild({ frontendRoot = FRONTEND_ROOT } = {}) {
  const source = checkDiceBoxAssets({ frontendRoot });
  const canonicalAssets = snapshotRegularFiles(
    resolve(frontendRoot, 'public/assets/dice-box'),
    'reviewed dice-box assets',
  );
  const builtAssets = snapshotRegularFiles(
    resolve(frontendRoot, 'dist/assets/dice-box'),
    'built dice-box assets',
  );
  if (JSON.stringify([...canonicalAssets]) !== JSON.stringify([...builtAssets])) {
    throw new Error('built dice-box assets differ from the reviewed runtime assets');
  }
  for (const unusedDirectory of ['ammo', 'themes']) {
    if (existsSync(resolve(frontendRoot, 'dist/assets', unusedDirectory))) {
      throw new Error(`build contains unused postinstall dice assets at /assets/${unusedDirectory}`);
    }
  }
  return source;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--dist') || args.length > 1) {
      throw new Error('usage: node scripts/check-dice-box-assets.mjs [--dist]');
    }
    const result = args[0] === '--dist' ? checkDiceBoxBuild() : checkDiceBoxAssets();
    process.stdout.write(`Verified ${result.fileCount} DiceBox assets from ${result.version}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
