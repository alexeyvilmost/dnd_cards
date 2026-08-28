import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, '..');
const artifactPath = resolve(
  frontendRoot,
  'src/pages/rulesLabFixture.generated.json',
);
const args = new Set(process.argv.slice(2));
const checkOnly = args.delete('--check') || args.delete('--dry-run');

if (args.size > 0) {
  throw new Error(`Unknown Rules Lab generator argument(s): ${[...args].join(', ')}`);
}

const server = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

try {
  const generator = await server.ssrLoadModule(
    '/src/pages/rulesLabFixtureGenerator.ts',
  );
  const displayPath = relative(frontendRoot, artifactPath);

  if (checkOnly) {
    const drift = await generator.checkRulesLabFixtureDrift(artifactPath);
    if (!drift.matches) {
      process.stderr.write(
        `Rules Lab fixture drift: ${displayPath}\n`
        + `  expected ${drift.expectedHash}\n`
        + `  actual   ${drift.actualHash ?? '<missing>'}\n`
        + 'Run `npm run rules-lab:generate` to refresh it.\n',
      );
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `Rules Lab fixture is current: ${displayPath} (${drift.expectedHash})\n`,
      );
    }
  } else {
    const result = await generator.generateRulesLabFixture(artifactPath);
    process.stdout.write(
      `Generated ${displayPath} (${result.bytes} bytes, ${result.hash})\n`,
    );
  }
} finally {
  await server.close();
}
