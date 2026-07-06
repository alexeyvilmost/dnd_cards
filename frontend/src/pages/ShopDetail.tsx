import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Grid3X3, List, ShoppingCart } from 'lucide-react';
import { shopsApi } from '../api/client';
import { charactersV3Api } from '../character/api';
import { characterCurrency, purchaseItem } from '../character/inventory';
import { runtimeInventoryPayload } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { Card } from '../types';
import CardPreview from '../components/CardPreview';
import CurrencyPriceInline from '../components/CurrencyPriceInline';
import { getRaritySymbol, getRaritySymbolDescription } from '../utils/raritySymbols';
import { getRarityColor } from '../utils/rarityColors';
import { getCurrencyInfo } from '../utils/currencies';
import { getSettings } from '../settings';

type VendorsResponse = Record<string, Card[]>;

const STARTING_GOLD = 150;

const ShopDetail = () => {
  const { slug } = useParams();
  const [vendors, setVendors] = useState<VendorsResponse>({});
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  // Начальный режим — из настройки «Отображение сущностей → Предметы»; переключатель работает поверх.
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(
    () => (getSettings().entityDisplay.items === 'icon' ? 'grid' : 'list'),
  );
  const [error, setError] = useState<string | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const selectedVendor = params.get('vendor') || '';
  const characterId = params.get('character') || '';

  const selectedCharacter = useMemo(
    () => characters.find((c) => c.id === characterId) ?? null,
    [characters, characterId],
  );

  const wallet = useMemo(
    () => (selectedCharacter ? characterCurrency(selectedCharacter) : null),
    [selectedCharacter],
  );

  useEffect(() => {
    const run = async () => {
      try {
        if (!slug) return;
        const [shop, chars] = await Promise.all([
          shopsApi.getShop(slug),
          charactersV3Api.list(),
        ]);
        setVendors(shop.vendors || {});
        setCharacters(chars);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Не удалось загрузить магазин');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [slug]);

  const selectCharacter = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('character', id);
    else next.delete('character');
    setParams(next);
    setShopMsg(null);
  };

  const grantStartingGold = async () => {
    if (!selectedCharacter) return;
    setBuyingId('grant');
    setShopMsg(null);
    try {
      const currency = { ...characterCurrency(selectedCharacter), gold: STARTING_GOLD };
      const updated = await charactersV3Api.patchRuntime(selectedCharacter.id, { currency });
      setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setShopMsg(`Выдано ${STARTING_GOLD} зм для теста покупок.`);
    } catch (e) {
      console.error(e);
      setShopMsg('Не удалось выдать золото');
    } finally {
      setBuyingId(null);
    }
  };

  const handleBuy = useCallback(async (card: Card) => {
    if (!selectedCharacter) {
      setShopMsg('Выберите персонажа для покупки');
      return;
    }
    setBuyingId(card.id);
    setShopMsg(null);
    try {
      const fresh = await charactersV3Api.get(selectedCharacter.id);
      const { runtime, currency, error: buyErr } = purchaseItem(fresh, card);
      if (buyErr) {
        setShopMsg(buyErr);
        return;
      }
      const updated = await charactersV3Api.patchRuntime(fresh.id, {
        inventory_items: runtimeInventoryPayload(runtime),
        currency,
      });
      setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setShopMsg(`«${card.name}» добавлен в инвентарь.`);
    } catch (e) {
      console.error(e);
      setShopMsg('Ошибка покупки');
    } finally {
      setBuyingId(null);
    }
  }, [selectedCharacter]);

  const vendorNames = useMemo(() => Object.keys(vendors), [vendors]);

  const canAfford = (card: Card) => {
    if (!wallet) return false;
    const price = card.price ?? 0;
    if (price <= 0) return true;
    const cur = card.price_currency || 'gold';
    return (wallet[cur] ?? 0) >= price;
  };

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

  const walletLine = wallet && (
    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
      {(['gold', 'silver', 'copper'] as const).map((key) => {
        const cur = getCurrencyInfo(key);
        return (
          <span key={key} className="inline-flex items-center gap-1">
            <img src={cur.icon} alt={cur.label} className="w-4 h-4" />
            <strong>{wallet[key] ?? 0}</strong>
            <span className="text-gray-500">{cur.short}</span>
          </span>
        );
      })}
      {(wallet.gold ?? 0) === 0 && (wallet.silver ?? 0) === 0 && (wallet.copper ?? 0) === 0 && (
        <button
          type="button"
          className="text-blue-600 hover:underline text-sm"
          disabled={buyingId === 'grant'}
          onClick={grantStartingGold}
        >
          Выдать {STARTING_GOLD} зм (тест)
        </button>
      )}
    </div>
  );

  const buyButton = (card: Card, compact = false) => {
    const price = card.price ?? 0;
    const affordable = canAfford(card);
    const busy = buyingId === card.id;
    return (
      <button
        type="button"
        disabled={!selectedCharacter || busy || (price > 0 && !affordable)}
        onClick={() => handleBuy(card)}
        className={`inline-flex items-center gap-1 rounded-lg border transition-colors ${
          compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
        } ${
          !selectedCharacter || (price > 0 && !affordable)
            ? 'border-gray-200 text-gray-400 cursor-not-allowed'
            : 'border-green-600 text-green-700 hover:bg-green-50'
        }`}
        title={!selectedCharacter ? 'Выберите персонажа' : price > 0 && !affordable ? 'Недостаточно средств' : 'Купить'}
      >
        <ShoppingCart size={compact ? 14 : 16} />
        {busy ? '…' : 'Купить'}
      </button>
    );
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

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm font-medium text-gray-700 shrink-0">Покупатель:</label>
          <select
            className="flex-1 max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={characterId}
            onChange={(e) => selectCharacter(e.target.value)}
          >
            <option value="">— выберите персонажа v3 —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedCharacter && (
            <Link
              to={`/characters-v3/${selectedCharacter.id}`}
              className="text-sm text-blue-600 hover:underline shrink-0"
            >
              Открыть лист →
            </Link>
          )}
        </div>
        {walletLine}
        {shopMsg && (
          <p className={`text-sm ${shopMsg.includes('Ошибка') || shopMsg.includes('Недостаточно') ? 'text-red-600' : 'text-green-700'}`}>
            {shopMsg}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {!loading && vendorNames.length === 0 && (
        <div className="text-center text-gray-500">Ассортимент пуст</div>
      )}

      {!loading && vendorNames.length > 0 && (
        <div className="space-y-10">
          {(selectedVendor ? vendorNames.filter((n) => n === selectedVendor) : vendorNames).map((vendorName) => {
            const cards = vendors[vendorName] || [];
            return (
              <div key={vendorName} className="space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">{vendorName}</h2>

                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-4">
                    {cards.map((card) => {
                      const isExtended = Boolean(card.is_extended);
                      return (
                        <div
                          key={card.id}
                          className={`relative flex flex-col items-center gap-2 ${isExtended ? 'col-span-2 sm:col-span-2 md:col-span-2 lg:col-span-2 xl:col-span-2' : ''}`}
                        >
                          <div className={`relative group flex justify-center ${isExtended ? '' : 'w-full max-w-[198px]'}`}>
                            {isExtended ? (
                              <CardPreview card={card as Card} />
                            ) : (
                              <CardPreview card={card as Card} />
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-center">
                            {card.price != null && card.price > 0 && (
                              <CurrencyPriceInline price={card.price} currency={card.price_currency} />
                            )}
                            {buyButton(card, true)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="relative">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
                      {cards.map((card) => (
                        <div key={card.id} className="relative">
                          <div className={`w-full text-left p-3 rounded-lg border border-gray-200 bg-white border-l-4 ${getRarityBorderColor(card.rarity)}`}>
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                                {card.image_url?.trim() ? (
                                  <img src={card.image_url} alt={card.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
                                ) : (
                                  <img src="/default_image.png" alt="" className="w-full h-full object-contain" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`font-medium truncate ${getRarityColor(card.rarity)} flex items-center gap-1`}>
                                  <span className="text-lg" title={getRaritySymbolDescription(card.rarity)}>
                                    {getRaritySymbol(card.rarity)}
                                  </span>
                                  <span>{card.name}</span>
                                </div>
                                <div className="flex items-center justify-between mt-1 text-xs gap-2">
                                  <div className="flex items-center gap-2">
                                    {card.price != null && card.price > 0 && (
                                      <CurrencyPriceInline price={card.price} currency={card.price_currency} textClassName="text-yellow-600 font-bold" />
                                    )}
                                    {buyButton(card, true)}
                                  </div>
                                  <span className="font-mono text-gray-400 shrink-0">{card.card_number}</span>
                                </div>
                              </div>
                            </div>
                          </div>
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
