const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Invalid inventory identifier');return `"${value}"`;};
export async function collectDataURLInventory(database,{limit=100,maxValueBytes=2*1024*1024}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(maxValueBytes)||maxValueBytes<1||maxValueBytes>2*1024*1024)throw Error('Invalid data URL sampling bounds');
  const query=sql=>database.query(`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='250ms';${sql};ROLLBACK;`,undefined,{sensitive:true});
  const columns=JSON.parse((await query(`SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type)),'[]'::json) FROM information_schema.columns WHERE table_schema='public' AND (column_name IN ('image_url','image_url_spent','avatar_url','token_url','image_cloudinary_url') OR table_name='audio_cues' AND column_name='url' OR table_name='paper_documents' AND column_name='document')`)).replace(/^(?:BEGIN|SET|ROLLBACK)\r?\n/gm,'').trim());
  const results=[];
  for(const row of columns) {
    const table=identifier(row.table),column=identifier(row.column),json=['json','jsonb'].includes(row.type);
    if(!json&&!['text','character varying'].includes(row.type))continue;
    const values=json?`SELECT j #>> '{}' AS value FROM sample CROSS JOIN LATERAL (SELECT v AS j FROM jsonb_path_query(raw::jsonb,'$.** ? (@.type() == "string" && @ like_regex "^data:")') v LIMIT 128) q WHERE bytes<=${maxValueBytes}`:`SELECT raw::text AS value FROM sample WHERE bytes<=${maxValueBytes} AND left(raw::text,5)='data:'`;
    const sql=`WITH sample AS MATERIALIZED (SELECT ${column} AS raw,octet_length(${column}::text) AS bytes FROM public.${table} LIMIT ${limit}), entries AS (${values}) SELECT json_build_object('sampleRows',(SELECT count(*) FROM sample),'oversizedRowsOmitted',(SELECT count(*) FROM sample WHERE bytes>${maxValueBytes}),'entries',(SELECT coalesce(json_agg(row_to_json(m)),'[]'::json) FROM (SELECT coalesce(substring(value from '^data:([^;,]{1,100})[;,]'),'unknown') AS mime,count(*) AS count,sum(octet_length(value)) AS encoded_bytes,max(octet_length(value)) AS max_encoded_bytes,count(DISTINCT md5(value)) AS distinct_contents FROM entries GROUP BY 1)m))`;
    const result=JSON.parse((await query(sql)).replace(/^(?:BEGIN|SET|ROLLBACK)\r?\n/gm,'').trim());results.push({table:row.table,column:row.column,...result});
  }
  return {scope:'bounded-reference-metadata-only',limit,maxValueBytes,maxDataURLsPerJSONRow:128,rows:results,limitations:['First physical rows, not a representative or complete inventory.','Oversized values and JSON matches beyond the per-row cap are omitted.','Encoded data URL byte counts are logical, not additive physical disk size.','No body, URL, file, row ID or owner ID is exported.']};
}
