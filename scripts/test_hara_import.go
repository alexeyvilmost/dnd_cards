package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
)

type ImportCharacterRequest struct {
	CharacterData string  `json:"character_data"`
	GroupID       *string `json:"group_id,omitempty"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

func main() {
	// Читаем файл Hara.json
	fileData, err := os.ReadFile("../Hara.json")
	if err != nil {
		log.Fatalf("Ошибка чтения файла: %v", err)
	}

	fmt.Printf("Размер файла Hara.json: %d байт\n", len(fileData))
	fmt.Printf("Первые 200 символов: %s\n", string(fileData[:min(200, len(fileData))]))
	fmt.Printf("Последние 200 символов: %s\n", string(fileData[max(0, len(fileData)-200):]))

	// Парсим JSON для проверки структуры
	var jsonData map[string]interface{}
	if err := json.Unmarshal(fileData, &jsonData); err != nil {
		log.Fatalf("Ошибка парсинга JSON: %v", err)
	}

	fmt.Printf("Ключи верхнего уровня: %v\n", getKeys(jsonData))

	// Проверяем поле data
	if dataField, exists := jsonData["data"]; exists {
		if dataStr, ok := dataField.(string); ok {
			fmt.Printf("Поле 'data' найдено, размер: %d байт\n", len(dataStr))
			fmt.Printf("Последние 200 символов поля 'data': %s\n", dataStr[max(0, len(dataStr)-200):])

			// Парсим вложенные данные
			var nestedData map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &nestedData); err == nil {
				fmt.Printf("Ключи вложенных данных: %v\n", getKeys(nestedData))

				// Проверяем наличие traits
				if _, hasTraits := nestedData["traits"]; hasTraits {
					fmt.Println("✓ Найдено поле 'traits' во вложенных данных")
				} else {
					fmt.Println("✗ Поле 'traits' НЕ найдено во вложенных данных")
				}
			} else {
				fmt.Printf("Ошибка парсинга вложенных данных: %v\n", err)
			}
		}
	}

	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		log.Fatalf("Ошибка получения токена: %v", err)
	}

	// Отправляем запрос на импорт
	reqBody := ImportCharacterRequest{
		CharacterData: string(fileData),
	}

	reqJsonData, err := json.Marshal(reqBody)
	if err != nil {
		log.Fatalf("Ошибка маршалинга запроса: %v", err)
	}

	req, err := http.NewRequest("POST", "http://localhost:8080/api/characters/import", bytes.NewBuffer(reqJsonData))
	if err != nil {
		log.Fatalf("Ошибка создания запроса: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
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
	fmt.Printf("Ответ: %s\n", string(body))
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

// min возвращает минимальное из двух значений
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// max возвращает максимальное из двух значений
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
