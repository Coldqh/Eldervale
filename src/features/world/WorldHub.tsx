import { useMemo, useState } from 'react';
import type { ActionResult } from '../../app/useGameState';
import type { GameState } from '../../domain/game';
import {
  assetTypeLabel,
  controlledVenueStockLimit,
  controlledVenueStockUnits,
  controlledVenueUpgradeCost,
  controlledShare,
  isPlayerControlledAsset,
  organizationKindLabel,
  type OrganizationState,
  type SubsidiaryAutonomy,
  type TreasuryPolicy,
  type WorldAssetState,
} from '../../domain/ecosystem';
import { commodityName, inventoryQuantity, productFamilyLabel, type TradeProductState } from '../../domain/trade';
import { regionDemandSummary } from '../../domain/demand';
import { leaderRoleLabel, strategyLabel } from '../../domain/worldIntelligence';
import { activeLicensesForOrganization, organizationCompliance } from '../../domain/regulation';
import { primaryCommodity } from '../../data/primaryProductionCatalog';
import { primarySiteLabel, processorLabel } from '../../domain/primaryProduction';
import { distributorSummary, logisticsOrganizationSummary } from '../../domain/logistics';
import { organizationQualitySummary, productQualitySummary } from '../../domain/quality';
import { packagingOrganizationSummary } from '../../domain/packaging';
import { packagingProfile } from '../../data/packagingCatalog';
import { hospitalityOrganizationSummary, hospitalityVenueSummary } from '../../domain/hospitality';
import { isHospitalityAssetType } from '../../data/hospitalityCatalog';
import { industrialMaturationForProduct, industrialProductionSummary, industrialRunsForProduct, industrialStageLabel } from '../../domain/industrialProduction';
import type { RetailVenueStatus, RetailVenueType } from '../../domain/retail';
import { Icon } from '../../ui/Icon';
import { EmptyState, Modal, SubTabs } from '../../ui/MobileUI';
import { EditorialVisual } from '../../ui/EditorialVisual';

type Section = 'city' | 'organizations' | 'flows' | 'group' | 'control' | 'chronicle' | 'deals';

interface WorldHubProps {
  state: GameState;
  onAcquire: (assetId: string) => ActionResult;
  onLease: (assetId: string, type: RetailVenueType, name: string) => ActionResult;
  onInvest: (organizationId: string, share: number) => ActionResult;
  onTakeover: (organizationId: string, targetShare: 51 | 75 | 100) => ActionResult;
  onInject: (organizationId: string, amount: number) => ActionResult;
  onPolicy: (organizationId: string, autonomy: SubsidiaryAutonomy, treasuryPolicy: TreasuryPolicy) => ActionResult;
  onTransfer: (assetId: string, targetOrganizationId: string) => ActionResult;
  onStock: (assetId: string, releaseId: string, units: number, price: number) => ActionResult;
  onClean: (assetId: string) => ActionResult;
  onUpgrade: (assetId: string) => ActionResult;
  onStatus: (assetId: string, status: RetailVenueStatus) => ActionResult;
}

