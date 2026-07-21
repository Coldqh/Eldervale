import { useMemo } from 'react';
import type { EntityRef, Species, WorldState } from '../types';
import type { PopulationShare, SettlementDemographyState } from '../populationTypes';
import { raceDefinition } from '../raceCatalog';
import {
  kingdomPopulationBreakdown, migrationRecords, settlementPopulationBreakdown,
} from '../sim/raceDemography';
import './population.css';

export function PopulationView({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const state = world.simulation.population;
  const kingdoms = useMemo(() => world.kingdoms.map(kingdom => ({
    kingdom,
    shares: kingdomPopulationBreakdown(world, kingdom.id),
    population: world.characters.filter(character => character.alive && character.kingdomId === kingdom.id).length,
    mixedSettlements: state?.settlements.filter(item => world.settlements.find(settlement => settlement.id === item.settlementId)?.kingdomId === kingdom.id && item.mixed).length ?? 0,
  })).sort((a, b) => b.population - a.population), [world, state]);
  const settlements = useMemo(() => [...world.settlements].map(settlement => ({
    settlement,
    demography: state?.settlements.find(item => item.settlementId === settlement.id),
    shares: settlementPopulationBreakdown(world, settlement.id),
  })).sort((a, b) => (b.demography?.migrationPressure ?? 0) - (a.demography?.migrationPressure ?? 0) || b.settlement.population - a.settlement.population), [world, state]);
  const migrations = migrationRecords(world, 36);
  const total = world.characters.filter(character => character.alive).length;
  const mixedCount = state?.settlements.filter(item => item.mixed).length ?? 0;
  const moving = migrations.filter(item => item.tick >= world.year * 12 + world.month - 13).reduce((sum, item) => sum + item.characterIds.length, 0);

  return <section className="workspace-view population-workspace scrollable-tab">
    <div className="workspace-heading population-heading">
      <div><span className="eyebrow">Народы и переселения</span><h1>Население мира</h1></div>
      <p>Государства имеют основной народ. Смешанные поселения возникают редко — из торговли, границ, войн и бегства от кризисов.</p>
    </div>
    <div className="population-summary-grid">
      <PopulationStat value={total.toLocaleString('ru-RU')} label="живых жителей" />
      <PopulationStat value={world.kingdoms.length} label="расовых государств" />
      <PopulationStat value={`${mixedCount}/${world.settlements.length}`} label="смешанных поселений" />
      <PopulationStat value={moving} label="переселенцев за год" />
    </div>

    <div className="population-layout">
      <div className="window-card population-window">
        <div className="population-window-head"><div><span className="eyebrow">Государства</span><h2>Состав королевств</h2></div><small>Основной народ задаёт ядро государства</small></div>
        <div className="kingdom-population-list">
          {kingdoms.map(({ kingdom, shares, population, mixedSettlements }) => <button key={kingdom.id} onClick={() => onSelect({ kind: 'kingdom', id: kingdom.id })}>
            <div className="population-card-title"><i style={{ background: kingdom.color }} /><span><strong>{kingdom.name}</strong><small>{raceDefinition(kingdom.species).pluralLabel} · {population.toLocaleString('ru-RU')} жителей · смешанных городов {mixedSettlements}</small></span></div>
            <ShareBar shares={shares} />
          </button>)}
        </div>
      </div>

      <div className="window-card population-window">
        <div className="population-window-head"><div><span className="eyebrow">Поселения</span><h2>Демографическое давление</h2></div><small>Сначала показаны города, откуда люди чаще уезжают</small></div>
        <div className="settlement-population-list">
          {settlements.slice(0, 80).map(({ settlement, demography, shares }) => <button key={settlement.id} onClick={() => onSelect({ kind: 'settlement', id: settlement.id })}>
            <span className="settlement-population-main"><strong>{settlement.name}</strong><small>{demography?.mixed ? demography.reason : 'поселение основного народа'} · давление {Math.round(demography?.migrationPressure ?? 0)}%</small></span>
            <ShareBar shares={shares} compact />
            <em className={(demography?.migrationBalance ?? 0) >= 0 ? 'positive' : 'negative'}>{signed(demography?.migrationBalance ?? 0)} за год</em>
          </button>)}
        </div>
      </div>
    </div>

    <div className="window-card migration-window">
      <div className="population-window-head"><div><span className="eyebrow">Последние перемещения</span><h2>Миграция</h2></div><small>{migrations.length ? 'Каждый переезд меняет дом, работу и состав города' : 'Крупных переселений пока не было'}</small></div>
      <div className="migration-list">{migrations.map(record => {
        const from = world.settlements.find(item => item.id === record.fromSettlementId);
        const to = world.settlements.find(item => item.id === record.toSettlementId);
        return <button key={record.id} onClick={() => onSelect({ kind: 'settlement', id: record.toSettlementId })}>
          <time>{record.year}.{String(record.month).padStart(2, '0')}</time>
          <span><strong>{from?.name ?? 'Неизвестно'} → {to?.name ?? 'Неизвестно'}</strong><small>{record.summary}</small></span>
          <em>{record.species.map(species => raceDefinition(species).pluralLabel).join(', ')}</em>
        </button>;
      })}</div>
    </div>
  </section>;
}

export function PopulationEntityPanel({ world, entityRef }: { world: WorldState; entityRef: { kind: 'settlement' | 'kingdom'; id: number } }) {
  const isSettlement = entityRef.kind === 'settlement';
  const settlement = isSettlement ? world.settlements.find(item => item.id === entityRef.id) : undefined;
  const kingdom = !isSettlement ? world.kingdoms.find(item => item.id === entityRef.id) : settlement ? world.kingdoms.find(item => item.id === settlement.kingdomId) : undefined;
  if (!kingdom) return null;
  const shares = settlement ? settlementPopulationBreakdown(world, settlement.id) : kingdomPopulationBreakdown(world, kingdom.id);
  const demography = settlement ? world.simulation.population?.settlements.find(item => item.settlementId === settlement.id) : undefined;
  const recent = migrationRecords(world, 120).filter(item => settlement
    ? item.fromSettlementId === settlement.id || item.toSettlementId === settlement.id
    : world.settlements.some(place => place.kingdomId === kingdom.id && (place.id === item.fromSettlementId || place.id === item.toSettlementId)));
  const balance = settlement ? demography?.migrationBalance ?? 0 : recent.reduce((sum, item) => {
    const from = world.settlements.find(place => place.id === item.fromSettlementId);
    const to = world.settlements.find(place => place.id === item.toSettlementId);
    return sum + (to?.kingdomId === kingdom.id ? item.characterIds.length : 0) - (from?.kingdomId === kingdom.id ? item.characterIds.length : 0);
  }, 0);

  return <section className="population-entity-panel">
    <div className="population-window-head"><div><span className="eyebrow">Население</span><h3>{settlement ? 'Состав поселения' : 'Народы государства'}</h3></div><small>{settlement ? demography?.reason ?? 'демография ещё формируется' : `основной народ — ${raceDefinition(kingdom.species).pluralLabel}`}</small></div>
    <ShareBar shares={shares} />
    <div className="population-entity-rows">
      {shares.map(share => <div key={share.species}><span>{raceDefinition(share.species).pluralLabel}</span><strong>{share.count.toLocaleString('ru-RU')} · {Math.round(share.share * 100)}%</strong></div>)}
      <div><span>Миграционный баланс</span><strong className={balance >= 0 ? 'positive' : 'negative'}>{signed(balance)} за год</strong></div>
      {settlement && <div><span>Давление на отъезд</span><strong>{Math.round(demography?.migrationPressure ?? 0)}%</strong></div>}
    </div>
  </section>;
}

function ShareBar({ shares, compact = false }: { shares: PopulationShare[]; compact?: boolean }) {
  return <div className={`race-share ${compact ? 'compact' : ''}`} title={shares.map(item => `${raceDefinition(item.species).pluralLabel}: ${Math.round(item.share * 100)}%`).join(' · ')}>
    {shares.map(item => <i key={item.species} className={`race-${item.species}`} style={{ width: `${Math.max(2, item.share * 100)}%` }} />)}
  </div>;
}

function PopulationStat({ value, label }: { value: string | number; label: string }) {
  return <div className="window-card population-stat"><strong>{value}</strong><span>{label}</span></div>;
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value}`;
}
