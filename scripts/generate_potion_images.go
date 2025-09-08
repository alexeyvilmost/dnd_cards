package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type AuthResponse struct {
	Token string `json:"token"`
}

type Card struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Rarity   string `json:"rarity"`
	ImageURL string `json:"image_url"`
}

type CardsResponse struct {
	Cards []Card `json:"cards"`
}

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		fmt.Printf("Ошибка получения токена: %v\n", err)
		return
	}

	fmt.Printf("Получен токен авторизации\n")

	// Получаем список зелий
	potions, err := getPotions(token)
	if err != nil {
		fmt.Printf("Ошибка получения списка зелий: %v\n", err)
		return
	}

	fmt.Printf("Найдено %d зелий для генерации изображений\n", len(potions))

	// Генерируем изображения
	generatedCount := 0
	for i, potion := range potions {
		fmt.Printf("Генерируем изображение %d/%d: %s\n", i+1, len(potions), potion.Name)

		err := generateImage(potion, token)
		if err != nil {
			fmt.Printf("  ✗ Ошибка: %v\n", err)
			continue
		}

		generatedCount++
		fmt.Printf("  ✓ Изображение сгенерировано для: %s\n", potion.Name)

		// Пауза между запросами
		time.Sleep(2 * time.Second)
	}

	fmt.Printf("\nВсего сгенерировано %d изображений\n", generatedCount)
}

func getAuthToken() (string, error) {
	// Сначала пытаемся зарегистрироваться
	registerData := map[string]string{
		"username":     "admin",
		"password":     "admin123",
		"email":        "admin@example.com",
		"display_name": "Admin",
	}

	jsonData, err := json.Marshal(registerData)
	if err != nil {
		return "", err
	}

	// Регистрируемся (игнорируем ошибку, если пользователь уже существует)
	http.Post("http://localhost:8080/api/auth/register", "application/json", bytes.NewBuffer(jsonData))

	// Теперь авторизуемся
	resp, err := http.Post("http://localhost:8080/api/auth/login", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ошибка авторизации: %s", string(body))
	}

	// Парсим ответ
	var authResp AuthResponse
	err = json.NewDecoder(resp.Body).Decode(&authResp)
	if err != nil {
		return "", err
	}

	return authResp.Token, nil
}

func getPotions(token string) ([]Card, error) {
	// Создаем HTTP запрос - получаем только зелья без изображений
	req, err := http.NewRequest("GET", "http://localhost:8080/api/cards?type=зелье&is_template=only_template&limit=100", nil)
	if err != nil {
		return nil, err
	}

	// Добавляем заголовки
	req.Header.Set("Authorization", "Bearer "+token)

	// Отправляем запрос
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("ошибка получения карт: %s", string(body))
	}

	// Парсим ответ
	var cardsResp CardsResponse
	err = json.NewDecoder(resp.Body).Decode(&cardsResp)
	if err != nil {
		return nil, err
	}

	// Фильтруем только зелья без изображений
	var potionsWithoutImages []Card
	for _, card := range cardsResp.Cards {
		if card.ImageURL == "" || card.ImageURL == "null" {
			potionsWithoutImages = append(potionsWithoutImages, card)
		}
	}

	return potionsWithoutImages, nil
}

func generateImage(potion Card, token string) error {
	// Создаем промпт для генерации изображения
	prompt := createImagePrompt(potion)

	// Данные для запроса генерации
	requestData := map[string]interface{}{
		"entity_type": "card",
		"entity_id":   potion.ID,
		"prompt":      prompt,
	}

	jsonData, err := json.Marshal(requestData)
	if err != nil {
		return err
	}

	// Создаем HTTP запрос
	req, err := http.NewRequest("POST", "http://localhost:8080/api/images/generate", bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	// Добавляем заголовки
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	// Отправляем запрос
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ошибка генерации изображения: %s", string(body))
	}

	return nil
}

func createImagePrompt(potion Card) string {
	// Базовый промпт для зелий
	basePrompt := "Fantasy item in videogame icon style. Object: %s with accent %s color and glow. Style — semi-realistic rendering, soft lighting, subtle outline glow, bright accents on glass bottle. Background transparent or black, minimal. Quality like an RPG item icon: detailed yet simplified background. Must be on transparent background."

	// Определяем цвет акцента на основе редкости
	accentColor := getRarityColor(potion.Rarity)

	// Если обычная редкость, убираем акцент
	if potion.Rarity == "common" {
		basePrompt = "Fantasy item in videogame icon style. Object: %s. Style — semi-realistic rendering, soft lighting, subtle outline glow, bright accents on glass bottle. Background transparent or black, minimal. Quality like an RPG item icon: detailed yet simplified background. Must be on transparent background."
		return fmt.Sprintf(basePrompt, potion.Name)
	}

	return fmt.Sprintf(basePrompt, potion.Name, accentColor)
}

func getRarityColor(rarity string) string {
	colors := map[string]string{
		"common":    "gray",
		"uncommon":  "green",
		"rare":      "blue",
		"very_rare": "purple",
		"legendary": "orange",
		"artifact":  "red",
	}

	if color, exists := colors[rarity]; exists {
		return color
	}
	return "gray"
}