export function WorldHub({ state, onAcquire, onLease, onInvest, onTakeover, onInject, onPolicy, onTransfer, onStock, onClean, onUpgrade, onStatus }: WorldHubProps) {
  const [section, setSection] = useState<Section>('city');
  const [search, setSearch] = useState('');
  const [assetModal, setAssetModal] = useState<WorldAssetState | null>(null);
  const [organizationModal, setOrganizationModal] = useState<OrganizationState | null>(null);
  const [stockAsset, setStockAsset] = useState<WorldAssetState | null>(null);
  const [productModal, setProductModal] = useState<TradeProductState | null>(null);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const ecosystem = state.ecosystem;

  if (!ecosystem) return <EmptyState icon="map" title="Мир ещё не создан" text="Заверши создание компании, чтобы загрузить организации и недвижимость региона." />;

  const controlledAssets = ecosystem.assets.filter((asset) => isPlayerControlledAsset(ecosystem, asset));
  const subsidiaries = ecosystem.subsidiaries.map((control) => ({ control, organization: ecosystem.organizations.find((organization) => organization.id === control.organizationId) })).filter((item): item is { control: typeof ecosystem.subsidiaries[number]; organization: OrganizationState } => Boolean(item.organization));
  const commercialAssets = ecosystem.assets.filter((asset) => isHospitalityAssetType(asset.type) || ['shop', 'vacant_commercial', 'warehouse', 'laboratory', 'depot', 'distribution_center'].includes(asset.type));
  const organizations = ecosystem.organizations.filter((organization) => organization.id !== ecosystem.playerOrganizationId);
  const saleAssets = commercialAssets.filter((asset) => asset.status === 'for_sale' || asset.status === 'vacant').length;
  const strainedOrganizations = organizations.filter((organization) => ['strained', 'insolvent'].includes(organization.status)).length;
  const activeShipments = ecosystem.trade.shipments.filter((shipment) => ['awaiting_transport', 'in_transit', 'delayed', 'customs_hold'].includes(shipment.status)).length;
  const playerOrganization = ecosystem.organizations.find((organization) => organization.id === ecosystem.playerOrganizationId);
  const localDemand = regionDemandSummary(ecosystem.demand, playerOrganization?.regionId ?? '');
  const bottlenecks = ecosystem.trade.contracts.filter((contract) => contract.failures > 0).length
    + ecosystem.trade.batches.filter((batch) => batch.status === 'blocked').length
    + ecosystem.trade.shelves.filter((listing) => listing.units <= 0).length;
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const visibleCommercialAssets = commercialAssets.filter((asset) => !query || `${asset.name} ${asset.city} ${assetTypeLabel(asset.type)}`.toLocaleLowerCase('ru-RU').includes(query));
  const visibleOrganizations = organizations.filter((organization) => !query || `${organization.name} ${organization.ownerLabel} ${organizationKindLabel(organization.kind)}`.toLocaleLowerCase('ru-RU').includes(query));

  function act(result: ActionResult, close = true) {
    setFeedback(result);
    if (result.ok && close) {
      setAssetModal(null);
      setOrganizationModal(null);
      setStockAsset(null);
      setProductModal(null);
    }
    window.setTimeout(() => setFeedback(null), 3200);
  }

  return (
    <div className="world-hub compact-page">
      {feedback && <div className={`toast ${feedback.ok ? 'success' : 'error'}`}>{feedback.ok ? <Icon name="check" /> : <Icon name="warning" />}{feedback.message}</div>}

      <EditorialVisual
        variant="city"
        eyebrow="Живая индустрия"
        title="Бары, клубы, производители и капитал города"
        metric={`${ecosystem.organizations.length} организаций`}
        note={`${localDemand.headline} · ${ecosystem.assets.length} объектов · ${activeShipments} грузов в движении`}
        action={<button className="button visual-button" onClick={() => setSection(saleAssets > 0 ? 'city' : 'flows')}>{saleAssets > 0 ? `${saleAssets} возможностей` : 'Открыть потоки'}<Icon name="arrow" /></button>}
      />

      <SubTabs value={section} onChange={setSection} options={[
        { id: 'city', label: 'Объекты', badge: saleAssets },
        { id: 'organizations', label: 'Компании', badge: strainedOrganizations },
        { id: 'flows', label: 'Потоки', badge: bottlenecks },
        { id: 'group', label: 'Группа', badge: subsidiaries.length + controlledAssets.length },
        { id: 'chronicle', label: 'Хроника' },
      ]} />

      {(section === 'city' || section === 'organizations') && <div className="content-toolbar world-toolbar">
        <label className="search-field"><Icon name="search" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={section === 'city' ? 'Объект, тип или город' : 'Компания, владелец или отрасль'} aria-label={section === 'city' ? 'Поиск объектов' : 'Поиск организаций'} /></label>
        <span>{section === 'city' ? `${visibleCommercialAssets.length} объектов` : `${visibleOrganizations.length} компаний`}</span>
      </div>}

      {section === 'city' && (
        <section className="ecosystem-list">
          {visibleCommercialAssets
            .sort((a, b) => assetPriority(a) - assetPriority(b))
            .map((asset) => {
              const owner = ecosystem.organizations.find((organization) => organization.id === asset.ownerOrganizationId);
              const controlled = isPlayerControlledAsset(ecosystem, asset);
              return (
                <button key={asset.id} className={`ecosystem-row glass-card ${asset.status === 'for_sale' ? 'distressed' : ''}`} onClick={() => setAssetModal(asset)}>
                  <span className="ecosystem-glyph"><Icon name={isHospitalityAssetType(asset.type) ? 'beer' : asset.type === 'shop' ? 'store' : asset.type === 'vacant_commercial' ? 'map' : 'factory'} /></span>
                  <span className="ecosystem-copy">
                    <small>{asset.city} · {assetTypeLabel(asset.type)}</small>
                    <strong>{asset.name}</strong>
                    <em>{controlled ? 'Под твоим контролем' : asset.status === 'vacant' ? 'Свободное помещение' : owner?.name ?? 'Частный собственник'}</em>
                  </span>
                  <span className="ecosystem-value">
                    <b>{asset.status === 'vacant' ? `${formatMoney(asset.dailyRent)}/д` : formatMoney(asset.askingPrice)}</b>
                    <small>{asset.status === 'for_sale' ? 'продажа' : asset.status === 'vacant' ? 'аренда' : asset.status === 'closed' ? 'закрыто' : 'работает'}</small>
                  </span>
                </button>
              );
            })}
        </section>
      )}

      {section === 'organizations' && (
        <section className="ecosystem-list">
          {visibleOrganizations
            .sort((a, b) => organizationPriority(a) - organizationPriority(b))
            .map((organization) => {
              const share = controlledShare(ecosystem, organization.id);
              return (
                <button key={organization.id} className={`ecosystem-row glass-card organization ${organization.status}`} onClick={() => setOrganizationModal(organization)}>
                  <span className="ecosystem-glyph"><Icon name={organization.kind === 'producer' ? 'factory' : organization.kind === 'hospitality' ? 'beer' : organization.kind === 'retailer' ? 'store' : 'handshake'} /></span>
                  <span className="ecosystem-copy">
                    <small>{organizationKindLabel(organization.kind)} · {organization.ownerLabel}</small>
                    <strong>{organization.name}</strong>
                    <em>{ecosystem.intelligence.minds.find((mind) => mind.organizationId === organization.id)?.objective ?? organization.strategy}</em>
                  </span>
                  <span className="ecosystem-value"><b>{formatMoney(organization.valuation)}</b><small>{share > 0 ? `твоя доля ${share}%` : statusLabel(organization.status)}</small></span>
                </button>
              );
            })}
        </section>
      )}

      {section === 'flows' && (
        <section className="trade-flow-stack">
          <article className="flow-block glass-card">
            <header><div><span>логистика</span><strong>Товары в пути</strong></div><b>{activeShipments}</b></header>
            {activeShipments === 0
              ? <EmptyState icon="contract" title="Нет активных перевозок" text="Следующие отправки появятся по действующим контрактам." />
              : ecosystem.trade.shipments
                  .filter((shipment) => shipment.status === 'in_transit' || shipment.status === 'delayed')
                  .sort((a, b) => a.arrivalDay - b.arrivalDay)
                  .slice(0, 8)
                  .map((shipment) => {
                    const seller = ecosystem.organizations.find((organization) => organization.id === shipment.sellerOrganizationId);
                    const buyer = ecosystem.organizations.find((organization) => organization.id === shipment.buyerOrganizationId);
                    return <div key={shipment.id} className="flow-row"><i className={shipment.status === 'delayed' ? 'bad' : ''} /><span><strong>{commodityName(ecosystem.trade, shipment.commodityKind, shipment.commodityId)}</strong><small>{seller?.name} → {buyer?.name} · прибытие день {shipment.arrivalDay}</small></span><b>{shipment.quantity}</b></div>;
                  })}
          </article>

          <article className="flow-block glass-card">
            <header><div><span>производство</span><strong>Продуктовые линии</strong></div><b>{ecosystem.trade.products.filter((product) => product.status === 'active').length}</b></header>
            {ecosystem.trade.products
              .filter((product) => product.status !== 'discontinued')
              .sort((a, b) => b.totalSold - a.totalSold)
              .slice(0, 10)
              .map((product) => {
                const producer = ecosystem.organizations.find((organization) => organization.id === product.producerOrganizationId);
                const stock = inventoryQuantity(ecosystem.trade, product.producerOrganizationId, 'product', product.id);
                const shelves = ecosystem.trade.shelves.filter((listing) => listing.productId === product.id);
                return <button key={product.id} className="product-flow-row" onClick={() => setProductModal(product)}><span className="product-flow-mark"><Icon name={product.family === 'cider' ? 'apple' : 'bottle'} /></span><span><small>{producer?.name} · {productFamilyLabel(product.family)}</small><strong>{product.name}</strong><em>{shelves.length} полок · склад {Math.round(stock)} · продано {product.totalSold}</em></span><b>{product.quality}</b></button>;
              })}
          </article>

          <article className="flow-block glass-card">
            <header><div><span>риски</span><strong>Узкие места</strong></div><b>{bottlenecks}</b></header>
            {bottlenecks === 0
              ? <EmptyState icon="market" title="Цепочки стабильны" text="Производство, поставки и полки сейчас не имеют критических разрывов." />
              : <>
                  {ecosystem.trade.batches.filter((batch) => batch.status === 'blocked').slice(0, 5).map((batch) => { const product = ecosystem.trade.products.find((item) => item.id === batch.productId); const producer = ecosystem.organizations.find((item) => item.id === batch.producerOrganizationId); return <div key={batch.id} className="flow-row warning"><i className="bad" /><span><strong>{producer?.name}: партия остановлена</strong><small>{product?.name} · {batch.issue}</small></span></div>; })}
                  {ecosystem.trade.contracts.filter((contract) => contract.failures > 0).slice(0, 5).map((contract) => { const seller = ecosystem.organizations.find((item) => item.id === contract.sellerOrganizationId); const buyer = ecosystem.organizations.find((item) => item.id === contract.buyerOrganizationId); return <div key={contract.id} className="flow-row warning"><i className="bad" /><span><strong>{commodityName(ecosystem.trade, contract.commodityKind, contract.commodityId)}</strong><small>{seller?.name} → {buyer?.name} · {contract.lastResult}</small></span><b>{contract.failures}</b></div>; })}
                  {ecosystem.trade.shelves.filter((listing) => listing.units <= 0).slice(0, 5).map((listing) => { const asset = ecosystem.assets.find((item) => item.id === listing.assetId); const product = ecosystem.trade.products.find((item) => item.id === listing.productId); return <div key={listing.id} className="flow-row warning"><i className="bad" /><span><strong>Пустая полка: {product?.name}</strong><small>{asset?.name} · {listing.stockoutDays} дн. без товара</small></span></div>; })}
                </>}
          </article>
        </section>
      )}

      {section === 'group' && (
        subsidiaries.length === 0
          ? <section className="glass-card"><EmptyState icon="handshake" title="Группа ещё не создана" text="Купи контрольный пакет работающей компании. Её активы, сотрудники, продукты и контракты останутся внутри мира." /></section>
          : <section className="controlled-assets">
              {subsidiaries.map(({ control, organization }) => {
                const assets = ecosystem.assets.filter((asset) => asset.ownerOrganizationId === organization.id);
                const products = ecosystem.trade.products.filter((product) => product.producerOrganizationId === organization.id && product.status === 'active');
                return <article key={organization.id} className="controlled-asset-card glass-card">
                  <header><div><span>дочерняя компания · {control.controlShare}%</span><strong>{organization.name}</strong></div><span className={`row-status ${organization.status === 'active' ? 'positive' : 'neutral'}`}>{statusLabel(organization.status)}</span></header>
                  <div className="detail-grid"><Detail label="Активы" value={String(assets.length)} /><Detail label="Продукты" value={String(products.length)} /><Detail label="Деньги" value={formatMoney(organization.cash)} /><Detail label="Долг" value={formatMoney(organization.debt)} /></div>
                  <div className="controlled-actions"><button className="button primary" onClick={() => setOrganizationModal(organization)}>Управление</button></div>
                </article>;
              })}
            </section>
      )}

      {section === 'group' && controlledAssets.length > 0 && (
        <section className="controlled-assets">
          <div className="section-heading"><span>Объекты под управлением</span><b>{controlledAssets.length}</b></div>
          {controlledAssets.map((asset) => (
            <article key={asset.id} className="controlled-asset-card glass-card">
              <header><div><span>{assetTypeLabel(asset.type)} · {asset.city}</span><strong>{asset.name}</strong></div><span className="row-status neutral">{asset.status === 'operating' ? 'работает' : 'закрыт'}</span></header>
              <div className="detail-grid"><Detail label="Состояние" value={`${Math.round(asset.condition)}/100`} /><Detail label="Расход" value={`${formatMoney(asset.dailyOperatingCost)}/д`} /></div>
              <div className="controlled-actions"><button className="button primary" onClick={() => setAssetModal(asset)}>Управление</button>{asset.type === 'shop' && asset.venue && <button className="button secondary" onClick={() => setStockAsset(asset)}>Полка</button>}</div>
            </article>
          ))}
        </section>
      )}

      {section === 'control' && (
        controlledAssets.length === 0
          ? <section className="glass-card"><EmptyState icon="store" title="Нет объектов под контролем" text="Выкупи действующую точку или арендуй свободное помещение в городе." /></section>
          : <section className="controlled-assets">
              {controlledAssets.map((asset) => (
                <article key={asset.id} className="controlled-asset-card glass-card">
                  <header>
                    <div><span>{assetTypeLabel(asset.type)} · {asset.city}</span><strong>{asset.name}</strong></div>
                    <span className={`row-status ${asset.status === 'operating' ? 'positive' : 'neutral'}`}>{asset.status === 'operating' ? 'работает' : asset.status === 'closed' ? 'закрыто' : 'объект'}</span>
                  </header>
                  <div className="detail-grid">
                    <Detail label="Состояние" value={`${Math.round(asset.condition)}/100`} />
                    <Detail label="Поток" value={asset.footfall ? `${asset.footfall}/100` : '—'} />
                    <Detail label="Расход" value={`${formatMoney(asset.dailyOperatingCost + (asset.ownerOrganizationId === ecosystem.playerOrganizationId ? 0 : asset.dailyRent))}/д`} />
                    <Detail label="Полка" value={asset.venue ? `${controlledVenueStockUnits(asset)}/${controlledVenueStockLimit(asset)}` : '—'} />
                  </div>
                  {asset.venue && (
                    <div className="controlled-actions">
                      <button className="button primary" onClick={() => setStockAsset(asset)}>Полка</button>
                      <button className="button secondary" disabled={asset.venue.cleanliness >= 96} onClick={() => act(onClean(asset.id), false)}>Санитария</button>
                      <button className="button ghost" disabled={asset.venue.level >= 3 || state.finance.cash < controlledVenueUpgradeCost(asset)} onClick={() => act(onUpgrade(asset.id), false)}>Расширить</button>
                      <button className="button ghost" onClick={() => act(onStatus(asset.id, asset.venue?.status === 'open' ? 'closed' : 'open'), false)}>{asset.venue.status === 'open' ? 'Закрыть' : 'Открыть'}</button>
                    </div>
                  )}
                </article>
              ))}
            </section>
      )}

      {section === 'chronicle' && (
        ecosystem.intelligence.chronicle.length === 0
          ? <section className="glass-card"><EmptyState icon="archive" title="История ещё не началась" text="Стратегические решения, смены руководителей, провалы и новые продукты появятся здесь." /></section>
          : <section className="transaction-list glass-card chronicle-list">
              {ecosystem.intelligence.chronicle.slice(0, 80).map((entry) => (
                <article key={entry.id}>
                  <i className={entry.tone === 'warning' ? 'bad' : entry.tone === 'release' ? 'good' : 'neutral'} />
                  <span><strong>{entry.headline}</strong><small>День {entry.day} · {entry.detail}</small></span>
                  <b>{entry.kind === 'leadership' ? 'люди' : entry.kind === 'product' ? 'продукт' : entry.kind === 'finance' ? 'финансы' : 'курс'}</b>
                </article>
              ))}
            </section>
      )}

      {section === 'deals' && (
        ecosystem.transactions.length === 0
          ? <section className="glass-card"><EmptyState icon="contract" title="Сделок ещё не было" text="Выкуп, аренда, инвестиции, банкротства и поглощения появятся здесь." /></section>
          : <section className="transaction-list glass-card">
              {ecosystem.transactions.map((transaction) => (
                <article key={transaction.id}>
                  <i className={transaction.kind === 'bankruptcy' ? 'bad' : transaction.kind === 'npc_acquisition' ? 'neutral' : 'good'} />
                  <span><strong>{transaction.headline}</strong><small>День {transaction.day} · {transaction.detail}</small></span>
                  <b>{transaction.amount > 0 ? formatMoney(transaction.amount) : '—'}</b>
                </article>
              ))}
            </section>
      )}

      {assetModal && (
        <AssetModal
          asset={assetModal}
          owner={ecosystem.organizations.find((organization) => organization.id === assetModal.ownerOrganizationId)}
          ecosystem={ecosystem}
          cash={state.finance.cash}
          controlled={isPlayerControlledAsset(ecosystem, assetModal)}
          onClose={() => setAssetModal(null)}
          onAcquire={() => act(onAcquire(assetModal.id))}
          onLease={(type, name) => act(onLease(assetModal.id, type, name))}
        />
      )}
      {organizationModal && (
        <OrganizationModal
          organization={organizationModal}
          assets={ecosystem.assets.filter((asset) => organizationModal.assetIds.includes(asset.id))}
          ecosystem={ecosystem}
          currentShare={controlledShare(ecosystem, organizationModal.id)}
          cash={state.finance.cash}
          onClose={() => setOrganizationModal(null)}
          controlledOrganizations={[ecosystem.organizations.find((organization) => organization.id === ecosystem.playerOrganizationId)!, ...subsidiaries.map((item) => item.organization)]}
          onInvest={(share) => act(onInvest(organizationModal.id, share), false)}
          onTakeover={(targetShare) => act(onTakeover(organizationModal.id, targetShare), false)}
          onInject={(amount) => act(onInject(organizationModal.id, amount), false)}
          onPolicy={(autonomy, treasuryPolicy) => act(onPolicy(organizationModal.id, autonomy, treasuryPolicy), false)}
          onTransfer={(assetId, targetOrganizationId) => act(onTransfer(assetId, targetOrganizationId), false)}
        />
      )}
      {productModal && <ProductModal product={productModal} ecosystem={ecosystem} onClose={() => setProductModal(null)} />}
      {stockAsset && <StockModal state={state} asset={stockAsset} onClose={() => setStockAsset(null)} onSubmit={(releaseId, units, price) => act(onStock(stockAsset.id, releaseId, units, price))} />}
    </div>
  );
}

