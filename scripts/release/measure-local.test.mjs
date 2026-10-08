import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {components, ignorePolicy, inventory, copyInputs, checkEmbeddedInputs, validateImagePins} from './measure-local.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const read = name => readFileSync(path.join(repo, name), 'utf8');
const policies = Object.fromEntries(Object.entries(components).map(([name, spec]) => [name, ignorePolicy(read(spec.ignore))]));
const fakeFile = (name, hash = name) => ({path: name, bytes: 1, sha256: hash});

test('ignore matching keeps ordered negation, ancestor exclusions and recursive wildcard semantics', () => {
  const policy = ignorePolicy('**\n!src/**\nsrc/private\n!src/private/allowed.json\n**/*.test.ts\n');
  assert.equal(policy.descend('src'), true);
  assert.equal(policy.includes('src/main.ts'), true);
  assert.equal(policy.includes('src/deep/rule.ts'), true);
  assert.equal(policy.includes('src/main.test.ts'), false);
  assert.equal(policy.includes('src/private/no.json'), false);
  assert.equal(policy.includes('src/private/allowed.json'), true);
  assert.equal(policy.includes('outside.ts'), false);
  assert.throws(() => ignorePolicy('[abc]'), /Unsupported/);
});

test('all policies reject secrets, local dependencies, dumps and experiment directories', () => {
  for (const [name, policy] of Object.entries({...policies, root: ignorePolicy(read('.dockerignore')), legacyFrontend: ignorePolicy(read('frontend/.dockerignore'))})) {
    for (const prefix of ['', 'frontend/', 'frontend/src/', 'migrations/']) {
      for (const candidate of ['.env', '.env.production', 'node_modules/package/index.js', '.git/config', 'tmp/a.json', 'output/a.png', 'outputs/snapshot.sql', 'backups/db.dump', '.local-postgres/data/pg_control']) {
        assert.equal(policy.includes(prefix + candidate), false, `${name}: ${prefix}${candidate}`);
      }
    }
  }
});

test('production source, raw Markdown, embed data and asset licenses remain available', () => {
  for (const candidate of ['frontend/src/rules-core/handler.ts', 'frontend/src/rules-core/coverage/microMvpEvidence.ts', 'frontend/src/rules-primitives/newRule.ts', 'frontend/utils/weapon_types.json', 'frontend/charges/charges.json']) {
    assert.equal(policies.frontend.includes(candidate), true, candidate);
    assert.equal(policies.worker.includes(candidate), true, candidate);
  }
  for (const candidate of ['frontend/src/engine/README.md', 'frontend/public/assets/dice-box/LICENSE', 'frontend/public/audio/music/new.ogg', 'backend/audiopresentation/catalog.json']) assert.equal(policies.frontend.includes(candidate), true, candidate);
  for (const candidate of ['main.go', 'generated_image_service.go', 'migrations/new_manifest.json', 'migrations/data/new/entities.json', 'migrations/entity_references_277.sql']) assert.equal(policies.backend.includes(candidate), true, candidate);
  for (const candidate of ['scripts/release/plan-components.mjs', 'scripts/release/component-dependencies.json', 'backend/animationpresentation/catalog.json']) assert.equal(policies.worker.includes(candidate), true, candidate);
  for (const candidate of ['frontend/public/audio/a.ogg', 'frontend/charges/main_action.png', 'frontend/src/components/App.tsx', 'scripts/testing/fixtures/schema.sql', 'frontend/worker/server.test.mjs']) assert.equal(policies.worker.includes(candidate), false, candidate);
  for(const candidate of ['frontend/src/rules-core/testing/fixtures/pending-lifecycle-v1/handler.cjs.gz',
    'frontend/src/rules-core/testing/fixtures/event-queue-v1/corpus.json.gz','frontend/src/rules-core/testing/pendingReplay.mjs',
    'frontend/src/rules-core/testing/pendingReplay.d.mts','frontend/src/roguelike/testing/currentPinnedFixture.ts']) {
    for(const name of ['frontend','worker'])assert.equal(policies[name].includes(candidate),false,`${name}: frozen test-only input ${candidate}`);
  }
});

test('clean snapshot inventory includes allowed untracked additions, no stale generated output', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rel02-inventory-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const file of ['src/main.ts', 'src/newRule.ts', 'src/main.test.ts', 'src/.env', 'tmp/snapshot.json', 'node_modules/module/index.js']) {
    mkdirSync(path.dirname(path.join(directory, file)), {recursive: true}); writeFileSync(path.join(directory, file), 'local fixture');
  }
  const files = inventory(directory, ignorePolicy('**\n!src/**\n**/*.test.ts\n**/.env\n'));
  assert.deepEqual(files.map(file => file.path), ['src/main.ts', 'src/newRule.ts']);
});

