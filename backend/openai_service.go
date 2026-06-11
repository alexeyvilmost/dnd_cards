package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAIService - сервис для работы с OpenAI API
type OpenAIService struct {
	client *openai.Client
}

// NewOpenAIService - создание нового сервиса OpenAI
func NewOpenAIService() *OpenAIService {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil
	}

	client := openai.NewClient(apiKey)
	return &OpenAIService{client: client}
}

// normalizeImageQuality - приводит качество к допустимому значению gpt-image-1
func normalizeImageQuality(quality string) string {
	switch quality {
	case "low", "medium", "high":
		return quality
	default:
		return "high"
	}
}

// GenerateImage - генерация изображения через OpenAI
func (s *OpenAIService) GenerateImage(prompt, quality string) (string, error) {
	if s.client == nil {
		return "", fmt.Errorf("OpenAI API не настроен")
	}

	ctx := context.Background()
	resp, err := s.client.CreateImage(ctx, openai.ImageRequest{
		Prompt:  prompt,
		Model:   "gpt-image-1",
		Size:    openai.CreateImageSize1024x1024,
		Quality: normalizeImageQuality(quality),
		N:       1,
	})

	if err != nil {
		return "", fmt.Errorf("ошибка генерации изображения: %w", err)
	}

	if len(resp.Data) == 0 {
		return "", fmt.Errorf("не получены данные изображения")
	}

	// При использовании B64JSON формата, данные приходят в поле B64JSON
	if resp.Data[0].B64JSON != "" {
		// Возвращаем как data URL для PNG изображения
		return "data:image/png;base64," + resp.Data[0].B64JSON, nil
	}

	// Fallback на URL если доступен
	if resp.Data[0].URL != "" {
		return resp.Data[0].URL, nil
	}

	return "", fmt.Errorf("не получены данные изображения")
}

// Стили генерации изображений
const (
	ImageStyleGame    = "game"    // видеоигровая иконка
	ImageStyleFantasy = "fantasy" // официальный арт D&D: акварельная книжная иллюстрация (по умолчанию)
)

// GenerateImagePrompt - генерация промпта для изображения на основе карточки
func GenerateImagePrompt(cardName, description, rarity, style string) string {
	if style == ImageStyleGame {
		return generateGamePrompt(cardName, description, rarity)
	}
	return generateFantasyPrompt(cardName, description, rarity)
}

// generateGamePrompt - промпт в стиле видеоигровой иконки
func generateGamePrompt(cardName, description, rarity string) string {
	// Определяем цвет редкости
	rarityColor := getRarityColor(rarity)

	// Базовый промпт
	prompt := fmt.Sprintf("Фэнтезийный предмет, выполненный в стиле видеоигровой иконки.\nОбъект: %s", cardName)

	// Добавляем описание предмета из базы данных
	if description != "" {
		prompt += fmt.Sprintf(" %s", description)
	}

	// Добавляем акцентные цвета и свечение только для необычных предметов
	if rarity != "common" {
		prompt += fmt.Sprintf(" с акцентным %s цветом и %s свечением", rarityColor, rarityColor)
	}

	// Добавляем стиль
	prompt += "\nБез дополнительных элементов, рамок и прочего. Самое главное - предмет. Фон — прозрачный, без лишних деталей. Стиль — реалистичная отрисовка, мягкое освещение, лёгкое свечение по контуру, яркие акценты на металле, дереве или камне. Качество — детализированное, но с упрощённым прозрачным фоном, чтобы предмет выделялся.\nОбязательно на прозрачном однотонном фоне. Никаких надписей, текста, букв или цифр на изображении."

	return prompt
}

// generateFantasyPrompt - промпт в стиле официальных иллюстраций D&D:
// реалистично нарисованный предмет на белом фоне с мягким акварельным пятном позади
func generateFantasyPrompt(cardName, description, rarity string) string {
	rarityColor := getRarityColor(rarity)

	prompt := fmt.Sprintf("Иллюстрация фэнтезийного предмета в стиле официальных артов настольной игры Dungeons & Dragons (книга игрока, пятая редакция).\nОбъект: %s", cardName)

	if description != "" {
		prompt += fmt.Sprintf(" %s", description)
	}

	if rarity != "common" {
		prompt += fmt.Sprintf("\nДобавь сдержанные магические акценты %s цвета (свечение рун, камней или лезвия).", rarityColor)
	}

	prompt += "\nСтиль: традиционная книжная иллюстрация, реалистичная ручная отрисовка красками, естественная приглушённая палитра, проработанные текстуры металла, дерева, кожи и камня, мягкие тени." +
		"\nКомпозиция: предмет целиком, крупно, под лёгким диагональным наклоном, по центру." +
		"\nФон: чисто белый, позади предмета — только мягкое размытое акварельное пятно нейтрального серого или пастельного оттенка, как клякса на бумаге. Никаких других объектов, сцен или окружения." +
		"\nНикаких надписей, текста, букв, цифр, рамок и водяных знаков на изображении."

	return prompt
}

// getRarityColor - возвращает цвет для редкости
func getRarityColor(rarity string) string {
	switch rarity {
	case "uncommon":
		return "зеленый"
	case "rare":
		return "синий"
	case "very_rare":
		return "фиолетовый"
	case "artifact":
		return "золотой"
	default:
		return "белый"
	}
}

// extractKeywords - извлечение ключевых слов из описания
func extractKeywords(description string) []string {
	// Простое извлечение ключевых слов
	words := strings.Fields(strings.ToLower(description))
	var keywords []string

	// Фильтруем стоп-слова и короткие слова
	stopWords := map[string]bool{
		"и": true, "в": true, "на": true, "с": true, "по": true, "для": true,
		"от": true, "до": true, "из": true, "за": true, "под": true, "над": true,
		"к": true, "у": true, "о": true, "об": true, "при": true, "про": true,
		"не": true, "ни": true, "но": true, "или": true, "либо": true, "что": true,
		"как": true, "где": true, "когда": true, "почему": true, "зачем": true,
		"это": true, "тот": true, "этот": true, "то": true,
		"быть": true, "стать": true, "мочь": true, "хотеть": true,
		"давать": true, "получать": true, "делать": true, "говорить": true,
		"видеть": true, "знать": true, "думать": true, "чувствовать": true,
		"иметь": true, "находиться": true, "оказаться": true, "остаться": true,
		"начать": true, "кончить": true, "продолжать": true,
		"останавливаться": true, "менять": true, "оставаться": true,
	}

	for _, word := range words {
		// Убираем знаки препинания
		word = strings.Trim(word, ".,!?;:()[]{}'\"")

		// Проверяем длину и стоп-слова
		if len(word) > 2 && !stopWords[word] {
			keywords = append(keywords, word)
		}
	}

	return keywords
}

// min - вспомогательная функция для минимума
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
