package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// InventoryController - контроллер для работы с инвентарем
type InventoryController struct {
	db *gorm.DB
}

// NewInventoryController - создание нового контроллера инвентаря
func NewInventoryController(db *gorm.DB) *InventoryController {
	return &InventoryController{db: db}
}

// CreateInventory - создание нового инвентаря
func (ic *InventoryController) CreateInventory(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var req CreateInventoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Создаем инвентарь
	inventory := Inventory{
		Type:   req.Type,
		Name:   req.Name,
		UserID: &userID, // По умолчанию привязываем к пользователю
	}

	// Если это групповой инвентарь, проверяем права
	if req.Type == InventoryTypeGroup {
		if req.GroupID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "для группового инвентаря необходимо указать group_id"})
			return
		}

		// Проверяем, является ли пользователь ДМом группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ? AND role = ?", *req.GroupID, userID, RoleDM).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "только ДМ может создавать групповой инвентарь"})
			return
		}

		inventory.GroupID = req.GroupID
		inventory.UserID = nil // Для группового инвентаря UserID = nil
	}

	if err := ic.db.Create(&inventory).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка создания инвентаря"})
		return
	}

	// Загружаем связанные данные
	if err := ic.db.Preload("User").Preload("Group").First(&inventory, inventory.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки данных инвентаря"})
		return
	}

	c.JSON(http.StatusCreated, inventory)
}

// GetInventories - получение списка инвентарей пользователя
func (ic *InventoryController) GetInventories(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	var inventories []Inventory

	// Получаем личные инвентари пользователя
	if err := ic.db.Preload("Items.Card").Where("user_id = ?", userID).Find(&inventories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения личных инвентарей"})
		return
	}

	// Получаем групповые инвентари, где пользователь является участником
	var groupInventories []Inventory
	if err := ic.db.Preload("Items.Card").Preload("Group").
		Joins("JOIN group_members ON inventories.group_id = group_members.group_id").
		Where("group_members.user_id = ? AND inventories.type = ?", userID, InventoryTypeGroup).
		Find(&groupInventories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения групповых инвентарей"})
		return
	}

	// Объединяем результаты
	inventories = append(inventories, groupInventories...)

	c.JSON(http.StatusOK, inventories)
}

// GetInventory - получение информации об инвентаре
func (ic *InventoryController) GetInventory(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	inventoryIDStr := c.Param("id")
	inventoryID, err := uuid.Parse(inventoryIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID инвентаря"})
		return
	}

	var inventory Inventory
	if err := ic.db.Preload("Items.Card").Preload("User").Preload("Group").First(&inventory, inventoryID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "инвентарь не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения инвентаря"})
		return
	}

	// Проверяем права доступа
	if inventory.Type == InventoryTypePersonal {
		if inventory.UserID == nil || *inventory.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	} else if inventory.Type == InventoryTypeGroup {
		if inventory.GroupID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "неверная конфигурация группового инвентаря"})
			return
		}

		// Проверяем, является ли пользователь участником группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ?", *inventory.GroupID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	}

	c.JSON(http.StatusOK, inventory)
}

// AddItemToInventory - добавление предмета в инвентарь
func (ic *InventoryController) AddItemToInventory(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	inventoryIDStr := c.Param("id")
	inventoryID, err := uuid.Parse(inventoryIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID инвентаря"})
		return
	}

	var req AddItemToInventoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Получаем инвентарь и проверяем права доступа
	var inventory Inventory
	if err := ic.db.Preload("Group").First(&inventory, inventoryID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "инвентарь не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения инвентаря"})
		return
	}

	// Проверяем права доступа
	if inventory.Type == InventoryTypePersonal {
		if inventory.UserID == nil || *inventory.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	} else if inventory.Type == InventoryTypeGroup {
		if inventory.GroupID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "неверная конфигурация группового инвентаря"})
			return
		}

		// Проверяем, является ли пользователь участником группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ?", *inventory.GroupID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	}

	// Проверяем, существует ли карточка
	var card Card
	if err := ic.db.First(&card, req.CardID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "карточка не найдена"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка поиска карточки"})
		return
	}

	// Проверяем, есть ли уже такой предмет в инвентаре
	var existingItem InventoryItem
	if err := ic.db.Where("inventory_id = ? AND card_id = ?", inventoryID, req.CardID).First(&existingItem).Error; err == nil {
		// Если предмет уже есть, увеличиваем количество
		existingItem.Quantity += req.Quantity
		if err := ic.db.Save(&existingItem).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления количества предмета"})
			return
		}
		c.JSON(http.StatusOK, existingItem)
		return
	}

	// Создаем новый предмет в инвентаре
	item := InventoryItem{
		InventoryID: inventoryID,
		CardID:      req.CardID,
		Quantity:    req.Quantity,
		Notes:       req.Notes,
	}

	if err := ic.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка добавления предмета в инвентарь"})
		return
	}

	// Загружаем связанные данные
	if err := ic.db.Preload("Card").First(&item, item.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки данных предмета"})
		return
	}

	c.JSON(http.StatusCreated, item)
}

// UpdateInventoryItem - обновление предмета в инвентаре
func (ic *InventoryController) UpdateInventoryItem(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID предмета"})
		return
	}

	var req UpdateInventoryItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Получаем предмет и проверяем права доступа
	var item InventoryItem
	if err := ic.db.Preload("Inventory").Preload("Inventory.Group").First(&item, itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "предмет не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения предмета"})
		return
	}

	// Проверяем права доступа к инвентарю
	if item.Inventory.Type == InventoryTypePersonal {
		if item.Inventory.UserID == nil || *item.Inventory.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	} else if item.Inventory.Type == InventoryTypeGroup {
		if item.Inventory.GroupID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "неверная конфигурация группового инвентаря"})
			return
		}

		// Проверяем, является ли пользователь участником группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ?", *item.Inventory.GroupID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	}

	// Обновляем предмет
	item.Quantity = req.Quantity
	item.Notes = req.Notes
	if req.IsEquipped != nil {
		item.IsEquipped = *req.IsEquipped
	}

	if err := ic.db.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления предмета"})
		return
	}

	// Загружаем связанные данные
	if err := ic.db.Preload("Card").First(&item, item.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка загрузки данных предмета"})
		return
	}

	c.JSON(http.StatusOK, item)
}