function AssetModal({ asset, owner, ecosystem, cash, controlled, onClose, onAcquire, onLease }: { asset: WorldAssetState; owner?: OrganizationState; ecosystem: NonNullable<GameState['ecosystem']>; cash: number; controlled: boolean; onClose: () => void; onAcquire: () => void; onLease: (type: RetailVenueType, name: string) => void }) {
  const [type, setType] = useState<RetailVenueType>('bar');
  const [name, setName] = useState(asset.name);
  const acquisitionEstimate = asset.askingPrice * (owner?.status === 'insolvent' ? .68 : owner?.status === 'strained' ? .84 : asset.status === 'operating' ? 1.18 : 1);
  const leaseCost = asset.dailyRent * 30 + (type === 'bar' ? 18_000 : 13_500);
  return (
    <Modal title={asset.name} kicker={`${assetTypeLabel(asset.type)} · ${asset.city}`} onClose={onClose} footer={
      controlled ? <span className="status-chip positive">Уже под контролем</span>
        : asset.status === 'vacant'
          ? <button className="button primary" disabled={name.trim().length < 2 || cash < leaseCost} onClick={() => onLease(type, name)}>Арендовать · {formatMoney(leaseCost)}</button>
          : (isHospitalityAssetType(asset.type) || ['shop', 'warehouse', 'laboratory'].includes(asset.type))
            ? <button className="button primary" disabled={cash < acquisitionEstimate} onClick={onAcquire}>Выкупить · ≈{formatMoney(acquisitionEstimate)}</button>
            : <span className="status-chip">Инфраструктурный объект</span>
    }>
      <div className="asset-identity"><span className="ecosystem-glyph large"><Icon name={isHospitalityAssetType(asset.type) ? 'beer' : asset.type === 'shop' ? 'store' : 'map'} /></span><div><strong>{asset.address}</strong><small>{asset.audience}</small></div></div>
      <div className="detail-grid"><Detail label="Владелец" value={owner?.name ?? 'Частный собственник'} /><Detail label="Статус владельца" value={owner ? statusLabel(owner.status) : 'частный'} /><Detail label="Состояние" value={`${Math.round(asset.condition)}/100`} /><Detail label="Поток" value={`${asset.footfall}/100`} /><Detail label="Аренда" value={`${formatMoney(asset.dailyRent)}/д`} /><Detail label="Оценка" value={formatMoney(asset.askingPrice)} /></div>
      {(asset.type === 'depot' || asset.type === 'distribution_center') && (() => { const ownerId = asset.operatorOrganizationId ?? ''; const carrier = logisticsOrganizationSummary(ecosystem.logistics, ownerId); const distribution = distributorSummary(ecosystem.trade, ownerId); return <div className="organization-intelligence"><span>{asset.type === 'depot' ? 'Транспортный узел' : 'Распределительный склад'}</span><strong>{asset.type === 'depot' ? `${carrier.activeJobs} рейсов в работе` : `${Math.round(distribution.productUnits)} бутылок на хранении`}</strong><small>{asset.type === 'depot' ? `${carrier.availableVehicles}/${carrier.totalVehicles} машин свободно` : `${distribution.inboundContracts} входящих · ${distribution.outboundContracts} исходящих контрактов`}</small></div>; })()}
      {isHospitalityAssetType(asset.type) && (() => { const venue = ecosystem.hospitality.venues.find((item) => item.assetId === asset.id); const summary = venue ? hospitalityVenueSummary(ecosystem.hospitality, venue.id) : null; const last = venue ? ecosystem.hospitality.shiftReports.find((report) => report.venueId === venue.id) : null; return summary ? <div className="organization-intelligence"><span>Работа заведения</span><strong>{summary.headline}</strong><small>{summary.detail}{last ? ` · выручка смены ${formatMoney(last.revenue)} · ожидание ${last.averageWaitMinutes} мин.` : ''}</small></div> : null; })()}
      {(() => { const summary = regionDemandSummary(ecosystem.demand, asset.regionId); const region = ecosystem.demand.regions.find((item) => item.regionId === asset.regionId); const lead = region?.segments.slice().sort((a, b) => b.adults - a.adults)[0]; return <div className="organization-intelligence"><span>Локальный спрос</span><strong>{summary.headline}</strong><small>{summary.detail}{lead ? ` · крупнейший сегмент: ${lead.name}` : ''}</small></div>; })()}
      {(isHospitalityAssetType(asset.type) || asset.type === 'shop') && <div className="organization-assets"><span>Товарный оборот</span>{ecosystem.trade.shelves.filter((listing) => listing.assetId === asset.id).length === 0 ? <small>На полках нет товаров экосистемы.</small> : ecosystem.trade.shelves.filter((listing) => listing.assetId === asset.id).map((listing) => { const product = ecosystem.trade.products.find((item) => item.id === listing.productId); return <div key={listing.id}><strong>{product?.name ?? 'Неизвестный продукт'}</strong><small>{listing.units} на полке · сегодня {listing.unitsSoldToday} · всего {listing.totalUnitsSold}</small></div>; })}{ecosystem.trade.shipments.filter((shipment) => shipment.buyerAssetId === asset.id && ['awaiting_transport', 'in_transit', 'delayed', 'customs_hold'].includes(shipment.status)).map((shipment) => <div key={shipment.id}><strong>В пути: {commodityName(ecosystem.trade, shipment.commodityKind, shipment.commodityId)}</strong><small>{shipment.quantity} ед. · прибытие день {shipment.arrivalDay}</small></div>)}</div>}
      {asset.status === 'vacant' && <div className="lease-builder"><span>Что открыть</span><div className="choice-pills"><button className={type === 'bar' ? 'active' : ''} onClick={() => setType('bar')}>Бар</button><button className={type === 'shop' ? 'active' : ''} onClick={() => setType('shop')}>Магазин</button></div><label className="field"><span>Название оператора</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={36} /></label><small>Ты арендуешь конкретное помещение. Собственник, депозит и ежедневная аренда остаются частью мира.</small></div>}
    </Modal>
  );
}

