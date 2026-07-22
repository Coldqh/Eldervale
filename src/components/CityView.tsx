import { useMemo, useState } from 'react';
import type { EntityRef, WorldState } from '../types';
import type { CityProblem, SettlementCityState } from '../cityTypes';
import './cityView.css';

export function CityView({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const states = useMemo(() => [...(world.cityStates ?? [])].sort((a, b) => {
    const aTop = a.problems[0]?.severity ?? 0;
    const bTop = b.problems[0]?.severity ?? 0;
    return bTop - aTop || b.population - a.population;
  }), [world]);
  const [selectedId, setSelectedId] = useState<number | undefined>(states[0]?.settlementId);
  const selected = states.find(state => state.settlementId === selectedId) ?? states[0];
  const settlement = selected ? world.settlements.find(item => item.id === selected.settlementId) : undefined;
  const urban = selected ? world.urbanStates?.find(item => item.settlementId === selected.settlementId) : undefined;

  const totals = states.reduce((result, state) => ({
    homeless: result.homeless + state.housing.homelessPeople,
    overcrowded: result.overcrowded + state.housing.overcrowdedPeople,
    children: result.children + state.education.unservedChildren,
    missingBeds: result.missingBeds + state.housing.peopleWithoutPermanentBed,
    problems: result.problems + state.problems.length,
  }), { homeless: 0, overcrowded: 0, children: 0, missingBeds: 0, problems: 0 });

  return <section className="workspace-view city-workspace scrollable-tab">
    <div className="workspace-heading"><div><span className="eyebrow">Городское ядро</span><h1>Живые поселения</h1></div><p>Физическое жильё, школы, работа, склады, земля и проблемы роста.</p></div>
    <div className="city-summary-grid">
      <CityMetric value={states.length} label="поселений" />
      <CityMetric value={totals.homeless} label="без крыши" danger={totals.homeless > 0} />
      <CityMetric value={totals.overcrowded} label="в тесноте" danger={totals.overcrowded > 0} />
      <CityMetric value={totals.missingBeds} label="без постоянной кровати" danger={totals.missingBeds > 0} />
      <CityMetric value={totals.children} label="без школы" danger={totals.children > 0} />
      <CityMetric value={totals.problems} label="активных проблем" danger={totals.problems > 0} />
    </div>
    <div className="city-layout">
      <div className="window-card city-list-window">
        <div className="city-list-head"><strong>Поселения</strong><small>Сначала самые тяжёлые проблемы</small></div>
        <div className="city-list">{states.map(state => {
          const place = world.settlements.find(item => item.id === state.settlementId);
          const top = state.problems[0];
          return <button key={state.settlementId} className={selected?.settlementId === state.settlementId ? 'active' : ''} onClick={() => setSelectedId(state.settlementId)}>
            <span><strong>{place?.name ?? `Поселение ${state.settlementId}`}</strong><small>{state.population} жителей · {state.housing.permanentBeds} постоянных мест</small></span>
            <em className={top && top.severity >= 60 ? 'critical' : top ? 'warning' : 'stable'}>{top ? Math.round(top.severity) : 'OK'}</em>
          </button>;
        })}</div>
      </div>
      {selected && settlement && <div className="city-detail-column">
        <div className="window-card city-detail-window">
          <header><div><span className="eyebrow">{settlement.type}</span><h2>{settlement.name}</h2></div><button className="ghost-button" onClick={() => onSelect({ kind: 'settlement', id: settlement.id })}>Карточка</button></header>
          <div className="city-capacity-grid">
            <CapacityBlock title="Жильё" current={selected.housing.occupiedBeds} total={selected.housing.permanentBeds} detail={`${selected.housing.peopleWithoutPermanentBed} без постоянной кровати · ${selected.housing.homelessPeople} на улице`} />
            <CapacityBlock title="Школы" current={selected.education.effectiveSeats} total={selected.education.schoolAgeChildren} detail={`${selected.education.classrooms} классов · ${selected.education.activeTeachers} учителей`} />
            <CapacityBlock title="Работа" current={selected.employment.activeWorkers} total={selected.employment.workstations} detail={`${selected.employment.unemployedPeople} без работы · ${selected.employment.vacantWorkstations} вакансий`} />
            <CapacityBlock title="Склады" current={Math.round(selected.storage.used)} total={Math.round(selected.storage.capacity)} detail={`${Math.round(selected.storage.overflow)} сверх объёма`} />
            <CapacityBlock title="Земля" current={selected.land.totalCells - selected.land.freeBuildableCells} total={selected.land.totalCells} detail={`${selected.land.freeBuildableCells} свободно · ${selected.land.overlapCells} конфликтующих клеток`} />
            <CapacityBlock title="Вода" current={Math.round(selected.services.waterCoverage * 100)} total={100} detail={`пожарный риск ${Math.round(selected.services.averageFireRisk)}%`} suffix="%" />
          </div>
        </div>
        <div className="window-card city-problems-window"><header><strong>Проблемы города</strong><small>{selected.problems.length ? 'Причины и последствия рассчитаны из физических данных' : 'Критических дефицитов нет'}</small></header><div className="city-problem-list">{selected.problems.map(problem => <ProblemCard key={problem.id} problem={problem} />)}</div></div>
        {urban && <div className="window-card city-projects-window"><header><strong>Городские проекты</strong><small>Единая очередь заявок, участков и строек</small></header><div className="city-project-list">{urban.projectQueue.filter(item => !['completed', 'cancelled', 'rejected'].includes(item.status)).slice(0, 12).map(project => <article key={project.id}><span><strong>{project.requestedBuildingType}</strong><small>{project.reason}</small>{project.blockedReason && <em>{project.blockedReason}</em>}</span><b>{project.status}</b></article>)}{!urban.projectQueue.some(item => !['completed', 'cancelled', 'rejected'].includes(item.status)) && <p>Активных проектов нет.</p>}</div><footer><span>Городских ходов: {urban.simulationCount}</span><span>Исторических проблем: {urban.problemRecords.length}</span></footer></div>}
        <div className="window-card city-buildings-window"><header><strong>Перегруженные здания</strong><small>Вместимость считается отдельно по назначению</small></header><div className="city-building-list">{selected.buildingAudits.filter(audit => audit.overloaded).slice(0, 24).map(audit => {
          const building = world.buildings.find(item => item.id === audit.buildingId);
          return <button key={audit.buildingId} onClick={() => onSelect({ kind: 'building', id: audit.buildingId })}><span><strong>{building?.name ?? `Здание ${audit.buildingId}`}</strong><small>{audit.warnings.join(' · ')}</small></span><em>{audit.floorArea} клеток</em></button>;
        })}</div></div>
      </div>}
    </div>
  </section>;
}

export function SettlementCityPanel({ world, settlementId }: { world: WorldState; settlementId: number }) {
  const state = world.cityStates?.find(item => item.settlementId === settlementId);
  if (!state) return null;
  return <section className="entity-section city-entity-panel"><div className="section-title"><span>Город</span><strong>{state.problems.length ? `${state.problems.length} проблем` : 'Стабильно'}</strong></div><div className="entity-metric-grid"><div><small>Постоянные места</small><strong>{state.housing.occupiedBeds}/{state.housing.permanentBeds}</strong></div><div><small>Без постоянной кровати</small><strong>{state.housing.peopleWithoutPermanentBed}</strong></div><div><small>Бездомные</small><strong>{state.housing.homelessPeople}</strong></div><div><small>Без школы</small><strong>{state.education.unservedChildren}</strong></div><div><small>Без работы</small><strong>{state.employment.unemployedPeople}</strong></div></div>{state.problems.slice(0, 4).map(problem => <div className="city-entity-problem" key={problem.id}><strong>{problem.title}</strong><small>{problem.description}</small></div>)}</section>;
}

function CityMetric({ value, label, danger }: { value: number; label: string; danger?: boolean }) { return <div className={danger ? 'danger' : ''}><strong>{value.toLocaleString('ru-RU')}</strong><span>{label}</span></div>; }

function CapacityBlock({ title, current, total, detail, suffix = '' }: { title: string; current: number; total: number; detail: string; suffix?: string }) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : current > 0 ? 1 : 0;
  return <div><header><strong>{title}</strong><span>{current.toLocaleString('ru-RU')}{suffix} / {total.toLocaleString('ru-RU')}{suffix}</span></header><i><b style={{ width: `${ratio * 100}%` }} /></i><small>{detail}</small></div>;
}

function ProblemCard({ problem }: { problem: CityProblem }) {
  return <article className={problem.severity >= 65 ? 'critical' : problem.severity >= 35 ? 'warning' : ''}><header><span><strong>{problem.title}</strong><small>{problem.description}</small></span><em>{Math.round(problem.severity)}</em></header><div><span>Причины: {problem.causes.join(', ')}</span><span>Последствия: {problem.consequences.join(', ')}</span></div></article>;
}
