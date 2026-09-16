package main

import (
 "fmt"
 "net/http/httptest"
 "testing"
 "github.com/gin-gonic/gin"
 "github.com/google/uuid"
 "gorm.io/gorm"
)

func seedTaggedShopTest(t *testing.T,db *gorm.DB,cards ...Card) MerchantConfig {
 t.Helper();if err:=db.AutoMigrate(&Card{},&EntityTag{},&EntityTagAssignment{},&MerchantSettings{},&MerchantItemRule{});err!=nil{t.Fatal(err)}
 ids:=[]string{uuid.NewString(),uuid.NewString(),uuid.NewString()};for i,id:=range ids{if e:=db.Create(&EntityTag{ID:id,Name:fmt.Sprintf("pool-%d",i)}).Error;e!=nil{t.Fatal(e)}}
 cfg:=MerchantConfig{PoolTag:ids[0],StartingTag:ids[1],StapleTag:ids[2],SuppliesPrice:20,RefreshPrice:5}
 for level:=1;level<=5;level++{cfg.Levels=append(cfg.Levels,MerchantLevel{Level:level,Slots:5,MagicLimit:5,UncommonBP:10000})};data,_:=mapFromJSON(cfg);if e:=db.Create(&MerchantSettings{ID:1,Version:1,Config:data}).Error;e!=nil{t.Fatal(e)}
 for _,card:=range cards{
  var n int64;db.Model(&Card{}).Where("id=?",card.ID).Count(&n);if n==0{if e:=db.Create(&card).Error;e!=nil{t.Fatal(e)}}
  if e:=db.Create(&EntityTagAssignment{"card",card.ID.String(),cfg.PoolTag}).Error;e!=nil{t.Fatal(e)}
  price:=5;if e:=db.Create(&MerchantItemRule{CardID:card.ID.String(),MinLevel:1,Weight:1,Quantity:1,Kind:"equipment",Price:&price}).Error;e!=nil{t.Fatal(e)}
 };return cfg
}

func TestTaggedMerchantUsesNewEntitiesAndNoManifestFallback(t *testing.T){
 f:=openCharacterV3AccessFixture(t);price:=3.0
 a:=Card{ID:uuid.New(),Name:"New item A",Description:"test",CardNumber:"DATA-A",Rarity:RarityUncommon,Price:&price}
 b:=Card{ID:uuid.New(),Name:"New item B",Description:"test",CardNumber:"DATA-B",Rarity:RarityUncommon,Price:&price}
 cfg:=seedTaggedShopTest(t,f.db,a,b);run:=RoguelikeRun{ID:uuid.New(),RunSeed:"tag-test",EncountersWon:1}
 raw,e:=generateRoguelikeShop(f.db,&run,1,nil);if e!=nil{t.Fatal(e)};var shop RoguelikeShop;decodeJSONMap(raw,&shop)
 if len(shop.Offers)!=2{t.Fatalf("new metadata items not selected: %+v",shop)}
 if e=f.db.Where("entity_type='card' AND entity_id=?",a.ID.String()).Delete(&EntityTagAssignment{}).Error;e!=nil{t.Fatal(e)}
 raw,e=generateRoguelikeShop(f.db,&run,1,nil);if e!=nil{t.Fatal(e)};decodeJSONMap(raw,&shop);if len(shop.Offers)!=1||shop.Offers[0].CardID!=b.ID.String(){t.Fatalf("removed tag still participates: %+v",shop)}
 // Make the second entity unlimited, proving base stock is metadata as well.
 f.db.Create(&EntityTagAssignment{"card",b.ID.String(),cfg.StapleTag})
 raw,e=generateRoguelikeShop(f.db,&run,1,nil);if e!=nil{t.Fatal(e)};decodeJSONMap(raw,&shop);if len(shop.Offers)!=0||len(shop.Staples)!=2{t.Fatalf("unlimited stock: %+v",shop)}
 char:=CharacterV3{ID:uuid.New()};run.Character=&char;run.Gold=20;run.Shop=raw
 for i:=0;i<2;i++{if e=buyRoguelikeOffer(f.db,&run,"staple:"+b.ID.String());e!=nil{t.Fatal(e)}}
 if run.Gold!=10||(*char.InventoryItems)[0].Qty!=2{t.Fatalf("unlimited purchases: %+v",run.Shop)}
 // Starting equipment disappears from a newly generated post-victory shelf.
 f.db.Create(&EntityTagAssignment{"card",a.ID.String(),cfg.StartingTag});run.EncountersWon=0
 raw,e=generateRoguelikeShop(f.db,&run,1,nil);if e!=nil{t.Fatal(e)};decodeJSONMap(raw,&shop);if len(shop.Staples)!=3{t.Fatal("missing starting stock")}
 run.EncountersWon=1;raw,e=generateRoguelikeShop(f.db,&run,1,nil);if e!=nil{t.Fatal(e)};decodeJSONMap(raw,&shop);if len(shop.Staples)!=2{t.Fatal("starting stock leaked past first victory")}
}