function OrganizationModal({ organization, assets, ecosystem, currentShare, cash, controlledOrganizations, onClose, onInvest, onTakeover, onInject, onPolicy, onTransfer }: {
  organization: OrganizationState;
  assets: WorldAssetState[];
  ecosystem: NonNullable<GameState['ecosystem']>;
  currentShare: number;
  cash: number;
  controlledOrganizations: OrganizationState[];
  onClose: () => void;
  onInvest: (share: number) => void;
  onTakeover: (targetShare: 51 | 75 | 100) => void;
  onInject: (amount: number) => void;
  onPolicy: (autonomy: SubsidiaryAutonomy, treasuryPolicy: TreasuryPolicy) => void;
  onTransfer: (assetId: string, targetOrganizationId: string) => void;
}) {
  const [share, setShare] = useState(10);
  const [takeoverTarget, setTakeoverTarget] = useState<51 | 75 | 100>(51);
  const [injection, setInjection] = useState(10_000);
  const subsidiary = ecosystem.subsidiaries.find((item) => item.organizationId === organization.id);
  const [autonomy, setAutonomy] = useState<SubsidiaryAutonomy>(subsidiary?.autonomy ?? 'autonomous');
  const [treasuryPolicy, setTreasuryPolicy] = useState<TreasuryPolicy>(subsidiary?.treasuryPolicy ?? 'balanced');
  const statusMultiplier = organization.status === 'insolvent' ? .58 : organization.status === 'strained' ? .82 : 1.22;
  const investmentDiscount = organization.status === 'insolvent' ? .52 : organization.status === 'strained' ? .76 : 1;
  const investmentCost = organization.valuation * (share / 100) * investmentDiscount;
  const takeoverCost = organization.valuation * (Math.max(0, takeoverTarget - currentShare) / 100) * statusMultiplier * (takeoverTarget >= 75 ? 1.08 : 1);
  const controlled = currentShare >= 51;

  return (
    <Modal title={organization.name} kicker={`${organizationKindLabel(organization.kind)} · ${statusLabel(organization.status)}`} onClose={onClose}>
      <div className="detail-grid"><Detail label="Владелец" value={organization.ownerLabel} /><Detail label="Оценка" value={formatMoney(organization.valuation)} /><Detail label="Деньги" value={formatMoney(organization.cash)} /><Detail label="Долг" value={formatMoney(organization.debt)} /><Detail label="Выручка/д" value={formatMoney(organization.dailyRevenue)} /><Detail label="Расход/д" value={formatMoney(organization.dailyCosts)} /></div>
      {organization.kind === 'carrier' && (() => { const summary = logisticsOrganizationSummary(ecosystem.logistics, organization.id); return <div className="organization-intelligence"><span>Перевозки</span><strong>{summary.activeJobs} активных рейсов · {summary.availableVehicles}/{summary.totalVehicles} машин свободно</strong><small>{summary.deliveredJobs} доставок · {summary.delayedJobs} задержек · повреждено {summary.damagedUnits} ед.</small></div>; })()}
      {organization.kind === 'distributor' && (() => { const summary = distributorSummary(ecosystem.trade, organization.id); return <div className="organization-intelligence"><span>Дистрибуция</span><strong>{Math.round(summary.productUnits)} бутылок на региональном складе</strong><small>{summary.inboundContracts} входящих · {summary.outboundContracts} исходящих контрактов · {summary.activeShipments} грузов в работе</small></div>; })()}
      {organization.kind === 'packaging' && (() => { const summary = packagingOrganizationSummary(ecosystem.packaging, ecosystem.trade, organization.id); return <div className="organization-intelligence"><span>Упаковочная индустрия</span><strong>{summary.activeJobs} линий в работе · {Math.round(summary.componentUnits)} компонентов на складе</strong><small>возвращено {Math.round(summary.returnedUnits)} ед. · брак {Math.round(summary.defectiveUnits)} ед.</small></div>; })()}
      {organization.kind === 'hospitality' && (() => { const summary = hospitalityOrganizationSummary(ecosystem.hospitality, organization.id); return <div className="organization-intelligence"><span>Гостеприимство</span><strong>{summary.venues} заведений · {summary.guests} гостей</strong><small>накопленная выручка ${formatMoney(summary.revenue)} · открытых бутылок и кегов ${summary.openContainers}</small></div>; })()}
      {organization.kind === 'service' && (() => { const laboratory = ecosystem.quality.laboratories.find((item) => item.organizationId === organization.id); if (!laboratory) return null; const pending = ecosystem.quality.samples.filter((sample) => sample.laboratoryId === laboratory.id && ['queued', 'testing'].includes(sample.status)).length; const completed = ecosystem.quality.results.filter((result) => ecosystem.quality.samples.find((sample) => sample.id === result.sampleId)?.laboratoryId === laboratory.id).length; return <div className="organization-intelligence"><span>Лабораторный контроль</span><strong>{pending} образцов в работе · мощность {laboratory.capacityPerDay}/день</strong><small>Аккредитация: {laboratory.accreditation.length} панелей · завершено {completed} анализов · надёжность {laboratory.reliability}/100</small></div>; })()}
      {(() => { const compliance = organizationCompliance(ecosystem.regulation, organization.id); const licenses = activeLicensesForOrganization(ecosystem.regulation, organization.id); const latestInspection = ecosystem.regulation.inspections.find((item) => item.organizationId === organization.id); return <div className="organization-intelligence"><span>Легальный оборот</span><strong>Комплаенс {compliance.score}/100</strong><small>{licenses.length} действующих разрешений · просроченный акциз {formatMoney(compliance.overdueTax)}{latestInspection ? ` · последняя проверка: день ${latestInspection.day}` : ''}</small></div>; })()}
      {organization.kind !== 'service' && (() => { const summary = organizationQualitySummary(ecosystem.quality, organization.id); return <div className="organization-intelligence"><span>Качество и безопасность</span><strong>{summary.validCertificates} сертификатов · {summary.pending} образцов в работе</strong><small>{summary.openIncidents > 0 ? `${summary.openIncidents} открытых инцидентов` : 'Открытых инцидентов нет'} · отозвано ${Math.round(summary.recalledUnits)} ед.</small></div>; })()}
      {(() => {
        const mind = ecosystem.intelligence.minds.find((item) => item.organizationId === organization.id);
        const leaders = ecosystem.intelligence.leaders.filter((leader) => leader.organizationId === organization.id && leader.active).sort((a, b) => b.influence - a.influence);
        const memories = ecosystem.intelligence.memories.filter((memory) => memory.organizationId === organization.id).slice(0, 5);
        const relations = ecosystem.intelligence.relations.filter((relation) => relation.organizationAId === organization.id || relation.organizationBId === organization.id).sort((a, b) => b.dependency - a.dependency).slice(0, 5);
        return <>
          {mind && <div className="organization-intelligence"><span>Текущий курс</span><strong>{strategyLabel(mind.strategy)}</strong><small>{mind.objective}</small><div className="detail-grid compact"><Detail label="Уверенность" value={`${Math.round(mind.confidence)}/100`} /><Detail label="Давление" value={`${Math.round(mind.pressure)}/100`} /></div></div>}
          <div className="organization-assets"><span>Руководство</span>{leaders.map((leader) => <div key={leader.id}><strong>{leader.name}</strong><small>{leaderRoleLabel(leader.role)} · влияние {leader.influence} · риск {leader.riskTolerance} · лояльность {leader.loyalty}</small></div>)}</div>
          {relations.length > 0 && <div className="organization-assets"><span>Связи</span>{relations.map((relation) => { const otherId = relation.organizationAId === organization.id ? relation.organizationBId : relation.organizationAId; const other = ecosystem.organizations.find((item) => item.id === otherId); return <div key={relation.id}><strong>{other?.name ?? 'Неизвестная организация'}</strong><small>доверие {Math.round(relation.trust)} · зависимость {Math.round(relation.dependency)} · соперничество {Math.round(relation.rivalry)} · {relation.reason}</small></div>; })}</div>}
          {memories.length > 0 && <div className="organization-assets"><span>Память компании</span>{memories.map((memory) => <div key={memory.id}><strong>День {memory.day}</strong><small>{memory.summary}</small></div>)}</div>}
        </>;
      })()}
      <div className="organization-assets"><span>Объекты</span>{assets.length === 0 ? <small>Собственной недвижимости нет.</small> : assets.map((asset) => <div key={asset.id}><strong>{asset.name}</strong><small>{assetTypeLabel(asset.type)} · {asset.city} · {asset.status === 'for_sale' ? 'продаётся' : 'работает'}</small></div>)}</div>
      {(() => {
        const sites = ecosystem.primaryProduction.sites.filter((site) => site.organizationId === organization.id);
        const processors = ecosystem.primaryProduction.processors.filter((processor) => processor.organizationId === organization.id);
        if (sites.length === 0 && processors.length === 0) return null;
        return <div className="organization-assets"><span>Первичный сектор</span>
          {sites.map((site) => <div key={site.id}><strong>{primaryCommodity(site.commodityId).name}</strong><small>{primarySiteLabel(site.kind)} · {site.hectares} га · {site.stage} · здоровье {Math.round(site.health)}/100 · ожидается {Math.round(site.expectedYield)} кг</small></div>)}
          {processors.map((processor) => <div key={processor.id}><strong>{processorLabel(processor.kind)}</strong><small>состояние {Math.round(processor.condition)}/100 · переработано {Math.round(processor.totalInputProcessed)} кг · {processor.blockedReason ?? 'работает'}</small></div>)}
        </div>;
      })()}
      <div className="organization-assets"><span>Цепочка операций</span>{ecosystem.trade.products.filter((product) => product.producerOrganizationId === organization.id).map((product) => <div key={product.id}><strong>{product.name}</strong><small>{productFamilyLabel(product.family)} · склад {Math.round(inventoryQuantity(ecosystem.trade, organization.id, 'product', product.id))} · продано {product.totalSold}</small></div>)}{ecosystem.trade.contracts.filter((contract) => contract.buyerOrganizationId === organization.id || contract.sellerOrganizationId === organization.id).slice(0, 6).map((contract) => { const counterpartyId = contract.sellerOrganizationId === organization.id ? contract.buyerOrganizationId : contract.sellerOrganizationId; const counterparty = ecosystem.organizations.find((item) => item.id === counterpartyId); return <div key={contract.id}><strong>{contract.sellerOrganizationId === organization.id ? 'Поставляет' : 'Покупает'}: {commodityName(ecosystem.trade, contract.commodityKind, contract.commodityId)}</strong><small>{counterparty?.name} · каждые {contract.intervalDays} дн. · {contract.lastResult}</small></div>; })}</div>

      {!controlled && <>
        <div className="investment-control"><span>Миноритарная доля: сейчас {currentShare}%</span><div className="choice-pills">{[10, 25, 40].map((value) => <button key={value} className={share === value ? 'active' : ''} disabled={currentShare + value > 49} onClick={() => setShare(value)}>{value}%</button>)}</div><button className="button secondary" disabled={cash < investmentCost || currentShare + share > 49} onClick={() => onInvest(share)}>Купить долю · {formatMoney(investmentCost)}</button></div>
        <div className="investment-control"><span>Контрольная сделка</span><div className="choice-pills">{([51, 75, 100] as const).map((value) => <button key={value} className={takeoverTarget === value ? 'active' : ''} disabled={currentShare >= value} onClick={() => setTakeoverTarget(value)}>{value}%</button>)}</div><small>Компания сохранит сотрудников, объекты, продукты, контракты и собственный денежный поток.</small><button className="button primary" disabled={cash < takeoverCost || currentShare >= takeoverTarget} onClick={() => onTakeover(takeoverTarget)}>Получить контроль · {formatMoney(takeoverCost)}</button></div>
      </>}

      {controlled && subsidiary && <div className="investment-control"><span>Управление дочерней компанией · {currentShare}%</span>
        <label className="field"><span>Автономность</span><select value={autonomy} onChange={(event) => setAutonomy(event.target.value as SubsidiaryAutonomy)}><option value="autonomous">Автономная</option><option value="guided">Управляемая</option><option value="integrated">Интегрированная</option></select></label>
        <label className="field"><span>Казначейство</span><select value={treasuryPolicy} onChange={(event) => setTreasuryPolicy(event.target.value as TreasuryPolicy)}><option value="retain">Оставлять прибыль</option><option value="balanced">Баланс</option><option value="sweep">Изымать прибыль</option></select></label>
        <button className="button secondary" onClick={() => onPolicy(autonomy, treasuryPolicy)}>Применить политику</button>
        <label className="field"><span>Докапитализация</span><input type="number" min={5000} step={5000} value={injection} onChange={(event) => setInjection(Number(event.target.value))} /></label>
        <button className="button primary" disabled={cash < injection || injection < 5000} onClick={() => onInject(injection)}>Внести {formatMoney(injection)}</button>
        {assets.length > 0 && controlledOrganizations.length > 1 && <div className="organization-assets"><span>Передача активов внутри группы</span>{assets.map((asset) => <AssetTransferRow key={asset.id} asset={asset} organizations={controlledOrganizations.filter((item) => item.id !== organization.id)} onTransfer={onTransfer} />)}</div>}
      </div>}
    </Modal>
  );
}

