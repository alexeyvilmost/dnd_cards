import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));

/** Official web-vitals algorithm (interaction grouping, page lifetime/p98,
 * lifecycle handling), rather than max(EventTiming.duration) under an INP name. */
export async function installBrowserVitals(context) {
  const observations = [];
  await context.exposeBinding('__recordLocalINP', (_source, value) => {
    assert.equal(value.name, 'INP');
    assert.ok(Number.isFinite(value.value) && value.value >= 0);
    observations.push(value);
  });
  const {build} = require('esbuild');
  const bundle = await build({entryPoints: [fileURLToPath(new URL('./browser-vitals-entry.mjs', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser', nodePaths: [fileURLToPath(new URL('../../frontend/node_modules', import.meta.url))]});
  await context.addInitScript({content: bundle.outputFiles[0].text});
  return {
    observations,
    async finish(page) {
      // Allow the browser's EventTiming delivery and the library's idle work
      // after the final scripted input. This delay is outside action timings.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestIdleCallback(resolve, {timeout:1000})))));
      await page.waitForTimeout(1000);
      const profiles = await page.evaluate(() => window.__localReactProfiles);
      assert.ok(observations.length > 0, 'No actual INP observation; unsupported/empty cannot pass');
      return {library: 'web-vitals@6.2.2', scope: 'page-lifetime INP at the end of a bounded scripted visit; not a field population percentile',
        boundary: 'reportAllChanges from before first input; snapshot after final input, two frames and idle delivery',
        observations, inp_ms: observations.at(-1).value, reactProfiles: profiles};
    },
  };
}
