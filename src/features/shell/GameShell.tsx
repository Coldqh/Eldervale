import { useState } from 'react';
import type { GameController } from '../../app/useGameState';
import type { VersionGuard } from '../../app/useVersionGuard';
import { TodayView, type TodayTarget } from '../today/TodayView';
import { ProductionStudio } from '../production/ProductionStudio';
import { MarketWorld } from '../market/MarketWorld';
import { WorldHub } from '../world/WorldHub';
import { CompanyCenter } from '../company/CompanyCenter';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/MobileUI';

export type Tab = 'today' | 'production' | 'trade' | 'world';

type TabIcon = 'home' | 'factory' | 'market' | 'map';

const tabs: { id: Tab; label: string; description: string; icon: TabIcon }[] = [
  { id: 'today', label: 'Сегодня', description: 'Решения и движение дня', icon: 'home' },
  { id: 'production', label: 'Производство', description: 'Рецепты, сырьё и партии', icon: 'factory' },
  { id: 'trade', label: 'Торговля', description: 'Бренды, сделки и покупатели', icon: 'market' },
  { id: 'world', label: 'Мир', description: 'Бары, клубы и компании', icon: 'map' },
];

export function GameShell({ game, version }: { game: GameController; version: VersionGuard }) {
  const [tab, setTab] = useState<Tab>('today');
  const [companyOpen, setCompanyOpen] = useState(false);
  const [dayMessage, setDayMessage] = useState<string | null>(null);
  const activeOffers = game.state.world?.proposals.filter((proposal) => proposal.status === 'offer').length ?? 0;
  const activeOrders = game.state.world?.repeatOrders.filter((order) => order.status === 'pending').length ?? 0;
  const readyBatches = game.state.production.batches.filter((batch) => ['ready', 'tasted'].includes(batch.status)).length;
  const attentionCount = activeOffers + activeOrders + readyBatches;

  function finishDay() {
    const result = game.nextDay();
    setDayMessage(result.message);
    setTab('today');
    window.setTimeout(() => setDayMessage(null), 2200);
  }

  function openTarget(target: TodayTarget) {
    if (target === 'company') setCompanyOpen(true);
    else setTab(target === 'trade' ? 'trade' : target);
  }

  function badgeFor(item: Tab) {
    if (item === 'production') return readyBatches;
    if (item === 'trade') return activeOffers + activeOrders;
    return 0;
  }

  return (
    <div className="app-shell ux-shell">
      <aside className="desktop-rail" aria-label="Основная навигация">
        <div className="rail-brand">
          <span className="rail-brand-mark"><Icon name="bottle" /></span>
          <span><strong>Drink Company</strong><small>premium beverage house</small></span>
        </div>

        <nav className="rail-navigation">
          {tabs.map((item) => (
            <RailNavButton key={item.id} item={item} active={tab === item.id} badge={badgeFor(item.id)} onClick={() => setTab(item.id)} />
          ))}
        </nav>

        <button className="rail-day-action" onClick={finishDay}>
          <span><Icon name="clock" /></span>
          <span><small>Продолжить симуляцию</small><strong>Завершить день {game.state.day}</strong></span>
          <Icon name="arrow" />
        </button>

        <div className="rail-spacer" />

        <button className="rail-company" onClick={() => setCompanyOpen(true)}>
          <span className="company-monogram">{companyInitials(game.state.company.name)}</span>
          <span><strong>{game.state.company.name}</strong><small>{formatMoney(game.state.finance.cash)} на счетах</small></span>
          <Icon name="arrow" />
        </button>
      </aside>

      <div className="app-stage">
        <header className="topbar ux-topbar">
          <button className="company-trigger" onClick={() => setCompanyOpen(true)}>
            <span className="brand-symbol">{companyInitials(game.state.company.name)}</span>
            <span><small>День {game.state.day}</small><strong>{game.state.company.name}</strong></span>
            <Icon name="arrow" />
          </button>
          <div className="topbar-context">
            <span>{tabs.find((item) => item.id === tab)?.label}</span>
            <small>{tabs.find((item) => item.id === tab)?.description}</small>
          </div>
          <div className="topbar-metrics">
            <div><span>Баланс</span><strong>{formatMoney(game.state.finance.cash)}</strong></div>
            <div><span>Внимание</span><strong>{attentionCount}</strong></div>
          </div>
        </header>

        <main className="content ux-content" key={tab}>
          {tab === 'today' && <TodayView state={game.state} onOpen={openTarget} />}
          {tab === 'production' && <ProductionStudio state={game.state} onBuyEquipment={game.buyEquipment} onSaveRecipe={game.saveRecipeDraft} onLaunchBatch={game.launchBatch} onTaste={game.tasteBatch} onPackage={game.packageBatch} onDiscard={game.discardBatch} onOrderSupply={game.orderSupply} onSignSupplier={game.signSupplier} onExpandRoom={game.expandRoom} onExpandUtility={game.expandUtility} onCleanFacility={game.cleanFacility} onServiceEquipment={game.serviceEquipment} onUpgradeEquipment={game.upgradeEquipment} onQueueRecipe={game.queueRecipe} onRemoveQueue={game.removeQueue} />}
          {tab === 'trade' && <MarketWorld state={game.state} onSendProposal={game.sendProposal} onAcceptOffer={game.acceptOffer} onDeclineOffer={game.declineOffer} onFulfillOrder={game.fulfillOrder} onCreateBrand={game.createBrand} onCreateRelease={game.createRelease} onLaunchCampaign={game.launchCampaign} />}
          {tab === 'world' && <WorldHub state={game.state} onAcquire={game.acquireAsset} onLease={game.leaseAsset} onInvest={game.investOrganization} onTakeover={game.takeoverOrganization} onInject={game.injectSubsidiaryCapital} onPolicy={game.setSubsidiaryPolicy} onTransfer={game.transferGroupAsset} onStock={game.stockWorldVenue} onClean={game.cleanWorldVenue} onUpgrade={game.upgradeWorldVenue} onStatus={game.setWorldVenueStatus} />}
        </main>
      </div>

      {dayMessage && <div className="day-toast" role="status"><Icon name="check" />{dayMessage}</div>}

      <nav className="main-dock" aria-label="Основная навигация">
        {tabs.slice(0, 2).map((item) => <NavButton key={item.id} item={item} active={tab === item.id} badge={badgeFor(item.id)} onClick={() => setTab(item.id)} />)}
        <button className="next-day-control" onClick={finishDay} aria-label="Перейти к следующему дню"><Icon name="clock" /><span>День</span></button>
        {tabs.slice(2).map((item) => <NavButton key={item.id} item={item} active={tab === item.id} badge={badgeFor(item.id)} onClick={() => setTab(item.id)} />)}
      </nav>

      {companyOpen && <Modal title={game.state.company.name} kicker={`День ${game.state.day} · ${game.state.mode === 'roguelike' ? 'жёсткий режим' : 'стандарт'}`} onClose={() => setCompanyOpen(false)} wide><CompanyCenter game={game} version={version} /></Modal>}
    </div>
  );
}

function RailNavButton({ item, active, badge, onClick }: { item: { id: Tab; label: string; description: string; icon: TabIcon }; active: boolean; badge: number; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <span className="rail-nav-icon"><Icon name={item.icon} />{badge > 0 && <i>{badge}</i>}</span>
      <span><strong>{item.label}</strong><small>{item.description}</small></span>
    </button>
  );
}

function NavButton({ item, active, badge, onClick }: { item: { id: Tab; label: string; icon: TabIcon }; active: boolean; badge: number; onClick: () => void }) {
  return <button className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined}><span><Icon name={item.icon} />{badge > 0 && <i>{badge}</i>}</span><small>{item.label}</small></button>;
}

function companyInitials(name: string) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || 'DC';
}

function formatMoney(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value); }
