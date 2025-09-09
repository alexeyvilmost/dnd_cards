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

	fmt.Printf("Ключи в корне data: %v\n", getKeys(dataJson))

	// Проверяем наличие поля text
	if textField, exists := dataJson["text"]; exists {
		fmt.Println("✓ Найдено поле 'text' в data")

		if textMap, ok := textField.(map[string]interface{}); ok {
			fmt.Printf("Ключи в data.text: %v\n", getKeys(textMap))

			// Проверяем наличие traits в text
			if traitsField, exists := textMap["traits"]; exists {
				fmt.Println("✓ Найдено поле 'traits' в data.text")

				if traitsMap, ok := traitsField.(map[string]interface{}); ok {
					fmt.Printf("Ключи в data.text.traits: %v\n", getKeys(traitsMap))

					// Проверяем структуру traits
					if valueField, exists := traitsMap["value"]; exists {
						fmt.Println("✓ Найдено поле 'value' в data.text.traits")

						if valueMap, ok := valueField.(map[string]interface{}); ok {
							fmt.Printf("Ключи в data.text.traits.value: %v\n", getKeys(valueMap))

							// Проверяем наличие data в traits.value
							if dataField, exists := valueMap["data"]; exists {
								fmt.Println("✓ Найдено поле 'data' в data.text.traits.value")

								if dataMap, ok := dataField.(map[string]interface{}); ok {
									fmt.Printf("Ключи в data.text.traits.value.data: %v\n", getKeys(dataMap))

									// Проверяем наличие content
									if contentField, exists := dataMap["content"]; exists {
										fmt.Println("✓ Найдено поле 'content' в data.text.traits.value.data")

										if contentArray, ok := contentField.([]interface{}); ok {
											fmt.Printf("Количество параграфов в traits: %d\n", len(contentArray))

											// Показываем первые несколько параграфов
											for i, paragraph := range contentArray {
												if i >= 3 { // Показываем только первые 3
													break
												}
												if paraMap, ok := paragraph.(map[string]interface{}); ok {
													if paraType, ok := paraMap["type"].(string); ok {
														fmt.Printf("Параграф %d: тип %s\n", i+1, paraType)

														// Показываем содержимое параграфа
														if content, ok := paraMap["content"].([]interface{}); ok {
															for j, textItem := range content {
																if j >= 2 { // Показываем только первые 2 текстовых элемента
																	break
																}
																if textMap, ok := textItem.(map[string]interface{}); ok {
																	if text, ok := textMap["text"].(string); ok {
																		fmt.Printf("  Текст %d: %s\n", j+1, text)
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
				}
			} else {
				fmt.Println("✗ Поле 'traits' НЕ найдено в data.text")
			}
		}
	} else {
		fmt.Println("✗ Поле 'text' НЕ найдено в data")
	}
}

// getKeys возвращает список ключей из map
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

