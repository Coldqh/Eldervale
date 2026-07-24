import { useState } from 'react';
import type { ActionResult } from '../../app/useGameState';
import type { GameState } from '../../domain/game';
import {
  channelLabel,
  demandEstimate,
  proposalActionCost,
  type ContactMode,
  type DemandSignal,
  type MarketOutletState,
  type MarketProposal,
  type ProposalInput,
  type RepeatOrder,
} from '../../domain/market';
import type { BatchState } from '../../domain/production';
import type { BrandDraft, CampaignType, ReleaseDraft } from '../../domain/brand';
import { Icon } from '../../ui/Icon';
import { EmptyState, Modal, SubTabs } from '../../ui/MobileUI';
import { EditorialVisual } from '../../ui/EditorialVisual';
import { BrandHub } from '../brand/BrandHub';

type TradeSection = 'products' | 'orders' | 'buyers';
type OutletFilter = 'local' | 'all' | 'bar' | 'store' | 'specialty';

interface MarketWorldProps {
  state: GameState;
  onSendProposal: (input: ProposalInput) => ActionResult;
  onAcceptOffer: (proposalId: string) => ActionResult;
  onDeclineOffer: (proposalId: string) => ActionResult;
  onFulfillOrder: (orderId: string, batchId: string) => ActionResult;
  onCreateBrand: (draft: BrandDraft) => ActionResult;
  onCreateRelease: (draft: ReleaseDraft) => ActionResult;
  onLaunchCampaign: (releaseId: string, type: CampaignType) => ActionResult;
}

