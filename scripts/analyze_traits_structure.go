package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
)

func main() {
	// Читаем файл Hara_data.json
	fileData, err := ioutil.ReadFile("../Hara_data.json")
	if err != nil {
		log.Fatalf("Ошибка чтения файла Hara_data.json: %v", err)
	}

	// Парсим JSON
	var dataJson map[string]interface{}
	if err := json.Unmarshal(fileData, &dataJson); err != nil {
		log.Fatalf("Ошибка парсинга JSON: %v", err)
	}

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
											fmt.Printf("Анализ структуры traits:\n")
											fmt.Printf("Количество элементов: %d\n\n", len(contentArray))
											
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

