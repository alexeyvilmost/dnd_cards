package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// References are derived metadata. Only mechanic fields may create/remove an
// edge; neither clients nor inverse-link editors can supply arbitrary edges.
type EntityReference struct {
	EntityType string   `json:"entity_type"`
	EntityID   string   `json:"entity_id"`
	Name       string   `json:"name"`
	Level      int      `json:"level,omitempty"`
	Paths      []string `json:"paths"`
	Missing    bool     `json:"missing,omitempty"`
}

type EntityReferenceFields struct {
	References   []EntityReference `json:"references"`
	ReferencedBy []EntityReference `json:"referenced_by"`
}

type entityReferenceRow struct {
	SourceType string
	SourceID   string
	SourceName string
	TargetType string
	TargetID   string
	TargetName string
	Level      int
	Path       string
	Missing    bool
}

type entityReferenceNode struct {
	EntityType string
	EntityID   string
	Name       string
}

func emptyEntityReferences() EntityReferenceFields {
	return EntityReferenceFields{References: []EntityReference{}, ReferencedBy: []EntityReference{}}
}

func referenceVisibility(query, db *gorm.DB, c *gin.Context) *gorm.DB {
	if canManageEntityTags(c) {
		return query
	}
	visibleCards := playerItemLibraryQuery(db.Model(&Card{})).Select("cards.id::text")
	return query.Where("(e.source_type <> 'card' OR e.source_id IN (?))", visibleCards).
		Where("(e.target_type <> 'card' OR e.missing OR e.target_id IN (?))", visibleCards)
}

func findReferenceNode(db *gorm.DB, c *gin.Context, kind, id string) (entityReferenceNode, error) {
	var node entityReferenceNode
	if _, ok := taggedEntityTables[kind]; !ok {
		return node, roguelikeError(400, "invalid_entity_type", "Неизвестный тип сущности")
	}
	q := db.Table("entity_reference_targets(?,?) AS node", kind, id)
	if kind == "card" && !canManageEntityTags(c) {
		q = q.Where("entity_id IN (?)", playerItemLibraryQuery(db.Model(&Card{})).Select("cards.id::text"))
	}
	var matches []entityReferenceNode
	if err := q.Limit(2).Find(&matches).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return node, roguelikeError(404, "entity_not_found", "Сущность не найдена")
		}
		return node, err
	}
	if len(matches) != 1 {
		return node, roguelikeError(404, "entity_not_found", "Сущность не найдена или ссылка неоднозначна")
	}
	node = matches[0]
	return node, nil
}

func appendEntityReference(refs []EntityReference, ref EntityReference) []EntityReference {
	for i := range refs {
		if refs[i].EntityType == ref.EntityType && refs[i].EntityID == ref.EntityID && refs[i].Level == ref.Level {
			for _, path := range refs[i].Paths {
				if path == ref.Paths[0] {
					return refs
				}
			}
			refs[i].Paths = append(refs[i].Paths, ref.Paths[0])
			sort.Strings(refs[i].Paths)
			return refs
		}
	}
	return append(refs, ref)
}

