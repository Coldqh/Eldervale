import { useMemo } from 'react';
import type { EntityRef, WorldState } from '../types';
import type { NaturalCrisis, SettlementClimateState } from '../climateTypes';
import {
  climateMapPosition, climatePressure, climateRiskLabel, climateSnapshot, crisisForSettlement, crisisIcon,
  settlementClimate, weatherIcon,
} from '../lib/climate';
import './climateCrisis.css';

export function ClimateCrisisView({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const snapshot = useMemo(() => climateSnapshot(world), [world]);
  const ranked = useMemo(() => [...snapshot.settlements]
    .sort((a, b) => climatePressure(b) - climatePressure(a)), [snapshot.settlements]);
  const worstSettlement = snapshot.worstSettlement
    ? world.settlements.find(item => item.id === snapshot.worstSettlement?.settlementId)
    : undefined;

  return <section className="workspace-view climate-workspace scrollable-tab">
    <div className="workspace-heading climate-heading">
      <div><span className="eyebrow">Климат и природные кризисы</span><h1>Погода меняет историю</h1></div>
      <p>Осадки, мороз, жара и состояние дорог уже влияют на поля, цены, здоровье, торговлю, армии и готовность семей покинуть поселение.</p>
    </div>

    <div className="climate-summary-grid">
      <SummaryCard label="Сезон" value={snapshot.season} detail={`Год ${world.year}, месяц ${world.month}`} />
      <SummaryCard label="Средняя температура" value={`${signed(snapshot.averageTemperature)}°`} detail={`Осадки ${Math.round(snapshot.averagePrecipitation)}%`} />
      <SummaryCard label="Активные кризисы" value={snapshot.activeCrises.length} detail={snapshot.activeCrises[0]?.kind ?? 'критических явлений нет'} />
      <SummaryCard label="Худшие условия" value={worstSettlement?.name ?? '—'} detail={snapshot.worstSettlement ? climateRiskLabel(climatePressure(snapshot.worstSettlement)) : 'нет данных'} />
    </div>

    <div className="climate-main-grid">
      <section className="window-card climate-map-card">
        <header><div><span className="eyebrow">Карта условий</span><strong>Поселения и текущий риск</strong></div><small>Нажми на точку, чтобы открыть поселение</small></header>
        <div className="climate-map-field">
          <div className="climate-map-grid-lines" />
          {ranked.map(state => {
            const settlement = world.settlements.find(item => item.id === state.settlementId);
            if (!settlement) return null;
            const pressure = climatePressure(state);
            return <button
              key={state.settlementId}
              className={`climate-map-node risk-${riskClass(pressure)}`}
              style={climateMapPosition(world, state.settlementId)}
              onClick={() => onSelect({ kind: 'settlement', id: state.settlementId })}
              title={`${settlement.name}: ${state.weather}, риск ${Math.round(pressure)}`}
            >
              <span>{weatherIcon(state.weather)}</span>
              <small>{settlement.name}</small>
            </button>;
          })}
        </div>
        <div className="climate-map-legend"><span><i className="calm" />спокойно</span><span><i className="strained" />тяжёлые условия</span><span><i className="critical" />кризис</span></div>
      </section>

      <section className="window-card climate-crisis-card">
        <header><div><span className="eyebrow">Текущие угрозы</span><strong>Природные кризисы</strong></div><small>{snapshot.activeCrises.length} активно</small></header>
        <div className="climate-crisis-list">
          {snapshot.activeCrises.length === 0 && <p className="climate-empty">Сейчас ни одно поселение не переживает тяжёлый природный кризис.</p>}
          {snapshot.activeCrises.slice(0, 12).map(crisis => <CrisisRow key={crisis.id} world={world} crisis={crisis} onSelect={onSelect} />)}
        </div>
      </section>
    </div>

    <section className="window-card climate-settlement-window">
      <header><div><span className="eyebrow">Все поселения</span><strong>Погода и последствия</strong></div><small>отсортировано по тяжести условий</small></header>
      <div className="climate-settlement-grid">
        {ranked.map(state => <ClimateSettlementCard key={state.settlementId} world={world} state={state} onSelect={onSelect} />)}
      </div>
    </section>
  </section>;
}

export function SettlementClimatePanel({ world, settlementId }: { world: WorldState; settlementId: number }) {
  const state = settlementClimate(world, settlementId);
  if (!state) return null;
  const crises = crisisForSettlement(world, settlementId);
  return <section className="settlement-climate-panel">
    <div className="settlement-climate-title"><span>{weatherIcon(state.weather)}</span><div><small>Погода сейчас</small><strong>{state.weather} · {signed(state.temperature)}°</strong></div></div>
    <div className="settlement-climate-metrics">
      <Metric label="Осадки" value={state.precipitation} suffix="%" />
      <Metric label="Дороги" value={state.roadCondition} suffix="%" inverse />
      <Metric label="Урожай" value={state.harvestPressure} suffix=" риск" />
      <Metric label="Болезни" value={state.diseasePressure} suffix=" риск" />
    </div>
    {crises.length > 0 && <div className="settlement-climate-crises">{crises.map(crisis => <span key={crisis.id}>{crisisIcon(crisis.kind)} {crisis.kind} · {Math.round(crisis.severity)}</span>)}</div>}
    <p>{state.history.at(-1)?.summary}</p>
  </section>;
}

function ClimateSettlementCard({ world, state, onSelect }: { world: WorldState; state: SettlementClimateState; onSelect: (ref: EntityRef) => void }) {
  const settlement = world.settlements.find(item => item.id === state.settlementId);
  if (!settlement) return null;
  const pressure = climatePressure(state);
  const crises = crisisForSettlement(world, state.settlementId);
  return <button className={`climate-settlement-card risk-${riskClass(pressure)}`} onClick={() => onSelect({ kind: 'settlement', id: state.settlementId })}>
    <header><span className="weather-symbol">{weatherIcon(state.weather)}</span><span><strong>{settlement.name}</strong><small>{state.weather} · {state.season}</small></span><b>{signed(state.temperature)}°</b></header>
    <div className="climate-pressure-line"><span style={{ width: `${Math.max(4, pressure)}%` }} /></div>
    <div className="climate-card-metrics"><span>Осадки <b>{Math.round(state.precipitation)}%</b></span><span>Дороги <b>{Math.round(state.roadCondition)}%</b></span><span>Урожай <b>{Math.round(state.harvestPressure)}</b></span><span>Миграция <b>{Math.round(state.migrationPressure)}</b></span></div>
    {crises[0] && <em>{crisisIcon(crises[0].kind)} {crises[0].kind}: тяжесть {Math.round(crises[0].severity)}</em>}
  </button>;
}

function CrisisRow({ world, crisis, onSelect }: { world: WorldState; crisis: NaturalCrisis; onSelect: (ref: EntityRef) => void }) {
  const settlement = world.settlements.find(item => item.id === crisis.settlementIds[0]);
  return <button className={`climate-crisis-row risk-${riskClass(crisis.severity)}`} onClick={() => settlement && onSelect({ kind: 'settlement', id: settlement.id })}>
    <span className="crisis-symbol">{crisisIcon(crisis.kind)}</span>
    <span><strong>{crisis.kind}</strong><small>{settlement?.name ?? 'Неизвестное поселение'} · {crisis.status}</small><em>{crisis.effects.slice(0, 2).join(' · ')}</em></span>
    <b>{Math.round(crisis.severity)}</b>
  </button>;
}

function SummaryCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="window-card climate-summary-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Metric({ label, value, suffix, inverse = false }: { label: string; value: number; suffix: string; inverse?: boolean }) {
  const risk = inverse ? 100 - value : value;
  return <div><span>{label}</span><strong>{Math.round(value)}{suffix}</strong><i><b style={{ width: `${Math.max(3, risk)}%` }} /></i></div>;
}

function signed(value: number): string { return `${value > 0 ? '+' : ''}${Math.round(value)}`; }
function riskClass(value: number): 'calm' | 'strained' | 'severe' | 'critical' {
  if (value >= 80) return 'critical';
  if (value >= 60) return 'severe';
  if (value >= 35) return 'strained';
  return 'calm';
}
