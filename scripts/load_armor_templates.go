package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/lib/pq"
)

func main() {
	// Подключение к базе данных
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "postgres")
	dbName := getEnv("DB_NAME", "dnd_cards")
	dbSSLMode := getEnv("DB_SSLMODE", "disable")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		dbHost, dbPort, dbUser, dbPassword, dbName, dbSSLMode)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Ошибка подключения к базе данных: %v", err)
	}
	defer db.Close()

	// Проверяем подключение
	if err := db.Ping(); err != nil {
		log.Fatalf("Ошибка проверки подключения: %v", err)
	}

	fmt.Println("Подключение к базе данных установлено")

	// Загружаем шаблоны доспехов
	armorTemplates := []struct {
		name, nameEn, category, damageType, damage string
		weight                                     float64
		price                                      int
		properties                                 string
		imagePath                                  string
		defenseType                                string
		armorClass                                 string
		strengthRequirement                        *int
		stealthDisadvantage                        bool
	}{
		// Лёгкий доспех
		{"Стёганый доспех", "Padded Armor", "light_armor", "defense", "11+ЛОВ", 8.0, 5, "", "/padded_armor.png", "cloth", "11+ЛОВ", nil, true},
		{"Кожаный доспех", "Leather Armor", "light_armor", "defense", "11+ЛОВ", 10.0, 10, "", "/leather_armor.png", "light", "11+ЛОВ", nil, false},
		{"Проклёпанный кожаный доспех", "Studded Leather Armor", "light_armor", "defense", "12+ЛОВ", 13.0, 45, "", "/studded_leather_armor.png", "light", "12+ЛОВ", nil, false},

		// Средний доспех
		{"Шкурный доспех", "Hide Armor", "medium_armor", "defense", "12+ЛОВ(макс.2)", 12.0, 10, "", "/hide_armor.png", "medium", "12+ЛОВ(макс.2)", nil, false},
		{"Кольчужная рубаха", "Chain Shirt", "medium_armor", "defense", "13+ЛОВ(макс.2)", 20.0, 50, "", "/chain_shirt.png", "medium", "13+ЛОВ(макс.2)", nil, false},
		{"Чешуйчатый доспех", "Scale Mail", "medium_armor", "defense", "14+ЛОВ(макс.2)", 45.0, 50, "", "/scale_mail.png", "medium", "14+ЛОВ(макс.2)", nil, true},
		{"Кираса", "Breastplate", "medium_armor", "defense", "14+ЛОВ(макс.2)", 20.0, 400, "", "/breastplate.png", "medium", "14+ЛОВ(макс.2)", nil, false},
		{"Полулаты", "Half Plate", "medium_armor", "defense", "15+ЛОВ(макс.2)", 40.0, 750, "", "/half_plate.png", "medium", "15+ЛОВ(макс.2)", nil, true},

		// Тяжёлый доспех
		{"Колечный доспех", "Ring Mail", "heavy_armor", "defense", "14", 40.0, 30, "", "/ring_mail.png", "heavy", "14", nil, true},
		{"Кольчуга", "Chain Mail", "heavy_armor", "defense", "16", 55.0, 75, "", "/chain_mail.png", "heavy", "16", intPtr(13), true},
		{"Наборный доспех", "Splint Armor", "heavy_armor", "defense", "17", 60.0, 200, "", "/splint_armor.png", "heavy", "17", intPtr(15), true},
		{"Латы", "Plate Armor", "heavy_armor", "defense", "18", 65.0, 1500, "", "/plate_armor.png", "heavy", "18", intPtr(15), true},

		// Щиты
		{"Щит", "Shield", "shield", "defense", "+2", 6.0, 10, "", "/shield.png", "light", "+2", nil, false},
	}

	// Вставляем шаблоны
	for _, template := range armorTemplates {
		query := `
			INSERT INTO weapon_templates 
			(name, name_en, category, damage_type, damage, weight, price, properties, image_path, defense_type, armor_class, strength_requirement, stealth_disadvantage)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`

		_, err := db.Exec(query,
			template.name, template.nameEn, template.category, template.damageType,
			template.damage, template.weight, template.price, template.properties,
			template.imagePath, template.defenseType, template.armorClass,
			template.strengthRequirement, template.stealthDisadvantage)

		if err != nil {
			log.Printf("Ошибка вставки шаблона %s: %v", template.name, err)
		} else {
			fmt.Printf("Добавлен шаблон: %s\n", template.name)
		}
	}

	fmt.Println("Загрузка шаблонов доспехов завершена")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func intPtr(i int) *int {
	return &i
}
