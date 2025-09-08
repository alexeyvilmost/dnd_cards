package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

type CreateCardRequest struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Rarity      string   `json:"rarity"`
	Price       int      `json:"price"`
	Weight      float64  `json:"weight"`
	Description string   `json:"description"`
	Properties  []string `json:"properties"`
	Tags        []string `json:"tags"`
	Source      string   `json:"source"`
	Author      string   `json:"author"`
	IsTemplate  string   `json:"is_template"`
}

type AuthResponse struct {
	Token string `json:"token"`
}

func main() {
	// Список зелий для импорта
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

	// Получаем токен авторизации
	token, err := getAuthToken()
	if err != nil {
		fmt.Printf("Ошибка получения токена: %v\n", err)
		return
	}

	fmt.Printf("Получен токен авторизации\n")

	// Импортируем зелья
	importedCount := 0
	for i, name := range potionNames {
		fmt.Printf("Импортируем зелье %d/%d: %s\n", i+1, len(potionNames), name)

		potion := createPotionData(name)
		err := importPotion(potion, token)
		if err != nil {
			fmt.Printf("  ✗ Ошибка: %v\n", err)
			continue
		}

		importedCount++
		fmt.Printf("  ✓ Импортировано: %s (%s) - %d зм\n", potion.Name, potion.Rarity, potion.Price)

		// Пауза между запросами
		time.Sleep(500 * time.Millisecond)
	}

	fmt.Printf("\nВсего импортировано %d зелий\n", importedCount)
}

func getAuthToken() (string, error) {
	// Сначала пытаемся зарегистрироваться
	registerData := map[string]string{
		"username":     "admin",
		"password":     "admin123",
		"email":        "admin@example.com",
		"display_name": "Admin",
	}

	jsonData, err := json.Marshal(registerData)
	if err != nil {
		return "", err
	}

	// Регистрируемся (игнорируем ошибку, если пользователь уже существует)
	http.Post("http://localhost:8080/api/auth/register", "application/json", bytes.NewBuffer(jsonData))

	// Теперь авторизуемся
	resp, err := http.Post("http://localhost:8080/api/auth/login", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("ошибка авторизации: %s", string(body))
	}

	// Парсим ответ
	var authResp AuthResponse
	err = json.NewDecoder(resp.Body).Decode(&authResp)
	if err != nil {
		return "", err
	}

	return authResp.Token, nil
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
		Type:        "зелье",
		Rarity:      rarity,
		Price:       price,
		Weight:      0.5,
		Description: description,
		Properties:  []string{},
		Source:      "Player's Handbook",
		Author:      "Wizards of the Coast",
		URL:         fmt.Sprintf("https://dnd.su/items/%s", name),
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

func importPotion(potion PotionData, token string) error {
	// Создаем запрос для API
	request := CreateCardRequest{
		Name:        potion.Name,
		Type:        potion.Type,
		Rarity:      potion.Rarity,
		Price:       potion.Price,
		Weight:      potion.Weight,
		Description: potion.Description,
		Properties:  potion.Properties,
		Tags:        []string{"зелье"},
		Source:      potion.Source,
		Author:      potion.Author,
		IsTemplate:  "only_template",
	}

	jsonData, err := json.Marshal(request)
	if err != nil {
		return err
	}

	// Создаем HTTP запрос
	req, err := http.NewRequest("POST", "http://localhost:8080/api/cards", bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}

	// Добавляем заголовки
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	// Отправляем запрос
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("ошибка создания карты: %s", string(body))
	}

	return nil
}
