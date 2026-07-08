package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	openai "github.com/sashabaranov/go-openai"
)

// OpenAIService - сервис для работы с OpenAI API
type OpenAIService struct {
	client *openai.Client
}

// newOpenAIHTTPClient — HTTP-клиент для OpenAI с egress Railway:
//   - Proxy из окружения (HTTPS_PROXY) — можно направить трафик через достижимый прокси,
//     если прямой доступ к api.openai.com блокируется/таймаутится;
//   - укороченный dial-timeout (15с вместо дефолтных 30с) — быстрее падаем на недостижимом
//     Cloudflare-edge и уходим в ретрай (повторный dial часто попадает на рабочий anycast-IP);
//   - общий бюджет запроса 180с (генерация изображения долгая, но не висит вечно).
func newOpenAIHTTPClient() *http.Client {
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.Proxy = http.ProxyFromEnvironment
	tr.DialContext = (&net.Dialer{
		Timeout:   15 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
	return &http.Client{
		Timeout:   180 * time.Second,
		Transport: tr,
	}
}

// isRetryableNetErr — временные сетевые сбои (dial i/o timeout, reset, EOF, TLS), на
// которых повтор имеет смысл (в отличие от 4xx/невалидного запроса).
func isRetryableNetErr(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, s := range []string{"i/o timeout", "timeout", "connection reset", "connection refused", "no such host", "eof", "tls handshake", "network is unreachable"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// NewOpenAIService - создание нового сервиса OpenAI
func NewOpenAIService() *OpenAIService {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		return nil
	}

	config := openai.DefaultConfig(apiKey)
	// OPENAI_BASE_URL — опциональный прокси/шлюз, совместимый с OpenAI API, если прямой
	// доступ из Railway недоступен (напр. Cloudflare Worker-релей). Пусто → api.openai.com.
	if base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")); base != "" {
		config.BaseURL = strings.TrimRight(base, "/")
		log.Printf("[openai] используется кастомный BaseURL: %s", config.BaseURL)
	}
	config.HTTPClient = newOpenAIHTTPClient()
	return &OpenAIService{client: openai.NewClientWithConfig(config)}
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

	req := openai.ImageRequest{
		Prompt:     prompt,
		Model:      "gpt-image-1",
		Size:       normalizeImageSize(size),
		Quality:    normalizeImageQuality(quality),
		Background: openai.CreateImageBackgroundTransparent,
		N:          1,
	}

	// Ретраи на временных сетевых сбоях (dial i/o timeout к Cloudflare-edge OpenAI):
	// повторный запрос заново резолвит DNS и часто попадает на рабочий anycast-IP.
	const attempts = 3
	var resp openai.ImageResponse
	var err error
	for i := 0; i < attempts; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 160*time.Second)
		resp, err = s.client.CreateImage(ctx, req)
		cancel()
		if err == nil {
			break
		}
		if i == attempts-1 || !isRetryableNetErr(err) {
			return "", fmt.Errorf("ошибка генерации изображения: %w", err)
		}
		wait := time.Duration(i+1) * 2 * time.Second
		log.Printf("[openai] генерация изображения: попытка %d/%d не удалась (%v), повтор через %s", i+1, attempts, err, wait)
		time.Sleep(wait)
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
	ImageStyleGame      = "game"       // видеоигровая иконка
	ImageStyleFantasy   = "fantasy"    // официальный арт D&D: акварельная книжная иллюстрация (по умолчанию)
	ImageStyleSpellIcon = "spell_icon" // иконка заклинания в стиле BG3: светящийся энергетический глиф
)

// spellEnergyColors — словарь "тип энергии" -> описание цвета для иконок заклинаний.
// Ключи совпадают с типами урона на фронте (damageTypes.ts).
var spellEnergyColors = map[string]string{
	"fire":        "fiery orange, amber and golden-yellow",
	"cold":        "icy pale blue and cyan with white highlights",
	"lightning":   "vivid violet and magenta",
	"thunder":     "deep purple and lavender",
	"acid":        "toxic lime green and yellow-green",
	"poison":      "sickly emerald and venom green",
	"necrotic":    "pale sickly green and ghostly white-green",
	"psychic":     "bright magenta-pink and orchid",
	"radiant":     "warm golden-yellow and white",
	"force":       "pink-violet and rose",
	"bludgeoning": "pale silver-grey and white",
	"piercing":    "pale silver-grey and white",
	"slashing":    "pale silver-grey and white",
	"healing":     "soft turquoise and teal",
}

// generateSpellIconPrompt строит максимально предсказуемый промпт для иконки
// заклинания в стиле Baldur's Gate 3: чёткий светящийся глиф из энергии выбранного
// цвета с ТЕСНЫМ свечением по штрихам (без большого ореола) на прозрачном фоне —
// без диффузного фонового пятна/дымки, которое читалось как «засветка» на тёмной плитке.
func generateSpellIconPrompt(subject, element, extra string) string {
	color := spellEnergyColors[element]
	if color == "" {
		color = "glowing arcane"
	}
	if subject == "" {
		subject = "an arcane spell"
	}

	prompt := fmt.Sprintf(
		"A single magic spell icon in the painterly style of Baldur's Gate 3 and Dungeons & Dragons spell icons. "+
			"The icon is a clean, crisp arcane symbol drawn with hand-painted luminous brushstrokes of glowing %s energy, "+
			"evoking the essence of \"%s\". Thin, elegant, well-defined strokes with a bright glowing core and only a THIN, "+
			"tight neon glow hugging the strokes closely (a narrow rim-light), NOT a large halo. "+
			"Single centered emblem occupying about two-thirds of the frame, with clear empty margins on all sides and a calm, balanced composition. "+
			"The background is completely empty and fully transparent: NO large diffuse background glow, NO colored haze, mist, fog or cloud, "+
			"NO soft glowing blob or bright spot behind the symbol, NO bloom or light bleeding into the background; "+
			"the glow stays tightly contained on the strokes only, and the surrounding area is clean and fully transparent. "+
			"No scene, no ground, no objects, no weapon, no creatures, no photo-real hands, no characters, "+
			"no text, no letters, no numbers, no border and no frame. "+
			"Only the crisp %s glowing strokes of the spell symbol.",
		color, subject, color,
	)

	if strings.TrimSpace(extra) != "" {
		prompt += " " + strings.TrimSpace(extra)
	}
	return prompt
}

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

	if rarity != "common" && rarity != "" {
		prompt += fmt.Sprintf(" с акцентным %s цветом и %s свечением", rarityColor, rarityColor)
	}

	prompt += "\nБез дополнительных элементов, рамок и прочего. Самое главное — один предмет. Фон — прозрачный, без лишних деталей. Стиль — реалистичная отрисовка, мягкое освещение, лёгкое свечение по контуру, яркие акценты на материалах самого предмета. Качество — детализированное, но с упрощённым прозрачным фоном, чтобы предмет выделялся."
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

	if rarity != "common" && rarity != "" {
		prompt += getMagicalAccentHint(rarity, itemType, cardName, description)
	}

	blobColor := getRarityBlobColor(rarity)

	backgroundPart := fmt.Sprintf("\nПозади предмета обязательно присутствует мягкое акварельное пятно-ореол %s. Это всегда видимая акварельная заливка умеренной насыщенности с размытыми, растушёванными краями: она расположена строго за предметом по центру, по размеру немного больше предмета, плавно растворяется к краям и не доходит до границ холста. Такое пятно должно быть на каждом изображении и не должно полностью исчезать или становиться невидимым.", blobColor)
	backgroundPart += " Вся остальная площадь холста за пределами этого пятна — полностью прозрачная, без других объектов, сцен и окружения."
	if rarity != "common" {
		backgroundPart += " Пятно не серое, не тёмное и не плотное, но отчётливо передаёт указанный цветной оттенок."
	}

	prompt += "\nСтиль: традиционная книжная иллюстрация, реалистичная ручная отрисовка красками, естественная приглушённая палитра, проработанные фактуры материалов самого предмета, мягкие тени."
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
	// ВАЖНО: не перечисляем «камни/кристаллы/металл» как отдельные объекты —
	// модель дорисовывает их отдельными вставками (самоцветы, флаконы). Свечение
	// описываем как свойство поверхности самого предмета.
	hint := fmt.Sprintf("\nУ предмета сдержанное магическое свечение %s оттенка — мягкая аура исходит от поверхности самого предмета.", rarityColor)

	if shouldSuggestRunes(itemType, cardName, description, rarity) {
		return hint + " Допустимы тонкие гравированные руны или узоры на поверхности самого предмета."
	}
	return hint
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
		"Между любой крайней точкой предмета и краем холста всегда остаётся свободное пространство. " +
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
	// ВАЖНО: не перечисляем «клинки/острия/навершия/древки» — из-за «парадокса
	// отрицания» модель именно их и дорисовывает. Формулируем позитивно.
	return "В кадре присутствует ровно этот один предмет целиком и ничего больше — только сам предмет, без любых дополнительных вставок и деталей, относящихся к другим предметам. Без персонажей и фоновых сцен."
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