func TestEntityTagFilterBeforePaginationAndDifferentEntityTypes(t *testing.T){
 f:=openCharacterV3AccessFixture(t);cfg:=seedTaggedShopTest(t,f.db)
 if e:=f.db.AutoMigrate(&Feat{});e!=nil{t.Fatal(e)}
 for i:=0;i<55;i++{id:=uuid.New();card:=Card{ID:id,Name:fmt.Sprint(i),Description:"test",CardNumber:fmt.Sprintf("TAG-%03d",i),Rarity:RarityCommon};if e:=f.db.Create(&card).Error;e!=nil{t.Fatal(e)};if i==54{f.db.Create(&EntityTagAssignment{"card",id.String(),cfg.PoolTag});f.db.Create(&EntityTagAssignment{"feat",uuid.NewString(),cfg.PoolTag})}}
 c,_:=gin.CreateTestContext(httptest.NewRecorder());c.Request=httptest.NewRequest("GET","/cards?tag="+cfg.PoolTag,nil)
 var rows []Card;var total int64;q:=entityTagFilter(f.db.Model(&Card{}),c,"card","cards");if e:=q.Count(&total).Error;e!=nil{t.Fatal(e)};if e:=q.Order("card_number").Limit(1).Find(&rows).Error;e!=nil{t.Fatal(e)}
 if total!=1||len(rows)!=1||rows[0].CardNumber!="TAG-054"{t.Fatalf("tag filtering must precede pagination: %d %+v",total,rows)}
}

func TestMerchantConfigProbabilitiesLimitsAndSparsePool(t *testing.T){
 entries:=[]roguelikeShopManifestEntry{};rarities:=map[string]string{}
 for i:=0;i<12;i++{id:=fmt.Sprint(i);entries=append(entries,roguelikeShopManifestEntry{CardNumber:id,MinLevel:1,Weight:1});rarities[id]="uncommon"}
 stock,e:=selectConfiguredMerchantStock("different-data",1,1,1,entries,rarities,"",MerchantLevel{Slots:10,MagicLimit:2,UncommonBP:10000});if e!=nil||len(stock)!=2{t.Fatalf("magic cap: %d %v",len(stock),e)}
 stock,e=selectConfiguredMerchantStock("different-data",1,1,1,nil,nil,"",MerchantLevel{Slots:5,MagicLimit:2,UncommonBP:10000});if e!=nil||len(stock)!=0{t.Fatal("empty pool must not fallback to hardcoded cards")}
 row:=MerchantLevel{UncommonBP:125,RareBP:10,EpicBP:3};counts:=map[string]int{};for i:=0;i<10000;i++{counts[row.rarity(i)]++};if counts["uncommon"]!=125||counts["rare"]!=10||counts["epic"]!=3{t.Fatal(counts)}
 cfg:=MerchantConfig{PoolTag:uuid.NewString(),StartingTag:uuid.NewString(),StapleTag:uuid.NewString()};for i:=1;i<=5;i++{cfg.Levels=append(cfg.Levels,MerchantLevel{Level:i,Slots:5,MagicLimit:2})};if e=validateMerchantConfig(cfg);e!=nil{t.Fatal(e)};cfg.Levels[0].RareBP=10001;if validateMerchantConfig(cfg)==nil{t.Fatal("accepted probability overflow")}
}

func TestWeaponClassificationWithoutLegacyTags(t *testing.T){
 typ:="weapon";for _,tc:=range []struct{weapon,mode,category string}{{"longbow","ranged","martial"},{"dart","ranged","simple"},{"longsword","melee","martial"},{"dagger","melee","simple"}}{w:=tc.weapon;c:=Card{Type:&typ,WeaponType:&w};if getWeaponType(&c)!=tc.mode{t.Fatalf("mode %s",w)};category,_:=cardWeaponProfileField(&c,"proficiency_category");if category!=tc.category{t.Fatalf("category %s",w)}}
}
