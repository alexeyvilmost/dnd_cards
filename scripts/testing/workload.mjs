// One workload inventory feeds execution, CI scheduling and global coverage.
import {assertFrontendEligibility} from '../release/ui-release-policy.mjs';
import {evidenceHash} from '../release/validate-manifest.mjs';
export function suiteWorkload({selection, catalog, manifest, suite, select,frontendPlanning}) {
  let nodeFiles=[...new Set(selection.selected.filter(g=>g.runner==='node').flatMap(g=>g.files??[]))];
  let vitestFiles=[...new Set(selection.selected.filter(g=>g.runner==='vitest').flatMap(g=>g.files??[]))];
  if(suite==='extended'){
    nodeFiles=catalog.filter(row=>row.runner==='node'&&row.tier!=='legacy-manual').map(row=>row.file);
    vitestFiles=catalog.filter(row=>row.runner==='vitest'&&row.tier!=='legacy-manual').map(row=>row.file);
  }else if(suite==='legacy-manual'){
    vitestFiles=catalog.filter(row=>row.suite===select&&row.runner==='vitest').map(row=>row.file);
    if(!vitestFiles.length)throw Error('Explicit legacy selector matched zero files');
  }
  const fixtureFiles=suite==='extended'?catalog.filter(row=>row.runner==='playwright'&&row.tier==='extended').map(row=>row.file):[];
  if(fixtureFiles.some(file=>!file.startsWith('frontend/e2e/')))throw Error('Unmapped mandatory browser file; add an owned runner profile');
  if(frontendPlanning){
    const proof=assertFrontendEligibility(frontendPlanning.eligibility,frontendPlanning.input);
    if(suite!=='core'||!selection.selected.some(group=>group.id==='local-api-spine'&&group.runner==='script')
      ||!selection.selected.some(group=>group.id==='local-browser-flows'&&group.runner==='playwright'))throw Error('Selective core must retain real API/browser groups');
    const available=new Set(catalog.filter(row=>row.runner==='vitest'&&row.tier!=='legacy-manual').map(row=>row.file));
    if(evidenceHash([...available].sort())!==evidenceHash([...frontendPlanning.input.testCatalog].sort()))throw Error('Current mandatory catalog differs from eligibility selection');
    if(proof.binding.affectedTests.some(file=>!available.has(file)))throw Error('Affected presentation test is not in mandatory catalog');
    vitestFiles=[...new Set([...vitestFiles,...proof.binding.affectedTests])].sort();
  }
  return {suite,nodeFiles,vitestFiles,goGroups:selection.selected.filter(g=>g.runner==='go'),
    scripts:selection.selected.filter(g=>g.runner==='script'),browserGroups:selection.selected.filter(g=>g.runner==='playwright'),
    gates:suite==='extended'?(manifest.extended_gates??[]):[],fixtureFiles};
}
