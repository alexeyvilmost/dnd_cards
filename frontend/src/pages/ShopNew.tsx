import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { shopsApi } from '../api/client';

const VENDORS = [
  'Кожевник',
  'Оруженик',
  'Кузнец-оружейник',
  'Кузнец-броневик',
  'Ювелир',
  'Магическая лавка',
  'Лавка Раввана',
];

const ShopNew = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [creating, setCreating] = useState(false);

  // Автовыбор через параметр vendor, если пришел
  useEffect(() => {
    const preset = params.get('vendor');
    if (preset && VENDORS.includes(preset)) {
      setSelectedVendor(preset);
    }
  }, [params]);

  const handleCreate = async () => {
    if (!selectedVendor) return;
    setCreating(true);
    try {
      const data = await shopsApi.createShop();
      navigate(`/shop/${data.slug}?vendor=${encodeURIComponent(selectedVendor)}`);
    } catch (e) {
      console.error(e);
      setCreating(false);
    }
  };

  return (
    <div className="py-8">
      {/* Диалог выбора продавца */}
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
        <div className="bg-white w-full max-w-md rounded-lg shadow-xl border border-gray-200 p-4 sm:p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">К какому торговцу вы направляетесь?</h2>

          <div className="grid grid-cols-1 gap-2 mb-4">
            {VENDORS.map((v) => (
              <button
                key={v}
                onClick={() => setSelectedVendor(v)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedVendor === v
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={handleCreate}
              disabled={!selectedVendor || creating}
              className={`btn-primary ${!selectedVendor || creating ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {creating ? 'Создаём…' : 'Перейти в магазин'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShopNew;


