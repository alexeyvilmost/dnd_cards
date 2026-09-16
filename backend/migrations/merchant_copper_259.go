package migrations

import "database/sql"

// Explicit economy data correction. Receipts, checkpoints and combat artifacts
// remain untouched; old offers without a currency still mean gold.
func merchantCopper259(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
 CREATE TABLE merchant_copper_259_archive(kind text NOT NULL,id text NOT NULL,data jsonb NOT NULL,PRIMARY KEY(kind,id));
 INSERT INTO merchant_copper_259_archive SELECT 'card',id::text,to_jsonb(c) FROM cards c WHERE card_number IN ('CARD-0728','CARD-0749') AND deleted_at IS NULL;
 INSERT INTO merchant_copper_259_archive SELECT 'rule',r.card_id::text,to_jsonb(r) FROM roguelike_item_rules r JOIN cards c ON c.id=r.card_id WHERE c.card_number IN ('CARD-0728','CARD-0749') AND c.deleted_at IS NULL;
 UPDATE cards SET price=5,price_currency='copper' WHERE card_number IN ('CARD-0728','CARD-0749') AND deleted_at IS NULL;
 UPDATE roguelike_item_rules r SET quantity=1,price=NULL FROM cards c WHERE c.id=r.card_id AND c.card_number IN ('CARD-0728','CARD-0749') AND c.deleted_at IS NULL;
 INSERT INTO merchant_copper_259_archive SELECT 'shop',id::text,shop FROM roguelike_runs WHERE status='active';
 UPDATE roguelike_runs r SET shop=jsonb_set(jsonb_set(r.shop,'{staples}',
  COALESCE((SELECT jsonb_agg(CASE WHEN c.id IS NOT NULL AND NOT COALESCE((o->>'sold')::boolean,false) THEN o || jsonb_build_object('price',5,'price_currency','copper','quantity',1,'name',c.name) ELSE o END ORDER BY ord)
   FROM jsonb_array_elements(r.shop->'staples') WITH ORDINALITY s(o,ord) LEFT JOIN cards c ON c.id::text=o->>'card_id' AND c.card_number IN ('CARD-0728','CARD-0749') AND c.deleted_at IS NULL),'[]'::jsonb)),
  '{offers}',COALESCE((SELECT jsonb_agg(CASE WHEN c.id IS NOT NULL AND NOT COALESCE((o->>'sold')::boolean,false) THEN o || jsonb_build_object('price',5,'price_currency','copper','quantity',1,'name',c.name) ELSE o END ORDER BY ord)
   FROM jsonb_array_elements(r.shop->'offers') WITH ORDINALITY s(o,ord) LEFT JOIN cards c ON c.id::text=o->>'card_id' AND c.card_number IN ('CARD-0728','CARD-0749') AND c.deleted_at IS NULL),'[]'::jsonb)), revision=revision+1
 WHERE status='active';
 `)
	if err != nil {
		return err
	}
	return tx.Commit()
}
