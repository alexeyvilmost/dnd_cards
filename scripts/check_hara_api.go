package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

type AuthResponse struct {
	Token string `json:"token"`
}

type CharacterResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Data string `json:"data"`
}

type CharactersResponse struct {
	Characters []CharacterResponse `json:"characters"`
}

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		log.Fatalf("Ошибка получения токена: %v", err)
	}

	// Получаем список персонажей
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

	// Ищем персонажа "Хара"
	for _, char := range charactersResp.Characters {
		if char.Name == "Хара" {
			fmt.Printf("Найден персонаж: %s (ID: %s)\n", char.Name, char.ID)
			fmt.Printf("Размер данных: %d байт\n", len(char.Data))

			// Парсим данные персонажа
			var charData map[string]interface{}
			if err := json.Unmarshal([]byte(char.Data), &charData); err != nil {
				log.Fatalf("Ошибка парсинга данных персонажа: %v", err)
			}

			fmt.Printf("Ключи в данных персонажа: %v\n", getKeys(charData))

			// Проверяем наличие traits
			if _, hasTraits := charData["traits"]; hasTraits {
				fmt.Println("✓ Найдено поле 'traits' в данных персонажа")

				// Показываем содержимое traits
				if traitsData, ok := charData["traits"].(map[string]interface{}); ok {
					if valueData, ok := traitsData["value"].(map[string]interface{}); ok {
						if dataData, ok := valueData["data"].(map[string]interface{}); ok {
							if contentData, ok := dataData["content"].([]interface{}); ok {
								fmt.Printf("Количество параграфов в traits: %d\n", len(contentData))

								// Показываем первые несколько параграфов
								for i, paragraph := range contentData {
									if i >= 3 { // Показываем только первые 3
										break
									}
									if paraMap, ok := paragraph.(map[string]interface{}); ok {
										if paraType, ok := paraMap["type"].(string); ok {
											fmt.Printf("Параграф %d: тип %s\n", i+1, paraType)
										}
									}
								}
							}
						}
					}
				}
			} else {
				fmt.Println("✗ Поле 'traits' НЕ найдено в данных персонажа")
			}

			// Показываем последние 200 символов данных
			fmt.Printf("Последние 200 символов данных: %s\n", char.Data[max(0, len(char.Data)-200):])
			break
		}
	}
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
