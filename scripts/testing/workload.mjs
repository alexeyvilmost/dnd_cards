// One workload inventory feeds execution, CI scheduling and global coverage.
export function suiteWorkload({selection, catalog, manifest, suite, select}) {
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
  return {suite,nodeFiles,vitestFiles,goGroups:selection.selected.filter(g=>g.runner==='go'),
    scripts:selection.selected.filter(g=>g.runner==='script'),browserGroups:selection.selected.filter(g=>g.runner==='playwright'),
    gates:suite==='extended'?(manifest.extended_gates??[]):[],fixtureFiles};
}
