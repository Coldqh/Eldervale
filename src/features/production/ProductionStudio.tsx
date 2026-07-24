import { useMemo, useState } from 'react';
import type { ActionResult } from '../../app/useGameState';
import type { IngredientCategory } from '../../data/supplyCatalog';
import { equipmentAvailable, maxActiveBatches, type FacilityRoomId, type FacilityUtilityId } from '../../domain/facility';
import type { GameState } from '../../domain/game';
import {
  adaptDraftToStyle,
  createRecipeDraft,
  estimateProcessCost,
  getStyle,
  getStylesForFamily,
  requiredEquipmentIds,
  statusLabel,
  type ProductFamily,
  type RecipeDraft,
} from '../../domain/production';
import { buildSupplyPlan, formatQuantity, getRecipeRequirements } from '../../domain/supply';
import { SupplyHub } from '../supply/SupplyHub';
import { FacilityHub } from '../facility/FacilityHub';
import { BatchBoard } from '../batches/BatchBoard';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/MobileUI';
import { EditorialVisual } from '../../ui/EditorialVisual';

interface ProductionStudioProps {
  state: GameState;
  onBuyEquipment: (equipmentId: string) => ActionResult;
  onSaveRecipe: (draft: RecipeDraft) => ActionResult;
  onLaunchBatch: (draft: RecipeDraft, selectedLots?: Partial<Record<IngredientCategory, string>>) => ActionResult;
  onTaste: (batchId: string) => ActionResult;
  onPackage: (batchId: string) => ActionResult;
  onDiscard: (batchId: string) => ActionResult;
  onOrderSupply: (offerId: string, quantity: number) => ActionResult;
  onSignSupplier: (supplierId: string) => ActionResult;
  onExpandRoom: (roomId: FacilityRoomId) => ActionResult;
  onExpandUtility: (utilityId: FacilityUtilityId) => ActionResult;
  onCleanFacility: () => ActionResult;
  onServiceEquipment: (equipmentId: string) => ActionResult;
  onUpgradeEquipment: (equipmentId: string) => ActionResult;
  onQueueRecipe: (recipeId: string) => ActionResult;
  onRemoveQueue: (queueId: string) => ActionResult;
}

type Workspace = 'recipe' | 'supply' | 'facility' | 'batches' | null;

type RecipeStep = 1 | 2 | 3;

