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

// normalizeImageSize - приводит размер к допустимому значению gpt-image-1.
// Пустое или неизвестное значение трактуется как квадрат по умолчанию.
func normalizeImageSize(size string) string {
	switch size {
	case openai.CreateImageSize1024x1024,
		openai.CreateImageSize1024x1536,
		openai.CreateImageSize1536x1024:
		return size
	default:
		return openai.CreateImageSize1024x1024
	}
}

// GenerateImageSize выбирает размер холста для генерации:
// портрет (1024x1536) для вытянутых по вертикали предметов (посох, копьё, лук и т.п.),
// иначе квадрат (1024x1024). Портретный холст резко снижает обрезание длинных предметов.
func GenerateImageSize(itemType, cardName, description string) string {
	resolvedType := inferItemType(itemType, cardName, description)
	if isTallItem(resolvedType, cardName) {
		return openai.CreateImageSize1024x1536
	}
	return openai.CreateImageSize1024x1024
}

// GenerateImage - генерация изображения через OpenAI.
// size может быть пустым — тогда используется квадрат 1024x1024.
func (s *OpenAIService) GenerateImage(prompt, quality, size string) (string, error) {
	if s.client == nil {
		return "", fmt.Errorf("OpenAI API не настроен")
	}

	ctx := context.Background()
	resp, err := s.client.CreateImage(ctx, openai.ImageRequest{
		Prompt:     prompt,
		Model:      "gpt-image-1",
		Size:       normalizeImageSize(size),
		Quality:    normalizeImageQuality(quality),
		Background: openai.CreateImageBackgroundTransparent,
		N:          1,
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

// ImagePromptOptions — дополнительные параметры для генерации промпта
type ImagePromptOptions struct {
	ItemType         string
	ImagePromptExtra string
}

// GenerateImagePrompt - генерация промпта для изображения на основе карточки
func GenerateImagePrompt(cardName, description, rarity, style string, opts ...ImagePromptOptions) string {
	var options ImagePromptOptions
	if len(opts) > 0 {
		options = opts[0]
	}
	itemType := inferItemType(options.ItemType, cardName, description)
	if style == ImageStyleGame {
		return generateGamePrompt(cardName, description, rarity, itemType, options.ImagePromptExtra)
	}
	return generateFantasyPrompt(cardName, description, rarity, itemType, options.ImagePromptExtra)
}

// generateGamePrompt - промпт в стиле видеоигровой иконки
func generateGamePrompt(cardName, description, rarity, itemType, imagePromptExtra string) string {
	rarityColor := getRarityColor(rarity)

	prompt := fmt.Sprintf("Фэнтезийный предмет, выполненный в стиле видеоигровой иконки.\nТип предмета: %s.\nОбъект: %s", getItemTypeLabel(itemType), cardName)

	if description != "" {
		prompt += fmt.Sprintf(" %s", description)
	}

	if imagePromptExtra != "" {
		prompt += fmt.Sprintf(" %s", imagePromptExtra)
	}

	if rarity != "common" {
		prompt += fmt.Sprintf(" с акцентным %s цветом и %s свечением", rarityColor, rarityColor)
	}

	prompt += "\nБез дополнительных элементов, рамок и прочего. Самое главное — один предмет. Фон — прозрачный, без лишних деталей. Стиль — реалистичная отрисовка, мягкое освещение, лёгкое свечение по контуру, яркие акценты на металле, дереве, камне, стекле или ткани. Качество — детализированное, но с упрощённым прозрачным фоном, чтобы предмет выделялся."
	prompt += "\n" + getFramingRequirements(itemType, cardName)
	prompt += "\n" + getItemCompositionHint(itemType, cardName)
	prompt += "\n" + getItemNegativeHint(itemType)
	prompt += "\nОбязательно на прозрачном однотонном фоне. Никаких надписей, текста, букв или цифр на изображении."

	return prompt
}

// generateFantasyPrompt - промпт в стиле официальных иллюстраций D&D:
// реалистично нарисованный предмет на белом фоне с мягким акварельным пятном позади
func generateFantasyPrompt(cardName, description, rarity, itemType, imagePromptExtra string) string {
	prompt := fmt.Sprintf("Иллюстрация фэнтезийного предмета в стиле официальных артов настольной игры Dungeons & Dragons (книга игрока, пятая редакция).\nТип предмета: %s.\nОбъект: %s", getItemTypeLabel(itemType), cardName)

	if description != "" {
		prompt += fmt.Sprintf(" %s", description)
	}

	if imagePromptExtra != "" {
		prompt += fmt.Sprintf(" %s", imagePromptExtra)
	}

	if rarity != "common" {
		prompt += getMagicalAccentHint(rarity, itemType, cardName, description)
	}

	blobColor := getRarityBlobColor(rarity)

	backgroundPart := fmt.Sprintf("\nПозади предмета обязательно присутствует мягкое акварельное пятно-ореол %s. Это всегда видимая акварельная заливка умеренной насыщенности с размытыми, растушёванными краями: она расположена строго за предметом по центру, по размеру немного больше предмета, плавно растворяется к краям и не доходит до границ холста. Такое пятно должно быть на каждом изображении и не должно полностью исчезать или становиться невидимым.", blobColor)
	backgroundPart += " Вся остальная площадь холста за пределами этого пятна — полностью прозрачная, без других объектов, сцен и окружения."
	if rarity != "common" {
		backgroundPart += " Пятно не серое, не тёмное и не плотное, но отчётливо передаёт указанный цветной оттенок."
	}

	prompt += "\nСтиль: традиционная книжная иллюстрация, реалистичная ручная отрисовка красками, естественная приглушённая палитра, проработанные текстуры металла, дерева, кожи, ткани, стекла и камня, мягкие тени."
	prompt += "\n" + getFramingRequirements(itemType, cardName)
	prompt += "\n" + getItemCompositionHint(itemType, cardName)
	prompt += "\n" + getItemNegativeHint(itemType)
	prompt += backgroundPart
	prompt += "\nНикаких надписей, текста, букв, цифр, рамок и водяных знаков на изображении."

	return prompt
}

// inferItemType определяет тип предмета по полю type или ключевым словам в названии/описании
func inferItemType(itemType, cardName, description string) string {
	if itemType != "" && itemType != "none" && itemType != "equipment" {
		return itemType
	}

	text := strings.ToLower(cardName + " " + description)

	keywordTypes := []struct {
		itemType string
		keywords []string
	}{
		{"weapon", []string{"меч", "клинок", "кинжал", "топор", "булава", "копь", "копьё", "копье", "лук", "арбалет", "посох", "жезл", "кистень", "секира", "рапира", "сабля", "sword", "dagger", "axe", "bow", "staff", "wand"}},
		{"shield", []string{"щит", "shield"}},
		{"ring", []string{"кольцо", "перстень", "ring"}},
		{"necklace", []string{"ожерелье", "амулет", "кулон", "подвеск", "necklace", "amulet"}},
		{"potion", []string{"зелье", "эликсир", "настой", "potion", "elixir"}},
		{"scroll", []string{"свиток", "scroll"}},
		{"cloak", []string{"плащ", "мантия", "накидк", "cloak", "mantle", "robe", "роба", "халат"}},
		{"chest", []string{"доспех", "кольчуг", "латы", "кираса", "нагрудник", "броня", "armor", "breastplate", "chainmail"}},
		{"helmet", []string{"шлем", "каска", "капюшон", "корона", "helmet", "hood", "crown"}},
		{"gloves", []string{"перчатк", "рукавиц", "наруч", "gauntlet", "glove", "bracer"}},
		{"boots", []string{"сапог", "ботинк", "обув", "boot"}},
		{"ammunition", []string{"стрел", "болт", "снаряд", "arrow", "bolt"}},
		{"food", []string{"хлеб", "сыр", "мясо", "пирог", "food", "bread"}},
		{"ingredient", []string{"ингредиент", "трава", "корень", "гриб", "ingredient", "herb"}},
		{"tool", []string{"инструмент", "молоток", "кирка", "отмычк", "tool", "pickaxe"}},
	}

	for _, entry := range keywordTypes {
		for _, kw := range entry.keywords {
			if strings.Contains(text, kw) {
				return entry.itemType
			}
		}
	}

	if itemType != "" {
		return itemType
	}
	return "item"
}

func getMagicalAccentHint(rarity, itemType, cardName, description string) string {
	rarityColor := getRarityColor(rarity)
	hint := fmt.Sprintf("\nДобавь сдержанные магические акценты %s цвета — мягкое свечение металла, камней или кристаллов.", rarityColor)

	if shouldSuggestRunes(itemType, cardName, description, rarity) {
		return hint + " Добавь руны или магические узоры, если они уместны для этого предмета."
	} else {
		return hint + " Допустимы едва заметные руны или магические узоры, если они уместны для этого предмета."
	}
}

// shouldSuggestRunes — руны только для особо редких предметов, где они логичны
func shouldSuggestRunes(itemType, cardName, description, rarity string) bool {
	if rarity != "very_rare" && rarity != "artifact" && rarity != "relic" {
		return false
	}

	text := strings.ToLower(cardName + " " + description)
	if strings.Contains(text, "рун") || strings.Contains(text, "rune") || strings.Contains(text, "глиф") {
		return true
	}

	switch itemType {
	case "scroll", "ring", "necklace":
		return true
	case "weapon":
		return strings.Contains(text, "посох") || strings.Contains(text, "жезл") ||
			strings.Contains(text, "staff") || strings.Contains(text, "wand")
	default:
		return false
	}
}

func getItemTypeLabel(itemType string) string {
	labels := map[string]string{
		"weapon":     "оружие",
		"shield":     "щит",
		"ring":       "кольцо",
		"necklace":   "ожерелье или амулет",
		"potion":     "зелье или флакон",
		"scroll":     "свиток",
		"cloak":      "плащ, мантия или одежда",
		"chest":      "доспех или нагрудник",
		"helmet":     "шлем или головной убор",
		"gloves":     "перчатки или наручи",
		"boots":      "обувь или сапоги",
		"ammunition": "боеприпасы",
		"food":       "еда",
		"ingredient": "алхимический ингредиент",
		"tool":       "инструмент",
		"armor":      "доспех",
		"trinket":    "безделушка",
		"item":       "фэнтезийный предмет",
	}
	if label, ok := labels[itemType]; ok {
		return label
	}
	return labels["item"]
}

func isTallItem(itemType, cardName string) bool {
	if itemType != "weapon" {
		return false
	}
	text := strings.ToLower(cardName)
	tallKeywords := []string{
		"посох", "staff", "копь", "spear", "копьё", "копье",
		"лук", "bow", "арбалет", "crossbow", "жезл", "wand",
		"секир", "axe", "трезуб", "trident", "булава", "mace",
	}
	for _, kw := range tallKeywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

func getFramingRequirements(itemType, cardName string) string {
	hint := "Композиция: один предмет целиком, по центру, небольшого размера — занимает примерно 45–55% площади холста. " +
		"Вокруг предмета со всех сторон широкие пустые поля, не менее 25% ширины и высоты с каждого края. " +
		"Между любой точкой предмета (включая навершие, остриё, рукоять и кончики) и краем холста всегда остаётся свободное пространство. " +
		"Весь предмет помещается в кадр целиком, с заметным запасом воздуха по периметру."

	if isTallItem(itemType, cardName) {
		hint += " Предмет вытянут по вертикали — оставь особенно большой запас пустого пространства сверху и снизу, чтобы оба конца предмета свободно помещались в кадр с воздухом вокруг."
	}

	return hint
}

func getItemCompositionHint(itemType, cardName string) string {
	switch itemType {
	case "weapon":
		if isTallItem(itemType, cardName) {
			return "Длинное оружие или посох: вертикальная ориентация, лёгкий наклон. Оба конца — навершие и нижний конец древка — полностью в кадре с отступом от краёв."
		}
		return "Оружие целиком в кадре, под лёгким диагональным наклоном. Если есть лезвие и рукоять — оба конца видны полностью с отступом от краёв."
	case "shield":
		return "Щит показан анфас, целиком в кадре. Только щит — без меча, копья или другого оружия рядом."
	case "cloak", "chest", "helmet", "gloves", "boots", "armor":
		return "Одежда или доспех: аккуратно сложена или на невидимом манекене, целиком в кадре. Показать только ткань, кожу и металл доспеха."
	case "ring", "necklace":
		return "Украшение крупным планом по центру: кольцо, перстень или подвеска целиком в кадре."
	case "potion":
		return "Стеклянный флакон или бутыль с пробкой, целиком в кадре. Только сосуд с жидкостью."
	case "scroll":
		return "Свиток пергамента, целиком в кадре."
	case "ammunition":
		return "Стрелы, болты или снаряды, аккуратно сгруппированы, целиком в кадре."
	case "food", "ingredient":
		return "Съедобный предмет или алхимический компонент, целиком в кадре."
	case "tool":
		return "Инструмент целиком в кадре."
	default:
		return "Один предмет целиком в кадре, без посторонних объектов."
	}
}

func getItemNegativeHint(itemType string) string {
	if itemType == "weapon" {
		return "В кадре только один этот предмет — без посторонних предметов, персонажей и фоновых сцен."
	}
	return "В кадре только один этот предмет. Не добавляй детали оружия (рукояти, рукоятки, древки, навершия, острия, клинки), если сам предмет не является оружием. Без посторонних предметов, персонажей и фоновых сцен."
}

// getRarityBlobColor - цвет акварельного пятна на фоне в зависимости от редкости карты
func getRarityBlobColor(rarity string) string {
	switch rarity {
	case "uncommon":
		return "бледно-зелёного оттенка"
	case "rare":
		return "бледно-голубого оттенка"
	case "very_rare":
		return "бледно-сиреневого (лавандового) оттенка"
	case "artifact":
		return "бледно-золотистого (янтарного) оттенка"
	case "relic":
		return "бледно-красного оттенка"
	case "custom":
		return "нейтрального приглушённого оттенка"
	default:
		return "нейтрального серого или тёплого бежевого оттенка"
	}
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
	case "relic":
		return "красный"
	case "custom":
		return "акцентный"
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
