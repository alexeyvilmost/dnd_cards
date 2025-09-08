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

// GenerateImage - генерация изображения через OpenAI DALL-E
func (s *OpenAIService) GenerateImage(prompt string) (string, error) {
	if s.client == nil {
		return "", fmt.Errorf("OpenAI API не настроен")
	}

	ctx := context.Background()
	resp, err := s.client.CreateImage(ctx, openai.ImageRequest{
		Prompt:  prompt,
		Model:   "gpt-image-1",
		Size:    openai.CreateImageSize1024x1024,
		Quality: "medium",
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

// GenerateImagePrompt - генерация промпта для изображения на основе карточки
func GenerateImagePrompt(cardName, description, rarity string) string {
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
