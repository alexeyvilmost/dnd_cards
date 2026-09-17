// Upload only this task's original audio assets; no production DB access.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
const env={...process.env};
for(const path of ['.env','backend/.env'])try{for(const line of (await readFile(path,'utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}catch{}
const access=env.YANDEX_CLOUD_ACCESS_KEY_ID,secret=env.YANDEX_CLOUD_SECRET_ACCESS_KEY,bucket=env.YANDEX_CLOUD_BUCKET_NAME||'dnd-cards-images';
if(!access||!secret||!bucket)throw Error('Yandex storage credentials missing (values are not logged)');
const hash=x=>createHash('sha256').update(x).digest('hex'),hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const region=env.YANDEX_CLOUD_REGION||'ru-central1';
const rows=JSON.parse(await readFile('outputs/audio-260/manifest.json','utf8'));
for(const row of rows){
 const data=await readFile(`outputs/audio-260/${row.file}`),key=`audio/roguelike-v1/${row.file}`;
 const host='storage.yandexcloud.net',path=`/${bucket}/${key}`,date=new Date().toISOString().replace(/[-:]|\.\d{3}/g,''),day=date.slice(0,8),digest=hash(data);
 const headers={'content-type':'audio/wav',host,'x-amz-acl':'public-read','x-amz-content-sha256':digest,'x-amz-date':date};
 const names=Object.keys(headers).sort(),canonical=names.map(k=>`${k}:${headers[k]}\n`).join(''),signed=names.join(';'),scope=`${day}/${region}/s3/aws4_request`;
 const request=`PUT\n${path}\n\n${canonical}\n${signed}\n${digest}`;
 const signingKey=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
 const signature=createHmac('sha256',signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(request)}`).digest('hex');
 const response=await fetch(`https://${host}${path}`,{method:'PUT',headers:{...headers,Authorization:`AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed}, Signature=${signature}`},body:data});
 if(!response.ok)throw Error(`Upload ${row.key}: HTTP ${response.status}`);
 row.url=`https://${host}${path}`;
 const check=await fetch(row.url,{method:'HEAD'});if(!check.ok||Number(check.headers.get('content-length'))!==data.length)throw Error(`Public verification failed: ${row.key}`);
 console.log(`Uploaded and verified ${row.key}`);
}
// Generated seed with public URLs only, embedded by migration 260.
await writeFile('backend/migrations/audio_260_seed.json',JSON.stringify(rows,null,2)+'\n');
