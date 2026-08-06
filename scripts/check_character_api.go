package main

import (
	scriptauth "armor-loader/internal/scriptauth"
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

type CharactersResponse struct {
	Characters []Character `json:"characters"`
	Total      int         `json:"total"`
}

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		fmt.Printf("Ошибка получения токена: %v\n", err)
		return
	}

	// Получаем список персонажей
	characters, err := getCharacters(token)
	if err != nil {
		fmt.Printf("Ошибка получения персонажей: %v\n", err)
		return
	}

	fmt.Printf("Найдено персонажей: %d\n", len(characters))
	for _, char := range characters {
		fmt.Printf("- %s (ID: %s)\n", char.Name, char.ID)

		// Парсим данные персонажа
		var characterData map[string]interface{}
		if err := json.Unmarshal([]byte(char.Data), &characterData); err != nil {
			fmt.Printf("  ❌ Ошибка парсинга данных: %v\n", err)
			continue
		}

		// Проверяем наличие traits
		if traits, exists := characterData["traits"]; exists {
			fmt.Printf("  ✅ Поле 'traits' найдено!\n")
			traitsBytes, _ := json.MarshalIndent(traits, "", "  ")
			fmt.Printf("  Содержимое traits (первые 300 символов): %s...\n", string(traitsBytes)[:min(300, len(traitsBytes))])
		} else {
			fmt.Printf("  ❌ Поле 'traits' НЕ найдено\n")

			// Выводим все ключи
			fmt.Printf("  Ключи в данных: ")
			for key := range characterData {
				fmt.Printf("'%s' ", key)
			}
			fmt.Printf("\n")
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func getAuthToken() (string, error) {
	return scriptauth.Token("http://localhost:8080/api")
}

func getCharacters(token string) ([]Character, error) {
	req, err := http.NewRequest("GET", "http://localhost:8080/api/characters", nil)
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
		return nil, fmt.Errorf("ошибка получения персонажей: %s", string(body))
	}

	var response CharactersResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return nil, err
	}

	return response.Characters, nil
}
