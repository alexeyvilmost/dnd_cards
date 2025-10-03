package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
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

	// Получаем все шаблоны брони
	fmt.Println("Получаем шаблоны брони...")
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

	// Фильтруем только броню (тип "armor")
	var armorTemplates []Card
	for _, card := range response.Cards {
		if card.Type != nil && *card.Type == "armor" {
			armorTemplates = append(armorTemplates, card)
		}
	}

	fmt.Printf("Найдено %d шаблонов брони\n", len(armorTemplates))

	// Обновляем каждый шаблон брони
	for _, template := range armorTemplates {
		fmt.Printf("Обновляем: %s (ID: %s)\n", template.Name, template.ID)

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
			Type:                stringPtr("chest"), // Изменяем тип на "chest" (Торс)
			DescriptionFontSize: template.DescriptionFontSize,
			IsExtended:          template.IsExtended,
			IsTemplate:          "only_template",   // Устанавливаем только шаблон
			Slot:                stringPtr("body"), // Устанавливаем слот "body" (Тело)
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

func stringPtr(s string) *string {
	return &s
}
