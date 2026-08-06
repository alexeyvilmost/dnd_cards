import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, '..');
const artifactPath = resolve(
  frontendRoot,
  'src/character/sheetCombatCertification.generated.json',
);
const args = new Set(process.argv.slice(2));
const checkOnly = args.delete('--check') || args.delete('--dry-run');

if (args.size > 0) {
  throw new Error(`Unknown sheet combat certification argument(s): ${[...args].join(', ')}`);
}

const server = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const generator = await server.ssrLoadModule(
    '/src/character/sheetCombatCertificationGenerator.ts',
  );
  const displayPath = relative(frontendRoot, artifactPath);

  if (checkOnly) {
    const drift = await generator.checkSheetCombatCertificationDrift(artifactPath);
    if (!drift.matches) {
      process.stderr.write(
        `Sheet combat certification drift: ${displayPath}\n`
        + `  expected ${drift.expectedHash}\n`
        + `  actual   ${drift.actualHash ?? '<missing>'}\n`
        + 'Run `npm run sheet-combat-certification:generate` after the full compiler gate.\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Sheet combat certification is current: ${displayPath} (${drift.expectedHash})\n`,
      );
    }
  } else {
    const result = await generator.generateSheetCombatCertification(artifactPath);
    process.stdout.write(
      `Generated ${displayPath} (${result.bytes} bytes, ${result.hash})\n`,
    );
  }
} finally {
  await server.close();
}
