import {spawn} from 'node:child_process';
import {existsSync, createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runsRoot = path.join(repositoryRoot, 'outputs/testing/runs');
export function cleanEnvironment(extra = {}) {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'PATHEXT'];
  return {...Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]])), ...extra};
}
export function resolveTool(name, explicit) {
  if (explicit) { if (!existsSync(explicit)) throw new Error(`Missing ${name} executable`); return explicit; }
  const extension = process.platform === 'win32' ? '.exe' : '';
  const local = process.env.LOCALAPPDATA;
  const candidates = [
    ...(process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, name + extension)),
    ...(local ? [path.join(local, 'dnd-cards-dev/tools/postgresql-17.11/pgsql/bin', name + extension), path.join(local, 'dnd-cards-dev/tools/go/bin', name + extension)] : []),
  ];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) throw new Error(`${name} is unavailable; provide its explicit tool path`);
  return found;
}
export function execute(executable, args, {cwd = repositoryRoot, env = cleanEnvironment(), input, log, timeout = 300_000, quiet = false, signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd, env, windowsHide: true, signal, stdio: quiet ? 'ignore' : ['pipe', 'pipe', 'pipe']});
    const stream = log ? createWriteStream(log, {flags: 'a'}) : null;
    let output = '';
    // Each pipe needs its own streaming decoder. Buffer -> string per chunk
    // corrupts a Cyrillic/emoji code point split by the OS pipe boundary.
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    const append = data => { output += data; if (output.length > 16_000_000) output = output.slice(-16_000_000); stream?.write(data); };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('error', error => {clearTimeout(timer); stream?.end(); reject(error);});
    child.on('close', code => {
      clearTimeout(timer); stream?.end();
      if (code !== 0) reject(Object.assign(new Error(`${path.basename(executable)} exited ${code}${log ? `; see ${log}` : ''}`), {output, code}));
      else resolve(output);
    });
  });
}
export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const {port} = server.address(); await new Promise(resolve => server.close(resolve)); return port;
}
export async function writeRegistry(registry) {
  await mkdir(registry.directory, {recursive: true});
  await writeFile(path.join(registry.directory, 'registry.json'), JSON.stringify(registry, null, 2));
}
export async function readRegistry(directory) {
  return JSON.parse(await readFile(path.join(directory, 'registry.json'), 'utf8'));
}