func sortEntityReferences(refs []EntityReference) {
	sort.Slice(refs, func(i, j int) bool {
		a, b := refs[i], refs[j]
		if a.EntityType != b.EntityType {
			return a.EntityType < b.EntityType
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		if a.EntityID != b.EntityID {
			return a.EntityID < b.EntityID
		}
		return a.Level < b.Level
	})
}

func loadEntityReferences(db *gorm.DB, c *gin.Context, kind string, ids []string) (map[string]EntityReferenceFields, error) {
	result := make(map[string]EntityReferenceFields, len(ids))
	for _, id := range ids {
		result[id] = emptyEntityReferences()
	}
	if len(ids) == 0 {
		return result, nil
	}
	var rows []entityReferenceRow
	if err := entityReferenceReadQuery(db, c, kind, ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		if fields, ok := result[row.SourceID]; ok && row.SourceType == kind {
			fields.References = appendEntityReference(fields.References, EntityReference{row.TargetType, row.TargetID, row.TargetName, row.Level, []string{row.Path}, row.Missing})
			result[row.SourceID] = fields
		}
		if fields, ok := result[row.TargetID]; ok && row.TargetType == kind {
			fields.ReferencedBy = appendEntityReference(fields.ReferencedBy, EntityReference{row.SourceType, row.SourceID, row.SourceName, row.Level, []string{row.Path}, false})
			result[row.TargetID] = fields
		}
	}
	for id, fields := range result {
		sortEntityReferences(fields.References)
		sortEntityReferences(fields.ReferencedBy)
		result[id] = fields
	}
	return result, nil
}

func entityReferenceReadQuery(db *gorm.DB, c *gin.Context, kind string, ids []string) *gorm.DB {
	// Bound raw edges before the lateral resolver. Every incoming resolved key
	// must be an alias of a requested node; literal IDs also retain missing edges.
	// Keep the original resolved predicate and visibility as the final authority.
	candidates := db.Table("entity_reference_edges").Select("source_type,source_id,level,path").Where(`
		(source_type=? AND source_id IN ?) OR (target_type IN ? AND (
			target_key IN ? OR target_key IN (
				SELECT unnest(aliases) FROM entity_reference_nodes WHERE entity_type=? AND entity_id IN ?
			)))`, kind, ids, []string{kind, "*", "$" + kind}, ids, kind, ids)
	query := db.Table("entity_reference_resolved_edges e").Select("e.*, n.name AS source_name").
		Joins("JOIN entity_reference_nodes n ON n.entity_type=e.source_type AND n.entity_id=e.source_id").
		Where("(e.source_type=? AND e.source_id IN ?) OR (e.target_type=? AND e.target_id IN ?)", kind, ids, kind, ids).
		Where("(e.source_type,e.source_id,e.level,e.path) IN (?)", candidates)
	return referenceVisibility(query, db, c)
}

func entityReferenceFilter(query *gorm.DB, c *gin.Context, kind, table string) (*gorm.DB, error) {
	state, sourceKind := c.Query("reference_state"), c.Query("reference_type")
	sourceID, levelValue := c.Query("reference_id"), c.Query("reference_level")
	if state == "" && sourceKind == "" && sourceID == "" && levelValue == "" {
		return query, nil
	}
	sub := query.Session(&gorm.Session{NewDB: true}).Table("entity_reference_resolved_edges e").Select("1").Where("e.target_type=? AND e.target_id="+table+".id::text", kind)
	if sourceKind != "" {
		sub = sub.Where("e.source_type=?", sourceKind)
	}
	if sourceID != "" {
		sub = sub.Where("e.source_id=?", sourceID)
	}
	if levelValue != "" {
		level, err := strconv.ParseInt(levelValue, 10, 32)
		if err != nil || level < 1 {
			return query, fmt.Errorf("Уровень источника должен быть положительным целым числом")
		}
		// All predicates belong to one edge: a class at level 3 and a race at
		// level 5 must not accidentally match that race at level 3.
		sub = sub.Where("e.level=?", level)
	}
	sub = referenceVisibility(sub, query.Session(&gorm.Session{NewDB: true}), c)
	if state == "unlinked" {
		return query.Where("NOT EXISTS (?)", sub), nil
	}
	return query.Where("EXISTS (?)", sub), nil
}

func registerEntityReferenceRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	api.GET("/entity-references/:type/:id", OptionalAuthMiddleware(auth), func(c *gin.Context) {
		node, err := findReferenceNode(db, c, c.Param("type"), c.Param("id"))
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		fields, err := loadEntityReferences(db, c, node.EntityType, []string{node.EntityID})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("Vary", "Authorization")
		c.JSON(http.StatusOK, fields[node.EntityID])
	})
	api.POST("/entity-references/:type/preview", StrictAuthMiddleware(auth), func(c *gin.Context) {
		kind := c.Param("type")
		if _, ok := taggedEntityTables[kind]; !ok {
			c.JSON(400, gin.H{"error": "Неизвестный тип сущности"})
			return
		}
		var req struct {
			Entity map[string]any `json:"entity"`
		}
		if c.ShouldBindJSON(&req) != nil || req.Entity == nil {
			c.JSON(400, gin.H{"error": "Ожидается объект entity"})
			return
		}
		fields := emptyEntityReferences()
		id, _ := req.Entity["id"].(string)
		if kind == "passive" {
			id, _ = req.Entity["key"].(string)
		}
		if id != "" {
			if node, lookupErr := findReferenceNode(db, c, kind, id); lookupErr == nil {
				// Existing editors send partial updates. Omitted legacy mechanic
				// fields remain saved, so they must also remain in the preview.
				column := "id"
				if kind == "passive" {
					column = "key"
				}
				var saved struct {
					Document JSONMap `gorm:"type:jsonb"`
				}
				if err := db.Table(taggedEntityTables[kind]+" e").Select("to_jsonb(e) - 'image_url' - 'image_cloudinary_url' - 'image_generation_prompt' AS document").Where(column+"::text=?", node.EntityID).Take(&saved).Error; err != nil {
					writeRoguelikeError(c, err)
					return
				}
				for key, value := range req.Entity {
					saved.Document[key] = value
				}
				if kind == "action" {
					if _, present := req.Entity["resources"]; present {
						delete(saved.Document, "resource")
					}
				}
				req.Entity = map[string]any(saved.Document)
				stored, loadErr := loadEntityReferences(db, c, kind, []string{node.EntityID})
				if loadErr != nil {
					writeRoguelikeError(c, loadErr)
					return
				}
				fields.ReferencedBy = stored[node.EntityID].ReferencedBy
			}
		}
		document, err := json.Marshal(req.Entity)
		if err != nil {
			c.JSON(400, gin.H{"error": "Некорректная сущность"})
			return
		}
		var rows []entityReferenceRow
		q := db.Table(`(SELECT COALESCE(t.entity_type,x.target_type) AS target_type,COALESCE(t.entity_id,x.target_key) AS target_id,COALESCE(t.name,x.target_key) AS target_name,t.entity_id IS NULL AS missing,x.level,x.path
		 FROM entity_reference_extract(?,?::jsonb) x LEFT JOIN LATERAL entity_reference_targets(x.target_type,x.target_key) t ON true
		 WHERE t.entity_id IS NOT NULL OR (left(x.target_type,1)<>'$' AND x.target_type<>'*')) e`, kind, string(document))
		if !canManageEntityTags(c) {
			q = q.Where("e.target_type <> 'card' OR e.missing OR e.target_id IN (?)", playerItemLibraryQuery(db.Model(&Card{})).Select("cards.id::text"))
		}
		if err = q.Find(&rows).Error; err != nil {
			writeRoguelikeError(c, err)
			return
		}
		for _, row := range rows {
			fields.References = appendEntityReference(fields.References, EntityReference{row.TargetType, row.TargetID, row.TargetName, row.Level, []string{row.Path}, row.Missing})
		}
		sortEntityReferences(fields.References)
		c.JSON(200, fields)
	})
	api.POST("/entity-references/:type/:id/refresh", StrictAuthMiddleware(auth), func(c *gin.Context) {
		node, err := findReferenceNode(db, c, c.Param("type"), c.Param("id"))
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		table := taggedEntityTables[node.EntityType]
		column := "id"
		if node.EntityType == "passive" {
			column = "key"
		}
		err = db.Transaction(func(tx *gorm.DB) error {
			var row map[string]any
			if err := tx.Table(table).Clauses(clause.Locking{Strength: "UPDATE"}).Where(column+"::text=?", node.EntityID).Take(&row).Error; err != nil {
				return err
			}
			userID, _ := GetCurrentUserID(c)
			if !canManageEntityTags(c) && (node.EntityType == "passive" || fmt.Sprint(row["author"]) != userID.String()) {
				return roguelikeError(403, "forbidden", "Редактировать может только автор")
			}
			return tx.Exec("SELECT entity_reference_sync(?,to_jsonb(e)) FROM "+table+" e WHERE "+column+"::text=?", node.EntityType, node.EntityID).Error
		})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		fields, err := loadEntityReferences(db, c, node.EntityType, []string{node.EntityID})
		if err != nil {
			writeRoguelikeError(c, err)
			return
		}
		c.JSON(200, fields[node.EntityID])
	})
}

