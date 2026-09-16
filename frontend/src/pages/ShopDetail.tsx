import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Grid3X3, LayoutGrid, ShoppingCart } from 'lucide-react';
import { shopsApi, cardsApi } from '../api/client';
import { roguelikeApi, type RoguelikeRun, type RoguelikeOffer } from '../roguelike/api';
import { runSheetURL } from '../roguelike/navigation';
import { charactersV3Api } from '../character/api';
import { characterCurrency, purchaseItem } from '../character/inventory';
import { loadAssembly } from '../character/assemble';
import { characterToDraft } from '../character/forgeHelpers';
import { collectPassiveMechanics } from '../character/resourceInit';
import { runtimeInventoryPayload } from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import type { Card } from '../types';
import SheetActionLine from '../components/SheetActionLine';
import ItemPreview from '../components/ItemPreview';
import CardPreview from '../components/CardPreview';
import {EntityDetailShell} from '../components/EntityDetailShell';
import './ShopDetail.css';
import CoinAmount from '../components/CoinAmount';
import { getCurrencyInfo } from '../utils/currencies';
import { useSiteSettings } from '../settings';
import MerchantSettingsDialog from '../components/MerchantSettingsDialog';
import {merchantSettingsApi,type MerchantSettings} from '../api/entityTags';
import ShopCart, {type CartRow} from '../components/ShopCart';
import {walletInCopper} from '../utils/money';
import {runMoneyCopper} from '../roguelike/money';
import {shopReturnTo} from '../utils/shopNavigation';
import {offerId,cardForOffer,shopPriceCopper} from '../roguelike/shopPresentation';

type VendorsResponse = Record<string, Card[]>;

const STARTING_GOLD = 150;

