import assert from 'node:assert/strict';
import {isIP} from 'node:net';

// Bind a probe to the currently launched owned container. Reused DNS aliases
// are not authority across stop/start generations of the fixture.
export function ownedPeerHttpURL(url,{alias,port,name,owner,network,imageId,container}) {
  const target=new URL(url);
  assert.equal(target.protocol,'http:');assert.equal(target.hostname,alias);
  assert.equal(target.port,String(port));assert.equal(target.username,'');assert.equal(target.password,'');
  assert.equal(container.Name,'/'+name);assert.equal(container.Config?.Labels?.['bagofholding.compact-writer'],owner);
  assert.equal(container.State?.Running,true);assert.equal(container.Image,imageId);assert.equal(container.Config.Image,imageId);
  assert.deepEqual(Object.keys(container.NetworkSettings?.Networks??{}),[network]);
  assert.ok(!Object.values(container.NetworkSettings?.Ports??{}).some(value=>value?.length));
  const endpoint=container.NetworkSettings.Networks[network];
  assert.ok(endpoint.Aliases?.includes(alias));assert.equal(isIP(endpoint.IPAddress),4,'Current owned IPv4 endpoint required');
  target.hostname=endpoint.IPAddress;
  return target.href;
}
