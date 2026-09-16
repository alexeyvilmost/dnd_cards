import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {replayCombatRecords} from '../../frontend/worker/replay.mjs';
const require=createRequire(import.meta.url);
const snapshot=JSON.parse(await readFile('outputs/cover-symmetry/battle-before.json','utf8'));
const groups=[];
for(const {record} of snapshot.events){if(record.baseline)groups.push([]);groups.at(-1).push(record);}
const report=[];
for(const records of groups){
 const artifact=require(`../../outputs/rules-artifacts-251/${records[0].artifactHash.slice(7)}.cjs`);
 const {envelope,commands}=replayCombatRecords(records,artifact);
 report.push({commands,map:envelope.state.battleMap, tokens:envelope.state.tokens,
  attacks:envelope.state.log.filter(l=>l.records?.some(r=>r.event?.type==='roll'&&r.event.roll?.target?.type==='ac')).map(l=>({text:l.text,records:l.records})),
  pending:envelope.state.world.pendingResolution});
}
await writeFile('outputs/cover-symmetry/replay-report.json',JSON.stringify(report,null,2));
for(const r of report){console.log('MAP',r.map.id,'commands',r.commands);for(const a of r.attacks)console.log(a.text);}
