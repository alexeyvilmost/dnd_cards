import {readFileSync} from 'node:fs';
import path from 'node:path';

const shellFiles=['index.html','site_logo.png','pwa-192x192.png','pwa-512x512.png','manifest.webmanifest','registerSW.js'];
const shellFont=file=>/\/(?:inter|pangolin)-(?:cyrillic|latin)-(?!ext-)[^/]+\.woff2$/.test(file);

// Only static imports form the initial shell. An unrelated lazy route called
// index-*.js must not become an installation dependency because of its name.
export function shellPrecache(entries,bundle){
  const root=bundle['index.html'];
  if(!root?.isEntry)throw Error('PWA shell requires the generated Vite entry manifest');
  const required=new Set(shellFiles.filter(file=>entries.some(entry=>entry.url===file))),visited=new Set();
  function visit(key){
    if(visited.has(key))return;visited.add(key);
    const chunk=bundle[key];if(!chunk?.file)throw Error(`Missing PWA static import: ${key}`);
    required.add(chunk.file);
    for(const file of chunk.css??[])required.add(file);
    for(const file of chunk.assets??[])if(!/\.(?:woff2?|ttf|otf)$/.test(file)||shellFont(file))required.add(file);
    for(const dependency of chunk.imports??[])visit(dependency);
  }
  visit('index.html');
  for(const entry of entries)if(shellFont(entry.url))required.add(entry.url);
  const urls=new Set(entries.map(entry=>entry.url));
  for(const file of required)if(!urls.has(file))throw Error(`PWA shell asset was omitted: ${file}`);
  if(!urls.has('index.html'))throw Error('PWA shell HTML is missing');
  return {manifest:entries.filter(entry=>required.has(entry.url)),warnings:[]};
}

export function createShellPrecacheTransform(directory){
  return async entries=>shellPrecache(entries,JSON.parse(readFileSync(path.join(typeof directory==='function'?directory():directory,'.vite/manifest.json'),'utf8')));
}
