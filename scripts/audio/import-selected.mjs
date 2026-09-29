// Local asset preparation only: never contacts the generator, object storage, or a database.
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = async file => JSON.parse((await readFile(path.join(root, file), 'utf8')).replace(/^\uFEFF/, ''));
const selected = await readJson('outputs/audio-workbench/selected-for-game.json');
const prompts = await readJson('scripts/audio/workbench/prompts.json');
const target = 'backend/audiopresentation/catalog.json';
const catalog = await readJson(target);
const animations = await readJson('backend/animationpresentation/catalog.json');
if (selected.entries.length !== prompts.entries.length || new Set(selected.entries.map(row => row.key)).size !== prompts.entries.length) throw new Error('Choose exactly one file for every sound before importing.');
const assetDir = path.join(root, 'frontend/public/audio/combat-v2');
await mkdir(assetDir, {recursive:true});
const provenance = [];
const cues = [];
for (const selection of selected.entries) {
  const prompt = prompts.entries.find(row => row.key === selection.key);
  if (!prompt || !/^audio\/[a-f0-9-]{36}\.mp3$/.test(selection.file)) throw new Error('Invalid selected audio reference.');
  const source = path.join(root, 'outputs/audio-workbench', selection.file);
  const audio = await readFile(source);
  const sha256 = createHash('sha256').update(audio).digest('hex');
  if (sha256 !== selection.sha256) throw new Error(`Selected file changed: ${selection.key}`);
  const filename = `${selection.key.replaceAll('.', '_')}.${sha256.slice(0,12)}.mp3`;
  await copyFile(source, path.join(assetDir, filename));
  const url = `/audio/combat-v2/${filename}`;
  cues.push({key:selection.key,name:prompt.nameRu,channel:'effects',url,gain:0.72,loop:false,
    license:'Generated with ElevenLabs Sound Effects; source and generation details in audiopresentation/provenance.json',version:2});
  provenance.push({...selection,url,provider:'ElevenLabs',modelId:selected.modelId,source:'https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert'});
}
const keys = new Set(cues.map(cue => cue.key));
for (const [profile, phases] of Object.entries(catalog.profiles)) {
  for (const cue of Object.values(phases)) if (!keys.has(cue)) throw new Error(`Unknown cue in ${profile}: ${cue}`);
}
const bindings = animations.bindings.flatMap(binding => Object.entries(catalog.profiles[binding.profile_key] ?? {}).map(([event,cue_key]) => ({entity_type:binding.entity_type,entity_id:binding.entity_id,event,cue_key})));
// Authored exceptions identify entities in data, never in playback code.
for (const override of catalog.bindingOverrides ?? []) {
  const index = bindings.findIndex(row => row.entity_type === override.entity_type && row.entity_id === override.entity_id && row.event === override.event);
  if (index < 0) bindings.push(override); else bindings[index] = override;
}
catalog.cues = [...cues, ...(catalog.cues ?? []).filter(cue => cue.channel === 'music')];
catalog.bindings = bindings;
await writeFile(path.join(root, target), `${JSON.stringify(catalog,null,2)}\n`);
await writeFile(path.join(root,'backend/audiopresentation/provenance.json'), `${JSON.stringify({version:2,service:selected.service,entries:provenance},null,2)}\n`);
console.log(JSON.stringify({selected:cues.length,entityPhaseBindings:bindings.length,profiles:Object.keys(catalog.profiles).length,assets:'frontend/public/audio/combat-v2'}));
