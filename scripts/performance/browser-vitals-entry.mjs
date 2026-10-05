import {onINP} from 'web-vitals';

// Installed before the document's first interaction. No selectors, URLs,
// element text, auth, request bodies, or React props leave the page.
onINP(metric => {
  window.__recordLocalINP({name: metric.name, value: metric.value,
    delta: metric.delta, rating: metric.rating, navigationType: metric.navigationType,
    visibility: document.visibilityState,
    interactionCount: Number.isFinite(performance.interactionCount) ? performance.interactionCount : null,
    entries: metric.entries.map(entry => ({startTime: entry.startTime, duration: entry.duration,
      interactionId: entry.interactionId, processingStart: entry.processingStart, processingEnd: entry.processingEnd}))});
}, {reportAllChanges: true});
window.__localReactProfiles = [];
addEventListener('dnd:react-profile', event => {
  const row = event.detail;
  if (!['SheetEquipmentPanel', 'TacticalBattleMap'].includes(row?.id)) return;
  if (!['mount', 'update', 'nested-update'].includes(row.phase)) return;
  const values = ['actualDuration', 'baseDuration', 'startTime', 'commitTime'];
  if (!values.every(key => Number.isFinite(row[key]) && row[key] >= 0)) return;
  if (window.__localReactProfiles.length >= 20000) throw Error('Local React profile capacity exceeded');
  window.__localReactProfiles.push({id: row.id, phase: row.phase, ...Object.fromEntries(values.map(key => [key, row[key]]))});
});
