package migrations

import("encoding/json";"fmt";"testing")

func TestEntityTags258MigratesLegacyAndSeedsDataPools(t *testing.T){
 db:=openIsolatedPostgresSchema(t,"CONTENT_MIGRATION_TEST_DSN")
 for _,table:=range []string{"cards","actions","effects","spells","feats","backgrounds","races","classes"}{
  columns:="id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tags jsonb";if table=="cards"{columns+=",card_number text,rarity text,price integer,is_template text,deleted_at timestamptz"}
  if _,e:=db.Exec(fmt.Sprintf("CREATE TABLE %s(%s)",table,columns));e!=nil{t.Fatal(e)}
 }
 var seed []struct{CardNumber string `json:"card_number"`};if e:=json.Unmarshal(entityTags258Seed,&seed);e!=nil{t.Fatal(e)}
 for _,r:=range seed{if _,e:=db.Exec(`INSERT INTO cards(card_number,rarity,price,is_template,tags) VALUES($1,'common',3,'false','[" Старый тег ","Старый тег"]')`,r.CardNumber);e!=nil{t.Fatal(e)}}
 for _,number:=range []string{"CARD-0839","CARD-0728","CARD-0749"}{db.Exec(`INSERT INTO cards(card_number,rarity,price,is_template) VALUES($1,'common',1,'false')`,number)}
 if _,e:=db.Exec(`INSERT INTO feats(tags) VALUES('["Вторая сущность"]')`);e!=nil{t.Fatal(e)}
 if e:=createEntityTags258(db);e!=nil{t.Fatal(e)}
 var n int;if e:=db.QueryRow(`SELECT count(*) FROM legacy_entity_tags_258`).Scan(&n);e!=nil||n!=len(seed)+1{t.Fatalf("archive %d %v",n,e)}
 if e:=db.QueryRow(`SELECT count(*) FROM entity_tag_definitions WHERE name='Старый тег'`).Scan(&n);e!=nil||n!=1{t.Fatal("tags must normalize and deduplicate",e)}
 if e:=db.QueryRow(`SELECT count(*) FROM entity_tag_assignments WHERE tag_id='d2580000-0000-4000-8000-000000000001'`).Scan(&n);e!=nil||n!=len(seed){t.Fatal("pool seed",n,e)}
 if e:=db.QueryRow(`SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='tags' AND table_name!='legacy_entity_tags_258'`).Scan(&n);e!=nil||n!=0{t.Fatal("legacy column remains",n,e)}
}
