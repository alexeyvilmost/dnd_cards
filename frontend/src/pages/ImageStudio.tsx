import { useState } from 'react';
import { Sparkles, Download, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { imagesApi } from '../api/imagesApi';
import type { ImageGenerationQuality } from '../api/imagesApi';
import { COLOR_TOKENS } from '../utils/damageTypes';

interface GenResult {
  url: string;
  subject: string;
  element: string;
  prompt: string;
  ms: number;
}

const QUALITY_OPTIONS: { value: ImageGenerationQuality; label: string }[] = [
  { value: 'low', label: 'Низкое (быстро, дёшево)' },
  { value: 'medium', label: 'Среднее' },
  { value: 'high', label: 'Высокое (медленно)' },
];

const ImageStudio = () => {
  const [subject, setSubject] = useState('');
  const [element, setElement] = useState('fire');
  const [extra, setExtra] = useState('');
  const [quality, setQuality] = useState<ImageGenerationQuality>('medium');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GenResult[]>([]);
  const [openPrompt, setOpenPrompt] = useState<number | null>(null);

  const elementColor = COLOR_TOKENS.find((c) => c.value === element)?.color ?? '#888';

  const generate = async () => {
    if (!subject.trim() && !customPrompt.trim()) {
      setError('Укажите концепт заклинания или свой промпт');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await imagesApi.generateStandalone({
        subject: subject.trim(),
        element,
        extra: extra.trim(),
        prompt: customPrompt.trim() || undefined,
        style: 'spell_icon',
        quality,
      });
      setResults((prev) => [
        { url: res.image_url, subject: subject.trim() || 'свой промпт', element, prompt: res.prompt, ms: res.generation_time_ms },
        ...prev,
      ]);
    } catch (e: any) {
      setError(e?.message || 'Ошибка генерации');
    } finally {
      setLoading(false);
    }
  };

  const download = (url: string, name: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'spell-icon'}.png`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const checkerBg =
    'repeating-conic-gradient(#e5e7eb 0% 25%, #f9fafb 0% 50%) 50% / 16px 16px';

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="text-purple-600" /> Генерация изображений
          </h1>
          <p className="text-gray-600 mt-1 text-sm">
            Иконки заклинаний в стиле Baldur's Gate 3: светящийся энергетический глиф на прозрачном фоне.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Форма */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-xl shadow p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Концепт / название заклинания *</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="напр. огненный шар, ледяная стрела, цепная молния"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тип энергии (цвет)</label>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-5 h-5 rounded-full border border-gray-300" style={{ backgroundColor: elementColor }} />
                  <select
                    value={element}
                    onChange={(e) => setElement(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {COLOR_TOKENS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Дополнительные детали (необязательно)</label>
                <input
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  placeholder="напр. в форме черепа, спиральный вихрь"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Качество</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value as ImageGenerationQuality)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  {QUALITY_OPTIONS.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />} Свой промпт (перебивает стиль)
                </button>
                {showAdvanced && (
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={4}
                    placeholder="Полный промпт на английском — если заполнен, поля выше игнорируются"
                    className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                  />
                )}
              </div>

              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

              <button
                onClick={generate}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
              >
                {loading ? <><Loader2 className="animate-spin" size={18} /> Генерация…</> : <><Sparkles size={18} /> Сгенерировать</>}
              </button>
              <p className="text-xs text-gray-400">Генерация занимает 10–40 секунд и расходует кредиты OpenAI.</p>
            </div>
          </div>

          {/* Результаты */}
          <div className="lg:col-span-7">
            {results.length === 0 && !loading && (
              <div className="bg-white rounded-xl shadow p-10 text-center text-gray-400">
                Здесь появятся сгенерированные иконки
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {loading && (
                <div className="bg-white rounded-xl shadow flex items-center justify-center aspect-square text-gray-400">
                  <Loader2 className="animate-spin" size={32} />
                </div>
              )}
              {results.map((r, i) => (
                <div key={i} className="bg-white rounded-xl shadow overflow-hidden">
                  <div className="aspect-square flex items-center justify-center" style={{ background: checkerBg }}>
                    <img src={r.url} alt={r.subject} className="max-w-full max-h-full object-contain" />
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-800 truncate">{r.subject}</div>
                      <button
                        onClick={() => download(r.url, r.subject)}
                        title="Скачать"
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                      >
                        <Download size={16} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{r.element} · {(r.ms / 1000).toFixed(1)}с</div>
                    <button
                      onClick={() => setOpenPrompt(openPrompt === i ? null : i)}
                      className="text-xs text-purple-600 hover:underline mt-1"
                    >
                      {openPrompt === i ? 'Скрыть промпт' : 'Показать промпт'}
                    </button>
                    {openPrompt === i && (
                      <p className="text-[11px] text-gray-500 mt-1 whitespace-pre-wrap break-words">{r.prompt}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageStudio;
