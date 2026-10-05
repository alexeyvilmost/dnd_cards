import {vi, expect} from 'vitest';
import {mkdirSync, writeFileSync, existsSync,realpathSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Maintenance-only capture from existing semantic assertions. Not a test oracle
// generator in normal suites; never edits the source fixtures or certificates.
vi.mock('/src/rules-core/handler.ts', async importOriginal => {
  const actual = await importOriginal<any>();
  const clone = (value:any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return {...actual, handleCommand(world:any, command:any, catalog:any, env:any) {
    if (!world.pendingResolution) return actual.handleCommand(world, command, catalog, env);
    const before = clone(world), request = clone(command), calls:any[] = [];
    const record = (name:string, callable:Function) => (...args:any[]) => {
      const value = callable(...args);
      calls.push({name, args:clone(args), value:clone(value)});
      return value;
    };
    const wrappedCatalog = Object.fromEntries(Object.entries(catalog).map(([key,value]) =>
      [key,typeof value === 'function' ? record(`catalog.${key}`,value.bind(catalog)) : value]));
    const rng:any = record('env.rng',env.rng);
    if (typeof env.rng.rollDie === 'function') rng.rollDie = record('env.rollDie',env.rng.rollDie.bind(env.rng));
    const wrappedEnv = {...env,rng,clock:record('env.clock',env.clock),nextId:record('env.nextId',env.nextId)};
    const result = actual.handleCommand(world,command,wrappedCatalog,wrappedEnv);
    if (result.status !== 'accepted') return result;
    const directory = path.resolve(process.env.PENDING_CAPTURE_DIRECTORY ?? '');
    const root=fileURLToPath(new URL('../../outputs/testing/pending-lifecycle-capture/',import.meta.url));
    const relative=path.relative(realpathSync(root),realpathSync(directory));
    if (!/^[a-f0-9]{32}$/.test(relative) || !process.env.PENDING_CAPTURE_DIRECTORY
      ||readFileSync(path.join(directory,'owner.txt'),'utf8')!==relative) {
      throw Error('Maintenance capture requires its explicit ignored output directory');
    }
    mkdirSync(directory,{recursive:true});
    const state = expect.getState();
    const row = {phase:before.pendingResolution.type, name:state.currentTestName,
      source:path.relative(process.cwd(),state.testPath??'').replaceAll('\\','/'),
      world:before,command:request,catalogMethods:Object.keys(catalog).filter(key=>typeof catalog[key]==='function'),
      dieAware:typeof env.rng.rollDie==='function',calls,result:clone(result)};
    const data = JSON.stringify(row), hash=createHash('sha256').update(data).digest('hex');
    const file=path.join(directory,`${row.phase}-${hash}.json`);
    if (!existsSync(file)) writeFileSync(file,data,{flag:'wx'});
    return result;
  }};
});