// Enrich only catalog HTTP responses, never domain models or their canonical
// serialization. This keeps existing signatures, saved artifacts and runtime
// reads byte-for-byte independent of the current cross-reference index.
type entityReferenceResponseWriter struct {
	gin.ResponseWriter
	body   bytes.Buffer
	status int
}

func (w *entityReferenceResponseWriter) WriteHeader(status int) { w.status = status }
func (w *entityReferenceResponseWriter) WriteHeaderNow()        {}
func (w *entityReferenceResponseWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	return w.body.Write(data)
}
func (w *entityReferenceResponseWriter) WriteString(data string) (int, error) {
	return w.Write([]byte(data))
}
func (w *entityReferenceResponseWriter) Status() int {
	if w.status == 0 {
		return 200
	}
	return w.status
}
func (w *entityReferenceResponseWriter) Size() int {
	if w.status == 0 {
		return -1
	}
	return w.body.Len()
}
func (w *entityReferenceResponseWriter) Written() bool { return w.status != 0 }

func EntityReferenceResponseMiddleware(db *gorm.DB) gin.HandlerFunc {
	routes := map[string]string{"cards": "card", "actions": "action", "effects": "effect", "spells": "spell", "feats": "feat", "backgrounds": "background", "races": "race", "classes": "class", "resources": "resource", "variables": "variable", "concepts": "concept", "monsters": "monster", "passive-presentations": "passive"}
	return func(c *gin.Context) {
		parts := strings.Split(strings.Trim(c.Request.URL.Path, "/"), "/")
		if len(parts) < 2 || len(parts) > 3 || parts[0] != "api" {
			c.Next()
			return
		}
		kind, ok := routes[parts[1]]
		if !ok {
			c.Next()
			return
		}
		// Incoming/outgoing cards obey the caller's library visibility. Shared
		// caches must not reuse an administrator's enriched response publicly.
		c.Header("Cache-Control", "private, no-store")
		c.Writer.Header().Add("Vary", "Authorization")
		original := c.Writer
		writer := &entityReferenceResponseWriter{ResponseWriter: original}
		c.Writer = writer
		c.Next()
		c.Writer = original
		body := writer.body.Bytes()
		status := writer.Status()
		if status >= 200 && status < 300 && strings.Contains(original.Header().Get("Content-Type"), "application/json") {
			var payload any
			decoder := json.NewDecoder(bytes.NewReader(body))
			decoder.UseNumber() // Do not round numeric mechanic data while adding metadata.
			if decoder.Decode(&payload) == nil {
				entities := catalogResponseEntities(payload, kind, parts[1])
				ids := []string{}
				for _, entity := range entities {
					id, _ := entity["id"].(string)
					if kind == "passive" {
						id, _ = entity["key"].(string)
					}
					if id != "" {
						ids = append(ids, id)
					}
				}
				if len(ids) > 0 {
					fields, err := loadEntityReferences(db, c, kind, ids)
					if err != nil {
						status = 500
						body = []byte(`{"error":"Не удалось загрузить связи сущностей"}`)
					} else {
						for _, entity := range entities {
							id, _ := entity["id"].(string)
							if kind == "passive" {
								id, _ = entity["key"].(string)
							}
							if f, ok := fields[id]; ok {
								entity["references"] = f.References
								entity["referenced_by"] = f.ReferencedBy
							}
						}
						if encoded, err := json.Marshal(payload); err == nil {
							body = encoded
						}
					}
				}
			}
		}
		original.Header().Del("Content-Length")
		original.WriteHeader(status)
		_, _ = original.Write(body)
	}
}

func catalogResponseEntities(payload any, kind, collection string) []map[string]any {
	rows := []map[string]any{}
	add := func(value any) {
		if row, ok := value.(map[string]any); ok {
			if _, hasName := row["name"]; hasName {
				rows = append(rows, row)
			}
		}
	}
	if array, ok := payload.([]any); ok {
		for _, row := range array {
			add(row)
		}
		return rows
	}
	if root, ok := payload.(map[string]any); ok {
		add(root)
		for _, key := range []string{collection, kind, "passives", "items", "data"} {
			if array, ok := root[key].([]any); ok {
				for _, row := range array {
					add(row)
				}
			} else {
				add(root[key])
			}
		}
	}
	return rows
}
