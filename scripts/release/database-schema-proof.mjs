import {evidenceHash} from './validate-manifest.mjs';

// The structure projection is exactly the historical recovery inventory's
// projection. It intentionally returns no artifact/media completeness claim.
export async function databaseSchemaLedgerProof(database) {
  const raw=await database.query(`SELECT json_build_object(
    'migrations',(SELECT coalesce(json_agg(version ORDER BY version),'[]'::json) FROM schema_migrations),
    'structure',(SELECT json_build_object(
    'columns',(SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) ORDER BY table_name,ordinal_position),'[]'::json) FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'test_run_ownership'),
    'constraints',(SELECT coalesce(json_agg(json_build_object('table',r.relname,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname),'[]'::json) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname <> 'test_run_ownership'),
    'indexes',(SELECT coalesce(json_agg(json_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname),'[]'::json) FROM pg_indexes WHERE schemaname='public' AND tablename <> 'test_run_ownership'))));`,undefined,{sensitive:true});
  const value=JSON.parse(raw.trim());
  if(!Array.isArray(value.migrations)||value.migrations.some(id=>typeof id!=='string')||!value.structure||!['columns','constraints','indexes'].every(key=>Array.isArray(value.structure[key])))throw Error('Invalid schema/ledger proof');
  return {scope:'schema-and-ledger',migrations:value.migrations,schemaFingerprint:evidenceHash(value.structure)};
}
