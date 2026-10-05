#!/usr/bin/env node
// Local operator utility. Do not upload the Sota account key to the server.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {sotaEgressConfiguration} from './sota-config.mjs';

try {
  const [environmentFile,deviceFile,outputDirectory,...extra]=process.argv.slice(2);
  if(!environmentFile||!deviceFile||!outputDirectory||extra.length)throw Error('Expected environment file, stable device ID file and new private output directory');
  const source=await readFile(environmentFile,'utf8');
  const key=(source.match(/^SOTA_ID\s*=\s*(.*)$/m)?.[1]??'').trim().replace(/^(["'])([\s\S]*)\1$/,'$2');
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))throw Error('Configured Sota key required');
  const output=path.resolve(outputDirectory);
  await mkdir(output,{mode:0o700});
  let hardwareID;
  try {hardwareID=(await readFile(deviceFile,'utf8')).trim();}
  catch(error){if(error.code!=='ENOENT')throw error;hardwareID=randomBytes(32).toString('hex');await writeFile(deviceFile,hardwareID,{mode:0o600,flag:'wx'});}
  if(!/^[a-f0-9]{64}$/.test(hardwareID))throw Error('Invalid stable device ID');
  const headers={'x-access-key':key,'x-hwid':hardwareID,'content-type':'application/json','user-agent':'BagOfHolding Sota integration (linux; dedicated image egress)'};
  // Host/routes verified against the official Linux application on 2026-10-05.
  const base='https://meowconnect.com/api/v1/public';
  async function request(route){
    const response=await fetch(`${base}${route}`,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Sota request rejected');
    return response.json();
  }
  const locations=await request('/connection/list');
  const location=Array.isArray(locations)&&locations.find(row=>row.shortname?.toLowerCase()==='fi'&&row.gateways?.length);
  if(!location)throw Error('Reviewed Finland gateway unavailable');
  const query=new URLSearchParams({gate_id:location.id,gateway_name:location.gateways[0].name});
  const response=await request(`/connection/connect?${query}`);
  const auth={username:'openai',password:randomBytes(32).toString('hex')};
  const config=sotaEgressConfiguration(response.configuration,auth);
  // Private output contains no subscription master key or full provider profile.
  for(const [name,value] of [['gateway.json',config],['proxy-auth.json',auth],['selection.json',{country:'fi',source:'official Sota application API',preparedAt:new Date().toISOString()}]]){
    await writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  await writeFile(path.join(output,'device-id'),hardwareID,{mode:0o600,flag:'wx'});
  console.log('Restricted Sota configuration prepared in the requested private directory.');
} catch {
  // Never serialize fetch errors/URLs, subscription data, or profile contents.
  console.error('Sota preparation failed. Check the account and private paths; retain any partial output for inspection.');
  process.exitCode=1;
}
