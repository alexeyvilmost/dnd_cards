package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
)

func main() {
	// Читаем файл Hara.json
	fileData, err := ioutil.ReadFile("../Hara.json")
	if err != nil {
		log.Fatalf("Ошибка чтения файла Hara.json: %v", err)
	}

	fmt.Printf("Размер исходного файла: %d байт\n", len(fileData))

	// Парсим JSON
	var jsonData map[string]interface{}
	if err := json.Unmarshal(fileData, &jsonData); err != nil {
		log.Fatalf("Ошибка парсинга JSON: %v", err)
	}

	// Извлекаем поле data
	dataField, exists := jsonData["data"]
	if !exists {
		log.Fatalf("Поле 'data' не найдено в JSON")
	}

	dataStr, ok := dataField.(string)
	if !ok {
		log.Fatalf("Поле 'data' не является строкой")
	}

	fmt.Printf("Размер поля 'data': %d байт\n", len(dataStr))

	// Парсим поле data как JSON для проверки валидности
	var dataJson map[string]interface{}
	if err := json.Unmarshal([]byte(dataStr), &dataJson); err != nil {
		log.Fatalf("Ошибка парсинга поля 'data' как JSON: %v", err)
	}

	fmt.Printf("Поле 'data' успешно распарсено как JSON\n")
	fmt.Printf("Ключи в поле 'data': %v\n", getKeys(dataJson))

	// Проверяем наличие traits
	if _, hasTraits := dataJson["traits"]; hasTraits {
		fmt.Println("✓ Найдено поле 'traits' в поле 'data'")
	} else {
		fmt.Println("✗ Поле 'traits' НЕ найдено в поле 'data'")
	}

	// Форматируем JSON для красивого вывода
	prettyData, err := json.MarshalIndent(dataJson, "", "  ")
	if err != nil {
		log.Fatalf("Ошибка форматирования JSON: %v", err)
	}

	// Сохраняем в файл
	outputFile := "../Hara_data.json"
	if err := ioutil.WriteFile(outputFile, prettyData, 0644); err != nil {
		log.Fatalf("Ошибка записи файла: %v", err)
	}

	fmt.Printf("Поле 'data' сохранено в файл: %s\n", outputFile)
	fmt.Printf("Размер сохраненного файла: %d байт\n", len(prettyData))

	// Показываем первые и последние 200 символов
	fmt.Printf("\nПервые 200 символов поля 'data':\n%s\n", dataStr[:min(200, len(dataStr))])
	fmt.Printf("\nПоследние 200 символов поля 'data':\n%s\n", dataStr[max(0, len(dataStr)-200):])

	// Проверяем, заканчивается ли поле data корректно
	if dataStr[len(dataStr)-1] == '}' {
		fmt.Println("✓ Поле 'data' заканчивается корректно (закрывающая скобка)")
	} else {
		fmt.Printf("✗ Поле 'data' заканчивается некорректно (последний символ: %c)\n", dataStr[len(dataStr)-1])
	}

	// Ищем подстроку "traits" в поле data
	if contains(dataStr, "traits") {
		fmt.Println("✓ Подстрока 'traits' найдена в поле 'data'")
	} else {
		fmt.Println("✗ Подстрока 'traits' НЕ найдена в поле 'data'")
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

// contains проверяет, содержит ли строка подстроку
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) &&
		(s[:len(substr)] == substr || s[len(s)-len(substr):] == substr ||
			containsInMiddle(s, substr)))
}

// containsInMiddle проверяет наличие подстроки в середине строки
func containsInMiddle(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
