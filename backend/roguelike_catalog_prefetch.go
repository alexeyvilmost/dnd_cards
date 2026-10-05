package main

import (
	"os"
	"sort"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// An advisory, preparation-local store. The reference index is not a rules
// authority: its rows are never sent to the worker until the canonical builder
// asks for that exact UUID. Aliases and type membership always use the normal
// resolver. Missing/stale edges therefore affect work only, never the catalog.
// Used inside the equipment/options repeatable-read snapshot, never shared
// across transactions or reused for an existing pinned combat envelope.
type catalogPrefetch struct {
	owner     uuid.UUID
	rows      map[string]JSONMap
	sources   map[string]bool
	remaining int
}

func newCatalogPrefetch(owner uuid.UUID) *catalogPrefetch {
	if os.Getenv("RULES_CATALOG_PREFETCH_ENABLED") != "1" {
		return nil
	}
	return &catalogPrefetch{owner: owner, rows: map[string]JSONMap{}, sources: map[string]bool{}, remaining: 256}
}

func (prefetch *catalogPrefetch) fulfill(tx *gorm.DB, catalog *roguelikeFrozenCatalog, needs []roguelikeWorkerNeed) error {
	remaining := make([]roguelikeWorkerNeed, 0, len(needs))
	for _, need := range needs {
		id, err := uuid.Parse(need.Reference)
		if prefetch != nil && need.Kind == "entity" && err == nil {
			if row := prefetch.rows[need.EntityType+"/"+id.String()]; row != nil {
				if err := catalog.add(need.EntityType, row); err != nil {
					return err
				}
				performanceAdd(tx.Statement.Context, "catalog_prefetch_consumed", 1)
				continue
			}
		}
		remaining = append(remaining, need)
	}
	if len(remaining) > 0 {
		if err := catalog.fulfillWave(tx, remaining); err != nil {
			return err
		}
	}
	if prefetch != nil {
		return prefetch.load(tx, catalog)
	}
	return nil
}

func (prefetch *catalogPrefetch) load(tx *gorm.DB, catalog *roguelikeFrozenCatalog) error {
	return prefetch.loadDepth(tx, catalog, 0)
}

func (prefetch *catalogPrefetch) loadDepth(tx *gorm.DB, catalog *roguelikeFrozenCatalog, depth int) error {
	if prefetch.remaining <= 0 || depth >= 8 {
		return nil
	}
	// Source identities have already been resolved by the canonical builder.
	var sourceKeys []string
	for kind, rows := range catalog.Entities {
		for _, row := range rows {
			id, _ := row["id"].(string)
			key := kind + "/" + id
			if !prefetch.sources[key] {
				prefetch.sources[key] = true
				sourceKeys = append(sourceKeys, key)
			}
		}
	}
	for key := range prefetch.rows {
		if !prefetch.sources[key] {
			prefetch.sources[key] = true
			sourceKeys = append(sourceKeys, key)
		}
	}
	if len(sourceKeys) == 0 {
		return nil
	}
	sort.Strings(sourceKeys)
	if len(sourceKeys) > 256 {
		sourceKeys = sourceKeys[:256]
	}
	var edges []struct {
		TargetType string
		TargetID   string
	}
	// LIMIT bounds the advisory rows. Index incompleteness is acceptable; a
	// database failure is not swallowed inside a PostgreSQL transaction.
	if err := tx.Table("entity_reference_resolved_edges").Select("DISTINCT target_type, target_id").
		Where("source_type || '/' || source_id IN ? AND NOT missing", sourceKeys).
		Order("target_type, target_id").Limit(prefetch.remaining).Scan(&edges).Error; err != nil {
		return err
	}
	groups := map[string][]string{}
	for _, edge := range edges {
		id, err := uuid.Parse(edge.TargetID)
		if _, known := catalog.Entities[edge.TargetType]; !known || err != nil {
			continue
		}
		key := edge.TargetType + "/" + id.String()
		if prefetch.rows[key] == nil {
			groups[edge.TargetType] = append(groups[edge.TargetType], id.String())
		}
	}
	kinds := make([]string, 0, len(groups))
	for kind := range groups {
		kinds = append(kinds, kind)
	}
	sort.Strings(kinds)
	before := len(prefetch.rows)
	for _, kind := range kinds {
		query := tx
		if kind == "card" {
			// An advisory edge can never widen item visibility. If a canonical
			// internal reference needs something else it takes the ordinary path.
			query = tx.Where("cards.id IN (?) OR cards.id IN (?)", playerItemLibraryQuery(tx.Model(&Card{})).Select("cards.id"), ownedItemQuery(tx, prefetch.owner).Select("cards.id"))
		}
		rows, err := catalogEntityRows(query, catalogReferenceGroup{kind: kind, column: "id", references: groups[kind]})
		if err != nil {
			return err
		}
		for _, row := range rows {
			projected, err := projectFrozenCatalogEntity(kind, row)
			if err != nil {
				return err
			}
			prefetch.rows[kind+"/"+row["id"].(string)] = projected
			prefetch.remaining--
			performanceAdd(tx.Statement.Context, "catalog_prefetch_loaded", 1)
		}
	}
	if len(prefetch.rows) > before {
		return prefetch.loadDepth(tx, catalog, depth+1)
	}
	return nil
}
