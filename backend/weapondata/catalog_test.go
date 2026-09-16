package weapondata
import("encoding/json";"os";"reflect";"testing")
func TestGeneratedWeaponCatalogMatchesCanonicalFrontendData(t *testing.T){
 source,err:=os.ReadFile("../../frontend/utils/weapon_types.json");if err!=nil{t.Fatal(err)}
 var want,got any;if err=json.Unmarshal(source,&want);err!=nil{t.Fatal(err)};if err=json.Unmarshal(raw,&got);err!=nil{t.Fatal(err)}
 if !reflect.DeepEqual(want,got){t.Fatal("regenerate weapon_types.generated.json from frontend/utils/weapon_types.json")}
}
