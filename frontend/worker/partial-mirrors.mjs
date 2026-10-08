import {compactState} from './state-delta.mjs';
const fields=['world','catalogActions','actionPresentation','actorPresentation','log','battleMap','tokens','combatAreas','resourceBindings','resourceBindingsByActor'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function compactPartialMirrors(value) {
 const state=value.envelope?.state,snapshot=value.patch?.turn_state?.solo_combat_v1,mirrors=[];
 if(!state||!snapshot)return {value,mirrors};
	const result={...snapshot};let count=0;
 for(const field of fields) {
  const source=state[field],target=snapshot[field];if(!object(source)||!object(target))continue;
		const delta=compactState(target,source,value.trace.afterHash),added=delta.metadata.references.length+delta.metadata.arrayPrefixes.length;
		if(!added||count+added>4096)continue;
		count+=added;mirrors.push({field,delta:delta.metadata});result[field]=delta.state;
 }
	return {value:applyPartialMirrors(value,{snapshot:result}),mirrors};
}
// Called with private metadata calculated for the exact same prepared result.
export function applyPartialMirrors(value,prepared) {
	return {...value,patch:{...value.patch,turn_state:{...value.patch.turn_state,solo_combat_v1:prepared.snapshot}}};
}
