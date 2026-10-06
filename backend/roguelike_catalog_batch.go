package main

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// A preparation-local wave resolver. It does not share rows across requests,
// principals, changed content or historical pinned envelopes. The caller still
// establishes run/character access. A shared cache requires a separate versioned
// rights/content contract; request UUIDs or access tokens cannot provide one.
func (catalog *roguelikeFrozenCatalog) fulfillWave(tx *gorm.DB, needs []roguelikeWorkerNeed) error {
	if os.Getenv("RULES_CATALOG_BATCH_ENABLED") != "1" {
		seen := map[roguelikeWorkerNeed]bool{}
		for _, need := range needs {
			if seen[need] {
				continue
			}
			seen[need] = true
			if err := catalog.fulfill(tx, need); err != nil {
				return err
			}
		}
		return nil
	}
	return catalog.fulfillBatch(tx, needs)
}

type catalogReferenceGroup struct {
	kind, column string
	references   []string
}

func catalogRows[T any](tx *gorm.DB, column string, references []string) ([]JSONMap, error) {
	var rows []T
	if err := tx.Where(column+" IN ?", references).Order("id").Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]JSONMap, 0, len(rows))
	for _, row := range rows {
		value, err := mapFromJSON(row)
		if err != nil {
			return nil, err
		}
		result = append(result, value)
	}
	return result, nil
}
func catalogEntityRows(tx *gorm.DB, group catalogReferenceGroup) ([]JSONMap, error) {
	switch group.kind {
	case "race":
		return catalogRows[Race](tx, group.column, group.references)
	case "class":
		return catalogRows[Class](tx, group.column, group.references)
	case "background":
		return catalogRows[Background](tx, group.column, group.references)
	case "feat":
		return catalogRows[Feat](tx, group.column, group.references)
	case "effect":
		return catalogRows[Effect](tx, group.column, group.references)
	case "action":
		return catalogRows[Action](tx, group.column, group.references)
	case "spell":
		return catalogRows[Spell](tx, group.column, group.references)
	case "card":
		return catalogRows[Card](tx, group.column, group.references)
	case "resource":
		return catalogRows[ResourceDefinition](tx, group.column, group.references)
	default:
		return nil, fmt.Errorf("unknown catalog entity type")
	}
}