export function MarketWorld({ state, onSendProposal, onAcceptOffer, onDeclineOffer, onFulfillOrder, onCreateBrand, onCreateRelease, onLaunchCampaign }: MarketWorldProps) {
  const world = state.world;
  const packagedBatches = state.production.batches.filter((batch) => batch.status === 'packaged' && batch.availableUnits > 0);
  const [section, setSection] = useState<TradeSection>('products');
  const [filter, setFilter] = useState<OutletFilter>('local');
  const [search, setSearch] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState(packagedBatches[0]?.id ?? '');
  const [dealOutlet, setDealOutlet] = useState<MarketOutletState | null>(null);
  const [proposalModal, setProposalModal] = useState<MarketProposal | null>(null);
  const [orderModal, setOrderModal] = useState<RepeatOrder | null>(null);
  const [contactMode, setContactMode] = useState<ContactMode>('sample');
  const [askingPrice, setAskingPrice] = useState(2.7);
  const [requestedUnits, setRequestedUnits] = useState(24);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const selectedBatch = packagedBatches.find((batch) => batch.id === selectedBatchId) ?? packagedBatches[0] ?? null;

  if (!world) return null;

  const pendingOrders = world.repeatOrders.filter((order) => order.status === 'pending');
  const activeProposals = world.proposals.filter((proposal) => ['reviewing', 'offer'].includes(proposal.status));
  const offers = activeProposals.filter((proposal) => proposal.status === 'offer');
  const visibleOutlets = world.outlets.filter((outlet) => {
    if (outlet.controlledByPlayer) return false;
    const query = search.trim().toLocaleLowerCase('ru-RU');
    if (query && !`${outlet.name} ${outlet.city} ${channelLabel(outlet.channel)}`.toLocaleLowerCase('ru-RU').includes(query)) return false;
    if (filter === 'all') return true;
    if (filter === 'local') return outlet.regionId === world.regionId || outlet.countryId === world.countryId;
    return outlet.channel === filter;
  });

  function show(result: ActionResult) {
    setFeedback(result);
    window.setTimeout(() => setFeedback(null), 2800);
  }

  function openDeal(outlet: MarketOutletState) {
    setDealOutlet(outlet);
    setAskingPrice(roundMoney((outlet.preferredWholesale[0] + outlet.preferredWholesale[1]) / 2));
    setRequestedUnits(outlet.minOrder);
  }

  function sendProposal() {
    if (!selectedBatch || !dealOutlet) return show({ ok: false, message: 'Выбери товар и покупателя' });
    const result = onSendProposal({ outletId: dealOutlet.id, batchId: selectedBatch.id, contactMode, askingPrice, requestedUnits });
    show(result);
    if (result.ok) {
      setDealOutlet(null);
      setSection('orders');
    }
  }

  return <div className="screen-stack trade-screen">
    {feedback && <div className={`toast ${feedback.ok ? 'success' : 'error'}`}>{feedback.ok ? <Icon name="check" /> : <Icon name="warning" />}{feedback.message}</div>}
    <EditorialVisual
      variant="bar"
      eyebrow="Коммерция и hospitality"
      title={offers.length > 0 ? `${offers.length} оффера ждут решения` : 'Выведи продукт на лучшие полки и барные карты'}
      metric={`${packagedBatches.reduce((sum, batch) => sum + batch.availableUnits, 0)} бутылок`}
      note={`${pendingOrders.length} повторных заказов · ${world.outlets.length} покупателей`}
      action={<button className="button visual-button" onClick={() => setSection(packagedBatches.length > 0 ? 'buyers' : 'products')}>{packagedBatches.length > 0 ? 'Найти покупателя' : 'Создать товар'}<Icon name="arrow" /></button>}
    />
    <SubTabs value={section} onChange={setSection} options={[
      { id: 'products', label: 'Товары', badge: state.brand.releases.length },
      { id: 'orders', label: 'Заказы', badge: pendingOrders.length + offers.length },
      { id: 'buyers', label: 'Покупатели' },
    ]} />

    {section === 'products' && <BrandHub state={state} onCreateBrand={onCreateBrand} onCreateRelease={onCreateRelease} onLaunchCampaign={onLaunchCampaign} />}

    {section === 'orders' && <div className="order-stack">
      {offers.length > 0 && <section><div className="section-heading"><span>Нужно ответить</span><b>{offers.length}</b></div><div className="action-list">{offers.map((proposal) => { const outlet = world.outlets.find((item) => item.id === proposal.outletId); return <button className="action-row urgent" key={proposal.id} onClick={() => setProposalModal(proposal)}><span className="action-icon"><Icon name="contract" /></span><span><strong>{outlet?.name ?? 'Закупщик'}</strong><small>{proposal.offeredUnits} бут. · {proposal.offeredPrice?.toFixed(2)} за штуку</small></span><Icon name="arrow" /></button>; })}</div></section>}
      {pendingOrders.length > 0 && <section><div className="section-heading"><span>Повторные заказы</span><b>{pendingOrders.length}</b></div><div className="simple-list plain-panel">{pendingOrders.map((order) => { const outlet = world.outlets.find((item) => item.id === order.outletId); return <button key={order.id} onClick={() => setOrderModal(order)}><span className="product-mark"><Icon name="handshake" /></span><span><strong>{outlet?.name ?? 'Покупатель'}</strong><small>{order.units} бут. · срок день {order.dueDay}</small></span><b>{order.dueDay - state.day} дн.</b></button>; })}</div></section>}
      {activeProposals.filter((proposal) => proposal.status === 'reviewing').length > 0 && <section><div className="section-heading"><span>На рассмотрении</span><b>{activeProposals.filter((proposal) => proposal.status === 'reviewing').length}</b></div><div className="simple-list plain-panel">{activeProposals.filter((proposal) => proposal.status === 'reviewing').map((proposal) => { const outlet = world.outlets.find((item) => item.id === proposal.outletId); return <button key={proposal.id} onClick={() => setProposalModal(proposal)}><span className="product-mark"><Icon name="clock" /></span><span><strong>{outlet?.name ?? 'Закупщик'}</strong><small>Ответ ожидается на день {proposal.reviewDay}</small></span><b>{Math.max(0, proposal.reviewDay - state.day)} дн.</b></button>; })}</div></section>}
      {offers.length + pendingOrders.length + activeProposals.filter((proposal) => proposal.status === 'reviewing').length === 0 && <div className="plain-panel"><EmptyState icon="contract" title="Активных сделок нет" text="Выбери товар и отправь предложение покупателю." /></div>}
    </div>}

    {section === 'buyers' && <>
      {packagedBatches.length === 0 ? <div className="plain-panel"><EmptyState icon="bottle" title="Нет товара для предложения" text="Сначала разлей партию и создай коммерческий релиз." /></div> : <>
        <section className="product-picker plain-panel"><span>Что продаём</span><div>{packagedBatches.map((batch) => <button key={batch.id} className={selectedBatch?.id === batch.id ? 'active' : ''} onClick={() => setSelectedBatchId(batch.id)}><strong>{batch.recipe.name}</strong><small>{batch.availableUnits} бут.</small></button>)}</div></section>
        <DemandStrip signals={world.demandSignals.filter((signal) => signal.regionId === world.regionId)} />
        <div className="content-toolbar">
          <label className="search-field"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Бар, магазин или город" aria-label="Поиск покупателей" /></label>
          <div className="filter-pills">{([['local','Рядом'],['all','Все'],['bar','Бары'],['store','Магазины'],['specialty','Спец']] as [OutletFilter,string][]).map(([id,label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
        </div>
        {visibleOutlets.length > 0 ? <div className="buyer-grid">{visibleOutlets.map((outlet) => <button className="buyer-card" key={outlet.id} onClick={() => openDeal(outlet)}><span className="buyer-card-art"><Icon name={outlet.channel === 'bar' ? 'beer' : 'store'} /></span><span><small>{outlet.city} · {channelLabel(outlet.channel)}</small><strong>{outlet.name}</strong><em>Отношения {outlet.relationship}/100</em></span><b>{outlet.preferredWholesale[0].toFixed(2)}–{outlet.preferredWholesale[1].toFixed(2)}</b></button>)}</div> : <div className="plain-panel"><EmptyState icon="store" title="Покупатели не найдены" text="Измени запрос или сними фильтр канала." /></div>}
      </>}
    </>}

    {dealOutlet && selectedBatch && <DealModal outlet={dealOutlet} batch={selectedBatch} demand={getDemand(world.demandSignals, dealOutlet, selectedBatch.recipe.family)} contactMode={contactMode} setContactMode={setContactMode} askingPrice={askingPrice} setAskingPrice={setAskingPrice} requestedUnits={requestedUnits} setRequestedUnits={setRequestedUnits} onClose={() => setDealOutlet(null)} onSend={sendProposal} />}
    {proposalModal && <ProposalModal state={state} proposal={proposalModal} onClose={() => setProposalModal(null)} onAccept={() => { const result = onAcceptOffer(proposalModal.id); show(result); if (result.ok) setProposalModal(null); }} onDecline={() => { const result = onDeclineOffer(proposalModal.id); show(result); if (result.ok) setProposalModal(null); }} />}
    {orderModal && <OrderModal state={state} order={orderModal} onClose={() => setOrderModal(null)} onFulfill={(batchId) => { const result = onFulfillOrder(orderModal.id, batchId); show(result); if (result.ok) setOrderModal(null); }} />}
  </div>;
}

function DemandStrip({ signals }: { signals: DemandSignal[] }) {
  const visible = signals.filter((signal, index, items) => items.findIndex((item) => item.family === signal.family) === index).slice(0, 2);
  if (visible.length === 0) return null;
  return <section className="demand-strip">{visible.map((signal) => { const estimate = demandEstimate(signal); return <div key={signal.id}><span>{signal.family === 'beer' ? 'Пиво' : 'Сидр'}</span><strong>{estimate.low}–{estimate.high}</strong><small>{signal.trend === 'rising' ? 'спрос растёт' : signal.trend === 'falling' ? 'спрос падает' : 'рынок ровный'}</small></div>; })}</section>;
}

function DealModal({ outlet, batch, demand, contactMode, setContactMode, askingPrice, setAskingPrice, requestedUnits, setRequestedUnits, onClose, onSend }: { outlet: MarketOutletState; batch: BatchState; demand: DemandSignal | undefined; contactMode: ContactMode; setContactMode: (value: ContactMode) => void; askingPrice: number; setAskingPrice: (value: number) => void; requestedUnits: number; setRequestedUnits: (value: number) => void; onClose: () => void; onSend: () => void }) {
  const maxUnits = Math.max(outlet.minOrder, Math.min(outlet.maxOrder, batch.availableUnits - (contactMode === 'meeting' ? 1 : 2)));
  const estimate = demand ? demandEstimate(demand) : null;
  return <Modal title={outlet.name} kicker={`${outlet.city} · ${channelLabel(outlet.channel)}`} onClose={onClose} footer={<button className="button primary" onClick={onSend}>Отправить предложение</button>}>
    <p className="quiet-copy">{outlet.summary}</p>
    {estimate && <div className="quiet-banner"><Icon name="market" /><span>Оценка спроса {estimate.low}–{estimate.high}/100</span></div>}
    <div className="detail-grid clean-grid"><Detail label="Цена" value={`${outlet.preferredWholesale[0].toFixed(2)}–${outlet.preferredWholesale[1].toFixed(2)}`} /><Detail label="Объём" value={`${outlet.minOrder}–${outlet.maxOrder}`} /><Detail label="Отношения" value={`${outlet.relationship}/100`} /><Detail label="На складе" value={`${batch.availableUnits} бут.`} /></div>
    <div className="modal-form"><label><span>Контакт</span><div className="choice-buttons"><button className={contactMode === 'sample' ? 'active' : ''} onClick={() => setContactMode('sample')}>Образцы · {proposalActionCost('sample')}</button><button className={contactMode === 'meeting' ? 'active' : ''} onClick={() => setContactMode('meeting')}>Встреча · {proposalActionCost('meeting')}</button></div></label><label><span>Цена за бутылку</span><input type="number" min="0.5" max="12" step="0.05" value={askingPrice} onChange={(event) => setAskingPrice(Number(event.target.value))} /></label><label><span>Количество</span><input type="number" min={outlet.minOrder} max={maxUnits} step="6" value={Math.min(requestedUnits, maxUnits)} onChange={(event) => setRequestedUnits(Number(event.target.value))} /></label></div>
  </Modal>;
}

function ProposalModal({ state, proposal, onClose, onAccept, onDecline }: { state: GameState; proposal: MarketProposal; onClose: () => void; onAccept: () => void; onDecline: () => void }) {
  const outlet = state.world?.outlets.find((item) => item.id === proposal.outletId);
  return <Modal title={outlet?.name ?? 'Переговоры'} kicker={proposal.status === 'offer' ? 'Оффер закупщика' : 'Предложение рассматривается'} onClose={onClose} footer={proposal.status === 'offer' ? <div className="modal-actions"><button className="button primary" onClick={onAccept}>Принять</button><button className="button secondary" onClick={onDecline}>Отказаться</button></div> : undefined}><div className="detail-grid clean-grid"><Detail label="Запрошено" value={`${proposal.requestedUnits} бут.`} /><Detail label="Твоя цена" value={proposal.askingPrice.toFixed(2)} /><Detail label="Совпадение" value={proposal.fitScore === null ? '—' : `${proposal.fitScore}/100`} /><Detail label="Ответ" value={proposal.status === 'reviewing' ? `день ${proposal.reviewDay}` : proposal.status} /></div>{proposal.status === 'offer' && proposal.offeredPrice !== null && proposal.offeredUnits !== null && <div className="offer-focus"><span>Условия</span><strong>{proposal.offeredUnits} × {proposal.offeredPrice.toFixed(2)}</strong><small>Выручка {formatMoney(proposal.offeredUnits * proposal.offeredPrice)}</small></div>}{proposal.decisionReasons.length > 0 && <div className="reason-list">{proposal.decisionReasons.filter(Boolean).map((reason) => <div key={reason}><i /><span>{reason}</span></div>)}</div>}</Modal>;
}

function OrderModal({ state, order, onClose, onFulfill }: { state: GameState; order: RepeatOrder; onClose: () => void; onFulfill: (batchId: string) => void }) {
  const outlet = state.world?.outlets.find((item) => item.id === order.outletId);
  const candidates = state.production.batches.filter((batch) => batch.status === 'packaged' && batch.availableUnits >= order.units && batch.recipe.family === order.family && batch.recipe.styleId === order.styleId);
  const [batchId, setBatchId] = useState(candidates[0]?.id ?? '');
  return <Modal title={outlet?.name ?? 'Повторный заказ'} kicker={`${order.units} бутылок · до дня ${order.dueDay}`} onClose={onClose} footer={<button className="button primary" disabled={!batchId} onClick={() => onFulfill(batchId)}>Отправить поставку</button>}><div className="detail-grid clean-grid"><Detail label="Цена" value={order.unitPrice.toFixed(2)} /><Detail label="Выручка" value={formatMoney(order.units * order.unitPrice)} /><Detail label="Стабильность" value={`${order.minConsistency}+`} /><Detail label="Осталось" value={`${order.dueDay - state.day} дн.`} /></div>{candidates.length === 0 ? <div className="inline-warning"><Icon name="warning" /><span>Нет подходящей разлитой партии.</span></div> : <div className="select-list">{candidates.map((batch) => <button key={batch.id} className={batchId === batch.id ? 'active' : ''} onClick={() => setBatchId(batch.id)}><span><strong>{batch.code} · {batch.recipe.name}</strong><small>{batch.availableUnits} бутылок</small></span><Icon name="check" /></button>)}</div>}</Modal>;
}

function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function getDemand(signals: DemandSignal[], outlet: MarketOutletState, family: BatchState['recipe']['family']): DemandSignal | undefined { return signals.find((signal) => signal.regionId === outlet.regionId && signal.family === family) ?? signals.find((signal) => signal.countryId === outlet.countryId && signal.family === family); }
function formatMoney(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value); }
function roundMoney(value: number): number { return Math.round(value * 100) / 100; }
