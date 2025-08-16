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

	// Улучшаем промпт для лучшего результата
	enhancedPrompt := fmt.Sprintf(
		"Create a fantasy potion bottle illustration for D&D: %s. "+
			"Style: minimalist, clean, white background, high quality, "+
			"magical glowing effects, suitable for a trading card. "+
			"Format: 3:4 aspect ratio, centered composition.",
		prompt,
	)

	ctx := context.Background()
	resp, err := s.client.CreateImage(ctx, openai.ImageRequest{
		Prompt:         enhancedPrompt,
		Size:           openai.CreateImageSize1024x1024,
		Quality:        openai.CreateImageQualityHD,
		ResponseFormat: openai.CreateImageResponseFormatURL,
		N:              1,
	})

	if err != nil {
		return "", fmt.Errorf("ошибка генерации изображения: %w", err)
	}

	if len(resp.Data) == 0 {
		return "", fmt.Errorf("не получен URL изображения")
	}

	return resp.Data[0].URL, nil
}

// GenerateImagePrompt - генерация промпта для изображения на основе карточки
func GenerateImagePrompt(cardName, description string) string {
	// Извлекаем ключевые слова из описания
	keywords := extractKeywords(description)

	// Формируем промпт
	prompt := fmt.Sprintf("Potion: %s", cardName)
	if len(keywords) > 0 {
		prompt += fmt.Sprintf(", Effects: %s", strings.Join(keywords[:min(3, len(keywords))], ", "))
	}

	return prompt
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
