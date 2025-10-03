package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type Card struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Properties          []string `json:"properties"`
	Description         string   `json:"description"`
	DetailedDescription *string  `json:"detailed_description"`
	ImageURL            string   `json:"image_url"`
	Rarity              string   `json:"rarity"`
	CardNumber          string   `json:"card_number"`
	Price               *int     `json:"price"`
	Weight              *float64 `json:"weight"`
	BonusType           *string  `json:"bonus_type"`
	BonusValue          *string  `json:"bonus_value"`
	DamageType          *string  `json:"damage_type"`
	DefenseType         *string  `json:"defense_type"`
	Type                *string  `json:"type"`
	DescriptionFontSize *int     `json:"description_font_size"`
	IsExtended          *bool    `json:"is_extended"`
	IsTemplate          string   `json:"is_template"`
	Slot                *string  `json:"slot"`
	CreatedAt           string   `json:"created_at"`
	UpdatedAt           string   `json:"updated_at"`
}

type UpdateCardRequest struct {
	Name                string   `json:"name"`
	Properties          []string `json:"properties"`
	Description         string   `json:"description"`
	DetailedDescription *string  `json:"detailed_description"`
	Rarity              string   `json:"rarity"`
	Price               *int     `json:"price"`
	Weight              *float64 `json:"weight"`
	BonusType           *string  `json:"bonus_type"`
	BonusValue          *string  `json:"bonus_value"`
	DamageType          *string  `json:"damage_type"`
	DefenseType         *string  `json:"defense_type"`
	Type                *string  `json:"type"`
	DescriptionFontSize *int     `json:"description_font_size"`
	IsExtended          *bool    `json:"is_extended"`
	IsTemplate          string   `json:"is_template"`
	Slot                *string  `json:"slot"`
	Tags                []string `json:"tags"`
}

// Определяем категории оружия согласно таблицам
var weaponCategories = map[string]map[string]bool{
	// Простое рукопашное оружие
	"Боевой посох":      {"Простое": true, "Ближнее": true},
	"Булава":            {"Простое": true, "Ближнее": true},
	"Дубинка":           {"Простое": true, "Ближнее": true},
	"Кинжал":            {"Простое": true, "Ближнее": true, "Метательное": true},
	"Копьё":             {"Простое": true, "Ближнее": true, "Метательное": true},
	"Лёгкий молот":      {"Простое": true, "Ближнее": true, "Метательное": true},
	"Метательное копьё": {"Простое": true, "Ближнее": true, "Метательное": true},
	"Палица":            {"Простое": true, "Ближнее": true},
	"Ручной топор":      {"Простое": true, "Ближнее": true, "Метательное": true},
	"Серп":              {"Простое": true, "Ближнее": true},

	// Простое дальнобойное оружие
	"Арбалет, лёгкий": {"Простое": true, "Дальнобойное": true},
	"Дротик":          {"Простое": true, "Дальнобойное": true, "Метательное": true},
	"Короткий лук":    {"Простое": true, "Дальнобойное": true},
	"Праща":           {"Простое": true, "Дальнобойное": true},

	// Воинское рукопашное оружие
	"Алебарда":      {"Воинское": true, "Ближнее": true},
	"Боевая кирка":  {"Воинское": true, "Ближнее": true},
	"Боевой молот":  {"Воинское": true, "Ближнее": true},
	"Боевой топор":  {"Воинское": true, "Ближнее": true},
	"Глефа":         {"Воинское": true, "Ближнее": true},
	"Двуручный меч": {"Воинское": true, "Ближнее": true},
	"Длинное копьё": {"Воинское": true, "Ближнее": true},
	"Длинный меч":   {"Воинское": true, "Ближнее": true},
	"Кнут":          {"Воинское": true, "Ближнее": true},
	"Короткий меч":  {"Воинское": true, "Ближнее": true},
	"Молот":         {"Воинское": true, "Ближнее": true},
	"Пика":          {"Воинское": true, "Ближнее": true},
	"Рапира":        {"Воинское": true, "Ближнее": true},
	"Секира":        {"Воинское": true, "Ближнее": true},
	"Скимитар":      {"Воинское": true, "Ближнее": true},
	"Трезубец":      {"Воинское": true, "Ближнее": true, "Метательное": true},
	"Цеп":           {"Воинское": true, "Ближнее": true},

	// Воинское дальнобойное оружие
	"Арбалет, ручной":  {"Воинское": true, "Дальнобойное": true},
	"Арбалет, тяжёлый": {"Воинское": true, "Дальнобойное": true},
	"Длинный лук":      {"Воинское": true, "Дальнобойное": true},
	"Духовая трубка":   {"Воинское": true, "Дальнобойное": true},
	"Сеть":             {"Воинское": true, "Дальнобойное": true, "Метательное": true},
}

// Определяем слот на основе свойств оружия
func determineSlot(properties []string) string {
	props := make(map[string]bool)
	for _, prop := range properties {
		props[prop] = true
	}

	// Проверяем свойства в порядке приоритета
	if props["two-handed"] {
		return "two_hands" // "Две руки"
	}
	if props["versatile"] {
		return "versatile" // "Универсальное"
	}
	return "one_hand" // "Одна рука"
}

