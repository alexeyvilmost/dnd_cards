package migrations

import (
	"fmt"
	"testing"

	"dnd-cards-backend/audiopresentation"
)

func TestAudio289PreservesCustomAssignmentsAndRetiresOnlyUnchangedProceduralCues(t *testing.T) {
	db := openIsolatedPostgresSchema(t, "AUDIO_TEST_DATABASE_URL")
	for _, table := range []string{"actions", "spells", "cards", "effects"} {
		if _, err := db.Exec(fmt.Sprintf(`CREATE TABLE %s(id text PRIMARY KEY,card_number text,deleted_at timestamptz)`, table)); err != nil {
			t.Fatal(err)
		}
	}
	if err := createAudio260(db); err != nil {
		t.Fatal(err)
	}
	catalog, err := audiopresentation.Decode(audio289Seed)
	if err != nil {
		t.Fatal(err)
	}
	var custom, different, absent audiopresentation.Binding
	for _, binding := range catalog.Bindings {
		if custom.EntityID == "" && binding.Event == "hit" {
			custom = binding
		}
	}
	for _, binding := range catalog.Bindings {
		if binding.EntityID == custom.EntityID {
			continue
		}
		if different.EntityID == "" {
			different = binding
		} else if binding.EntityID != different.EntityID {
			absent = binding
			break
		}
	}
	if custom.EntityID == "" || different.EntityID == "" || absent.EntityID == "" {
		t.Fatal("need three different catalog entities to check preservation and absent entity handling")
	}
	tables := map[string]string{"action": "actions", "spell": "spells", "card": "cards", "effect": "effects"}
	for _, binding := range []audiopresentation.Binding{custom, different} {
		if _, err := db.Exec(fmt.Sprintf(`INSERT INTO %s(id) VALUES($1)`, tables[binding.EntityType]), binding.EntityID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO audio_cues(key,name,channel,url,gain,license) VALUES('custom.keep','Custom','effects','/custom.mp3',1,'Owned');
	 UPDATE audio_cues SET name='Customized old UI cue' WHERE key='ui.click';
	 UPDATE audio_cues SET url='/previous-dice-selection.mp3' WHERE key='dice.roll'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key) VALUES($1,$2,$3,'custom.keep')`, custom.EntityType, custom.EntityID, custom.Event); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := installSelectedAudio289(db); err != nil {
			t.Fatal(err)
		}
	}
	var cueKey string
	if err := db.QueryRow(`SELECT cue_key FROM entity_audio_bindings WHERE entity_type=$1 AND entity_id=$2 AND event=$3`, custom.EntityType, custom.EntityID, custom.Event).Scan(&cueKey); err != nil || cueKey != "custom.keep" {
		t.Fatalf("custom assignment changed: %s %v", cueKey, err)
	}
	if err := db.QueryRow(`SELECT cue_key FROM entity_audio_bindings WHERE entity_type=$1 AND entity_id=$2 AND event=$3`, different.EntityType, different.EntityID, different.Event).Scan(&cueKey); err != nil || cueKey != different.CueKey {
		t.Fatalf("second entity assignment missing: %s %v", cueKey, err)
	}
	var absentCount int
	if err := db.QueryRow(`SELECT count(*) FROM entity_audio_bindings WHERE entity_id=$1`, absent.EntityID).Scan(&absentCount); err != nil || absentCount != 0 {
		t.Fatalf("assignment created for absent entity: %d %v", absentCount, err)
	}
	for key, want := range map[string]bool{"music.camp": false, "attack.slashing.hit": false, "custom.keep": true, "ui.click": true, "dice.roll": true} {
		var active bool
		if err := db.QueryRow(`SELECT active FROM audio_cues WHERE key=$1`, key).Scan(&active); err != nil || active != want {
			t.Fatalf("%s active=%v want=%v err=%v", key, active, want, err)
		}
	}
	for _, cue := range catalog.Cues {
		var storedURL string
		if err := db.QueryRow(`SELECT url FROM audio_cues WHERE key=$1 AND active=true`, cue.Key).Scan(&storedURL); err != nil || storedURL != cue.URL {
			t.Fatalf("approved cue not installed: %s %v", cue.Key, err)
		}
	}
	for _, event := range []string{"charge", "launch", "activate"} {
		if _, err := db.Exec(`INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key) VALUES('action','new-phase-test',$1,'custom.keep')`, event); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`INSERT INTO entity_audio_bindings(entity_type,entity_id,event,cue_key) VALUES('action','new-phase-test','spend_resource','custom.keep')`); err == nil {
		t.Fatal("mechanical command accepted as audio presentation phase")
	}
}

func TestAudio289RegisteredAfterExistingAnimationMigrations(t *testing.T) {
	all := GetAllMigrations()
	for index, migration := range all {
		if migration.Version == "289_selected_combat_audio" {
			if index == 0 || all[index-1].Version != "288_force_animation_palette" {
				t.Fatal("selected audio migration must follow force palette migration")
			}
			return
		}
	}
	t.Fatal("selected audio migration is not registered")
}
