package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string `json:"token"`
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

	// ID последнего созданного персонажа
	characterID := "fb1c6b35-dc45-42ad-a6d3-7177ef0ca65b"

	// Получаем конкретного персонажа
	character, err := getCharacter(token, characterID)
	if err != nil {
		fmt.Printf("Ошибка получения персонажа: %v\n", err)
		return
	}

	fmt.Printf("Персонаж: %s (ID: %s)\n", character.Name, character.ID)
	fmt.Printf("Размер данных: %d байт\n", len(character.Data))
	
	// Парсим данные персонажа
	var characterData map[string]interface{}
	if err := json.Unmarshal([]byte(character.Data), &characterData); err != nil {
		fmt.Printf("❌ Ошибка парсинга данных: %v\n", err)
		return
	}
	
	// Проверяем наличие traits
	if traits, exists := characterData["traits"]; exists {
		fmt.Printf("✅ Поле 'traits' найдено!\n")
		traitsBytes, _ := json.MarshalIndent(traits, "", "  ")
		fmt.Printf("Содержимое traits (первые 500 символов): %s...\n", string(traitsBytes)[:min(500, len(traitsBytes))])
	} else {
		fmt.Printf("❌ Поле 'traits' НЕ найдено\n")
		
		// Выводим все ключи
		fmt.Printf("Ключи в данных: ")
		for key := range characterData {
			fmt.Printf("'%s' ", key)
		}
		fmt.Printf("\n")
		
		// Выводим последние 500 символов данных
		fmt.Printf("Последние 500 символов данных: %s\n", character.Data[max(0, len(character.Data)-500):])
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
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

func getCharacter(token, characterID string) (*Character, error) {
	req, err := http.NewRequest("GET", "http://localhost:8080/api/characters/"+characterID, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ошибка получения персонажа: %s", string(body))
	}

	var character Character
	if err := json.Unmarshal(body, &character); err != nil {
		return nil, err
	}

	return &character, nil
}