export function ProductionStudio(props: ProductionStudioProps) {
  const { state } = props;
  const [workspace, setWorkspace] = useState<Workspace>(null);
  const [family, setFamily] = useState<ProductFamily>('beer');
  const [draft, setDraft] = useState<RecipeDraft>(() => createRecipeDraft('beer'));
  const [recipeStep, setRecipeStep] = useState<RecipeStep>(1);
  const [selectedLots, setSelectedLots] = useState<Partial<Record<IngredientCategory, string>>>({});
  const [selectingCategory, setSelectingCategory] = useState<IngredientCategory | null>(null);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);

  const style = getStyle(draft.styleId);
  const requirements = useMemo(() => getRecipeRequirements(draft), [draft]);
  const supplyPlan = useMemo(() => buildSupplyPlan(state.supply.inventory, requirements, selectedLots), [requirements, selectedLots, state.supply.inventory]);
  const processCost = estimateProcessCost(draft);
  const required = requiredEquipmentIds(family);
  const lineReady = required.every((id) => state.production.equipmentIds.includes(id) && (!state.facility || equipmentAvailable(state.facility, id)));
  const active = state.production.batches.filter((batch) => !['packaged', 'discarded'].includes(batch.status));
  const waiting = state.production.batches.filter((batch) => ['ready', 'tasted'].includes(batch.status));
  const packaged = state.production.batches.filter((batch) => batch.status === 'packaged').reduce((sum, batch) => sum + batch.availableUnits, 0);
  const capacity = state.facility ? maxActiveBatches(state.facility) : 1;
  const categoryRequirement = requirements.find((item) => item.category === selectingCategory) ?? null;
  const categoryLots = categoryRequirement ? state.supply.inventory.filter((lot) => lot.ingredientId === categoryRequirement.ingredientId && lot.quantity > 0) : [];

  function show(result: ActionResult) {
    setFeedback(result);
    window.setTimeout(() => setFeedback(null), 2600);
  }

  function switchFamily(next: ProductFamily) {
    setFamily(next);
    setDraft(createRecipeDraft(next));
    setSelectedLots({});
    setRecipeStep(1);
  }

  function update<K extends keyof RecipeDraft>(key: K, value: RecipeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function launch() {
    const result = props.onLaunchBatch(draft, selectedLots);
    show(result);
    if (result.ok) {
      setWorkspace(null);
      setDraft(createRecipeDraft(family));
      setSelectedLots({});
      setRecipeStep(1);
    }
  }

  return <div className="screen-stack production-screen">
    {feedback && <div className={`toast ${feedback.ok ? 'success' : 'error'}`}>{feedback.ok ? <Icon name="check" /> : <Icon name="warning" />}{feedback.message}</div>}
    <EditorialVisual
      variant="production"
      eyebrow="Производственная база"
      title={active.length > 0 ? `${active.length} партии проходят цикл` : 'Линии готовы к новому запуску'}
      metric={`${Math.max(0, capacity - active.length)} свободных линий`}
      note={`${packaged} бутылок готовы к торговле`}
      action={<button className="button visual-button" onClick={() => { setRecipeStep(1); setWorkspace('recipe'); }}>Новая партия<Icon name="arrow" /></button>}
    />

    <div className="production-overview-grid">
      <section className="production-flow plain-panel">
        <header><span className="section-kicker">Производственный цикл</span><strong>От сырья до релиза</strong></header>
        <button onClick={() => setWorkspace('supply')}><span>1</span><div><strong>Сырьё</strong><small>{state.supply.inventory.length} лотов · {state.supply.purchaseOrders.filter((order) => ['pending','delayed'].includes(order.status)).length} в пути</small></div><Icon name="arrow" /></button>
        <button onClick={() => { setRecipeStep(1); setWorkspace('recipe'); }}><span>2</span><div><strong>Рецепт</strong><small>{state.production.recipes.length} сохранено · пиво и сидр</small></div><Icon name="arrow" /></button>
        <button onClick={() => setWorkspace('batches')}><span>3</span><div><strong>Партия</strong><small>{active.length} в работе · {waiting.length} ждут решения</small></div><Icon name="arrow" /></button>
        <button onClick={() => setWorkspace('batches')}><span>4</span><div><strong>Розлив</strong><small>{packaged} бутылок готовы к торговле</small></div><Icon name="arrow" /></button>
      </section>

      <div className="production-side-stack">
        <section className="plain-panel current-work">
          <div className="section-heading"><span>Сейчас в работе</span><button onClick={() => setWorkspace('batches')}>Все партии</button></div>
          {active.length > 0 ? active.slice(0, 4).map((batch) => <button key={batch.id} onClick={() => setWorkspace('batches')}><span><strong>{batch.code} · {batch.recipe.name}</strong><small>{statusLabel(batch.status)} · готовность день {batch.readyDay}</small></span><b>{batch.progress}%</b></button>) : <p className="quiet-copy">Активных партий нет. Линии не заняты.</p>}
        </section>

        <button className="secondary-command" onClick={() => setWorkspace('facility')}><Icon name="factory" /><span><strong>Объект и оборудование</strong><small>Чистота {Math.round(state.facility?.sanitation ?? 0)} · {state.production.equipmentIds.length} модулей</small></span><Icon name="arrow" /></button>
      </div>
    </div>

    {workspace === 'recipe' && <Modal title="Новая партия" kicker={`Шаг ${recipeStep} из 3`} onClose={() => setWorkspace(null)} wide footer={<div className="wizard-footer">{recipeStep > 1 && <button className="button secondary" onClick={() => setRecipeStep((recipeStep - 1) as RecipeStep)}>Назад</button>}{recipeStep < 3 ? <button className="button primary" onClick={() => setRecipeStep((recipeStep + 1) as RecipeStep)}>Дальше</button> : <button className="button primary" disabled={!lineReady || supplyPlan.missing.length > 0 || state.finance.cash < processCost} onClick={launch}>Запустить · {formatMoney(supplyPlan.totalCost + processCost)}</button>}</div>}>
      <div className="wizard-steps"><i className={recipeStep >= 1 ? 'active' : ''} /><i className={recipeStep >= 2 ? 'active' : ''} /><i className={recipeStep >= 3 ? 'active' : ''} /></div>
      {recipeStep === 1 && <div className="wizard-pane">
        <div className="family-choice"><button className={family === 'beer' ? 'active' : ''} onClick={() => switchFamily('beer')}><Icon name="beer" />Пиво</button><button className={family === 'cider' ? 'active' : ''} onClick={() => switchFamily('cider')}><Icon name="apple" />Сидр</button></div>
        <label className="field"><span>Название рецепта</span><input value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={36} /></label>
        <div className="select-list">{getStylesForFamily(family).map((item) => <button key={item.id} className={draft.styleId === item.id ? 'active' : ''} onClick={() => { setDraft((current) => adaptDraftToStyle(current, item.id)); setSelectedLots({}); }}><span><strong>{item.shortName}</strong><small>{item.description}</small></span>{draft.styleId === item.id && <Icon name="check" />}</button>)}</div>
      </div>}
      {recipeStep === 2 && <div className="wizard-pane compact-controls">
        <RangeControl label="Сладость" value={draft.sweetness} min={1} max={5} onChange={(value) => update('sweetness', value)} />
        <RangeControl label="Кислотность" value={draft.acidity} min={1} max={5} onChange={(value) => update('acidity', value)} />
        <RangeControl label="Горечь / танины" value={draft.bitterness} min={1} max={5} onChange={(value) => update('bitterness', value)} />
        <RangeControl label="Тело" value={draft.body} min={1} max={5} onChange={(value) => update('body', value)} />
        <RangeControl label="Ароматика" value={draft.aroma} min={1} max={5} onChange={(value) => update('aroma', value)} />
        <RangeControl label="Оригинальность" value={draft.originality} min={1} max={5} onChange={(value) => update('originality', value)} />
      </div>}
      {recipeStep === 3 && <div className="wizard-pane">
        <div className="compact-controls"><RangeControl label="Объём" value={draft.volumeLiters} min={40} max={240} step={10} suffix=" л" onChange={(value) => { update('volumeLiters', value); setSelectedLots({}); }} /><RangeControl label="Температура" value={draft.processTemperature} min={style.processTemperatureRange[0]} max={style.processTemperatureRange[1]} suffix="°C" onChange={(value) => update('processTemperature', value)} /><RangeControl label="Основной этап" value={draft.primaryDays} min={style.primaryDaysRange[0]} max={style.primaryDaysRange[1]} suffix=" дн." onChange={(value) => update('primaryDays', value)} /><RangeControl label="Созревание" value={draft.conditioningDays} min={style.conditioningDaysRange[0]} max={style.conditioningDaysRange[1]} suffix=" дн." onChange={(value) => update('conditioningDays', value)} /></div>
        <div className="material-summary"><div><span>Сырьё</span><strong>{supplyPlan.missing.length === 0 ? `${supplyPlan.qualityScore}/100` : `${supplyPlan.missing.length} позиций не хватает`}</strong></div>{requirements.map((requirement) => { const uses = supplyPlan.uses.filter((use) => use.ingredientId === requirement.ingredientId); return <button key={requirement.category} className={supplyPlan.missing.some((item) => item.ingredientId === requirement.ingredientId) ? 'missing' : ''} onClick={() => setSelectingCategory(requirement.category)}><span><strong>{requirement.label}</strong><small>{uses.map((use) => use.variantName).join(' + ') || 'нет на складе'}</small></span><b>{formatQuantity(requirement.quantity, requirement.unit)}</b></button>; })}</div>
        {!lineReady && <div className="inline-warning"><Icon name="warning" /><span>Линия не готова. Закрой окно и проверь объект.</span></div>}
        {supplyPlan.missing.length > 0 && <div className="inline-warning"><Icon name="warning" /><span>Не хватает сырья. Закрой окно и открой снабжение.</span></div>}
        <button className="button secondary full-button" onClick={() => show(props.onSaveRecipe(draft))}>Сохранить рецепт</button>
      </div>}
    </Modal>}

    {workspace === 'supply' && <Modal title="Сырьё и поставщики" kicker="Снабжение" onClose={() => setWorkspace(null)} wide><SupplyHub state={state} onOrder={props.onOrderSupply} onSignSupplier={props.onSignSupplier} /></Modal>}
    {workspace === 'facility' && <Modal title="Объект и оборудование" kicker="Производственная база" onClose={() => setWorkspace(null)} wide><FacilityHub state={state} onBuyEquipment={props.onBuyEquipment} onExpandRoom={props.onExpandRoom} onExpandUtility={props.onExpandUtility} onClean={props.onCleanFacility} onServiceEquipment={props.onServiceEquipment} onUpgradeEquipment={props.onUpgradeEquipment} onQueueRecipe={props.onQueueRecipe} onRemoveQueue={props.onRemoveQueue} /></Modal>}
    {workspace === 'batches' && <Modal title="Партии" kicker="Производственный журнал" onClose={() => setWorkspace(null)} wide><BatchBoard state={state} onTaste={props.onTaste} onPackage={props.onPackage} onDiscard={props.onDiscard} onOpenProduction={() => { setWorkspace('recipe'); setRecipeStep(1); }} /></Modal>}

    {selectingCategory && categoryRequirement && <Modal title={categoryRequirement.label} kicker={`Нужно ${formatQuantity(categoryRequirement.quantity, categoryRequirement.unit)}`} onClose={() => setSelectingCategory(null)}>{categoryLots.length === 0 ? <p className="quiet-copy">На складе нет подходящих лотов.</p> : <div className="select-list">{categoryLots.map((lot) => <button key={lot.id} className={selectedLots[selectingCategory] === lot.id ? 'active' : ''} onClick={() => { setSelectedLots((current) => ({ ...current, [selectingCategory]: lot.id })); setSelectingCategory(null); }}><span><strong>{lot.variantName}</strong><small>{lot.origin} · {formatQuantity(lot.quantity, lot.unit)}</small></span><b>{lot.quality}/100</b></button>)}</div>}<button className="button secondary full-button" onClick={() => { setSelectedLots((current) => { const next = { ...current }; delete next[selectingCategory]; return next; }); setSelectingCategory(null); }}>Автовыбор</button></Modal>}
  </div>;
}

function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  const progress = ((value - min) / Math.max(1, max - min)) * 100;
  return <label className="compact-range"><div><span>{label}</span><output>{value}{suffix}</output></div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ '--range-progress': `${progress}%` } as React.CSSProperties} /></label>;
}
function formatMoney(value: number): string { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value); }