function AssetTransferRow({ asset, organizations, onTransfer }: { asset: WorldAssetState; organizations: OrganizationState[]; onTransfer: (assetId: string, targetOrganizationId: string) => void }) {
  const [target, setTarget] = useState(organizations[0]?.id ?? '');
  return <div><span><strong>{asset.name}</strong><small>{assetTypeLabel(asset.type)} · {asset.city}</small></span><select value={target} onChange={(event) => setTarget(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select><button className="button ghost compact-button" disabled={!target} onClick={() => onTransfer(asset.id, target)}>Передать</button></div>;
}

function ProductModal({ product, ecosystem, onClose }: { product: TradeProductState; ecosystem: NonNullable<GameState['ecosystem']>; onClose: () => void }) {
  const producer = ecosystem.organizations.find((organization) => organization.id === product.producerOrganizationId);
  const stock = inventoryQuantity(ecosystem.trade, product.producerOrganizationId, 'product', product.id);
  const batches = ecosystem.trade.batches.filter((batch) => batch.productId === product.id).slice(-4).reverse();
  const shelves = ecosystem.trade.shelves.filter((listing) => listing.productId === product.id);
  const contracts = ecosystem.trade.contracts.filter((contract) => contract.commodityKind === 'product' && contract.commodityId === product.id);
  const packageProfile = packagingProfile(product.packagingProfileId ?? 'profile-returnable-500');
  const industrial = industrialProductionSummary(ecosystem.trade.industrial, product.id);
  const recentRuns = industrialRunsForProduct(ecosystem.trade.industrial, product.id).slice(0, 6);
  const maturation = industrialMaturationForProduct(ecosystem.trade.industrial, product.id).slice(0, 3);
  return <Modal title={product.name} kicker={`${producer?.name ?? 'Производитель'} · ${productFamilyLabel(product.family)}`} onClose={onClose}>
    <div className="detail-grid"><Detail label="Качество" value={`${product.quality}/100`} /><Detail label="Крепость" value={`${product.alcoholByVolume}%`} /><Detail label="Объём" value={`${product.packageVolumeLiters} л`} /><Detail label="Упаковка" value={packageProfile.name} /><Detail label="Возврат" value={`${Math.round(packageProfile.returnRate * 100)}%`} /><Detail label="Склад" value={`${Math.round(stock)} бут.`} /><Detail label="Опт" value={formatMoney(product.wholesalePrice)} /><Detail label="Розница" value={formatMoney(product.recommendedRetailPrice)} /><Detail label="Произведено" value={String(product.totalProduced)} /><Detail label="Продано" value={String(product.totalSold)} /></div>
    {(() => { const summary = productQualitySummary(ecosystem.quality, product.id); const status = summary.status === 'certified' ? 'Сертифицирован' : summary.status === 'testing' ? 'Проверяется' : summary.status === 'incident' ? 'Инцидент качества' : 'Не проверен'; return <div className="organization-intelligence"><span>Лабораторный статус</span><strong>{status}</strong><small>{summary.certificateCount} действующих сертификатов · {summary.incidentCount} открытых инцидентов{summary.latestResult ? ` · последний анализ: ${summary.latestResult.summary}` : ''}</small></div>; })()}
    <div className="organization-intelligence"><span>Технологический цикл</span><strong>{industrial.currentStage}</strong><small>{industrial.activePlans} активных партий · {Math.round(industrial.agingLiters)} л на выдержке · старший лот {industrial.oldestAgeDays} дн.</small></div>
    {(recentRuns.length > 0 || maturation.length > 0) && <div className="organization-assets"><span>Процессы и выдержка</span>{recentRuns.map((run) => <div key={run.id}><strong>{industrialStageLabel(run.stageId)} · {run.status === 'complete' ? 'завершён' : 'в работе'}</strong><small>{Math.round(run.inputVolumeLiters)} → {Math.round(run.outputVolumeLiters || run.inputVolumeLiters)} л · день {run.startDay}–{run.dueDay}</small></div>)}{maturation.map((lot) => <div key={lot.id}><strong>Выдержка · {lot.vesselType}</strong><small>{Math.round(lot.currentVolumeLiters)} л · {lot.ageDays} дн. · {lot.status}</small></div>)}</div>}
    <div className="organization-assets"><span>Где продаётся</span>{shelves.length === 0 ? <small>Продукт ещё не попал на полки.</small> : shelves.map((listing) => { const asset = ecosystem.assets.find((item) => item.id === listing.assetId); return <div key={listing.id}><strong>{asset?.name ?? listing.assetId}</strong><small>{listing.units} осталось · сегодня {listing.unitsSoldToday} · цена {formatMoney(listing.retailPrice)}</small></div>; })}</div>
    <div className="organization-assets"><span>Контракты и партии</span>{contracts.map((contract) => { const buyer = ecosystem.organizations.find((item) => item.id === contract.buyerOrganizationId); return <div key={contract.id}><strong>{buyer?.name}</strong><small>{contract.quantity} ед. каждые {contract.intervalDays} дн. · {contract.lastResult}</small></div>; })}{batches.map((batch) => <div key={batch.id}><strong>{batch.status === 'ready' ? 'Готовая партия' : batch.status === 'blocked' ? 'Заблокирована' : 'В производстве'}</strong><small>{batch.producedUnits || batch.plannedUnits} ед. · {batch.issue ?? `день готовности ${batch.readyDay}`}</small></div>)}</div>
  </Modal>;
}

function StockModal({ state, asset, onClose, onSubmit }: { state: GameState; asset: WorldAssetState; onClose: () => void; onSubmit: (releaseId: string, units: number, price: number) => void }) {
  const releases = useMemo(() => state.brand.releases.filter((release) => release.status === 'active' && (state.production.batches.find((batch) => batch.id === release.batchId)?.availableUnits ?? 0) >= 6), [state.brand.releases, state.production.batches]);
  const [releaseId, setReleaseId] = useState(releases[0]?.id ?? '');
  const release = releases.find((item) => item.id === releaseId);
  const batch = state.production.batches.find((item) => item.id === release?.batchId);
  const [units, setUnits] = useState(12);
  const [price, setPrice] = useState(release?.retailPrice ?? 4);
  const maxUnits = Math.max(0, Math.min(batch?.availableUnits ?? 0, controlledVenueStockLimit(asset) - controlledVenueStockUnits(asset)));
  return (
    <Modal title={`Полка: ${asset.name}`} kicker="операционный контроль" onClose={onClose} footer={<button className="button primary" disabled={!release || units < 6 || units > maxUnits || price <= (release?.wholesalePrice ?? 0)} onClick={() => onSubmit(releaseId, units, price)}>Передать {units} бутылок</button>}>
      {releases.length === 0 ? <EmptyState icon="bottle" title="Нет готовых релизов" text="Нужен активный брендированный релиз и минимум 6 свободных бутылок." /> : <>
        <div className="release-choice-list">{releases.map((item) => { const itemBatch = state.production.batches.find((entry) => entry.id === item.batchId); return <button key={item.id} className={releaseId === item.id ? 'active' : ''} onClick={() => { setReleaseId(item.id); setPrice(item.retailPrice); }}><span className="release-bottle-mark"><i /></span><span><strong>{item.name}</strong><small>Доступно {itemBatch?.availableUnits ?? 0}</small></span><b>{formatMoney(item.retailPrice)}</b></button>; })}</div>
        <div className="retail-stock-form"><label><span>Количество</span><input type="number" min={6} max={maxUnits} value={units} onChange={(event) => setUnits(Number(event.target.value))} /></label><label><span>Цена</span><input type="number" min={(release?.wholesalePrice ?? 0) + .01} step="0.1" value={price} onChange={(event) => setPrice(Number(event.target.value))} /></label></div>
      </>}
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function formatMoney(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value); }
function statusLabel(status: OrganizationState['status']): string { return status === 'active' ? 'устойчива' : status === 'strained' ? 'под давлением' : status === 'insolvent' ? 'неплатёжеспособна' : 'поглощена'; }
function assetPriority(asset: WorldAssetState): number { return asset.status === 'for_sale' ? 0 : asset.status === 'vacant' ? 1 : asset.status === 'closed' ? 2 : 3; }
function organizationPriority(organization: OrganizationState): number { return organization.status === 'insolvent' ? 0 : organization.status === 'strained' ? 1 : 2; }
