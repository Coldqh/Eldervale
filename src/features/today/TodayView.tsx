import type { GameState } from '../../domain/game';
import { statusLabel } from '../../domain/production';
import { Icon } from '../../ui/Icon';
import { EmptyState } from '../../ui/MobileUI';
import { EditorialVisual } from '../../ui/EditorialVisual';

export type TodayTarget = 'production' | 'trade' | 'world' | 'company';

interface TodayViewProps {
  state: GameState;
  onOpen: (target: TodayTarget) => void;
}

interface DecisionItem {
  id: string;
  title: string;
  detail: string;
  target: TodayTarget;
  urgent?: boolean;
  icon: 'batch' | 'contract' | 'warning' | 'factory' | 'team' | 'market';
}

export function TodayView({ state, onOpen }: TodayViewProps) {
  const decisions = buildDecisions(state);
  const activeBatches = state.production.batches.filter((batch) => !['packaged', 'discarded'].includes(batch.status));
  const shipments = state.supply.purchaseOrders.filter((order) => ['pending', 'delayed'].includes(order.status));
  const freight = state.ecosystem?.trade.shipments.filter((shipment) => ['awaiting_transport', 'in_transit', 'delayed', 'customs_hold'].includes(shipment.status)) ?? [];
  const cashDays = state.finance.dailyFixedCost > 0 ? Math.floor(state.finance.cash / state.finance.dailyFixedCost) : 99;

  return (
    <div className="screen-stack today-screen">
      <EditorialVisual
        variant="cellar"
        eyebrow={`День ${state.day} · операционная сводка`}
        title={decisions.length > 0 ? `${decisions.length} решения требуют внимания` : 'Компания работает в заданном ритме'}
        metric={formatMoney(state.finance.cash)}
        note={`${cashDays > 90 ? '90+ дней' : `${cashDays} дней`} финансового запаса`}
        action={<button className="button visual-button" onClick={() => onOpen(decisions[0]?.target ?? 'production')}>{decisions.length > 0 ? 'Открыть главное' : 'Проверить производство'}<Icon name="arrow" /></button>}
      />

      <section className="today-metrics" aria-label="Ключевые показатели">
        <article><span>Расходы в день</span><strong>{formatMoney(state.finance.dailyFixedCost)}</strong><small>операционная нагрузка</small></article>
        <article><span>Активные процессы</span><strong>{activeBatches.length + shipments.length + freight.length}</strong><small>партии и поставки</small></article>
        <article className={cashDays < 7 ? 'attention' : ''}><span>Запас денег</span><strong>{cashDays > 90 ? '90+' : cashDays}</strong><small>дней до кассового разрыва</small></article>
      </section>

      <div className="today-content-grid">
        <section className="decision-section content-section">
          <div className="section-heading"><span>Нужно решить</span><b>{decisions.length}</b></div>
          {decisions.length === 0 ? (
            <div className="plain-panel"><EmptyState icon="archive" title="Срочных решений нет" text="Производство, поставки и рынок продолжают работать автономно." /></div>
          ) : (
            <div className="action-list">
              {decisions.slice(0, 6).map((item) => (
                <button key={item.id} className={`action-row ${item.urgent ? 'urgent' : ''}`} onClick={() => onOpen(item.target)}>
                  <span className="action-icon"><Icon name={item.icon} /></span>
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="working-section content-section">
          <div className="section-heading"><span>В работе</span><b>{activeBatches.length + shipments.length + freight.length}</b></div>
          <div className="work-list plain-panel">
            {activeBatches.slice(0, 3).map((batch) => (
              <button key={batch.id} onClick={() => onOpen('production')}>
                <span><strong>{batch.code} · {batch.recipe.name}</strong><small>{statusLabel(batch.status)} · готовность день {batch.readyDay}</small></span>
                <b>{batch.progress}%</b>
              </button>
            ))}
            {shipments.slice(0, 2).map((order) => (
              <button key={order.id} onClick={() => onOpen('production')}>
                <span><strong>{order.status === 'delayed' ? 'Поставка задержана' : 'Сырьё в пути'}</strong><small>Прибытие день {order.expectedDay}</small></span>
                <b>{Math.max(0, order.expectedDay - state.day)} дн.</b>
              </button>
            ))}
            {freight.slice(0, 2).map((shipment) => (
              <button key={shipment.id} onClick={() => onOpen('world')}>
                <span><strong>{shipment.status === 'customs_hold' ? 'Груз на таможне' : shipment.status === 'awaiting_transport' ? 'Груз ждёт перевозчика' : shipment.status === 'delayed' ? 'Перевозка задержана' : 'Товар в пути'}</strong><small>{shipment.quantity} ед. · {shipment.note}</small></span>
                <b>{shipment.arrivalDay > state.day ? `${shipment.arrivalDay - state.day} дн.` : 'сегодня'}</b>
              </button>
            ))}
            {activeBatches.length + shipments.length + freight.length === 0 && <p className="quiet-copy">Нет активных партий и поставок.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

function buildDecisions(state: GameState): DecisionItem[] {
  const items: DecisionItem[] = [];
  const offers = state.world?.proposals.filter((proposal) => proposal.status === 'offer') ?? [];
  const orders = state.world?.repeatOrders.filter((order) => order.status === 'pending') ?? [];
  const ready = state.production.batches.filter((batch) => ['ready', 'tasted'].includes(batch.status));
  const delayed = state.supply.purchaseOrders.filter((order) => order.status === 'delayed');
  const exhausted = state.team.employees.filter((employee) => employee.fatigue >= 85 || employee.morale <= 30);
  const damaged = Object.entries(state.facility?.equipmentCondition ?? {}).filter(([, item]) => item < 25);
  const playerOrganizationId = state.ecosystem?.playerOrganizationId;
  const compliance = state.ecosystem?.regulation.compliance.find((item) => item.organizationId === playerOrganizationId);
  const regulatoryViolations = state.ecosystem?.regulation.violations.filter((item) => item.organizationId === playerOrganizationId && !item.resolved) ?? [];
  const overdueExcise = state.ecosystem?.regulation.obligations.filter((item) => item.organizationId === playerOrganizationId && item.status === 'overdue') ?? [];
  const freightHolds = state.ecosystem?.trade.shipments.filter((shipment) => shipment.status === 'customs_hold' || shipment.status === 'delayed') ?? [];
  const freightQueue = state.ecosystem?.logistics.jobs.filter((job) => job.status === 'queued' && state.day - job.createdDay >= 2) ?? [];
  const qualityIncidents = state.ecosystem?.quality.incidents.filter((incident) => incident.organizationId === playerOrganizationId && incident.status !== 'closed') ?? [];
  const activeRecalls = state.ecosystem?.quality.recalls.filter((recall) => recall.responsibleOrganizationId === playerOrganizationId && recall.status === 'active') ?? [];

  if (qualityIncidents.length > 0 || activeRecalls.length > 0) items.push({ id: 'quality', title: 'Проблема качества продукта', detail: `${qualityIncidents.length} инцидентов · ${activeRecalls.length} активных отзывов.`, target: 'world', icon: 'warning', urgent: true });
  if (regulatoryViolations.length > 0 || overdueExcise.length > 0) items.push({ id: 'regulation', title: 'Регулятор требует внимания', detail: `${regulatoryViolations.length} нарушений · просрочено ${overdueExcise.length} обязательств · комплаенс ${compliance?.score ?? 100}/100.`, target: 'company', icon: 'warning', urgent: true });
  if (freightHolds.length > 0 || freightQueue.length > 0) items.push({ id: 'freight', title: 'Логистика требует внимания', detail: `${freightHolds.length} задержано · ${freightQueue.length} долго ждут транспорт.`, target: 'world', icon: 'warning', urgent: freightHolds.length > 0 });
  if (offers.length > 0) items.push({ id: 'offers', title: `${offers.length} коммерческих оффера`, detail: 'Принять условия или отказаться.', target: 'trade', icon: 'contract', urgent: true });
  if (orders.length > 0) {
    const nearest = Math.min(...orders.map((order) => order.dueDay));
    items.push({ id: 'orders', title: `${orders.length} повторных заказа`, detail: `Ближайший срок — день ${nearest}.`, target: 'trade', icon: 'market', urgent: nearest - state.day <= 2 });
  }
  if (ready.length > 0) items.push({ id: 'ready', title: `${ready.length} партии ждут решения`, detail: 'Провести дегустацию, разлить или списать.', target: 'production', icon: 'batch' });
  if (delayed.length > 0) items.push({ id: 'delayed', title: `${delayed.length} поставки задержаны`, detail: 'Проверь запас и планы производства.', target: 'production', icon: 'warning', urgent: true });
  if ((state.facility?.sanitation ?? 100) < 45) items.push({ id: 'clean', title: 'Цех требует санитарной смены', detail: `Чистота ${Math.round(state.facility?.sanitation ?? 0)}/100 повышает риск дефектов.`, target: 'production', icon: 'factory', urgent: true });
  if (damaged.length > 0) items.push({ id: 'equipment', title: `${damaged.length} модуля критически изношены`, detail: 'Без ремонта линия может остановиться.', target: 'production', icon: 'warning', urgent: true });
  if (exhausted.length > 0) items.push({ id: 'team', title: `${exhausted.length} сотрудника перегружены`, detail: 'Снизь нагрузку или измени назначение.', target: 'company', icon: 'team' });

  return items;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
