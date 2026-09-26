package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AudioCue struct {
	Key     string  `json:"key" gorm:"primaryKey"`
	Name    string  `json:"name"`
	Channel string  `json:"channel"`
	URL     string  `json:"url"`
	Gain    float64 `json:"gain"`
	Loop    bool    `json:"loop"`
	License string  `json:"license"`
	Version int     `json:"version"`
}
type EntityAudioBinding struct {
	EntityType string `json:"entity_type" gorm:"primaryKey"`
	EntityID   string `json:"entity_id" gorm:"primaryKey"`
	Event      string `json:"event" gorm:"primaryKey"`
	CueKey     string `json:"cue_key"`
}

func (AudioCue) TableName() string           { return "audio_cues" }
func (EntityAudioBinding) TableName() string { return "entity_audio_bindings" }
func validAudioEvent(event string) bool {
	return event == "cast" || event == "hit" || event == "miss" || event == "healing"
}
func audioMediaType(data []byte) (string, string) {
	if len(data) > 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
		return "audio/wav", ".wav"
	}
	if len(data) > 4 && string(data[:4]) == "OggS" {
		return "audio/ogg", ".ogg"
	}
	if len(data) > 3 && (string(data[:3]) == "ID3" || (data[0] == 0xff && data[1]&0xe0 == 0xe0)) {
		return "audio/mpeg", ".mp3"
	}
	return "", ""
}
func registerAudioRoutes(api *gin.RouterGroup, auth *AuthService, db *gorm.DB) {
	routes := api.Group("/audio", StrictAuthMiddleware(auth))
	routes.GET("", func(c *gin.Context) {
		cues := []AudioCue{}
		bindings := []EntityAudioBinding{}
		if db.Order("name").Find(&cues).Error != nil || db.Find(&bindings).Error != nil {
			c.JSON(500, gin.H{"error": "Не удалось загрузить звуки"})
			return
		}
		c.JSON(200, gin.H{"cues": cues, "bindings": bindings, "can_manage": canManageEntityTags(c)})
	})
	routes.PUT("/entities/:type/:id/:event", ContentAdminAuthMiddleware(auth), JSONBodyLimitMiddleware(4096), func(c *gin.Context) {
		kind, id, event := c.Param("type"), c.Param("id"), c.Param("event")
		if !validAudioEvent(event) {
			c.JSON(400, gin.H{"error": "Неизвестное звуковое событие"})
			return
		}
		var input struct {
			CueKey string `json:"cue_key"`
		}
		d := json.NewDecoder(c.Request.Body)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil {
			c.JSON(400, gin.H{"error": "Некорректная привязка"})
			return
		}
		err := db.Transaction(func(tx *gorm.DB) error {
			if e := validateTaggedEntity(tx, kind, id, true); e != nil {
				return e
			}
			if input.CueKey == "" {
				return tx.Where("entity_type=? AND entity_id=? AND event=?", kind, id, event).Delete(&EntityAudioBinding{}).Error
			}
			var cue AudioCue
			if tx.First(&cue, "key = ?", input.CueKey).Error != nil || cue.Channel == "music" {
				return fmt.Errorf("выберите существующий звуковой эффект")
			}
			row := EntityAudioBinding{kind, id, event, input.CueKey}
			return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "entity_type"}, {Name: "entity_id"}, {Name: "event"}}, DoUpdates: clause.AssignmentColumns([]string{"cue_key"})}).Create(&row).Error
		})
		if err != nil {
			c.JSON(400, gin.H{"error": "Не удалось сохранить звук сущности"})
			return
		}
		c.JSON(200, gin.H{"saved": true})
	})
	routes.POST("/upload", ContentAdminAuthMiddleware(auth), func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMultipartSafetyBytes)
		if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
			var sizeError *http.MaxBytesError
			if errors.As(err, &sizeError) {
				c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "Загрузка превышает защитный предел сервера"})
			} else {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Не удалось прочитать файл звука"})
			}
			return
		}
		defer c.Request.MultipartForm.RemoveAll()
		name, license := strings.TrimSpace(c.PostForm("name")), strings.TrimSpace(c.PostForm("license"))
		if len([]rune(name)) < 1 || len([]rune(name)) > 200 || license == "" || len(license) > 2000 {
			c.JSON(400, gin.H{"error": "Укажите название и источник/лицензию звука"})
			return
		}
		f, err := c.FormFile("file")
		if err != nil {
			c.JSON(400, gin.H{"error": "Выберите WAV, MP3 или OGG"})
			return
		}
		src, err := f.Open()
		if err != nil {
			c.JSON(400, gin.H{"error": "Не удалось прочитать звук"})
			return
		}
		defer src.Close()
		header := make([]byte, 16)
		n, err := io.ReadFull(src, header)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			c.JSON(400, gin.H{"error": "Не удалось прочитать звук"})
			return
		}
		contentType, ext := audioMediaType(header[:n])
		if ext == "" {
			c.JSON(400, gin.H{"error": "Нужен WAV, MP3 или OGG, а не файл другого типа"})
			return
		}
		storage, err := NewYandexStorageService()
		if err != nil {
			c.JSON(503, gin.H{"error": "Ключи Yandex Storage не настроены на сервере"})
			return
		}
		url, objectKey, err := storage.UploadFile(c.Request.Context(), f, "audio/entities", ext, contentType)
		if err != nil {
			c.JSON(502, gin.H{"error": "Не удалось загрузить звук в хранилище"})
			return
		}
		row := AudioCue{Key: "custom." + uuid.NewString(), Name: name, Channel: "effects", URL: url, Gain: 1, License: license, Version: 1}
		if db.Create(&row).Error != nil {
			_ = storage.DeleteImage(c.Request.Context(), objectKey)
			c.JSON(500, gin.H{"error": "Не удалось сохранить звук"})
			return
		}
		c.JSON(201, row)
	})
}
