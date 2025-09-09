package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
)

func main() {
	characterID := "f38ae5d4-455b-4df1-9e1d-79f4a006ca6c"
	
	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		log.Fatalf("Ошибка получения токена: %v", err)
	}

	// Получаем информацию о персонаже
	character, err := getCharacter(characterID, token)
	if err != nil {
		log.Fatalf("Ошибка получения персонажа: %v", err)
	}

	// Сохраняем полную информацию в файл
	characterJSON, _ := json.MarshalIndent(character, "", "  ")
	ioutil.WriteFile("character_analysis.json", characterJSON, 0644)
	fmt.Printf("Полная информация о персонаже сохранена в character_analysis.json\n\n")

	// Анализируем traits
	if dataField, exists := character["data"]; exists {
		if dataStr, ok := dataField.(string); ok {
			var dataJson map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &dataJson); err == nil {
				analyzeTraits(dataJson)
			}
		}
	}
}

func getAuthToken() (string, error) {
	loginData := map[string]string{
		"username": "testuser123",
		"password": "password123",
	}

	jsonData, _ := json.Marshal(loginData)
	resp, err := http.Post("http://localhost:8080/api/auth/login", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	
	if token, ok := result["token"].(string); ok {
		return token, nil
	}
	return "", fmt.Errorf("токен не найден в ответе")
}

func getCharacter(characterID, token string) (map[string]interface{}, error) {
	req, _ := http.NewRequest("GET", "http://localhost:8080/api/characters/"+characterID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var character map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&character)
	return character, nil
}

func analyzeTraits(dataJson map[string]interface{}) {
	fmt.Printf("Анализ структуры traits для персонажа:\n")
	
	// Получаем traits
	if textField, exists := dataJson["text"]; exists {
		if textMap, ok := textField.(map[string]interface{}); ok {
			if traitsField, exists := textMap["traits"]; exists {
				if traitsMap, ok := traitsField.(map[string]interface{}); ok {
					if valueField, exists := traitsMap["value"]; exists {
						if valueMap, ok := valueField.(map[string]interface{}); ok {
							if dataField, exists := valueMap["data"]; exists {
								if dataMap, ok := dataField.(map[string]interface{}); ok {
									if contentField, exists := dataMap["content"]; exists {
										if contentArray, ok := contentField.([]interface{}); ok {
											fmt.Printf("Количество элементов в traits: %d\n\n", len(contentArray))
											
											for i, item := range contentArray {
												if itemMap, ok := item.(map[string]interface{}); ok {
													fmt.Printf("=== Элемент %d ===\n", i+1)
													fmt.Printf("Тип: %v\n", itemMap["type"])
													
													if content, ok := itemMap["content"].([]interface{}); ok {
														fmt.Printf("Количество подэлементов: %d\n", len(content))
														
														for j, subItem := range content {
															if subItemMap, ok := subItem.(map[string]interface{}); ok {
																fmt.Printf("  Подэлемент %d: тип %v\n", j+1, subItemMap["type"])
																
																if text, ok := subItemMap["text"].(string); ok {
																	fmt.Printf("    Текст: %s\n", text)
																}
																
																if marks, ok := subItemMap["marks"].([]interface{}); ok {
																	fmt.Printf("    Стили: %v\n", marks)
																}
															}
														}
													}
													fmt.Println()
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
}
