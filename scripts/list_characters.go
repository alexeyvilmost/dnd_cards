package main

import (
	scriptauth "armor-loader/internal/scriptauth"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

func main() {
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		log.Fatalf("Ошибка получения токена: %v", err)
	}

	// Получаем список персонажей
	characters, err := getCharacters(token)
	if err != nil {
		log.Fatalf("Ошибка получения персонажей: %v", err)
	}

	// Выводим список персонажей
	fmt.Printf("Найдено персонажей: %d\n\n", len(characters))
	for i, char := range characters {
		if charMap, ok := char.(map[string]interface{}); ok {
			fmt.Printf("%d. ID: %v\n", i+1, charMap["id"])
			fmt.Printf("   Имя: %v\n", charMap["name"])
			fmt.Printf("   Группа: %v\n", charMap["group_id"])
			fmt.Println()
		}
	}
}

func getAuthToken() (string, error) {
	return scriptauth.Token("http://localhost:8080/api")
}

func getCharacters(token string) ([]interface{}, error) {
	req, _ := http.NewRequest("GET", "http://localhost:8080/api/characters", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)

	if characters, ok := result["characters"].([]interface{}); ok {
		return characters, nil
	}
	return nil, fmt.Errorf("персонажи не найдены в ответе")
}