// Определяем теги на основе названия оружия и свойств
func determineTags(name string, properties []string) []string {
	var tags []string

	// Получаем базовые теги из категории
	if category, exists := weaponCategories[name]; exists {
		for tag := range category {
			tags = append(tags, tag)
		}
	} else {
		// Если оружие не найдено в таблице, определяем по свойствам
		// Проверяем наличие дальнобойных свойств
		hasRanged := false
		for _, prop := range properties {
			if prop == "ammunition" || prop == "loading" {
				hasRanged = true
				break
			}
		}

		if hasRanged {
			tags = append(tags, "Простое", "Дальнобойное")
		} else {
			tags = append(tags, "Простое", "Ближнее")
		}
	}

	// Добавляем тег "Метательное" если есть свойство "thrown"
	for _, prop := range properties {
		if prop == "thrown" {
			tags = append(tags, "Метательное")
			break
		}
	}

	return tags
}

func main() {
	// URL API
	apiURL := "http://localhost:8080/api"

	// Получаем токен авторизации
	fmt.Println("Получаем токен авторизации...")
	authData := map[string]string{
		"username": "admin",
		"password": "admin123",
	}
	authJSON, _ := json.Marshal(authData)

	authResp, err := http.Post(apiURL+"/auth/login", "application/json", bytes.NewBuffer(authJSON))
	if err != nil {
		fmt.Printf("Ошибка авторизации: %v\n", err)
		os.Exit(1)
	}
	defer authResp.Body.Close()

	authBody, err := io.ReadAll(authResp.Body)
	if err != nil {
		fmt.Printf("Ошибка чтения ответа авторизации: %v\n", err)
		os.Exit(1)
	}

	var authResponse struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(authBody, &authResponse); err != nil {
		fmt.Printf("Ошибка парсинга токена: %v\n", err)
		os.Exit(1)
	}

	if authResponse.Token == "" {
		fmt.Printf("Не удалось получить токен: %s\n", string(authBody))
		os.Exit(1)
	}

	fmt.Println("Токен получен успешно")

	// Получаем все шаблоны оружия
	fmt.Println("Получаем шаблоны оружия...")
	resp, err := http.Get(apiURL + "/cards?template_only=true&limit=100")
	if err != nil {
		fmt.Printf("Ошибка получения карт: %v\n", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Ошибка чтения ответа: %v\n", err)
		os.Exit(1)
	}

	var response struct {
		Cards []Card `json:"cards"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		fmt.Printf("Ошибка парсинга JSON: %v\n", err)
		os.Exit(1)
	}

	// Фильтруем только оружие (тип "weapon")
	var weaponTemplates []Card
	for _, card := range response.Cards {
		if card.Type != nil && *card.Type == "weapon" {
			weaponTemplates = append(weaponTemplates, card)
		}
	}

	fmt.Printf("Найдено %d шаблонов оружия\n", len(weaponTemplates))

	// Обновляем каждый шаблон оружия
	for _, template := range weaponTemplates {
		fmt.Printf("Обновляем: %s (ID: %s)\n", template.Name, template.ID)

		// Определяем слот и теги
		slot := determineSlot(template.Properties)
		tags := determineTags(template.Name, template.Properties)

		fmt.Printf("  Слот: %s\n", slot)
		fmt.Printf("  Теги: %s\n", strings.Join(tags, ", "))

		// Подготавливаем данные для обновления
		updateData := UpdateCardRequest{
			Name:                template.Name,
			Properties:          template.Properties,
			Description:         template.Description,
			DetailedDescription: template.DetailedDescription,
			Rarity:              template.Rarity,
			Price:               template.Price,
			Weight:              template.Weight,
			BonusType:           template.BonusType,
			BonusValue:          template.BonusValue,
			DamageType:          template.DamageType,
			DefenseType:         template.DefenseType,
			Type:                template.Type,
			DescriptionFontSize: template.DescriptionFontSize,
			IsExtended:          template.IsExtended,
			IsTemplate:          "only_template", // Устанавливаем только шаблон
			Slot:                &slot,           // Устанавливаем слот
			Tags:                tags,            // Устанавливаем теги
		}

		// Отправляем запрос на обновление
		jsonData, err := json.Marshal(updateData)
		if err != nil {
			fmt.Printf("Ошибка сериализации данных: %v\n", err)
			continue
		}

		req, err := http.NewRequest("PUT", apiURL+"/cards/"+template.ID, bytes.NewBuffer(jsonData))
		if err != nil {
			fmt.Printf("Ошибка создания запроса: %v\n", err)
			continue
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+authResponse.Token)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("Ошибка отправки запроса: %v\n", err)
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == 200 {
			fmt.Printf("✅ Успешно обновлен: %s\n", template.Name)
		} else {
			body, _ := io.ReadAll(resp.Body)
			fmt.Printf("❌ Ошибка обновления %s: %s (статус: %d)\n", template.Name, string(body), resp.StatusCode)
		}
	}

	fmt.Println("Обновление завершено!")
}
