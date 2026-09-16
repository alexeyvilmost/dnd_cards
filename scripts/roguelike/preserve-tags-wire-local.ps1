# Complete the locally applied 258 migration's frozen wire-compatibility columns.
$ErrorActionPreference='Stop'
$taskConfig=Get-Content 'C:/Users/alexe/AppData/Local/dnd-cards-dev/local-env.json' -Raw|ConvertFrom-Json
$taskDb=[UriBuilder]$taskConfig.DATABASE_URL
if(-not $taskDb.Uri.IsLoopback){throw 'Local DB required'}
$taskDb.Path='shop_review_249_20260915'
$taskSQL=@'
BEGIN;
DO $$
DECLARE pair record;
BEGIN
 FOR pair IN SELECT * FROM (VALUES ('card','cards'),('action','actions'),('effect','effects'),('spell','spells'),('feat','feats'),('background','backgrounds'),('race','races'),('class','classes')) AS t(kind,tbl)
 LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS legacy_tags jsonb',pair.tbl);
  EXECUTE format('UPDATE %I c SET legacy_tags=a.tags FROM legacy_entity_tags_258 a WHERE a.entity_type=$1 AND a.entity_id=c.id::text AND c.legacy_tags IS NULL',pair.tbl) USING pair.kind;
 END LOOP;
END $$;
COMMIT;
'@
& 'C:/Users/alexe/AppData/Local/dnd-cards-dev/tools/postgresql-17.11/pgsql/bin/psql.exe' $taskDb.Uri.AbsoluteUri -X -v ON_ERROR_STOP=1 -c $taskSQL
if($LASTEXITCODE -ne 0){throw 'Wire compatibility update failed'}