const ShopDetail = () => {
  const [merchantSettings,setMerchantSettings]=useState<MerchantSettings|null>(null);
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{void merchantSettingsApi.get().then(setMerchantSettings).catch(()=>{});},[settingsOpen]);
  const settings = useSiteSettings();
  const { slug } = useParams();
  const [vendors, setVendors] = useState<VendorsResponse>({});
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'full'>(() => {
    try { return localStorage.getItem('dnd-cards:shop-view') === 'full' ? 'full' : 'grid'; }
    catch { return 'grid'; }
  });
  const changeViewMode = (mode: 'grid' | 'full') => {
    setViewMode(mode);
    try { localStorage.setItem('dnd-cards:shop-view', mode); } catch { /* private mode */ }
  };
  const [error, setError] = useState<string | null>(null);
  const [inspectedCard, setInspectedCard] = useState<Card | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [purchasePassives, setPurchasePassives] = useState<Record<string, unknown>[]>([]);
  const [params, setParams] = useSearchParams();
  const runId = params.get('roguelike');
  const [roguelike, setRoguelike] = useState<RoguelikeRun | null>(null);
  const selectedVendor = params.get('vendor') || '';
  const characterId = params.get('character') || '';
  const returnTo = shopReturnTo(params.get('returnTo'))
    ?? (runId && (characterId || roguelike?.character_id)
      ? runSheetURL({id:runId,character_id:characterId || roguelike!.character_id})
      : characterId ? `/characters-v3/${characterId}` : '/shop/new');
  const basketKey=runId??characterId??'unselected';
  const [baskets,setBaskets]=useState<Record<string,Record<string,number>>>(()=>{try{return JSON.parse(localStorage.getItem('boh:shop-baskets')||'{}')}catch{return {}}});
  const basket=baskets[basketKey]??{};
  const pendingCart=useRef<{signature:string;revision:number;commandId:string}|null>(null);
  const forgetPendingCart=()=>{pendingCart.current=null;try{localStorage.removeItem('boh:shop-pending:'+basketKey)}catch{/* storage unavailable */}};
  const changeBasket=(id:string,quantity:number)=>{if(buyingId)return;setShopMsg(null);setBaskets(all=>{const next={...(all[basketKey]??{})};if(quantity<0)delete next[id];else next[id]=Math.max(0,Math.min(1000,Math.floor(quantity)||0));return {...all,[basketKey]:next}});pendingCart.current=null;};
  useEffect(()=>{try{localStorage.setItem('boh:shop-baskets',JSON.stringify(baskets))}catch{/* storage unavailable */}},[baskets]);

  const applyRun = useCallback(async (run: RoguelikeRun) => {
    const hydrate = async (offer: RoguelikeOffer): Promise<Card> => {
      const card = offer.card_id ? await cardsApi.getCard(offer.card_id) : {
        id: offer.id, name: offer.name, rarity: 'common',
        price:offer.price,price_currency:offer.price_currency||'gold',
        image_url: 'https://dnd-cards-images.storage.yandexcloud.net/cards/1783596157_0LfYMOIk.png',
        description: 'Для долгого отдыха требуется один комплект лагерных припасов.',
      } as Card;
      return cardForOffer(card,offer);
    };
    const [staples, offers] = await Promise.all([
      Promise.all(run.shop.staples.map(hydrate)), Promise.all(run.shop.offers.map(hydrate)),
    ]);
    setRoguelike(run);
    setCharacters(run.character ? [run.character] : []);
    const starterIDs=new Set(run.shop.staples.filter(o=>o.starting_only).map(o=>o.id));
    setVendors({ 'Постоянный ассортимент': staples.filter(c=>!starterIDs.has(offerId(c))),
      ...(starterIDs.size ? {'Стартовая экипировка':staples.filter(c=>starterIDs.has(offerId(c)))} : {}),
      'Случайный ассортимент': offers });
  }, []);

  const runCommand = async (type: 'buy' | 'pin' | 'refresh_shop', payload: Record<string, unknown> = {}) => {
    if (!runId || buyingId) return;
    setBuyingId(String(payload.offer_id ?? type)); setShopMsg(null);
    try {
      const fresh = await roguelikeApi.get(runId);
      await applyRun(await roguelikeApi.command(runId, fresh.revision, type, payload));
    } catch (e) { setShopMsg(e instanceof Error ? e.message : 'Ошибка магазина'); }
    finally { setBuyingId(null); }
  };

  const selectedCharacter = useMemo(
    () => roguelike?.character ?? characters.find((c) => c.id === characterId) ?? null,
    [characters, characterId, roguelike],
  );

  const wallet = useMemo(
    () => (selectedCharacter ? characterCurrency(selectedCharacter) : null),
    [selectedCharacter],
  );

  useEffect(() => {
    const run = async () => {
      try {
        if (!slug) return;
        if (runId) {
          await applyRun(await roguelikeApi.get(runId));
          return;
        }
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
  }, [slug, runId, applyRun]);

  useEffect(() => {
    let active = true;
    if (!selectedCharacter || runId) {
      setPurchasePassives([]);
      return () => { active = false; };
    }
    setPurchasePassives([]);
    const draft = characterToDraft(selectedCharacter);
    void loadAssembly(draft)
      .then((assembled) => {
        if (active) setPurchasePassives(collectPassiveMechanics(assembled, draft.resolvedChoices));
      })
      .catch(() => {
        if (active) setPurchasePassives([]);
      });
    return () => { active = false; };
  }, [selectedCharacter, runId]);

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
      setShopMsg('Кошелёк пополнен для теста покупок.');
    } catch (e) {
      console.error(e);
      setShopMsg('Не удалось выдать золото');
    } finally {
      setBuyingId(null);
    }
  };

  const checkout = async () => {
    if (!selectedCharacter) {
      setShopMsg('Выберите персонажа для покупки');
      return;
    }
    if(buyingId||!cartRows.length)return;
    setBuyingId('cart');
    setShopMsg(null);
    try {
      if(runId){
        const items=cartRows.map(row=>({offer_id:row.id,quantity:row.quantity}));
        const signature=JSON.stringify([runId,items]);
        if(!pendingCart.current){try{pendingCart.current=JSON.parse(localStorage.getItem('boh:shop-pending:'+basketKey)||'null')}catch{/* storage unavailable */}}
        if(pendingCart.current?.signature!==signature){const fresh=await roguelikeApi.get(runId);pendingCart.current={signature,revision:fresh.revision,commandId:crypto.randomUUID()};}
        try{localStorage.setItem('boh:shop-pending:'+basketKey,JSON.stringify(pendingCart.current))}catch{/* storage unavailable */}
        const pending=pendingCart.current!;
        await roguelikeApi.command(runId,pending.revision,'buy_cart',{items},pending.commandId);
        await applyRun(await roguelikeApi.get(runId));
        forgetPendingCart();
      }else{
      let fresh = await charactersV3Api.get(selectedCharacter.id);
      const expectedRevision=fresh.runtime_revision;
      const draft = characterToDraft(fresh);
      const assembled = await loadAssembly(draft);
      const passives = collectPassiveMechanics(assembled, draft.resolvedChoices);
      for(const row of cartRows){
      if(!row.card)throw new Error('Товар недоступен');
      const {
        runtime,
        currency,
        error: buyErr,
      } = purchaseItem(fresh, row.card, passives,row.quantity);
      if (buyErr) {
        setShopMsg(buyErr);
        return;
      }
      fresh={...fresh,inventory_items:runtimeInventoryPayload(runtime),currency};
      }
      const updated = await charactersV3Api.patchRuntime(fresh.id, {
        inventory_items: fresh.inventory_items??[],
        currency:fresh.currency??{},
        expected_runtime_revision:expectedRevision??undefined,
      });
      setCharacters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      }
      setBaskets(all=>({...all,[basketKey]:{}}));
      setShopMsg('Корзина куплена. Предметы добавлены в инвентарь, сдача — в кошелёк.');
    } catch (e) {
      console.error(e);
      const status=(e as {response?:{status:number;data?:{error?:string}}})?.response?.status;
      if(status&&status>=400&&status<500)forgetPendingCart();
      setShopMsg((e as {response?:{data?:{error?:string}}})?.response?.data?.error??(e instanceof Error?e.message:'Ошибка покупки'));
    } finally {
      setBuyingId(null);
    }
  };

  const vendorNames = useMemo(() => Object.keys(vendors), [vendors]);

  const offers=roguelike?[...roguelike.shop.staples,...roguelike.shop.offers]:[];
  const cartRows:CartRow[]=Object.entries(basket).map(([id,quantity])=>{const card=Object.values(vendors).flat().find(c=>offerId(c)===id);const offer=offers.find(o=>o.id===id);return {id,card,quantity,bundle:offer?.quantity??1,max:offer?.sold?0:offer&&!roguelike?.shop.staples.some(o=>o.id===id)?1:1000,priceCopper:card?shopPriceCopper(card,offers,purchasePassives):0}});
  let canResumeCart=false;
  try{const saved=JSON.parse(localStorage.getItem('boh:shop-pending:'+basketKey)||'null');canResumeCart=Boolean(runId&&saved?.signature===JSON.stringify([runId,cartRows.map(row=>({offer_id:row.id,quantity:row.quantity}))]));}catch{/* storage unavailable */}

  const walletLine = wallet && (
    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
      {(['gold', 'silver', 'copper'] as const).map((key) => {
        const cur = getCurrencyInfo(key);
        return (
          <span key={key} className="inline-flex items-center gap-1">
            <img src={cur.icon} alt={cur.label} className="w-4 h-4" />
            <strong>{wallet[key] ?? 0}</strong>
          </span>
        );
      })}
      {!runId && (wallet.gold ?? 0) === 0 && (wallet.silver ?? 0) === 0 && (wallet.copper ?? 0) === 0 && (
        <button
          type="button"
          className="text-blue-600 hover:underline text-sm"
          disabled={buyingId === 'grant'}
          onClick={grantStartingGold}
        >
          Выдать <CoinAmount copper={STARTING_GOLD*100}/> (тест)
        </button>
      )}
    </div>
  );

  const buyButton = (card: Card, compact = false) => {
    const offer = roguelike && [...roguelike.shop.staples, ...roguelike.shop.offers].find((entry) => entry.id === offerId(card));
    const busy = buyingId === offerId(card);
    return (
      <>
      <button
        type="button"
        disabled={!selectedCharacter || Boolean(buyingId) || canResumeCart || Boolean(offer?.sold) || Boolean(roguelike && (roguelike.phase !== 'camp' || roguelike.status !== 'active'))}
        onClick={() => {const max=offer&&!roguelike?.shop.staples.some(o=>o.id===offer.id)?1:1000;changeBasket(offerId(card),Math.min(max,(basket[offerId(card)]??0)+1));}}
        className="shop-buy"
        aria-description={!selectedCharacter ? 'Выберите персонажа' : 'Добавить товар в корзину'}
      >
        <ShoppingCart size={compact ? 14 : 16} />
        {busy ? '…' : offer?.sold ? 'Продано' : basket[offerId(card)] ? `В корзине: ${basket[offerId(card)]}` : 'В корзину'}
      </button>
      {offer && <span className="text-xs text-gray-500">{offer.quantity>1?`Пачка: ${offer.quantity} шт. · `:''}{roguelike?.shop.staples.some((entry) => entry.id === offer.id) ? '∞' : '1 предложение'}</span>}
      {offer && roguelike?.shop.offers.some((entry) => entry.id === offer.id) && <button type="button"
        className="shop-reserve" aria-pressed={offer.pinned} disabled={Boolean(buyingId) || offer.sold || (!offer.pinned && runMoneyCopper(roguelike) < 500) || roguelike.phase !== 'camp' || roguelike.status !== 'active'}
        onClick={() => void runCommand('pin', { offer_id: offer.pinned ? '' : offer.id })}>
        {offer.pinned ? 'Снять резерв' : <>В резерв · <CoinAmount copper={500}/></>}
      </button>}
      </>
    );
  };

  return (
    <div className="merchant-shop space-y-6">
      <Link
        className="shop-back"
        to={returnTo}
        aria-description="Вернуться на страницу, с которой открыт магазин"
      ><ArrowLeft size={18} aria-hidden="true"/>Назад</Link>
      {merchantSettings?.can_manage&&<button type="button" className="shop-refresh" onClick={()=>setSettingsOpen(true)}>Настройки магазина забега</button>}
      {settingsOpen&&<MerchantSettingsDialog onClose={()=>setSettingsOpen(false)}/>}
      <p className="merchant-shop__eyebrow">ПРИПАСЫ · СНАРЯЖЕНИЕ · РЕДКОСТИ</p>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div><h1>Лавка странника</h1><p className="merchant-shop__welcome">Загляните на полки. Хорошая находка может спасти следующий бой.</p></div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => changeViewMode('grid')}
            className={`p-2 rounded-lg border ${viewMode === 'grid' ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
            aria-description="Предметы на полках" aria-label="Предметы на полках" aria-pressed={viewMode === 'grid'}
          >
            <Grid3X3 size={18} />
          </button>
          <button
            onClick={() => changeViewMode('full')}
            className="p-2 rounded-lg border"
            aria-description="Полные карточки — вид из настроек превью предметов" aria-label="Полные карточки" aria-pressed={viewMode === 'full'}
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>

      <div className="shop-counter space-y-3">
        {roguelike && <div className="flex items-center gap-3 flex-wrap">
          <span>Припасы: {roguelike.supplies} · Обновление {roguelike.shop.generation}</span>
          {roguelike.encounters_won===0&&<span>Стартовая экипировка доступна до первой победы.</span>}
          <button className="shop-refresh" disabled={!merchantSettings || Boolean(buyingId) || runMoneyCopper(roguelike) < (merchantSettings?.config.refresh_price ?? 0) * (roguelike.paid_refresh_count + 1)*100 || roguelike.phase !== 'camp' || roguelike.status !== 'active'}
            onClick={() => void runCommand('refresh_shop')}>Обновить ассортимент · {merchantSettings ? <CoinAmount copper={merchantSettings.config.refresh_price * (roguelike.paid_refresh_count + 1)*100}/> : '…'}</button>
        </div>}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm font-medium text-gray-700 shrink-0">Покупатель:</label>
          <select
            className="flex-1 max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm"
            value={selectedCharacter?.id ?? characterId}
            disabled={Boolean(runId)}
            onChange={(e) => selectCharacter(e.target.value)}
          >
            <option value="">— выберите персонажа v3 —</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedCharacter && (
            <Link
              to={roguelike ? runSheetURL(roguelike) : `/characters-v3/${selectedCharacter.id}`}
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

      <ShopCart key={basketKey} rows={cartRows} busy={Boolean(buyingId)||Boolean(roguelike&&(roguelike.phase!=='camp'||roguelike.status!=='active'))} availableMoney={wallet?walletInCopper(wallet):0} onQuantity={changeBasket} onRemove={id=>changeBasket(id,-1)} onBuy={()=>void checkout()} onInspect={setInspectedCard} canResume={canResumeCart} message={shopMsg}/>

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
                  <div className="shop-shelves">
                    {cards.map(card => <article className="shop-shelf-item" key={offerId(card)}>
                      <SheetActionLine name={card.name} imageUrl={card.image_url || '/default_image.png'} itemRef={card}
                        variant="icon" onActivate={() => setInspectedCard(card)}/>
                      <div className="shop-shelf-item__trade">
                        <CoinAmount copper={shopPriceCopper(card,offers,purchasePassives)}/>
                        {buyButton(card, true)}
                      </div>
                    </article>)}
                  </div>
                ) : (
                  <div className={`shop-full-items is-${settings.itemPreview}`}>
                    {cards.map(card => <article className="shop-full-item" key={offerId(card)} aria-label={card.name}>
                      {settings.itemPreview === 'interface'
                        ? <ItemPreview card={card} disableHover/>
                        : <CardPreview card={card} disableHover/>}
                      <div className="shop-full-item__trade">
                        <CoinAmount copper={shopPriceCopper(card,offers,purchasePassives)}/>
                        {buyButton(card)}
                      </div>
                    </article>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {inspectedCard && <EntityDetailShell isOpen onClose={()=>setInspectedCard(null)} title={inspectedCard.name}
        titleEn={inspectedCard.name_en} labelledById="shop-item-title"
        preview={settings.itemPreview==='interface'?<ItemPreview card={inspectedCard} disableHover/>:<CardPreview card={inspectedCard} disableHover/>}
        actions={buyButton(inspectedCard)}>
        <span className="inline-flex items-center gap-1">Цена предложения: <CoinAmount copper={shopPriceCopper(inspectedCard,offers,purchasePassives)}/></span>
      </EntityDetailShell>}
    </div>
  );
};

export default ShopDetail;
