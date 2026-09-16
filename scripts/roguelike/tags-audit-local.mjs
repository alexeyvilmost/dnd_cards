import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const env=JSON.parse(await readFile('C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json','utf8'));
if(!['localhost','127.0.0.1'].includes(new URL(env.DATABASE_URL).hostname)) throw Error('Local DB only');
const database=new URL(env.DATABASE_URL);database.pathname='/shop_review_249_20260915';env.DATABASE_URL=database.href;
const db={query:async sql=>{const r=spawnSync('C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe',[env.DATABASE_URL,'-X','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return {rows:r.stdout};},end:async()=>{}};
try {
 for(const table of ['cards','actions','effects','spells','feats','backgrounds','races','classes']) {
  const legacy=(await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' AND column_name='legacy_tags'`)).rows.trim();
  const column=legacy ? 'legacy_tags' : 'tags';
  console.log(table,(await db.query(`SELECT ${column}::text as tags,count(*)::int as n FROM ${table} WHERE ${column} IS NOT NULL GROUP BY ${column}::text`)).rows);
 }
 console.log((await db.query(`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_name IN ('passive_presentations','concepts','resource_definitions','variables') AND column_name IN ('id','key')`)).rows);
 console.log((await db.query(`SELECT card_number,price,price_currency,weapon_type,properties FROM cards WHERE card_number IN ('CARD-0728','CARD-0749','CARD-0839','CARD-0319','CARD-0327')`)).rows);
} finally {await db.end();}
