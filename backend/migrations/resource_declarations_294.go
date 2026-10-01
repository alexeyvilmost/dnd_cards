package migrations

import (
	"bytes"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

const resourceDeclarations294Version = "294_explicit_resource_declarations"

// Historical seed metadata is frozen with this migration. Current mechanics
// come from the database; the migration never reconstructs their content.
//
//go:embed resource_declarations_294.json
var resourceDeclarations294JSON []byte

var resourceID294 = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)
var resourceLegacyPool294 = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$`)
var resourceTables294 = []string{"actions", "effects", "cards", "spells", "feats", "races", "classes", "backgrounds"}

type resourceEntity294 struct {
	Table              string          `json:"table"`
	ID                 string          `json:"id"`
	Name               string          `json:"name"`
	Description        string          `json:"description"`
	CardNumber         string          `json:"card_number"`
	NameEn             string          `json:"name_en"`
	ImageURL           string          `json:"image_url"`
	ImageCloudinaryURL string          `json:"image_cloudinary_url"`
	Mechanics          json.RawMessage `json:"mechanics"`
	Resources          json.RawMessage `json:"resources"`
}

func (e resourceEntity294) ref() string {
	if e.CardNumber != "" {
		return e.CardNumber
	}
	return e.ID
}

type resourceMetadata294 struct {
	ResourceID  string `json:"resource_id"`
	Name        string `json:"name"`
	NameEn      string `json:"name_en"`
	Description string `json:"description"`
	Category    string `json:"category"`
	ImageURL    string `json:"image_url"`
	Recharge    string `json:"recharge"`
	SortOrder   int    `json:"sort_order"`
}
type resourceDeclaration294 struct {
	ID, Kind, Recharge string
	Source             resourceEntity294
}
type resourceRewrite294 struct {
	Entity        resourceEntity294
	Before, After []byte
}

func resourceObject294(raw []byte) (map[string]any, error) {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil, nil
	}
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("mechanics must be an object")
	}
	return object, nil
}
func resourceText294(v any) string { value, _ := v.(string); return value }
func resourceRecharge294(row map[string]any) string {
	for _, key := range []string{"recharge", "per"} {
		if value := resourceText294(row[key]); value != "" {
			return value
		}
	}
	return ""
}

// This transformation only makes existing bindings explicit. Numeric charges,
// formulas, recovery, choices and targeting are retained byte-for-byte values.
// Spell free uses remain generic runtime pools and are never rewritten here.
func rewriteResourceMechanics294(entity resourceEntity294) ([]byte, []resourceDeclaration294, error) {
	mechanics, err := resourceObject294(entity.Mechanics)
	if err != nil || mechanics == nil {
		return entity.Mechanics, nil, err
	}
	declarations := []resourceDeclaration294{}
	add := func(id, kind, recharge string) error {
		if !resourceID294.MatchString(id) {
			return fmt.Errorf("invalid declared resource %s/%s", entity.Table, entity.ref())
		}
		declarations = append(declarations, resourceDeclaration294{ID: id, Kind: kind, Recharge: recharge, Source: entity})
		return nil
	}
	if uses, ok := mechanics["uses"].(map[string]any); ok {
		id := resourceText294(uses["resource_id"])
		if _, present := uses["resource_id"]; !present {
			id = "uses_" + entity.ref()
			if pool, present := uses["pool"]; present {
				if !resourceLegacyPool294.MatchString(resourceText294(pool)) {
					return nil, nil, fmt.Errorf("invalid legacy shared pool %s/%s", entity.Table, entity.ref())
				}
				id = "uses_shared_" + resourceText294(pool)
			}
			if !resourceID294.MatchString(id) {
				return nil, nil, fmt.Errorf("uses cannot preserve resource ID %s/%s", entity.Table, entity.ref())
			}
			uses["resource_id"] = id
		}
		if err = add(id, "uses", resourceRecharge294(uses)); err != nil {
			return nil, nil, err
		}
	}
	var visit func(any) error
	visit = func(value any) error {
		switch row := value.(type) {
		case []any:
			for _, child := range row {
				if err := visit(child); err != nil {
					return err
				}
			}
		case map[string]any:

			kind := resourceText294(row["kind"])
			if kind == "resource" || kind == "grant_resource" {
				id := resourceText294(row["id"])
				if id == "" {
					id = resourceText294(row["resource_id"])
				}
				if id != "" {
					if err := add(id, "resource", resourceRecharge294(row)); err != nil {
						return err
					}
				}
			}
			if binding, ok := row["binding"].(map[string]any); ok && resourceText294(binding["currency"]) != "" {
				if err := add(resourceText294(row["resource"]), "material", resourceRecharge294(row)); err != nil {
					return err
				}
			}
			for _, child := range row {
				if err := visit(child); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err = visit(mechanics); err != nil {
		return nil, nil, err
	}
	after, err := json.Marshal(mechanics)
	return after, declarations, err
}

func resourceImage294(e resourceEntity294) string {
	if e.ImageURL == "" && e.ImageCloudinaryURL != "" {
		return "/api/content-images/" + e.Table + "/" + e.ID
	}
	if strings.HasPrefix(e.ImageURL, "data:") {
		return "/api/content-images/" + e.Table + "/" + e.ID
	}
	return e.ImageURL
}
func resourceGrantRefs294(raw []byte) map[string]bool {
	out := map[string]bool{}
	root, _ := resourceObject294(raw)
	var visit func(any)
	visit = func(value any) {
		switch row := value.(type) {
		case []any:
			for _, v := range row {
				visit(v)
			}
		case map[string]any:
			if resourceText294(row["kind"]) == "grant_action" {
				if ref := resourceText294(row["value"]); ref != "" {
					out[ref] = true
				}
			}
			for _, v := range row {
				visit(v)
			}
		}
	}
	visit(root)
	return out
}

func planResourceDeclarations294(entities []resourceEntity294) ([]resourceRewrite294, []resourceMetadata294, error) {
	var seed struct {
		Resources []resourceMetadata294 `json:"resources"`
	}
	if err := json.Unmarshal(resourceDeclarations294JSON, &seed); err != nil {
		return nil, nil, err
	}
	metadata := map[string]resourceMetadata294{}
	for _, row := range seed.Resources {
		if !resourceID294.MatchString(row.ResourceID) || row.Name == "" {
			return nil, nil, fmt.Errorf("invalid resource metadata seed")
		}
		metadata[row.ResourceID] = row
	}

	groups := map[string][]resourceDeclaration294{}
	rewrites := []resourceRewrite294{}
	for _, entity := range entities {
		after, declarations, err := rewriteResourceMechanics294(entity)
		if err != nil {
			return nil, nil, err
		}
		if len(after) > 0 && !bytes.Equal(bytes.TrimSpace(after), []byte("null")) {
			beforeCanonical, _ := resourceObject294(entity.Mechanics)
			afterCanonical, _ := resourceObject294(after)
			before, _ := json.Marshal(beforeCanonical)
			next, _ := json.Marshal(afterCanonical)
			if !bytes.Equal(before, next) {
				rewrites = append(rewrites, resourceRewrite294{Entity: entity, Before: entity.Mechanics, After: after})
			}
		}
		if entity.Table == "classes" {
			classResources, err := resourceObject294(entity.Resources)
			if err != nil {
				return nil, nil, err
			}
			for id, value := range classResources {
				if !resourceID294.MatchString(id) {
					return nil, nil, fmt.Errorf("invalid class resource %s", entity.ref())
				}
				definition, _ := value.(map[string]any)
				declarations = append(declarations, resourceDeclaration294{ID: id, Kind: "class", Recharge: resourceRecharge294(definition), Source: entity})
			}
		}
		for _, decl := range declarations {
			groups[decl.ID] = append(groups[decl.ID], decl)
		}
	}
	for id, decls := range groups {
		if _, present := metadata[id]; present {
			continue
		}
		row := resourceMetadata294{ResourceID: id, Category: "ability_resource", SortOrder: 500}
		sources := map[string]resourceEntity294{}
		recharges := map[string]bool{}
		for _, decl := range decls {
			sources[decl.Source.Table+"/"+decl.Source.ID] = decl.Source
			if decl.Recharge != "" {
				recharges[decl.Recharge] = true
			}
		}
		sorted := make([]resourceEntity294, 0, len(sources))
		for _, source := range sources {
			sorted = append(sorted, source)
		}
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].Table+sorted[i].ID < sorted[j].Table+sorted[j].ID })
		if row.Name == "" {
			owner := resourceEntity294{}
			if len(sorted) == 1 {
				owner = sorted[0]
			}
			if strings.HasPrefix(id, "uses_shared_") {
				owners := []resourceEntity294{}
				for _, candidate := range entities {
					if candidate.Table != "cards" {
						continue
					}
					refs := resourceGrantRefs294(candidate.Mechanics)
					all := true
					for _, source := range sorted {
						if !refs[source.ref()] && !refs[source.ID] {
							all = false
							break
						}
					}
					if all {
						owners = append(owners, candidate)
					}
				}
				if len(owners) == 1 {
					owner = owners[0]
				}
			}
			if owner.Name != "" {
				row.Name = "Заряды: " + owner.Name
				row.NameEn = owner.NameEn
				row.ImageURL = resourceImage294(owner)
				row.Description = owner.Description
				if owner.Table == "cards" {
					row.Category = "item_resource"
				}
			}
			if row.Name == "" {
				row.Name = "Общий запас: " + id
			}
			if decls[0].Kind == "material" {
				row.Name = "Материальные компоненты: " + sorted[0].Name
				row.Category = "currency"
			}
		}
		if len(recharges) == 1 {
			for recharge := range recharges {
				row.Recharge = recharge
			}
		}
		names := []string{}
		for _, source := range sorted {
			names = append(names, source.Name)
		}
		row.Description = strings.TrimSpace(row.Description + "\n\nИсточники: " + strings.Join(names, "; ") + ".")
		if len([]rune(row.Name)) > 255 {
			return nil, nil, fmt.Errorf("resource display name exceeds bounds %s", id)
		}
		metadata[id] = row
	}
	rows := make([]resourceMetadata294, 0, len(metadata))
	for _, row := range metadata {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ResourceID < rows[j].ResourceID })
	return rewrites, rows, nil
}

func applyResourceDeclarations294(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`SELECT pg_advisory_xact_lock(294,1);CREATE TABLE IF NOT EXISTS resource_declarations_294_archive(entity_table text NOT NULL,entity_id uuid NOT NULL,before_mechanics jsonb,after_mechanics jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT NOW(),PRIMARY KEY(entity_table,entity_id));CREATE TABLE IF NOT EXISTS resource_declarations_294_metadata_archive(resource_id text PRIMARY KEY,before_row jsonb NOT NULL,after_category text NOT NULL,archived_at timestamptz NOT NULL DEFAULT NOW());`); err != nil {
		return err
	}
	entities := []resourceEntity294{}
	for _, table := range resourceTables294 {
		if _, err = tx.Exec("LOCK TABLE " + table + " IN SHARE ROW EXCLUSIVE MODE"); err != nil {
			return err
		}
		// Entity art remains in its canonical endpoint, rather than duplicating
		// hundreds of base64 images in a resource migration's in-memory plan.
		rows, err := tx.Query("SELECT jsonb_build_object('id',id,'card_number',card_number,'name',name,'name_en',name_en,'description',description,'image_url',CASE WHEN image_url LIKE 'data:%' THEN '/api/content-images/" + table + "/'||id ELSE image_url END,'image_cloudinary_url',to_jsonb(e)->'image_cloudinary_url','mechanics',to_jsonb(e)->'mechanics','resources',to_jsonb(e)->'resources') FROM " + table + " e WHERE deleted_at IS NULL ORDER BY id FOR UPDATE")
		if err != nil {
			return err
		}
		for rows.Next() {
			var raw []byte
			if err = rows.Scan(&raw); err != nil {
				rows.Close()
				return err
			}
			var entity resourceEntity294
			if err = json.Unmarshal(raw, &entity); err != nil {
				rows.Close()
				return err
			}
			entity.Table = table
			entities = append(entities, entity)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		var drift int
		if err = tx.QueryRow("SELECT count(*) FROM resource_declarations_294_archive a JOIN "+table+" e ON e.id=a.entity_id WHERE a.entity_table=$1 AND (to_jsonb(e)->'mechanics') IS DISTINCT FROM a.after_mechanics", table).Scan(&drift); err != nil {
			return err
		}
		if drift != 0 {
			return fmt.Errorf("closed resource declaration archive drift in %s", table)
		}
	}
	var categoryDrift int
	if err = tx.QueryRow(`SELECT count(*) FROM resource_declarations_294_metadata_archive a JOIN resources r ON r.resource_id=a.resource_id WHERE r.category IS DISTINCT FROM a.after_category`).Scan(&categoryDrift); err != nil {
		return err
	}
	if categoryDrift != 0 {
		return fmt.Errorf("closed resource metadata archive drift")
	}
	rewrites, definitions, err := planResourceDeclarations294(entities)
	if err != nil {
		return err
	}
	for _, change := range rewrites {
		if _, err = tx.Exec(`INSERT INTO resource_declarations_294_archive(entity_table,entity_id,before_mechanics,after_mechanics) VALUES($1,$2::uuid,$3::jsonb,$4::jsonb) ON CONFLICT DO NOTHING`, change.Entity.Table, change.Entity.ID, string(change.Before), string(change.After)); err != nil {
			return err
		}
		result, err := tx.Exec("UPDATE "+change.Entity.Table+" SET mechanics=$1::jsonb,updated_at=NOW() WHERE id=$2::uuid AND mechanics IS NOT DISTINCT FROM $3::jsonb AND deleted_at IS NULL", string(change.After), change.Entity.ID, string(change.Before))
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil || count != 1 {
			return fmt.Errorf("resource declaration changed concurrently %s/%s", change.Entity.Table, change.Entity.ID)
		}
	}
	var seed struct {
		Resources []resourceMetadata294 `json:"resources"`
	}
	if err = json.Unmarshal(resourceDeclarations294JSON, &seed); err != nil {
		return err
	}
	seedCategories := map[string]string{}
	for _, row := range seed.Resources {
		seedCategories[row.ResourceID] = row.Category
	}
	if _, err = tx.Exec("LOCK TABLE resources IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		return err
	}
	for _, row := range definitions {
		if _, err = tx.Exec(`INSERT INTO resources(resource_id,name,name_en,description,category,image_url,recharge,sort_order) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8) ON CONFLICT(resource_id) DO NOTHING`, row.ResourceID, row.Name, row.NameEn, row.Description, row.Category, row.ImageURL, row.Recharge, row.SortOrder); err != nil {
			return err
		}
		// Current data defines the display category of built-in pools. Keep
		// custom names, artwork, recharge and all other authored metadata.
		if category, declared := seedCategories[row.ResourceID]; declared {
			if _, err = tx.Exec(`INSERT INTO resource_declarations_294_metadata_archive(resource_id,before_row,after_category) SELECT resource_id,to_jsonb(r),$2 FROM resources r WHERE resource_id=$1 AND category IS DISTINCT FROM $2 AND deleted_at IS NULL ON CONFLICT DO NOTHING`, row.ResourceID, category); err != nil {
				return err
			}
			if _, err = tx.Exec(`UPDATE resources SET category=$2,updated_at=NOW() WHERE resource_id=$1 AND category IS DISTINCT FROM $2 AND deleted_at IS NULL`, row.ResourceID, category); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
