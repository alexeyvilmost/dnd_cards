package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

type PotionData struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Rarity      string   `json:"rarity"`
	Price       int      `json:"price"`
	Weight      float64  `json:"weight"`
	Description string   `json:"description"`
	Properties  []string `json:"properties"`
	Source      string   `json:"source"`
	Author      string   `json:"author"`
	URL         string   `json:"url"`
}

func main() {
	// Получаем переменные окружения
	dbHost := os.Getenv("DB_HOST")
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")
	dbName := os.Getenv("DB_NAME")
	dbPort := os.Getenv("DB_PORT")

	if dbHost == "" || dbUser == "" || dbPassword == "" || dbName == "" {
		log.Fatal("Необходимо установить переменные окружения: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME")
	}

	if dbPort == "" {
		dbPort = "5432"
	}

	// Подключаемся к базе данных
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dbHost, dbPort, dbUser, dbPassword, dbName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatal("Ошибка подключения к базе данных:", err)
	}
	defer db.Close()

	// Проверяем подключение
	if err := db.Ping(); err != nil {
		log.Fatal("Ошибка проверки подключения к базе данных:", err)
	}

	fmt.Println("Подключение к базе данных установлено")

	// Читаем JSON файл с зельями
	jsonData, err := os.ReadFile("parsed_potions.json")
	if err != nil {
		log.Fatal("Ошибка чтения файла parsed_potions.json:", err)
	}

	var potions []PotionData
	err = json.Unmarshal(jsonData, &potions)
	if err != nil {
		log.Fatal("Ошибка парсинга JSON:", err)
	}

	fmt.Printf("Загружено %d зелий из файла\n", len(potions))

	// Импортируем зелья в базу данных
	importQuery := `
		INSERT INTO cards (
			name, type, rarity, price, weight, description, 
			properties, tags, source, author, is_template, 
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, 
			$7, $8, $9, $10, 'only_template',
			NOW(), NOW()
		)
	`

	importedCount := 0
	for _, potion := range potions {
		// Создаем правильные свойства для зелий
		propertiesStr := `{"расходуемое"}`

		// Создаем теги для зелий
		tagsStr := `{"зелье"}`

		_, err := db.Exec(importQuery,
			potion.Name,
			"зелье", // Исправляем тип на "зелье"
			potion.Rarity,
			potion.Price,
			potion.Weight,
			potion.Description,
			propertiesStr,
			tagsStr,
			potion.Source,
			potion.Author,
		)

		if err != nil {
			log.Printf("Ошибка импорта зелья %s: %v", potion.Name, err)
			continue
		}

		importedCount++
		fmt.Printf("Импортировано: %s (%s) - %d зм\n", potion.Name, potion.Rarity, potion.Price)
	}

	fmt.Printf("\nВсего импортировано %d новых зелий\n", importedCount)
}
