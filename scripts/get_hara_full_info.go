package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
)

type AuthResponse struct {
	Token string `json:"token"`
}

type CharacterResponse struct {
	ID          string      `json:"id"`
	UserID      string      `json:"user_id"`
	GroupID     *string     `json:"group_id"`
	Name        string      `json:"name"`
	Data        string      `json:"data"`
	CreatedAt   string      `json:"created_at"`
	UpdatedAt   string      `json:"updated_at"`
	Group       interface{} `json:"group"`
	Inventories interface{} `json:"inventories"`
}

type CharactersResponse struct {
	Characters []CharacterResponse `json:"characters"`
	Total      int                 `json:"total"`
	Limit      int                 `json:"limit"`
	Offset     int                 `json:"offset"`
}

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		log.Fatalf("Ошибка получения токена: %v", err)
	}

	// Получаем список всех персонажей
	req, err := http.NewRequest("GET", "http://localhost:8080/api/characters", nil)
	if err != nil {
		log.Fatalf("Ошибка создания запроса: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("Ошибка отправки запроса: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatalf("Ошибка чтения ответа: %v", err)
	}

	fmt.Printf("Статус ответа: %d\n", resp.StatusCode)

	var charactersResp CharactersResponse
	if err := json.Unmarshal(body, &charactersResp); err != nil {
		log.Fatalf("Ошибка парсинга ответа: %v", err)
	}

	fmt.Printf("Найдено персонажей: %d\n", len(charactersResp.Characters))

	// Ищем персонажа "Хара"
	var haraCharacter *CharacterResponse
	for _, char := range charactersResp.Characters {
		if char.Name == "Хара" {
			haraCharacter = &char
			break
		}
	}

	if haraCharacter == nil {
		log.Fatalf("Персонаж 'Хара' не найден")
	}

	fmt.Printf("Найден персонаж: %s (ID: %s)\n", haraCharacter.Name, haraCharacter.ID)
	fmt.Printf("Размер данных: %d байт\n", len(haraCharacter.Data))

	// Получаем детальную информацию о персонаже по ID
	detailReq, err := http.NewRequest("GET", "http://localhost:8080/api/characters/"+haraCharacter.ID, nil)
	if err != nil {
		log.Fatalf("Ошибка создания запроса для детальной информации: %v", err)
	}

	detailReq.Header.Set("Authorization", "Bearer "+token)

	detailResp, err := client.Do(detailReq)
	if err != nil {
		log.Fatalf("Ошибка отправки запроса для детальной информации: %v", err)
	}
	defer detailResp.Body.Close()

	detailBody, err := io.ReadAll(detailResp.Body)
	if err != nil {
		log.Fatalf("Ошибка чтения ответа с детальной информацией: %v", err)
	}

	fmt.Printf("Статус ответа для детальной информации: %d\n", detailResp.StatusCode)

	// Парсим детальный ответ
	var detailCharacter CharacterResponse
	if err := json.Unmarshal(detailBody, &detailCharacter); err != nil {
		log.Fatalf("Ошибка парсинга детального ответа: %v", err)
	}

	// Сохраняем полную информацию в JSON файл
	outputFile := "../Hara_full_info.json"
	prettyJSON, err := json.MarshalIndent(detailCharacter, "", "  ")
	if err != nil {
		log.Fatalf("Ошибка форматирования JSON: %v", err)
	}

	if err := ioutil.WriteFile(outputFile, prettyJSON, 0644); err != nil {
		log.Fatalf("Ошибка записи файла: %v", err)
	}

	fmt.Printf("Полная информация о персонаже сохранена в файл: %s\n", outputFile)
	fmt.Printf("Размер сохраненного файла: %d байт\n", len(prettyJSON))

	// Парсим данные персонажа для анализа
	var charData map[string]interface{}
	if err := json.Unmarshal([]byte(detailCharacter.Data), &charData); err != nil {
		log.Fatalf("Ошибка парсинга данных персонажа: %v", err)
	}

	fmt.Printf("\nАнализ данных персонажа:\n")
	fmt.Printf("Ключи в данных: %v\n", getKeys(charData))

	// Проверяем наличие traits в разных местах
	if _, hasTraits := charData["traits"]; hasTraits {
		fmt.Println("✓ Найдено поле 'traits' в корне данных")
	} else {
		fmt.Println("✗ Поле 'traits' НЕ найдено в корне данных")
	}

	if textField, hasText := charData["text"]; hasText {
		fmt.Println("✓ Найдено поле 'text' в данных")
		if textMap, ok := textField.(map[string]interface{}); ok {
			if _, hasTraitsInText := textMap["traits"]; hasTraitsInText {
				fmt.Println("✓ Найдено поле 'traits' в data.text")
			} else {
				fmt.Println("✗ Поле 'traits' НЕ найдено в data.text")
			}
		}
	} else {
		fmt.Println("✗ Поле 'text' НЕ найдено в данных")
	}

	// Показываем последние 200 символов данных
	fmt.Printf("\nПоследние 200 символов данных:\n%s\n", detailCharacter.Data[max(0, len(detailCharacter.Data)-200):])
}

func getAuthToken() (string, error) {
	// Данные для авторизации
	authData := map[string]string{
		"username":     "admin",
		"password":     "admin123",
		"email":        "admin@example.com",
		"display_name": "Admin",
	}

	jsonData, err := json.Marshal(authData)
	if err != nil {
		return "", err
	}

	// Сначала пробуем залогиниться
	resp, err := http.Post("http://localhost:8080/api/auth/login", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		var authResp AuthResponse
		if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
			return "", err
		}
		return authResp.Token, nil
	}

	// Если логин не удался, пробуем зарегистрироваться
	resp, err = http.Post("http://localhost:8080/api/auth/register", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 201 {
		var authResp AuthResponse
		if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
			return "", err
		}
		return authResp.Token, nil
	}

	return "", fmt.Errorf("ошибка авторизации")
}

// getKeys возвращает список ключей из map
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// max возвращает максимальное из двух значений
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

