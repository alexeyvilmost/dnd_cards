import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertRunId, assertLocalOrigin, assertRealOwnedPath, assertTestDsn, localFetch} from './guards.mjs';
import {readRegistry, runsRoot} from './runtime.mjs';

// Shared only inside this test process. Login itself remains a real HTTP call;
// credentials/tokens are never written to a report or accepted from a caller.
const authenticatedAccounts = new Map();

export async function localAcceptanceContext(env = process.env) {
  if (!env.TEST_RUN_DIRECTORY) throw new Error('Run this acceptance scenario through scripts/testing/stack.mjs');
  await assertRealOwnedPath(runsRoot, env.TEST_RUN_DIRECTORY);
  const registry = await readRegistry(env.TEST_RUN_DIRECTORY);
  assertRunId(registry.runId);
  if (registry.runId !== env.TEST_RUN_ID || registry.status !== 'ready') throw new Error('A ready runner-owned local stack is required');
  assertTestDsn(env.TEST_DATABASE_URL, registry);
  const uiOrigin = assertLocalOrigin(env.TEST_UI_ORIGIN), apiOrigin = assertLocalOrigin(env.TEST_API_ORIGIN);
  if (uiOrigin !== registry.origins.ui || apiOrigin !== registry.origins.api) throw new Error('Acceptance origins do not match this run');
  if (![env.TEST_USERNAME, env.TEST_PASSWORD, env.TEST_ADMIN_USERNAME, env.TEST_ADMIN_PASSWORD].every(Boolean)) throw new Error('Runner-provisioned accounts are required');
  const output = path.join(registry.directory, 'acceptance'); await mkdir(output, {recursive: true});
  const accounts = {
    player: {username: env.TEST_USERNAME, password: env.TEST_PASSWORD}, admin: {username: env.TEST_ADMIN_USERNAME, password: env.TEST_ADMIN_PASSWORD},
    peer: env.TEST_PEER_USERNAME && env.TEST_PEER_PASSWORD ? {username: env.TEST_PEER_USERNAME, password: env.TEST_PEER_PASSWORD} : null,
  };
  return {registry, uiOrigin, apiOrigin, output, ...accounts,
    authenticate: async (role = 'player') => {
      if (!Object.hasOwn(accounts, role) || !accounts[role]) throw Error('Runner-provisioned account role required');
      await assertRealOwnedPath(runsRoot, env.TEST_RUN_DIRECTORY);
      const current = await readRegistry(env.TEST_RUN_DIRECTORY);
      if (current.runId !== registry.runId || current.status !== 'ready'
        || current.origins?.api !== apiOrigin || current.origins?.ui !== uiOrigin) throw Error('Owned authentication context is no longer ready');
      assertTestDsn(env.TEST_DATABASE_URL, current);
      const key = createHash('sha256').update(JSON.stringify([env.TEST_RUN_DIRECTORY,registry.runId,apiOrigin,role,accounts[role]])).digest('hex');
      if (!authenticatedAccounts.has(key)) {
        const pending = (async () => {
          const response = await localFetch(apiOrigin, '/api/auth/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(accounts[role])});
          if (response.status !== 200) throw Error(`Owned authentication returned HTTP ${response.status}`);
          const auth = await response.json();
          if (typeof auth.token !== 'string' || !auth.token || typeof auth.user?.id !== 'string') throw Error('Owned authentication response is invalid');
          return auth;
        })();
        authenticatedAccounts.set(key,pending);
        pending.catch(() => {if (authenticatedAccounts.get(key) === pending) authenticatedAccounts.delete(key);});
      }
      return structuredClone(await authenticatedAccounts.get(key));
    },
    request: (resource, options) => localFetch(apiOrigin, resource, options),
    isolateBrowser: async browserContext => {
      // Backend egress controls do not cover browser fonts/images/audio/CDNs.
      await browserContext.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['data:', 'blob:', 'about:'].includes(url.protocol) || [uiOrigin, apiOrigin].includes(url.origin) ? route.continue() : route.abort('blockedbyclient');
      });
    }};
}
