import {defineConfig} from '@playwright/test';

// Run against a separately supervised local Vite server. This dev fixture is
// deliberately not shipped as an application route or production build entry.
export default defineConfig({
  testDir:'./e2e', testMatch:'battle-3d.spec.ts', workers:1, retries:0, timeout:60_000,
  reporter:[['list']], outputDir:'test-results/battle-3d',
  projects:[{name:'battle3d-local'}],
  use:{
    baseURL:process.env.BATTLE_3D_BASE_URL || 'http://127.0.0.1:3000',
    channel:'chrome', viewport:{width:1440,height:1100},
    trace:'retain-on-failure', screenshot:'only-on-failure',
    launchOptions:{args:['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']},
  },
});
