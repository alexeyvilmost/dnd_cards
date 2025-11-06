import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { shopsApi } from '../api/client';
import type { Card } from '../types';
import CardPreview from '../components/CardPreview';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import { getRarityColor } from '../utils/rarityColors';
import { Grid3X3, List } from 'lucide-react';

type VendorsResponse = Record<string, Card[]>;

const ShopDetail = () => {
  const { slug } = useParams();
  const [vendors, setVendors] = useState<VendorsResponse>({});
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const selectedVendor = params.get('vendor') || '';

  useEffect(() => {
    const run = async () => {
      try {
        if (!slug) return;
        const data = await shopsApi.getShop(slug);
        setVendors(data.vendors || {});
        setError(null);
      } catch (e: any) {
        setError(e?.message || 'Не удалось загрузить магазин');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [slug]);

  const vendorNames = useMemo(() => Object.keys(vendors), [vendors]);

  const getRarityBorderColor = (rarity: string): string => {
    switch (rarity?.toLowerCase()) {
      case 'common':
      case 'обычное':
        return 'border-l-gray-400';
      case 'uncommon':
      case 'необычное':
        return 'border-l-green-500';
      case 'rare':
      case 'редкое':
        return 'border-l-blue-500';
      case 'very_rare':
      case 'очень редкое':
        return 'border-l-purple-500';
      case 'epic':
      case 'эпическое':
        return 'border-l-purple-500';
      case 'legendary':
      case 'легендарное':
        return 'border-l-orange-500';
      case 'artifact':
      case 'артефакт':
        return 'border-l-orange-500';
      default:
        return 'border-l-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl sm:text-3xl font-fantasy font-bold text-gray-900">Магазин</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-lg border ${viewMode === 'grid' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title="Сетка"
          >
            <Grid3X3 size={18} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-lg border ${viewMode === 'list' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            title="Список"
          >
            <List size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {!loading && vendorNames.length === 0 && (
        <div className="text-center text-gray-500">Ассортимент пуст</div>
      )}

      {!loading && vendorNames.length > 0 && (
        <div className="space-y-10">
          {(selectedVendor ? vendorNames.filter(n => n === selectedVendor) : vendorNames).map((vendorName) => {
            const cards = vendors[vendorName] || [];
            return (
              <div key={vendorName} className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">{vendorName}</h2>

                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
                    {cards.map((card) => {
                      const isExtended = Boolean(card.is_extended);
                      return (
                        <div 
                          key={card.id} 
                          className={`relative group flex justify-center cursor-pointer ${isExtended ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
                        >
                          {isExtended ? (
                            <CardPreview card={card as any} />
                          ) : (
                            <div className="w-full max-w-[198px]">
                              <CardPreview card={card as any} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                      {cards.map((card) => (
                        <div key={card.id} className="relative">
                          <button className={`w-full text-left p-3 rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:shadow-md hover:bg-gray-50 border-l-4 ${getRarityBorderColor(card.rarity)}`}>
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                                {card.image_url && card.image_url.trim() !== '' ? (
                                  <img src={card.image_url} alt={card.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                                ) : (
                                  <img src="/default_image.png" alt="Default D&D" className="w-full h-full object-contain" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium truncate ${getRarityColor(card.rarity)} flex items-center gap-1`}>
                                  <span className="text-lg" title={getRaritySymbolDescription(card.rarity)} aria-label={getRaritySymbolDescription(card.rarity)}>
                                    {getRaritySymbol(card.rarity)}
                                  </span>
                                  <span>{card.name}</span>
                                </div>
                                <div className="flex items-center justify-between mt-1 text-xs">
                                  <div className="flex items-center space-x-2">
                                    {card.price && (
                                      <div className="flex items-center space-x-1">
                                        <span className="text-yellow-600 font-bold">{card.price >= 1000 ? `${(card.price / 1000).toFixed(1)}K` : card.price}</span>
                                        <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                                      </div>
                                    )}
                                  </div>
                                  <span className={`font-mono text-gray-400`}>{card.card_number}</span>
                                </div>
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ShopDetail;