// RemoveItemFromInventory - удаление предмета из инвентаря
func (ic *InventoryController) RemoveItemFromInventory(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID предмета"})
		return
	}

	// Получаем предмет и проверяем права доступа
	var item InventoryItem
	if err := ic.db.Preload("Inventory").Preload("Inventory.Group").First(&item, itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "предмет не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения предмета"})
		return
	}

	// Проверяем права доступа к инвентарю
	if item.Inventory.Type == InventoryTypePersonal {
		if item.Inventory.UserID == nil || *item.Inventory.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	} else if item.Inventory.Type == InventoryTypeGroup {
		if item.Inventory.GroupID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "неверная конфигурация группового инвентаря"})
			return
		}

		// Проверяем, является ли пользователь участником группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ?", *item.Inventory.GroupID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	}

	// Удаляем предмет
	if err := ic.db.Delete(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка удаления предмета"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "предмет успешно удален из инвентаря"})
}

// GetCharacterInventories - получение инвентарей персонажа
func (ic *InventoryController) GetCharacterInventories(c *gin.Context) {
	startTime := time.Now()
	log.Println("🚀 [PERF] GetCharacterInventories: Начало")

	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	characterIDStr := c.Param("id")
	characterID, err := uuid.Parse(characterIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID персонажа"})
		return
	}

	// Проверяем, что персонаж принадлежит пользователю
	checkStartTime := time.Now()
	var character CharacterV2
	if err := ic.db.Where("id = ? AND user_id = ?", characterID, userID).First(&character).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "персонаж не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения персонажа"})
		return
	}
	log.Printf("⏱️ [PERF] GetCharacterInventories: Проверка персонажа - %v", time.Since(checkStartTime))

	// Получаем инвентари персонажа
	queryStartTime := time.Now()
	var inventories []Inventory
	if err := ic.db.Preload("Items.Card").Where("character_id = ?", characterID).Find(&inventories).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения инвентарей персонажа"})
		return
	}
	log.Printf("⏱️ [PERF] GetCharacterInventories: Запрос инвентарей - %v", time.Since(queryStartTime))
	log.Printf("📊 [PERF] GetCharacterInventories: Найдено инвентарей: %d", len(inventories))

	for i, inv := range inventories {
		log.Printf("📦 [PERF] GetCharacterInventories: Инвентарь %d - предметов: %d", i, len(inv.Items))
	}

	log.Printf("✅ [PERF] GetCharacterInventories: Общее время - %v", time.Since(startTime))
	c.JSON(http.StatusOK, inventories)
}

// EquipItemRequest - запрос на экипировку предмета
type EquipItemRequest struct {
	IsEquipped bool `json:"is_equipped"`
}

// EquipItem - экипировка/снятие предмета
func (ic *InventoryController) EquipItem(c *gin.Context) {
	userID, err := GetCurrentUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "пользователь не авторизован"})
		return
	}

	itemIDStr := c.Param("itemId")
	itemID, err := uuid.Parse(itemIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверный ID предмета"})
		return
	}

	var req EquipItemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "неверные данные запроса: " + err.Error()})
		return
	}

	// Получаем предмет и проверяем права доступа
	var item InventoryItem
	if err := ic.db.Preload("Inventory").Preload("Card").First(&item, itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "предмет не найден"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка получения предмета"})
		return
	}

	// Проверяем права доступа к инвентарю
	if item.Inventory.Type == InventoryTypePersonal {
		if item.Inventory.UserID == nil || *item.Inventory.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	} else if item.Inventory.Type == InventoryTypeGroup {
		if item.Inventory.GroupID == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "неверная конфигурация группового инвентаря"})
			return
		}

		// Проверяем, является ли пользователь участником группы
		var member GroupMember
		if err := ic.db.Where("group_id = ? AND user_id = ?", *item.Inventory.GroupID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "у вас нет доступа к этому инвентарю"})
			return
		}
	}

	// Если экипируем предмет, проверяем, что у предмета есть слот экипировки
	if req.IsEquipped && (item.Card.Slot == nil || *item.Card.Slot == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "этот предмет нельзя экипировать"})
		return
	}

	// Если экипируем предмет, снимаем другие предметы в том же слоте
	if req.IsEquipped && item.Card.Slot != nil {
		// Находим все предметы в инвентарях персонажа с тем же слотом
		var conflictingItems []InventoryItem
		if err := ic.db.Preload("Card").
			Joins("JOIN inventories ON inventory_items.inventory_id = inventories.id").
			Where("inventories.character_id = ? AND inventory_items.is_equipped = true", item.Inventory.CharacterID).
			Find(&conflictingItems).Error; err == nil {

			for _, conflictItem := range conflictingItems {
				if conflictItem.Card.Slot != nil && *conflictItem.Card.Slot == *item.Card.Slot && conflictItem.ID != item.ID {
					conflictItem.IsEquipped = false
					ic.db.Save(&conflictItem)
				}
			}
		}
	}

	// Обновляем статус экипировки
	item.IsEquipped = req.IsEquipped

	if err := ic.db.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ошибка обновления предмета"})
		return
	}

	c.JSON(http.StatusOK, item)
}
