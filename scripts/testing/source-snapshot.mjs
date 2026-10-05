import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {repositoryRoot} from './runtime.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function assertCleanCICheckout(repo = repositoryRoot) {
  const status=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024});
  if(status.trim())throw Error('CI verification requires a clean committed checkout, including untracked sources');
  return {clean_checkout:true};
}
export function isVerificationInput(file) {
  return (/^(?:frontend|backend|scripts|tests|infra|officials|\.github)\//.test(file)
    || /^(?:\.dockerignore|\.gitignore|\.gitattributes|docker-compose[^/]*\.ya?ml|package(?:-lock)?\.json)$/.test(file))
    && !/(?:^|\/)(?:node_modules|dist|outputs?|tmp|playwright-report|test-results|\.env(?:\.[^/]*)?)(?:\/|$)/.test(file)
    // rules-core/coverage contains source modules and historical contracts.
    // Only the top-level generated coverage directories are report outputs.
    && !/^(?:frontend|backend)\/coverage(?:\/|$)/.test(file)
    && !/\.(?:tsbuildinfo|log)$/.test(file);
}
// Keep only hashes, never file contents. The inventory includes unchanged
// sources and additions/removals, not just files already dirty at startup.
export function captureSourceSnapshot(repo = repositoryRoot) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repo, encoding:'utf8'}).trim();
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {cwd:repo, encoding:'utf8', maxBuffer:64*1024*1024}).split('\0');
  const root = realpathSync(repo), files = [];
  for (const file of [...new Set(names)].filter(isVerificationInput).sort()) {
    const absolute = path.join(repo, file);
    if (!existsSync(absolute)) {files.push({file, sha256:null}); continue;}
    const relative = path.relative(root, realpathSync(absolute));
    if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw Error(`Verification input escapes repository: ${file}`);
    files.push({file, sha256:digest(readFileSync(absolute))});
  }
  return {schema_version:1, head, sha256:digest(JSON.stringify({head,files})), files};
}
export function verifySourceSnapshot(before, after) {
  if (before.sha256 === after.sha256 && before.head === after.head) return {unchanged:true, files:after.files.length, sha256:after.sha256};
  const left = new Map(before.files.map(row=>[row.file,row.sha256]));
  const right = new Map(after.files.map(row=>[row.file,row.sha256]));
  const changed = [...new Set([...left.keys(),...right.keys()])].filter(file=>left.has(file)!==right.has(file)||left.get(file)!==right.get(file)).sort();
  throw Object.assign(Error('Verification inputs changed during the run; repeat on stable sources'), {changedFiles:changed, headChanged:before.head!==after.head});
}
