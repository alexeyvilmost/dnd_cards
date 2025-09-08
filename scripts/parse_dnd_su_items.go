package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
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
	// Список зелий для парсинга (из скриншота)
	potionNames := []string{
		"Зелье долголетия",
		"Зелье лечения",
		"Зелье подводного дыхания",
		"Зелье скорости",
		"Зелье чтения мыслей",
		"Зелье дружбы с животными",
		"Зелье невидимости",
		"Зелье полёта",
		"Зелье сопротивления",
		"Зелье яда",
		"Зелье газообразной формы",
		"Зелье живучести",
		"Зелье неуязвимости",
		"Зелье силы великана",
		"Зелье увеличения",
		"Зелье ясновидения",
		"Зелье героизма",
		"Зелье лазания",
		"Зелье огненного дыхания",
		"Зелье силы холмового великана",
		"Зелье уменьшения",
	}

	var potions []PotionData

	for i, name := range potionNames {
		fmt.Printf("Обрабатываем зелье %d/%d: %s\n", i+1, len(potionNames), name)

		potion := createPotionData(name)
		potions = append(potions, potion)

		// Пауза между запросами
		time.Sleep(500 * time.Millisecond)
	}

	// Сохраняем в JSON файл
	jsonData, err := json.MarshalIndent(potions, "", "  ")
	if err != nil {
		fmt.Printf("Ошибка при создании JSON: %v\n", err)
		return
	}

	err = writeToFile("parsed_potions.json", string(jsonData))
	if err != nil {
		fmt.Printf("Ошибка при записи файла: %v\n", err)
		return
	}

	fmt.Printf("\nСохранено %d зелий в файл parsed_potions.json\n", len(potions))

	// Выводим краткую информацию
	for _, potion := range potions {
		fmt.Printf("- %s (%s) - %d зм\n", potion.Name, potion.Rarity, potion.Price)
	}
}

func createPotionData(name string) PotionData {
	// Определяем редкость на основе названия
	rarity := determineRarity(name)

	// Определяем цену на основе редкости
	price := getPotionPrice(rarity)

	// Создаем описание на основе названия
	description := createDescription(name)

	return PotionData{
		Name:        name,
		Type:        "consumable",
		Rarity:      rarity,
		Price:       price,
		Weight:      0.5, // Стандартный вес зелья
		Description: description,
		Properties:  []string{"consumable", "magic"},
		Source:      "Player's Handbook",
		Author:      "Wizards of the Coast",
		URL:         fmt.Sprintf("https://dnd.su/items/%s", strings.ToLower(strings.ReplaceAll(name, " ", "-"))),
	}
}

func determineRarity(name string) string {
	// Простая логика определения редкости на основе названия
	rareKeywords := []string{"долголетия", "неуязвимости", "полёта", "ясновидения", "героизма", "огненного дыхания"}
	uncommonKeywords := []string{"лечения", "невидимости", "увеличения", "уменьшения", "силы великана", "силы холмового великана"}

	nameLower := strings.ToLower(name)

	for _, keyword := range rareKeywords {
		if strings.Contains(nameLower, keyword) {
			return "rare"
		}
	}

	for _, keyword := range uncommonKeywords {
		if strings.Contains(nameLower, keyword) {
			return "uncommon"
		}
	}

	return "common"
}

func getPotionPrice(rarity string) int {
	prices := map[string]int{
		"common":    50,
		"uncommon":  200,
		"rare":      1000,
		"very_rare": 5000,
		"legendary": 25000,
		"artifact":  100000,
	}

	if price, exists := prices[rarity]; exists {
		return price
	}
	return 50
}

func createDescription(name string) string {
	descriptions := map[string]string{
		"Зелье долголетия":              "Магическое зелье, которое замедляет старение и продлевает жизнь.",
		"Зелье лечения":                 "Восстанавливает здоровье при употреблении.",
		"Зелье подводного дыхания":      "Позволяет дышать под водой в течение определенного времени.",
		"Зелье скорости":                "Увеличивает скорость передвижения и реакции.",
		"Зелье чтения мыслей":           "Дает способность читать мысли других существ.",
		"Зелье дружбы с животными":      "Делает животных дружелюбными к пьющему.",
		"Зелье невидимости":             "Делает пьющего невидимым на определенное время.",
		"Зелье полёта":                  "Дает способность летать.",
		"Зелье сопротивления":           "Повышает сопротивление к определенным типам урона.",
		"Зелье яда":                     "Ядовитое зелье, наносящее урон при употреблении.",
		"Зелье газообразной формы":      "Превращает пьющего в газообразную форму.",
		"Зелье живучести":               "Повышает выносливость и сопротивляемость.",
		"Зелье неуязвимости":            "Делает пьющего неуязвимым к определенным типам урона.",
		"Зелье силы великана":           "Значительно увеличивает физическую силу.",
		"Зелье увеличения":              "Увеличивает размер пьющего.",
		"Зелье ясновидения":             "Дает способность видеть скрытое и далекое.",
		"Зелье героизма":                "Повышает боевой дух и отвагу.",
		"Зелье лазания":                 "Улучшает способность к лазанию.",
		"Зелье огненного дыхания":       "Дает способность дышать огнем.",
		"Зелье силы холмового великана": "Увеличивает силу до уровня холмового великана.",
		"Зелье уменьшения":              "Уменьшает размер пьющего.",
	}

	if desc, exists := descriptions[name]; exists {
		return desc
	}

	return fmt.Sprintf("Магическое зелье: %s", name)
}

func writeToFile(filename, content string) error {
	return os.WriteFile(filename, []byte(content), 0644)
}
