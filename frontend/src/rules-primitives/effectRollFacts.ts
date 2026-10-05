/** Outcome facts are derived from canonical payloads, including nested choices.
 * They are never supplied by the target's response or by item names. */
export function effectRollFacts(value:unknown,side:'acting'|'defending'='defending'):Record<string,unknown>{
 const kinds=new Set<string>();
 const visit=(node:unknown):void=>{
  if(Array.isArray(node)){node.forEach(visit);return;}
  if(!node||typeof node!=='object')return;
  const row=node as Record<string,unknown>;
  if(row.kind==='movement'&&['push','pull'].includes(String(row.value))&&Number(row.distance??1)>0)kinds.add('forced_movement');
  if(row.kind==='world_interaction'&&row.operation==='drop_held_item')kinds.add('disarm');
  if(row.kind==='condition'&&row.value==='prone')kinds.add('prone');
  if(row.kind==='condition'&&row.value==='grappled')kinds.add('grapple');
  Object.values(row).forEach(visit);
 };
 visit(value);
 return side==='acting'?{...(kinds.has('grapple')?{purpose:'grapple'}:kinds.has('forced_movement')||kinds.has('prone')?{purpose:'shove'}:{})}:{
  ...(kinds.has('forced_movement')?{against_forced_movement:true}:{}),...(kinds.has('disarm')?{against_disarm:true}:{}),...(kinds.has('prone')?{against_prone:true}:{}),
 };
}
