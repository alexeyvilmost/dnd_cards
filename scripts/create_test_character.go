package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
}

type ImportCharacterRequest struct {
	CharacterData string `json:"character_data"`
}

type Character struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Data string `json:"data"`
}

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		fmt.Printf("Ошибка получения токена: %v\n", err)
		return
	}

	// Читаем данные из example.json
	exampleData, err := os.ReadFile("../example.json")
	if err != nil {
		fmt.Printf("Ошибка чтения example.json: %v\n", err)
		return
	}

	fmt.Printf("Размер example.json: %d байт\n", len(exampleData))

	// Парсим JSON из example.json для проверки
	var exampleCharacter map[string]interface{}
	if err := json.Unmarshal(exampleData, &exampleCharacter); err != nil {
		fmt.Printf("Ошибка парсинга example.json: %v\n", err)
		return
	}

	// Выводим все ключи верхнего уровня
	fmt.Printf("Ключи верхнего уровня в example.json: ")
	for key := range exampleCharacter {
		fmt.Printf("'%s' ", key)
	}
	fmt.Printf("\n")

	// Проверяем наличие поля traits в example.json
	if traits, exists := exampleCharacter["traits"]; exists {
		fmt.Printf("✅ Поле 'traits' найдено в example.json\n")
		traitsBytes, _ := json.MarshalIndent(traits, "", "  ")
		fmt.Printf("Содержимое traits (первые 200 символов): %s...\n", string(traitsBytes)[:min(200, len(traitsBytes))])
	} else {
		fmt.Printf("❌ Поле 'traits' НЕ найдено в example.json на верхнем уровне\n")
		
		// Проверяем внутри поля data
		if dataField, exists := exampleCharacter["data"]; exists {
			if dataStr, ok := dataField.(string); ok {
				var dataContent map[string]interface{}
				if err := json.Unmarshal([]byte(dataStr), &dataContent); err == nil {
					fmt.Printf("Ключи внутри поля 'data': ")
					for key := range dataContent {
						fmt.Printf("'%s' ", key)
					}
					fmt.Printf("\n")
					
					if traits, exists := dataContent["traits"]; exists {
						fmt.Printf("✅ Поле 'traits' найдено внутри поля 'data'\n")
						traitsBytes, _ := json.MarshalIndent(traits, "", "  ")
						fmt.Printf("Содержимое traits (первые 200 символов): %s...\n", string(traitsBytes)[:min(200, len(traitsBytes))])
					} else {
						fmt.Printf("❌ Поле 'traits' НЕ найдено внутри поля 'data'\n")
						// Продолжаем выполнение, так как traits может быть в другом месте
					}
				} else {
					fmt.Printf("❌ Ошибка парсинга поля 'data': %v\n", err)
					return
				}
			} else {
				fmt.Printf("❌ Поле 'data' не является строкой\n")
				return
			}
		} else {
			fmt.Printf("❌ Поле 'data' не найдено в example.json\n")
			return
		}
	}

	// Создаем запрос на импорт
	importReq := ImportCharacterRequest{
		CharacterData: string(exampleData),
	}

	reqBody, err := json.Marshal(importReq)
	if err != nil {
		fmt.Printf("Ошибка сериализации запроса: %v\n", err)
		return
	}

	fmt.Printf("Размер запроса: %d байт\n", len(reqBody))
	
	// Проверяем, что traits есть в отправляемых данных
	if len(string(exampleData)) > 0 {
		exampleStr := string(exampleData)
		if len(exampleStr) > 1000 {
			fmt.Printf("Первые 1000 символов отправляемых данных: %s\n", exampleStr[:1000])
		} else {
			fmt.Printf("Все отправляемые данные: %s\n", exampleStr)
		}
		fmt.Printf("Последние 500 символов отправляемых данных: %s\n", exampleStr[max(0, len(exampleStr)-500):])
	}

	req, err := http.NewRequest("POST", "http://localhost:8080/api/characters/import", bytes.NewBuffer(reqBody))
	if err != nil {
		fmt.Printf("Ошибка создания запроса: %v\n", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Ошибка выполнения запроса: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("Ошибка чтения ответа: %v\n", err)
		return
	}

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
		var character Character
		if err := json.Unmarshal(body, &character); err != nil {
			fmt.Printf("Ошибка парсинга ответа: %v\n", err)
			return
		}
		fmt.Printf("✅ Персонаж успешно создан! ID: %s, Name: %s\n", character.ID, character.Name)
		
		// Проверяем, что traits есть в сохраненных данных
		var savedData map[string]interface{}
		if err := json.Unmarshal([]byte(character.Data), &savedData); err != nil {
			fmt.Printf("Ошибка парсинга сохраненных данных: %v\n", err)
			return
		}
		
		if traits, exists := savedData["traits"]; exists {
			fmt.Printf("✅ Поле 'traits' найдено в сохраненных данных\n")
			traitsBytes, _ := json.MarshalIndent(traits, "", "  ")
			fmt.Printf("Содержимое traits (первые 200 символов): %s...\n", string(traitsBytes)[:min(200, len(traitsBytes))])
		} else {
			fmt.Printf("❌ Поле 'traits' НЕ найдено в сохраненных данных\n")
		}
		
	} else {
		fmt.Printf("❌ Ошибка создания персонажа (статус %d): %s\n", resp.StatusCode, string(body))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func getAuthToken() (string, error) {
	// Сначала пытаемся зарегистрировать пользователя
	registerData := map[string]string{
		"username":     "admin",
		"password":     "admin123",
		"email":        "admin@example.com",
		"display_name": "Admin",
	}

	registerBody, err := json.Marshal(registerData)
	if err != nil {
		return "", err
	}

	resp, err := http.Post("http://localhost:8080/api/auth/register", "application/json", bytes.NewBuffer(registerBody))
	if err != nil {
		return "", err
	}
	resp.Body.Close()

	// Теперь логинимся
	loginData := LoginRequest{
		Username: "admin",
		Password: "admin123",
	}

	loginBody, err := json.Marshal(loginData)
	if err != nil {
		return "", err
	}

	resp, err = http.Post("http://localhost:8080/api/auth/login", "application/json", bytes.NewBuffer(loginBody))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ошибка авторизации: %s", string(body))
	}

	var loginResp LoginResponse
	if err := json.Unmarshal(body, &loginResp); err != nil {
		return "", err
	}

	return loginResp.Token, nil
}
