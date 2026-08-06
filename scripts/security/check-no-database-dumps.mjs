#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbidden = tracked.filter((path) => {
  if (!existsSync(path)) return false;
  const name = basename(path).toLowerCase();
  const extension = extname(name);
  if (extension === '.dump' || extension === '.backup') return true;
  if (/^dump.*\.sql$/.test(name)) return true;
  return extension === '.sql' && statSync(path).size > 2 * 1024 * 1024;
});

const repositoryKnownPasswordHash = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';
const insecureSeeds = tracked.filter((path) => (
  existsSync(path)
  && extname(path).toLowerCase() === '.sql'
  && readFileSync(path, 'utf8').includes(repositoryKnownPasswordHash)
));

if (forbidden.length > 0 || insecureSeeds.length > 0) {
  process.stderr.write(
    [
      ...(forbidden.length > 0
        ? [`Tracked database dump artifacts are forbidden:\n${forbidden.map((path) => `- ${path}`).join('\n')}`]
        : []),
      ...(insecureSeeds.length > 0
        ? [`Repository-known production password seeds are forbidden:\n${insecureSeeds.map((path) => `- ${path}`).join('\n')}`]
        : []),
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  process.stdout.write('No tracked database dump artifacts or repository-known password seeds found.\n');
}