test('COPY closure rejects deleted inputs and does not count previous-stage output as source', () => {
  const source = 'FROM node AS build\nCOPY package.json package-lock.json ./\nCOPY src ./src\nFROM nginx\nCOPY --from=build /app/dist /html\n';
  const files = ['package.json', 'package-lock.json', 'src/main.ts'].map(file => fakeFile(file));
  assert.equal(copyInputs(source, files).length, 2);
  assert.throws(() => copyInputs(source, files.filter(file => file.path !== 'package-lock.json')), /COPY input missing/);
  assert.throws(() => copyInputs('COPY ../secret ./', files), /Unsafe COPY/);
});

test('input fingerprints distinguish UI, media, shared engine and dependency changes', () => {
  const source = 'FROM node AS dependencies\nCOPY frontend/package.json frontend/package-lock.json ./\nFROM dependencies AS build\nCOPY frontend/src ./src\nFROM nginx AS runtime\nCOPY frontend/public /html\nCOPY --from=build /app/dist /html\n';
  const files = ['frontend/package.json', 'frontend/package-lock.json', 'frontend/src/App.tsx', 'frontend/src/rules-core/handler.ts', 'frontend/public/audio/theme.ogg'].map(file => fakeFile(file));
  const original = copyInputs(source, files);
  for (const [changed, expected] of [['frontend/package-lock.json', 0], ['frontend/src/App.tsx', 1], ['frontend/src/rules-core/handler.ts', 1], ['frontend/public/audio/theme.ogg', 2]]) {
    const modified = copyInputs(source, files.map(file => file.path === changed ? {...file, sha256: 'changed'} : file));
    assert.deepEqual(modified.map((copy, index) => copy.fingerprint !== original[index].fingerprint ? index : null).filter(index => index !== null), [expected]);
  }
});

test('real context inventories omit both mobile screens but retain changing shared engine input', t => {
  const root=mkdtempSync(path.join(tmpdir(),'rel02-mobile-inputs-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const write=(file,value)=>{const target=path.join(root,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,value);};
  const mobile=['frontend/src/mobile/MobileCharacterSheet.tsx','frontend/src/mobile/MobileLibrary.tsx'],engine='frontend/src/engine/cost.ts';
  for(const file of [...mobile,engine])write(file,'original');
  const before=inventory(root,policies.worker),frontend=inventory(root,policies.frontend);
  assert.deepEqual(before.map(file=>file.path),[engine]);for(const file of mobile)assert(frontend.some(row=>row.path===file));
  for(const file of mobile)write(file,'new screen text');assert.deepEqual(inventory(root,policies.worker),before);
  write(engine,'new rule operation');assert.notDeepEqual(inventory(root,policies.worker),before);
});

test('Go embed closure fails when a required SQL/JSON input is omitted', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rel02-embed-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  writeFileSync(path.join(directory, 'main.go'), 'package main\n//go:embed catalog/*.json\n');
  assert.throws(() => checkEmbeddedInputs(directory, [fakeFile('main.go')]), /Go embed missing/);
  assert.equal(checkEmbeddedInputs(directory, [fakeFile('main.go'), fakeFile('catalog/example.json')]).length, 1);
});

test('Dockerfiles retain full frontend production gate, lockfile installs and distinct caches', () => {
  assert.match(read('frontend/Dockerfile'), /^RUN npm run build$/m);
  assert.match(JSON.parse(read('frontend/package.json')).scripts.build, /\btsc\b.*vite build/);
  for (const [name, spec] of Object.entries(components)) {
    const dockerfile = read(spec.dockerfile);
    assert.match(dockerfile, new RegExp(`BUILD_CACHE_SCOPE=bagofholding-${name}`));
    assert.match(dockerfile, /--mount=type=cache/);
    assert.doesNotMatch(dockerfile, /ARG .*SECRET|ARG .*TOKEN|ARG .*PASSWORD|npm install/);
  }
});

test('measurement requires immutable runtime refs before actual benchmark builds', () => {
  assert.throws(() => validateImagePins({}), /digest-pinned/);
  const pins = Object.fromEntries(['GO_IMAGE', 'ALPINE_IMAGE', 'NODE_IMAGE', 'NGINX_IMAGE'].map(key => [key, `example.test/image@sha256:${'a'.repeat(64)}`]));
  assert.deepEqual(validateImagePins(pins), pins);
  assert.throws(() => validateImagePins({...pins, NODE_IMAGE: 'node:latest'}), /digest-pinned/);
  assert.throws(() => validateImagePins({...pins, API_TOKEN: 'not-a-build-arg'}), /Only public/);
});
