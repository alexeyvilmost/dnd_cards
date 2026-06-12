import { useState, useEffect, useRef } from 'react';
import { Search, Filter, Download, Minus, Plus, Trash2, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import { RARITY_OPTIONS, PROPERTIES_OPTIONS } from '../types';
import CardPreview from '../components/CardPreview';

// Параметры листа: A4 альбомная, 18 карт (6 колонок × 3 ряда)
const PAGE_W_MM = 297;
const PAGE_H_MM = 210;
const GRID_COLS = 6;
const GRID_ROWS = 3;
const PAGE_MARGIN_MM = 6;
// Базовый размер карты (пропорции превью 52.5×74.25 мм)
const CARD_BASE_W_MM = 52.5;
const CARD_BASE_H_MM = 74.25;

interface SelectedEntry {
  card: Card;
  copies: number;
}

interface Placement {
  dataUrl: string;
  col: number;
  row: number;
  span: number;
}

const CardExport = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCards, setTotalCards] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Фильтры (как в библиотеке)
  const [search, setSearch] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [propertiesFilter, setPropertiesFilter] = useState('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState('cards');
  const [slotFilter, setSlotFilter] = useState('');
  const [armorTypeFilter, setArmorTypeFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_desc');
  const [showFilters, setShowFilters] = useState(false);

  // Выбранные карты: id -> карта + количество копий
  const [selected, setSelected] = useState<Record<string, SelectedEntry>>({});

  // Состояние экспорта
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; stage: 'render' | 'pdf' } | null>(null);
  const [captureCard, setCaptureCard] = useState<Card | null>(null);
  const captureRef = useRef<HTMLDivElement>(null);

  const loadCards = async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const params: Parameters<typeof cardsApi.getCards>[0] = {
        page,
        limit: 50,
      };
      if (search) params.search = search;
      if (rarityFilter) params.rarity = rarityFilter;
      if (propertiesFilter) params.properties = propertiesFilter;
      if (slotFilter) params.slot = slotFilter;
      if (armorTypeFilter) params.armor_type = armorTypeFilter;
      if (sortBy) params.sort_by = sortBy;

      switch (templateTypeFilter) {
        case 'cards':
          params.exclude_template_only = true;
          break;
        case 'templates':
          params.template_only = true;
          break;
        default:
          break;
      }

      const response = await cardsApi.getCards(params);

      if (append) {
        setCards(prev => {
          const existingIds = new Set(prev.map(card => card.id));
          const newCards = response.cards.filter(card => !existingIds.has(card.id));
          const combined = [...prev, ...newCards];
          setHasMore(response.cards.length === 50 && combined.length < response.total);
          return combined;
        });
      } else {
        setCards(response.cards);
        setHasMore(response.cards.length === 50 && response.cards.length < response.total);
      }

      setTotalCards(response.total);
      setCurrentPage(page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    loadCards(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, rarityFilter, propertiesFilter, templateTypeFilter, slotFilter, armorTypeFilter, sortBy]);

  // Автоподгрузка при прокрутке
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleScroll = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 1000) {
          if (hasMore && !loadingMore && !loading) {
            loadCards(currentPage + 1, true);
          }
        }
      }, 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, loading, currentPage]);

  // --- Выбор карт ---

  const toggleCard = (card: Card) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[card.id]) {
        delete next[card.id];
      } else {
        next[card.id] = { card, copies: 1 };
      }
      return next;
    });
  };

  const changeCopies = (card: Card, delta: number) => {
    setSelected(prev => {
      const next = { ...prev };
      const entry = next[card.id];
      if (!entry) {
        if (delta > 0) {
          next[card.id] = { card, copies: delta };
        }
        return next;
      }
      const copies = entry.copies + delta;
      if (copies <= 0) {
        delete next[card.id];
      } else {
        next[card.id] = { ...entry, copies: Math.min(copies, 99) };
      }
      return next;
    });
  };

  const clearSelection = () => setSelected({});

  const selectedEntries = Object.values(selected);
  const totalCopies = selectedEntries.reduce((sum, entry) => sum + entry.copies, 0);

  // Оценка количества листов с учётом расширенных карт (занимают 2 ячейки)
  const estimatePages = (): number => {
    if (selectedEntries.length === 0) return 0;
    let col = 0;
    let row = 0;
    let pages = 1;
    for (const entry of selectedEntries) {
      const span = entry.card.is_extended ? 2 : 1;
      for (let i = 0; i < entry.copies; i += 1) {
        if (col + span > GRID_COLS) {
          col = 0;
          row += 1;
        }
        if (row >= GRID_ROWS) {
          pages += 1;
          row = 0;
          col = 0;
        }
        col += span;
      }
    }
    return pages;
  };

  // --- Экспорт в PDF ---

  const waitForImages = async (container: HTMLElement): Promise<void> => {
    await Promise.all(
      Array.from(container.querySelectorAll('img')).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            })
      )
    );
  };

  // Рендерим карту тем же компонентом, что и превью, и снимаем её в PNG
  const renderAndCapture = async (card: Card): Promise<string> => {
    setCaptureCard(card);
    // Даём React отрендерить карту в контейнере захвата
    await new Promise((resolve) => setTimeout(resolve, 50));

    const node = captureRef.current?.querySelector('.card-preview') as HTMLElement | null;
    if (!node) {
      throw new Error('Не удалось отрендерить карту для экспорта');
    }

    await document.fonts.ready;
    await waitForImages(node);

    return toPng(node, {
      pixelRatio: 3,
      backgroundColor: '#ffffff',
      cacheBust: true,
    });
  };

  const handleExport = async () => {
    if (selectedEntries.length === 0) {
      setError('Выберите карточки для экспорта');
      return;
    }

    setExporting(true);
    setError(null);

    try {
      // 1. Снимаем каждую уникальную карту один раз
      const images = new Map<string, { dataUrl: string; span: number }>();
      setProgress({ current: 0, total: selectedEntries.length, stage: 'render' });

      for (let i = 0; i < selectedEntries.length; i += 1) {
        const entry = selectedEntries[i];
        const dataUrl = await renderAndCapture(entry.card);
        images.set(entry.card.id, {
          dataUrl,
          span: entry.card.is_extended ? 2 : 1,
        });
        setProgress({ current: i + 1, total: selectedEntries.length, stage: 'render' });
      }
      setCaptureCard(null);

      // 2. Раскладываем копии по листам (6×3, расширенные карты занимают 2 ячейки)
      const pages: Placement[][] = [];
      let currentPagePlacements: Placement[] = [];
      let col = 0;
      let row = 0;

      for (const entry of selectedEntries) {
        const image = images.get(entry.card.id)!;
        for (let i = 0; i < entry.copies; i += 1) {
          if (col + image.span > GRID_COLS) {
            col = 0;
            row += 1;
          }
          if (row >= GRID_ROWS) {
            pages.push(currentPagePlacements);
            currentPagePlacements = [];
            row = 0;
            col = 0;
          }
          currentPagePlacements.push({ dataUrl: image.dataUrl, col, row, span: image.span });
          col += image.span;
        }
      }
      if (currentPagePlacements.length > 0) {
        pages.push(currentPagePlacements);
      }

      // 3. Собираем PDF в реальном размере A4
      setProgress({ current: 0, total: pages.length, stage: 'pdf' });

      const scale = Math.min(
        (PAGE_W_MM - 2 * PAGE_MARGIN_MM) / (GRID_COLS * CARD_BASE_W_MM),
        (PAGE_H_MM - 2 * PAGE_MARGIN_MM) / (GRID_ROWS * CARD_BASE_H_MM)
      );
      const cellW = CARD_BASE_W_MM * scale;
      const cellH = CARD_BASE_H_MM * scale;
      const offsetX = (PAGE_W_MM - GRID_COLS * cellW) / 2;
      const offsetY = (PAGE_H_MM - GRID_ROWS * cellH) / 2;

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
        compress: true,
      });

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        if (pageIndex > 0) {
          pdf.addPage('a4', 'landscape');
        }

        // Тонкие чёрные линии реза через весь лист (карты лягут поверх,
        // на полях останутся метки для совмещения реза)
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.1);
        for (let i = 0; i <= GRID_COLS; i += 1) {
          const x = offsetX + i * cellW;
          pdf.line(x, 0, x, PAGE_H_MM);
        }
        for (let j = 0; j <= GRID_ROWS; j += 1) {
          const y = offsetY + j * cellH;
          pdf.line(0, y, PAGE_W_MM, y);
        }

        for (const placement of pages[pageIndex]) {
          pdf.addImage(
            placement.dataUrl,
            'PNG',
            offsetX + placement.col * cellW,
            offsetY + placement.row * cellH,
            cellW * placement.span,
            cellH
          );
        }

        setProgress({ current: pageIndex + 1, total: pages.length, stage: 'pdf' });
        // Даём интерфейсу обновить прогресс
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      pdf.save(`dnd-cards-${dateStamp}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка экспорта');
    } finally {
      setCaptureCard(null);
      setProgress(null);
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-24">
      {/* Заголовок */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-fantasy font-bold text-gray-900">
          Экспорт карточек
        </h1>
        <div className="text-sm text-gray-500">
          18 карт на лист A4 (альбомный), разметка для резки, PDF в реальном размере
        </div>
      </div>

      {/* Поиск и фильтры */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field pl-10 text-sm sm:text-base"
              />
            </div>
          </div>

          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center justify-center space-x-2 text-sm sm:text-base"
          >
            <Filter size={18} />
            <span>Фильтры</span>
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Редкость
              </label>
              <select
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все редкости</option>
                {RARITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Свойства
              </label>
              <select
                value={propertiesFilter}
                onChange={(e) => setPropertiesFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все свойства</option>
                {PROPERTIES_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип шаблона
              </label>
              <select
                value={templateTypeFilter}
                onChange={(e) => setTemplateTypeFilter(e.target.value)}
                className="input-field"
              >
                <option value="cards">Обычные карты</option>
                <option value="templates">Только шаблоны</option>
                <option value="mixed">Шаблоны и обычные</option>
                <option value="all">Все</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Слот экипировки
              </label>
              <select
                value={slotFilter}
                onChange={(e) => setSlotFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все слоты</option>
                <option value="none">Не экипируется</option>
                <option value="head">Голова</option>
                <option value="body">Тело</option>
                <option value="arms">Наручи</option>
                <option value="feet">Обувь</option>
                <option value="cloak">Плащ</option>
                <option value="one_hand">Одна рука</option>
                <option value="versatile">Универсальное</option>
                <option value="two_hands">Две руки</option>
                <option value="necklace">Ожерелье</option>
                <option value="ring">Кольцо</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Тип брони
              </label>
              <select
                value={armorTypeFilter}
                onChange={(e) => setArmorTypeFilter(e.target.value)}
                className="input-field"
              >
                <option value="">Все типы</option>
                <option value="light">Лёгкая</option>
                <option value="medium">Средняя</option>
                <option value="heavy">Тяжелая</option>
                <option value="cloth">Ткань</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Сортировка
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="input-field"
              >
                <option value="created_desc">По дате добавления (новые)</option>
                <option value="created_asc">По дате добавления (старые)</option>
                <option value="updated_desc">По дате изменения (новые)</option>
                <option value="updated_asc">По дате изменения (старые)</option>
                <option value="rarity_asc">По редкости (обычные)</option>
                <option value="rarity_desc">По редкости (артефакты)</option>
                <option value="price_asc">По стоимости (дешевые)</option>
                <option value="price_desc">По стоимости (дорогие)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Сообщение об ошибке */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Загрузка */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {!loading && cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Карточки не найдены</p>
        </div>
      )}

      {/* Сетка карт */}
      {!loading && cards.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-fantasy font-semibold text-gray-900">
              Выберите карточки ({totalCards} в библиотеке)
            </h2>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-6 justify-start">
            {cards.map((card) => {
              const entry = selected[card.id];
              const isSelected = Boolean(entry);
              return (
                <div key={card.id} className="relative">
                  <div
                    className={`cursor-pointer rounded-lg transition-all duration-200 ${
                      isSelected
                        ? 'ring-2 ring-blue-500 ring-offset-2'
                        : 'hover:shadow-card-hover'
                    }`}
                    onClick={() => toggleCard(card)}
                  >
                    <CardPreview card={card} disableHover />
                  </div>

                  {/* Счётчик копий */}
                  {isSelected && (
                    <div
                      className="absolute -top-2 left-1/2 -translate-x-1/2 flex items-center bg-blue-600 text-white rounded-full shadow-lg overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="px-2 py-1 hover:bg-blue-700"
                        onClick={() => changeCopies(card, -1)}
                        title="Убрать копию"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="px-1 text-xs font-bold min-w-[20px] text-center">
                        {entry.copies}
                      </span>
                      <button
                        className="px-2 py-1 hover:bg-blue-700"
                        onClick={() => changeCopies(card, 1)}
                        title="Добавить копию"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}
        </div>
      )}

      {/* Нижняя панель действий */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            Выбрано: <span className="font-semibold">{selectedEntries.length}</span> карт,{' '}
            <span className="font-semibold">{totalCopies}</span> копий —{' '}
            <span className="font-semibold">{estimatePages()}</span> лист(ов) A4
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={clearSelection}
              disabled={exporting || selectedEntries.length === 0}
              className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
            >
              <Trash2 size={16} />
              <span>Очистить</span>
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedEntries.length === 0}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              <span>Экспорт PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* Контейнер захвата: карта рендерится как в превью и снимается в PNG.
          Находится в видимой области, но закрыта оверлеем прогресса */}
      {captureCard && (
        <div className="fixed top-4 left-4 z-[90] bg-white pointer-events-none">
          <div ref={captureRef}>
            <CardPreview card={captureCard} disableHover />
          </div>
        </div>
      )}

      {/* Оверлей прогресса экспорта */}
      {exporting && (
        <div className="fixed inset-0 z-[100] bg-gray-900/80 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-80 text-center space-y-4">
            <Loader2 size={32} className="animate-spin mx-auto text-blue-600" />
            <div className="text-gray-900 font-medium">
              {progress?.stage === 'render'
                ? `Подготовка карт: ${progress.current} из ${progress.total}`
                : `Сборка PDF: лист ${progress?.current ?? 0} из ${progress?.total ?? 0}`}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-200"
                style={{
                  width: progress && progress.total > 0
                    ? `${Math.round((progress.current / progress.total) * 100)}%`
                    : '0%',
                }}
              />
            </div>
            <div className="text-xs text-gray-500">
              Не закрывайте вкладку до завершения экспорта
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardExport;
