import {mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import base from './vite.config';

// Opt-in local diagnostic build. The regular release config never imports it.
// Production React disables Profiler callbacks; timing this build must always
// be labelled separately from the ordinary production bundle.
const components = ['SheetEquipmentPanel', 'TacticalBattleMap'];
const profilingRenderer = fileURLToPath(new URL('./node_modules/react-dom/profiling.js', import.meta.url));
export default mergeConfig({...base, plugins: base.plugins?.flat(Infinity).filter((plugin: any) => !plugin?.name?.startsWith('vite-plugin-pwa'))}, {
  resolve: {alias: [
    {find: /^react-dom\/client$/, replacement: profilingRenderer},
    {find: /^react-dom$/, replacement: profilingRenderer},
  ]},
  plugins: [{
    name: 'local-component-profiling', enforce: 'pre',
    // Profiling visits already block service workers. Keep the application
    // bootstrap import valid without generating a different PWA in this build.
    resolveId(id: string) {if (id === 'virtual:pwa-register') return '\0local-profiling-pwa';},
    load(id: string) {if (id === '\0local-profiling-pwa') return 'export const registerSW = () => async () => {};';},
    transform(source: string, id: string) {
      const name = components.find(component => id.replaceAll('\\', '/').endsWith(`/src/components/${component}.tsx`));
      if (!name) return null;
      const declaration = `export default function ${name}(`;
      if (source.split(declaration).length !== 2) throw Error(`Profiling seam changed: ${name}`);
      return {code: `import {Profiler as LocalProfiler} from 'react';\n${source.replace(declaration, `function ${name}(`)}
export default function LocalProfiled${name}(props: Parameters<typeof ${name}>[0]) {
  return <LocalProfiler id="${name}" onRender={(id, phase, actualDuration, baseDuration, startTime, commitTime) => {
    window.dispatchEvent(new CustomEvent('dnd:react-profile', {detail: {id, phase, actualDuration, baseDuration, startTime, commitTime}}));
  }}><${name} {...props} /></LocalProfiler>;
}\n`, map: null};
    },
  }],
});