func (catalog *roguelikeFrozenCatalog) fulfillBatch(tx *gorm.DB, needs []roguelikeWorkerNeed) error {
	defer performanceSince(tx.Statement.Context, "catalog_fulfill_ms")()
	performanceAdd(tx.Statement.Context, "catalog_needs_count", float64(len(needs)))
	groups := map[string]*catalogReferenceGroup{}
	effectTypes, seen := map[string]bool{}, map[roguelikeWorkerNeed]bool{}
	variables := false
	for _, need := range needs {
		if seen[need] {
			continue
		}
		seen[need] = true
		switch need.Kind {
		case "variables":
			variables = true
		case "effect_type":
			effectTypes[need.EffectType] = true
		case "entity":
			if need.Reference == "" {
				return fmt.Errorf("unknown catalog dependency")
			}
			if _, ok := catalog.Entities[need.EntityType]; !ok {
				return fmt.Errorf("unknown catalog entity type")
			}
			column, reference := "card_number", need.Reference
			if need.EntityType == "resource" {
				column = "resource_id"
			}
			if id, err := uuid.Parse(reference); err == nil {
				column, reference = "id", id.String()
			}
			key := need.EntityType + "/" + column
			if groups[key] == nil {
				groups[key] = &catalogReferenceGroup{kind: need.EntityType, column: column}
			}
			groups[key].references = append(groups[key].references, reference)
		default:
			return fmt.Errorf("unknown catalog dependency")
		}
	}
	performanceAdd(tx.Statement.Context, "catalog_unique_needs_count", float64(len(seen)))
	// Accumulate a wave in maps, then sort once at the publication boundary.
	// Existing snapshots keep their original rows if the same UUID is requested.
	rowsByKind := map[string]map[string]JSONMap{}
	for kind, rows := range catalog.Entities {
		rowsByKind[kind] = map[string]JSONMap{}
		for _, row := range rows {
			rowsByKind[kind][row["id"].(string)] = row
		}
	}
	add := func(kind string, entity any) error {
		row, err := projectFrozenCatalogEntity(kind, entity)
		if err != nil {
			return err
		}
		id := row["id"].(string)
		if _, exists := rowsByKind[kind][id]; !exists {
			rowsByKind[kind][id] = row
		}
		return nil
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		group := *groups[key]
		rows, err := catalogEntityRows(tx, group)
		if err != nil {
			return err
		}
		byReference := map[string]JSONMap{}
		for _, row := range rows {
			ref, _ := row[group.column].(string)
			if _, exists := byReference[ref]; !exists {
				byReference[ref] = row
			}
		}
		// Exact stable references win over English spell aliases, as before.
		missingAliases := map[string]bool{}
		for _, ref := range group.references {
			if byReference[ref] == nil && group.kind == "spell" && group.column == "card_number" {
				if alias := strings.ToLower(strings.TrimSpace(ref)); alias != "" {
					missingAliases[alias] = true
				}
			}
		}
		aliases := map[string][]Spell{}
		if len(missingAliases) > 0 {
			values := make([]string, 0, len(missingAliases))
			for value := range missingAliases {
				values = append(values, value)
			}
			sort.Strings(values)
			// Let PostgreSQL own alias normalization; avoid a second Go regex/slugs
			// implementation and read the alias and row in the same statement.
			type aliasedSpell struct {
				Spell
				CatalogAlias string
			}
			var spells []aliasedSpell
			if err := tx.Model(&Spell{}).Select("spells.*, "+catalogSpellAliasSQL+" AS catalog_alias").Where(catalogSpellAliasSQL+" IN ?", values).Order("id").Scan(&spells).Error; err != nil {
				return err
			}
			for _, spell := range spells {
				aliases[spell.CatalogAlias] = append(aliases[spell.CatalogAlias], spell.Spell)
			}
		}
		for _, ref := range group.references {
			if row := byReference[ref]; row != nil {
				if err := add(group.kind, row); err != nil {
					return err
				}
				continue
			}
			matches := aliases[strings.ToLower(strings.TrimSpace(ref))]
			if len(matches) > 1 {
				return &roguelikeWorkerRejection{"combat_catalog_ambiguous_ref", "Английское имя заклинания неоднозначно. Укажите его ID или номер в данных способности. Действие не применено."}
			}
			if len(matches) == 1 {
				if err := add(group.kind, matches[0]); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("missing pinned %s %s: %w", group.kind, ref, gorm.ErrRecordNotFound)
		}
	}
	if variables {
		if err := tx.Order("id").Find(&catalog.Variables).Error; err != nil {
			return err
		}
		catalog.VariablesComplete = true
	}
	if len(effectTypes) > 0 {
		types := make([]string, 0, len(effectTypes))
		for kind := range effectTypes {
			types = append(types, kind)
		}
		sort.Strings(types)
		var rows []Effect
		if err := tx.Where("type IN ?", types).Order("id").Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			if err := add("effect", row); err != nil {
				return err
			}
		}
		for _, kind := range catalog.CompleteEffectTypes {
			effectTypes[kind] = true
		}
		catalog.CompleteEffectTypes = []string{}
		for kind := range effectTypes {
			catalog.CompleteEffectTypes = append(catalog.CompleteEffectTypes, kind)
		}
		sort.Strings(catalog.CompleteEffectTypes)
	}
	for kind, rows := range rowsByKind {
		ids := make([]string, 0, len(rows))
		for id := range rows {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		catalog.Entities[kind] = make([]JSONMap, 0, len(ids))
		for _, id := range ids {
			catalog.Entities[kind] = append(catalog.Entities[kind], rows[id])
		}
	}
	return nil
}
