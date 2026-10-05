BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '250ms';
SET LOCAL search_path = pg_catalog;
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'database_bytes', pg_database_size(current_database()),
  'collected_at', clock_timestamp(),
  'stats_reset', d.stats_reset,
  'database_counters', json_build_object('commits', d.xact_commit, 'rollbacks', d.xact_rollback, 'blocks_read', d.blks_read, 'blocks_hit', d.blks_hit, 'deadlocks', d.deadlocks),
  'pg_stat_statements_installed', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'),
  'relations', coalesce((SELECT json_agg(row_to_json(r) ORDER BY r.total_bytes DESC) FROM (
    SELECT s.relname AS name, c.relkind AS kind,
      pg_total_relation_size(s.relid) AS total_bytes,
      pg_table_size(s.relid) AS table_bytes,
      pg_relation_size(s.relid) AS heap_main_bytes,
      CASE WHEN c.reltoastrelid = 0 THEN 0 ELSE pg_total_relation_size(c.reltoastrelid) END AS toast_with_index_bytes,
      pg_indexes_size(s.relid) AS index_bytes,
      s.n_live_tup AS live_rows_estimate, s.n_dead_tup AS dead_rows_estimate,
      s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
      s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
    FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
    WHERE s.schemaname = 'public'
  ) r), '[]'::json),
  'indexes', coalesce((SELECT json_agg(row_to_json(i) ORDER BY i.bytes DESC) FROM (
    SELECT s.relname AS relation, s.indexrelname AS name, pg_relation_size(s.indexrelid) AS bytes,
      s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
      x.indisprimary AS is_primary, x.indisunique AS is_unique, x.indisvalid AS is_valid,
      x.indisready AS is_ready, x.indisreplident AS is_replica_identity,
      (SELECT count(*) FROM pg_depend dep WHERE dep.refclassid='pg_class'::regclass AND dep.refobjid=s.indexrelid) AS dependants,
      jsonb_build_object('table',s.relid,'access_method',ic.relam,'keys',x.indkey::text,'operator_classes',x.indclass::text,
        'collations',x.indcollation::text,'options',x.indoption::text,'key_columns',x.indnkeyatts,'all_columns',x.indnatts,
        'predicate',pg_get_expr(x.indpred,x.indrelid),'expressions',pg_get_expr(x.indexprs,x.indrelid),
        'unique',x.indisunique,'nulls_not_distinct',x.indnullsnotdistinct,'tablespace',ic.reltablespace,'storage_options',ic.reloptions)::text AS semantic_definition,
      (x.indexprs IS NULL AND x.indpred IS NULL AND x.indnkeyatts=x.indnatts AND am.amname='btree') AS is_simple_btree,
      pg_get_indexdef(s.indexrelid) AS definition
    FROM pg_stat_user_indexes s JOIN pg_index x ON x.indexrelid = s.indexrelid JOIN pg_class ic ON ic.oid=s.indexrelid JOIN pg_am am ON am.oid=ic.relam
    WHERE s.schemaname = 'public'
  ) i), '[]'::json),
  'constraints', coalesce((SELECT json_agg(json_build_object('relation', c.relname, 'name', k.conname, 'type', k.contype))
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'), '[]'::json)
)
FROM pg_stat_database d WHERE d.datname = current_database();
ROLLBACK;
