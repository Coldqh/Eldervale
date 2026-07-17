import type { BurialRecord, Cemetery, EntityKind, EntityRef, Relationship, WorldState } from '../types';
import {
  armyStatusLabel, artifactTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel,
  buildingTypeLabel, professionLabel, settlementTypeLabel, speciesLabel,
} from '../i18n';
import { TextureIcon } from './TextureIcon';

const labels: Record<EntityKind, string> = {
  kingdom: 'Государство', settlement: 'Поселение', character: 'Личность', army: 'Армия', battleRecord: 'Сражение', monster: 'Существо',
  artifact: 'Артефакт', book: 'Книга', dungeon: 'Подземелье', war: 'Война', dynasty: 'Династия', tradeRoute: 'Торговый путь',
  animalPopulation: 'Популяция животных', ingredient: 'Природный ресурс', recipe: 'Алхимический рецепт',
  building: 'Здание', household: 'Домохозяйство', establishment: 'Заведение', item: 'Предмет', productionRecipe: 'Производственный рецепт', field: 'Поле', constructionProject: 'Строительный проект',
  cemetery: 'Кладбище', burial: 'Кладбищенская запись', travelingMerchant: 'Странствующий торговец', militaryUnit: 'Военное подразделение', supplyWagon: 'Военный обоз', knowledgeFact: 'Знание', rumor: 'Слух', message: 'Сообщение', settlementGovernment: 'Местная власть', districtCivic: 'Состояние района', patrol: 'Патруль', crime: 'Преступление', courtCase: 'Судебное дело', fireIncident: 'Пожар', kingdomGovernment: 'Государственная власть', nobleTitle: 'Титул и владение', vassalContract: 'Вассальный договор', courtOffice: 'Придворная должность', courtFaction: 'Придворная группировка', royalOrder: 'Государственный приказ', stateCrisis: 'Государственный кризис', diplomaticAgreement: 'Дипломатический договор', culture: 'Культура', language: 'Язык', religion: 'Религия',
};

export function EntityPanel({ world, selected, onSelect }: { world: WorldState; selected?: EntityRef; onSelect: (ref: EntityRef) => void }) {
  if (!selected) return <div className="empty-state"><span>✦</span><strong>Выбери объект на карте</strong><p>Поселения, государства, чудовища, армии и руины связаны одной причинной историей.</p></div>;
  const entity = getEntity(world, selected);
  if (!entity) return null;
  const subjectRef = entityIsBurial(entity) && entity.subjectKind !== 'anonymous' && entity.subjectId
    ? { kind: entity.subjectKind, id: entity.subjectId } as EntityRef
    : undefined;
  const relatedEvents = world.events.filter(event => event.entityRefs.some(ref =>
    (ref.kind === selected.kind && ref.id === selected.id) || (subjectRef && ref.kind === subjectRef.kind && ref.id === subjectRef.id),
  )).slice(-12).reverse();
  return <div className="entity-panel">
    <div className="entity-panel-title"><TextureIcon kind={selected.kind} subtype={entity.species ?? entity.type ?? entity.tier} /><div><div className="eyebrow">{labels[selected.kind]}</div>
    <h2>{getTitle(world, selected)}</h2></div></div>
    <div className="entity-stats">{renderStats(world, selected, entity, onSelect)}</div>
    {relatedEvents.length > 0 && <section><h3>След в истории</h3>{relatedEvents.map(event => <div className="history-link detailed-history" key={event.id}>
      <span>{event.year}.{String(event.month).padStart(2, '0')}</span>
      <div><strong>{event.title}</strong><small>{event.description}</small><em>Причина: {event.cause}</em><em>Условия: {event.conditions.join('; ')}</em><em>Действие: {event.decision}</em><em>Результат: {event.outcome}</em>{event.decisionId && <em>Решение №{event.decisionId}: {world.decisions.find(item => item.id === event.decisionId)?.reason ?? 'запись утрачена'}</em>}{Boolean(event.stateDeltaIds?.length) && <em>Реальные изменения: {event.stateDeltaIds!.map(id => world.stateDeltas.find(item => item.id === id)).filter(Boolean).map((delta: any) => `${delta.field}: ${delta.before} → ${delta.after}`).join('; ')}</em>}{event.consequences.length > 0 && <em>Последствия: {event.consequences.join('; ')}</em>}</div>
    </div>)}</section>}
  </div>;
}

function getEntity(world: WorldState, ref: EntityRef): any {
  const map: Record<EntityKind, any[]> = {
    kingdom: world.kingdoms, settlement: world.settlements, character: world.characters, army: world.armies, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, battleRecord: world.battleRecords ?? [], war: world.wars, dynasty: world.dynasties, tradeRoute: world.tradeRoutes,
    animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes,
    building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes, field: world.fields, constructionProject: world.constructionProjects,
    cemetery: world.cemeteries ?? [], burial: world.burials ?? [], travelingMerchant: world.travelingMerchants ?? [], militaryUnit: world.militaryUnits ?? [], supplyWagon: world.supplyWagons ?? [], knowledgeFact: world.knowledgeFacts ?? [], rumor: world.rumors ?? [], message: world.messages ?? [], settlementGovernment: world.settlementGovernments ?? [], districtCivic: world.districtCivicStates ?? [], patrol: world.civicPatrols ?? [], crime: world.crimes ?? [], courtCase: world.courtCases ?? [], fireIncident: world.fireIncidents ?? [], kingdomGovernment: world.kingdomGovernments ?? [], nobleTitle: world.nobleTitles ?? [], vassalContract: world.vassalContracts ?? [], courtOffice: world.courtOffices ?? [], courtFaction: world.courtFactions ?? [], royalOrder: world.royalOrders ?? [], stateCrisis: world.stateCrises ?? [], diplomaticAgreement: world.diplomaticAgreements ?? [], culture: world.cultures ?? [], language: world.languages ?? [], religion: world.religions ?? [],
  };
  const direct = map[ref.kind].find(item => item.id === ref.id);
  if (direct) return direct;
  if (ref.kind === 'character' || ref.kind === 'monster') return world.burials?.find(item => item.subjectKind === ref.kind && item.subjectId === ref.id);
  return undefined;
}

export function getTitle(world: WorldState, ref: EntityRef): string {
  const entity = getEntity(world, ref);
  if (!entity) return 'Неизвестно';
  if (ref.kind === 'household') {
    const head = world.characters.find(character => character.id === entity.headCharacterId)
      ?? world.burials?.find(item => item.subjectKind === 'character' && item.subjectId === entity.headCharacterId);
    return `Домохозяйство ${head?.name ?? `№${entity.id}`}`;
  }
  if (ref.kind === 'battleRecord') return `Сражение №${entity.id}`;
  if (ref.kind === 'knowledgeFact') return entity.statement ?? `Знание №${entity.id}`;
  if (ref.kind === 'rumor') return entity.text ?? `Слух №${entity.id}`;
  if (ref.kind === 'message') return `${entity.kind} №${entity.id}`;
  if (ref.kind === 'settlementGovernment') return `Власть ${getTitle(world, { kind: 'settlement', id: entity.settlementId })}`;
  if (ref.kind === 'districtCivic') return `${entity.districtName}`;
  if (ref.kind === 'patrol') return `${entity.shift} патруль: ${entity.districtName}`;
  if (ref.kind === 'crime') return `${entity.type} №${entity.id}`;
  if (ref.kind === 'courtCase') return `Дело №${entity.id}`;
  if (ref.kind === 'fireIncident') return `Пожар №${entity.id}`;
  if (ref.kind === 'kingdomGovernment') return `Власть ${getTitle(world, { kind: 'kingdom', id: entity.kingdomId })}`;
  if (ref.kind === 'nobleTitle') return entity.name;
  if (ref.kind === 'vassalContract') return `Присяга №${entity.id}`;
  if (ref.kind === 'courtOffice') return `${entity.kind}: ${getTitle(world, { kind: 'kingdom', id: entity.kingdomId })}`;
  if (ref.kind === 'courtFaction') return entity.name;
  if (ref.kind === 'royalOrder') return `${entity.kind} №${entity.id}`;
  if (ref.kind === 'stateCrisis') return `${entity.kind}: ${getTitle(world, { kind: 'kingdom', id: entity.kingdomId })}`;
  if (ref.kind === 'culture' || ref.kind === 'language' || ref.kind === 'religion') return entity.name;
  if (ref.kind === 'diplomaticAgreement') return `${entity.kind}: ${entity.kingdomIds.map((id: number) => getTitle(world, { kind: 'kingdom', id })).join(' — ')}`;
  return entity.name ?? entity.title ?? `Объект №${entity.id}`;
}


function entityIsBurial(entity: any): entity is BurialRecord {
  return Boolean(entity && typeof entity === 'object' && typeof entity.subjectKind === 'string' && typeof entity.state === 'string' && typeof entity.deathYear === 'number');
}

function burialStateLabel(state: BurialRecord['state']): string {
  const labels: Record<BurialRecord['state'], string> = {
    corpse: 'тело ожидает погребения', buried: 'погребён', cremated: 'кремирован', 'mass-grave': 'общая могила', trophy: 'останки сохранены как трофей', decayed: 'останки истлели',
  };
  return labels[state];
}

function cemeteryOccupancy(world: WorldState, cemetery: Cemetery): number {
  const ids = new Set(cemetery.burialIds);
  return (world.burials ?? []).filter(item => ids.has(item.id)).reduce((sum, item) => sum + Math.max(1, item.count), 0);
}

function link(label: string, ref: EntityRef, onSelect: (ref: EntityRef) => void) {
  return <button className="inline-link" onClick={() => onSelect(ref)}>{label}</button>;
}
function links(world: WorldState, refs: EntityRef[], onSelect: (ref: EntityRef) => void) {
  if (!refs.length) return 'нет';
  return <span className="inline-links">{refs.map(ref => <span key={`${ref.kind}-${ref.id}`}>{link(getTitle(world, ref), ref, onSelect)}</span>)}</span>;
}
function row(label: string, value: React.ReactNode) { return <div className="stat-row"><span>{label}</span><strong>{value}</strong></div>; }

function relationshipText(world: WorldState, characterId: number, relationship: Relationship, onSelect: (ref: EntityRef) => void) {
  const otherId = relationship.characterAId === characterId ? relationship.characterBId : relationship.characterAId;
  const details = relationship.trust === undefined
    ? `${relationship.kind}, сила ${relationship.strength}`
    : `${relationship.kind} · ${relationship.status ?? 'stable'} · доверие ${Math.round(relationship.trust ?? 0)}, привязанность ${Math.round(relationship.affection ?? 0)}, уважение ${Math.round(relationship.respect ?? 0)}, страх ${Math.round(relationship.fear ?? 0)}, напряжение ${Math.round(relationship.tension ?? 0)}`;
  return <span className="relationship-line" key={relationship.id}>{link(getTitle(world, { kind: 'character', id: otherId }), { kind: 'character', id: otherId }, onSelect)}<small>{details}: {relationship.reason}{relationship.contexts?.length ? ` · ${relationship.contexts.map(mindLabel).join(', ')}` : ''}</small></span>;
}


function itemTemplateName(world: WorldState, templateId: string): string {
  return world.items.find(item => item.templateId === templateId)?.name ?? templateId.replaceAll('_', ' ');
}
function mindLabel(value: string): string {
  const labels: Record<string, string> = {
    greed: 'жадность', empathy: 'эмпатия', courage: 'смелость', patience: 'терпение', honesty: 'честность', cruelty: 'жестокость', ambition: 'амбиции', riskTolerance: 'риск',
    family: 'семья', faith: 'вера', wealth: 'богатство', power: 'власть', freedom: 'свобода', order: 'порядок',
    survive: 'выжить', feed_family: 'накормить семью', earn_wealth: 'заработать', gain_power: 'получить власть', protect_home: 'защитить дом', serve_faith: 'служить вере', revenge: 'отомстить', escape_justice: 'избежать закона', master_craft: 'стать мастером', explore: 'исследовать мир',
    debt: 'долг', employment: 'работа', oath: 'присяга', office: 'должность', vassalage: 'вассальная обязанность', promise: 'обещание',
    neighbors: 'соседи', workers: 'работники', merchants: 'купцы', guards: 'стража', clergy: 'духовенство', nobility: 'знать', army: 'армия', court: 'двор',
    household: 'общий дом', work: 'работа', market: 'рынок', travel: 'дорога', crime: 'преступление',
    loan: 'заём', service: 'услуга', protection: 'защита', patronage: 'покровительство', family_support: 'поддержка семьи', work_referral: 'рекомендация', silence: 'обет молчания',
  };
  return labels[value] ?? value;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 1 : 0);
}

function renderStats(world: WorldState, ref: EntityRef, entity: any, onSelect: (ref: EntityRef) => void) {

  if (ref.kind === 'culture') return <>
    {row('Основной народ', speciesLabel(entity.species))}{row('Язык', link(getTitle(world, { kind: 'language', id: entity.languageId }), { kind: 'language', id: entity.languageId }, onSelect))}
    {row('Традиции', entity.traditions.join('; '))}{row('Запреты', entity.taboos.join('; '))}{row('Праздники', entity.holidays.join('; '))}
    {row('Одежда', entity.clothingStyle)}{row('Имена', entity.namingStyle)}{row('Брак', entity.marriageCustom)}{row('Погребение', entity.burialCustom)}
    {row('Открытость', `${Math.round(entity.openness)}%`)}{row('Сплочённость', `${Math.round(entity.cohesion)}%`)}{row('Престиж', `${Math.round(entity.prestige)}%`)}
    {row('Поселения', links(world, entity.settlementIds.slice(0, 30).map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'language') return <>
    {row('Письменность', entity.script)}{row('Сложность', `${Math.round(entity.difficulty)}%`)}{row('Престиж', `${Math.round(entity.prestige)}%`)}
    {row('Обычные выражения', entity.commonPhrases.join('; '))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'religion') return <>
    {row('Духовенство', entity.clergyTitle)}{row('Учение', entity.doctrines.join('; '))}{row('Запреты', entity.taboos.join('; '))}{row('Святые дни', entity.holyDays.join('; '))}
    {row('Терпимость', `${Math.round(entity.tolerance)}%`)}{row('Стремление обращать', `${Math.round(entity.conversionPressure)}%`)}{row('Авторитет', `${Math.round(entity.authority)}%`)}
    {row('Поселения', links(world, entity.settlementIds.slice(0, 30).map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'kingdomGovernment') {
    return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Форма власти', entity.form)}{row('Правитель', link(getTitle(world, { kind: 'character', id: entity.sovereignCharacterId }), { kind: 'character', id: entity.sovereignCharacterId }, onSelect))}{row('Наследник', entity.heirCharacterId ? link(getTitle(world, { kind: 'character', id: entity.heirCharacterId }), { kind: 'character', id: entity.heirCharacterId }, onSelect) : 'не определён')}{row('Регент', entity.regentCharacterId ? link(getTitle(world, { kind: 'character', id: entity.regentCharacterId }), { kind: 'character', id: entity.regentCharacterId }, onSelect) : 'не нужен')}{row('Столица', link(getTitle(world, { kind: 'settlement', id: entity.capitalSettlementId }), { kind: 'settlement', id: entity.capitalSettlementId }, onSelect))}{row('Легитимность', `${Math.round(entity.legitimacy)}%`)}{row('Централизация', `${Math.round(entity.centralization)}%`)}{row('Управление', `${Math.round(entity.administration)}%`)}{row('Коррупция', `${Math.round(entity.corruption)}%`)}{row('Налоговая ставка', `${Math.round(entity.taxRate * 100)}%`)}{row('Воинская повинность', `${Math.round(entity.levyRate * 100)}%`)}{row('Налоги за месяц', `${entity.monthlyTaxIncome.toFixed(1)} крон`)}{row('Расходы двора', `${entity.monthlyCourtCost.toFixed(1)} крон`)}{row('Государственный долг', `${entity.debt.toFixed(1)} крон`)}{row('Наследование', entity.successionLaw)}{row('Титулы', links(world, entity.titleIds.map((id: number) => ({ kind: 'nobleTitle' as const, id })), onSelect))}{row('Должности', links(world, entity.courtOfficeIds.map((id: number) => ({ kind: 'courtOffice' as const, id })), onSelect))}{row('Группировки', links(world, entity.factionIds.map((id: number) => ({ kind: 'courtFaction' as const, id })), onSelect))}{row('Приказы', links(world, entity.orderIds.slice(-20).map((id: number) => ({ kind: 'royalOrder' as const, id })), onSelect))}{row('Кризисы', links(world, entity.crisisIds.slice(-12).map((id: number) => ({ kind: 'stateCrisis' as const, id })), onSelect))}{row('Договоры', links(world, entity.agreementIds.slice(-16).map((id: number) => ({ kind: 'diplomaticAgreement' as const, id })), onSelect))}{row('Текущее решение', entity.activeDecision)}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'nobleTitle') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Ранг', entity.rank)}{row('Держатель', link(getTitle(world, { kind: 'character', id: entity.holderCharacterId }), { kind: 'character', id: entity.holderCharacterId }, onSelect))}{row('Владение', entity.settlementId ? link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect) : 'вся корона')}{row('Сюзерен', entity.liegeTitleId ? link(getTitle(world, { kind: 'nobleTitle', id: entity.liegeTitleId }), { kind: 'nobleTitle', id: entity.liegeTitleId }, onSelect) : 'нет')}{row('Наследственный', entity.hereditary ? 'да' : 'нет')}{row('Налоговая доля', `${Math.round(entity.taxShare * 100)}%`)}{row('Военная доля', `${Math.round(entity.levyShare * 100)}%`)}{row('Легитимность', `${Math.round(entity.legitimacy)}%`)}{row('Автономия', `${Math.round(entity.autonomy)}%`)}{row('Состояние', entity.status)}{row('Претенденты', links(world, entity.claimantIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'vassalContract') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Сюзерен', link(getTitle(world, { kind: 'character', id: entity.liegeCharacterId }), { kind: 'character', id: entity.liegeCharacterId }, onSelect))}{row('Вассал', link(getTitle(world, { kind: 'character', id: entity.vassalCharacterId }), { kind: 'character', id: entity.vassalCharacterId }, onSelect))}{row('Сюзеренский титул', link(getTitle(world, { kind: 'nobleTitle', id: entity.liegeTitleId }), { kind: 'nobleTitle', id: entity.liegeTitleId }, onSelect))}{row('Вассальный титул', link(getTitle(world, { kind: 'nobleTitle', id: entity.vassalTitleId }), { kind: 'nobleTitle', id: entity.vassalTitleId }, onSelect))}{row('Статус', entity.status)}{row('Лояльность', `${Math.round(entity.loyalty)}%`)}{row('Автономия', `${Math.round(entity.autonomy)}%`)}{row('Налог', `${Math.round(entity.taxRate * 100)}%`)}{row('Военная повинность', `${Math.round(entity.levyRate * 100)}%`)}{row('Недоимка', `${entity.taxArrears.toFixed(1)} крон`)}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'courtOffice') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Должность', entity.kind)}{row('Чиновник', entity.holderCharacterId ? link(getTitle(world, { kind: 'character', id: entity.holderCharacterId }), { kind: 'character', id: entity.holderCharacterId }, onSelect) : 'вакантна')}{row('Жалование', `${entity.salary} крон`)}{row('Влияние', `${Math.round(entity.influence)}%`)}{row('Компетентность', `${Math.round(entity.competence)}%`)}{row('Лояльность', `${Math.round(entity.loyalty)}%`)}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'courtFaction') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Тип', entity.kind)}{row('Лидер', link(getTitle(world, { kind: 'character', id: entity.leaderCharacterId }), { kind: 'character', id: entity.leaderCharacterId }, onSelect))}{row('Участники', links(world, entity.memberIds.slice(0, 40).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Влияние', `${Math.round(entity.influence)}%`)}{row('Лояльность', `${Math.round(entity.loyalty)}%`)}{row('Касса', `${Math.round(entity.treasury)} крон`)}{row('Статус', entity.status)}{row('Цель', entity.goal)}{row('Недовольство', entity.grievance)}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'royalOrder') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Вид приказа', entity.kind)}{row('Издал', link(getTitle(world, { kind: 'character', id: entity.issuerCharacterId }), { kind: 'character', id: entity.issuerCharacterId }, onSelect))}{row('Цель', entity.targetSettlementId ? link(getTitle(world, { kind: 'settlement', id: entity.targetSettlementId }), { kind: 'settlement', id: entity.targetSettlementId }, onSelect) : 'не указана')}{row('Статус', entity.status)}{row('Приоритет', entity.priority)}{row('Стоимость', `${entity.cost.toFixed(1)} крон`)}{row('Причина', entity.reason)}{row('Донесение', entity.messageId ? link(getTitle(world, { kind: 'message', id: entity.messageId }), { kind: 'message', id: entity.messageId }, onSelect) : 'не создано')}{row('Результат', entity.outcome ?? 'ещё нет')}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'stateCrisis') return <>{row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}{row('Тип', entity.kind)}{row('Статус', entity.status)}{row('Зачинщик', entity.instigatorCharacterId ? link(getTitle(world, { kind: 'character', id: entity.instigatorCharacterId }), { kind: 'character', id: entity.instigatorCharacterId }, onSelect) : 'не установлен')}{row('Претендент', entity.claimantCharacterId ? link(getTitle(world, { kind: 'character', id: entity.claimantCharacterId }), { kind: 'character', id: entity.claimantCharacterId }, onSelect) : 'нет')}{row('Тяжесть', `${Math.round(entity.severity)}%`)}{row('Поддержка', `${Math.round(entity.support)}%`)}{row('Сила короны', `${Math.round(entity.opposition)}%`)}{row('Затронутые земли', links(world, entity.settlementIds.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'diplomaticAgreement') return <>{row('Участники', links(world, entity.kingdomIds.map((id: number) => ({ kind: 'kingdom' as const, id })), onSelect))}{row('Тип', entity.kind)}{row('Статус', entity.status)}{row('Инициатор', link(getTitle(world, { kind: 'kingdom', id: entity.initiatorKingdomId }), { kind: 'kingdom', id: entity.initiatorKingdomId }, onSelect))}{row('Условия', entity.terms.join('; '))}{row('Дань', `${entity.tributeAmount} крон`)}{row('Посольство', entity.messageId ? link(getTitle(world, { kind: 'message', id: entity.messageId }), { kind: 'message', id: entity.messageId }, onSelect) : 'исторический договор')}{row('История', entity.history.join(' '))}</>;

  if (ref.kind === 'settlementGovernment') {
    return <>{row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}{row('Глава', link(getTitle(world, { kind: 'character', id: entity.leaderCharacterId }), { kind: 'character', id: entity.leaderCharacterId }, onSelect))}{row('Совет', links(world, entity.councilCharacterIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Казна', `${entity.treasury.toFixed(1)} крон`)}{row('Налоги за месяц', `${entity.monthlyTaxIncome.toFixed(1)} крон`)}{row('Расходы за месяц', `${entity.monthlyExpenses.toFixed(1)} крон`)}{row('Коррупция', `${Math.round(entity.corruption)}%`)}{row('Стража', links(world, entity.guardIds.slice(0, 24).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Судьи', links(world, entity.judgeIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Пожарные', links(world, entity.firefighterIds.slice(0, 20).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Заключённые', links(world, entity.prisonerIds.slice(0, 24).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Текущее решение', entity.activeDecision)}{row('Законы', entity.laws.join('; '))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'districtCivic') return <>{row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}{row('Район', entity.districtName)}{row('Безопасность', `${Math.round(entity.safety)}%`)}{row('Чистота', `${Math.round(entity.cleanliness)}%`)}{row('Пожарный риск', `${Math.round(entity.fireRisk)}%`)}{row('Доступ к воде', `${Math.round(entity.waterAccess)}%`)}{row('Преступность', `${Math.round(entity.crimeRate)}%`)}{row('Бездомные', entity.homelessCount)}{row('Аренда', `×${entity.rentMultiplier.toFixed(2)}`)}{row('Патрули', links(world, entity.patrolIds.map((id: number) => ({ kind: 'patrol' as const, id })), onSelect))}</>;
  if (ref.kind === 'patrol') return <>{row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}{row('Район', entity.districtName)}{row('Смена', entity.shift)}{row('Статус', entity.status)}{row('Стражники', links(world, entity.guardIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Аресты', entity.arrests)}{row('История', entity.history.join(' ') || 'Обычная служба.')}</>;
  if (ref.kind === 'crime') return <>{row('Тип', entity.type)}{row('Статус', entity.status)}{row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}{row('Район', entity.districtName)}{row('Подозреваемый', entity.perpetratorId ? link(getTitle(world, { kind: 'character', id: entity.perpetratorId }), { kind: 'character', id: entity.perpetratorId }, onSelect) : 'не установлен')}{row('Жертва', entity.victimCharacterId ? link(getTitle(world, { kind: 'character', id: entity.victimCharacterId }), { kind: 'character', id: entity.victimCharacterId }, onSelect) : 'нет')}{row('Свидетели', links(world, entity.witnessIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Улики', `${Math.round(entity.evidence)}%`)}{row('Тяжесть', entity.severity)}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'courtCase') return <>{row('Преступление', link(getTitle(world, { kind: 'crime', id: entity.crimeId }), { kind: 'crime', id: entity.crimeId }, onSelect))}{row('Статус', entity.status)}{row('Судья', entity.judgeId ? link(getTitle(world, { kind: 'character', id: entity.judgeId }), { kind: 'character', id: entity.judgeId }, onSelect) : 'не назначен')}{row('Подсудимый', entity.defendantId ? link(getTitle(world, { kind: 'character', id: entity.defendantId }), { kind: 'character', id: entity.defendantId }, onSelect) : 'не установлен')}{row('Приговор', entity.verdict ?? 'нет')}{row('Срок', `${entity.sentenceMonths} месяцев`)}{row('Штраф', `${entity.fine} крон`)}{row('История', entity.history.join(' '))}</>;
  if (ref.kind === 'fireIncident') return <>{row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}{row('Статус', entity.status)}{row('Интенсивность', `${Math.round(entity.intensity)}%`)}{row('Риск распространения', `${Math.round(entity.spreadRisk)}%`)}{row('Затронутые здания', links(world, entity.affectedBuildingIds.map((id: number) => ({ kind: 'building' as const, id })), onSelect))}{row('Пожарные', links(world, entity.firefighterIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Погибшие', entity.deaths)}{row('Уничтожено зданий', entity.destroyedBuildingIds.length)}{row('История', entity.history.join(' '))}</>;

  if (ref.kind === 'knowledgeFact') {
    const sourceEvent = entity.eventId ? world.events.find(item => item.id === entity.eventId) : undefined;
    return <>{row('Тема', entity.topic)}{row('Достоверность', `${Math.round(entity.truth)}%`)}{row('Подтверждено', entity.verified ? 'да' : 'нет')}{row('Секретность', `${entity.secrecy}%`)}{row('Важность', entity.importance)}{row('Источник', entity.originCharacterId ? link(getTitle(world, { kind: 'character', id: entity.originCharacterId }), { kind: 'character', id: entity.originCharacterId }, onSelect) : 'не установлен')}{row('Место происхождения', entity.originSettlementId ? link(getTitle(world, { kind: 'settlement', id: entity.originSettlementId }), { kind: 'settlement', id: entity.originSettlementId }, onSelect) : 'не установлено')}{row('Предмет знания', entity.subjectRef ? link(getTitle(world, entity.subjectRef), entity.subjectRef, onSelect) : 'общее знание')}{row('Исходное событие', sourceEvent ? sourceEvent.title : 'нет')}{row('Формулировка', entity.statement)}{row('Истинная формулировка', entity.canonicalStatement)}{row('Метки', entity.tags.join(', ') || 'нет')}{row('История знания', entity.history.join(' ') || 'нет')}</>;
  }
  if (ref.kind === 'rumor') {
    const fact = world.knowledgeFacts.find(item => item.id === entity.factId);
    return <>{row('Состояние', entity.status)}{row('Уверенность', `${Math.round(entity.confidence)}%`)}{row('Искажение', `${Math.round(entity.distortion)}%`)}{row('Передач', entity.spreadCount)}{row('Возник', link(getTitle(world, { kind: 'settlement', id: entity.originSettlementId }), { kind: 'settlement', id: entity.originSettlementId }, onSelect))}{row('Сейчас ходит в', link(getTitle(world, { kind: 'settlement', id: entity.currentSettlementId }), { kind: 'settlement', id: entity.currentSettlementId }, onSelect))}{row('Основан на', fact ? link(getTitle(world, { kind: 'knowledgeFact', id: fact.id }), { kind: 'knowledgeFact', id: fact.id }, onSelect) : 'утраченный факт')}{row('Текст', entity.text)}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'message') {
    const sender = entity.senderCharacterId ? world.characters.find(item => item.id === entity.senderCharacterId) : undefined;
    const recipient = entity.recipientCharacterId ? world.characters.find(item => item.id === entity.recipientCharacterId) : undefined;
    return <>{row('Тип', entity.kind)}{row('Состояние', entity.status)}{row('Надёжность', `${Math.round(entity.reliability)}%`)}{row('Печать', entity.sealed ? 'запечатано' : 'открыто')}{row('Отправитель', sender ? link(sender.name, { kind: 'character', id: sender.id }, onSelect) : 'не указан')}{row('Получатель', recipient ? link(recipient.name, { kind: 'character', id: recipient.id }, onSelect) : entity.recipientKingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.recipientKingdomId }), { kind: 'kingdom', id: entity.recipientKingdomId }, onSelect) : 'не указан')}{row('Маршрут', <>{link(getTitle(world, { kind: 'settlement', id: entity.fromSettlementId }), { kind: 'settlement', id: entity.fromSettlementId }, onSelect)} → {link(getTitle(world, { kind: 'settlement', id: entity.toSettlementId }), { kind: 'settlement', id: entity.toSettlementId }, onSelect)}</>)}{row('Отправлено', `${Math.floor(entity.departedTick / 12)}.${String(entity.departedTick % 12 + 1).padStart(2, '0')}`)}{row('Ожидаемое прибытие', `${Math.floor(entity.arrivalTick / 12)}.${String(entity.arrivalTick % 12 + 1).padStart(2, '0')}`)}{row('Сведения', links(world, entity.knowledgeFactIds.map((id: number) => ({ kind: 'knowledgeFact' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'battleRecord') {
    const attacker = world.armies.find(item => item.id === entity.attackerArmyId);
    const defender = world.armies.find(item => item.id === entity.defenderArmyId);
    const winner = entity.winnerArmyId ? world.armies.find(item => item.id === entity.winnerArmyId) : undefined;
    const unitLines = (states: any[]) => states.map(state => `${getTitle(world, { kind: 'militaryUnit', id: state.unitId })}: ${state.role}, ${state.remainingCount}/${state.initialCount}, мораль ${Math.round(state.morale)}%, ${state.routed ? 'бежало' : 'держало строй'}`).join('; ');
    return <>{row('Дата', `${entity.year}.${String(entity.month).padStart(2, '0')}`)}{row('Место', entity.settlementId ? link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect) : `квадрат ${entity.globalX}:${entity.globalY}`)}{row('Атакующие', attacker ? link(attacker.name, { kind: 'army', id: attacker.id }, onSelect) : 'армия распущена')}{row('Защитники', defender ? link(defender.name, { kind: 'army', id: defender.id }, onSelect) : 'армия распущена')}{row('Победитель', winner ? link(winner.name, { kind: 'army', id: winner.id }, onSelect) : 'не определён')}{row('Раунды', entity.rounds)}{row('Потери атакующих', `${entity.attackerDead} погибших · ${entity.attackerWounded} раненых · ${entity.attackerCaptured} пленных`)}{row('Потери защитников', `${entity.defenderDead} погибших · ${entity.defenderWounded} раненых · ${entity.defenderCaptured} пленных`)}{row('Пленные', links(world, entity.prisonerIds.slice(0, 40).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Раненые', links(world, entity.woundedIds.slice(0, 40).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Трофеи', links(world, entity.lootedItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}{row('Строй атакующих', unitLines(entity.attackerUnitStates))}{row('Строй защитников', unitLines(entity.defenderUnitStates))}{row('Ход боя', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'army') {
    const kingdom = world.kingdoms.find(item => item.id === entity.kingdomId);
    const commander = world.characters.find(item => item.id === entity.commanderId);
    const garrison = entity.garrisonBuildingId ? world.buildings.find(item => item.id === entity.garrisonBuildingId) : undefined;
    const arsenal = entity.arsenalBuildingId ? world.buildings.find(item => item.id === entity.arsenalBuildingId) : undefined;
    const castle = entity.castleBuildingId ? world.buildings.find(item => item.id === entity.castleBuildingId) : undefined;
    const soldierRefs = (entity.soldierIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'character' as const, id }));
    const unitRefs = (entity.unitIds ?? []).map((id: number) => ({ kind: 'militaryUnit' as const, id }));
    const wagonRefs = (entity.supplyWagonIds ?? []).map((id: number) => ({ kind: 'supplyWagon' as const, id }));
    const camp = world.armyCamps.find(item => item.armyId === entity.id);
    const campStructures = camp ? camp.structureIds.map(id => world.armyCampStructures.find(item => item.id === id)).filter(Boolean) : [];
    return <>{row('Государство', kingdom ? link(kingdom.name, { kind: 'kingdom', id: kingdom.id }, onSelect) : 'неизвестно')}{row('Командир', commander ? link(commander.name, { kind: 'character', id: commander.id }, onSelect) : 'нет')}{row('Состояние', armyStatusLabel(entity.status))}{row('Размещение', camp ? (camp.mode === 'camp' ? `полевой лагерь, квадрат ${camp.globalX}:${camp.globalY}` : camp.mode === 'battle' ? `боевое построение, квадрат ${camp.globalX}:${camp.globalY}` : `походная колонна, квадрат ${camp.globalX}:${camp.globalY}`) : 'не развёрнуто')}{row('Полевые сооружения', campStructures.length)}{row('Именные бойцы', `${entity.soldierIds?.length ?? 0}`)}{row('Боевая сила', entity.strength)}{row('Готовность', `${Math.round(entity.readiness ?? 0)}%`)}{row('Мораль', `${Math.round(entity.morale)}%`)}{row('Снабжение', `${Math.round(entity.supplies)}%`)}{row('Еда', `${Math.round(entity.logistics?.foodDays ?? 0)} дней`)}{row('Вода', `${Math.round(entity.logistics?.waterDays ?? 0)} дней`)}{row('Броня', `${Math.round(entity.logistics?.armorCoverage ?? 0)}%`)}{row('Оружие', `${Math.round(entity.logistics?.equipmentCoverage ?? 0)}%`)}{row('Дальний бой', `${Math.round(entity.logistics?.rangedCoverage ?? 0)}%`)}{row('Лошади', entity.logistics?.horses ?? 0)}{row('Повозки', entity.logistics?.wagons ?? 0)}{row('Долг по жалованию', `${Math.round(entity.logistics?.payrollDebt ?? 0)} крон`)}{row('Дезертиры', entity.logistics?.desertions ?? 0)}{row('Раненые', entity.logistics?.wounded ?? 0)}{row('Городская база снабжения', garrison ? link(garrison.name, { kind: 'building', id: garrison.id }, onSelect) : 'нет')}{row('Арсенал', arsenal ? link(arsenal.name, { kind: 'building', id: arsenal.id }, onSelect) : 'нет')}{row('Замок', castle ? link(castle.name, { kind: 'building', id: castle.id }, onSelect) : 'нет')}{row('Подразделения', links(world, unitRefs, onSelect))}{row('Обозы', links(world, wagonRefs, onSelect))}{row('Бойцы', links(world, soldierRefs, onSelect))}{row('История походов', entity.campaignHistory.join(' '))}</>;
  }
  if (ref.kind === 'militaryUnit') {
    const army = world.armies.find(item => item.id === entity.armyId);
    const commander = world.characters.find(item => item.id === entity.commanderId);
    return <>{row('Армия', army ? link(army.name, { kind: 'army', id: army.id }, onSelect) : 'нет')}{row('Тип', entity.type)}{row('Командир', commander ? link(commander.name, { kind: 'character', id: commander.id }, onSelect) : 'нет')}{row('Бойцы', `${entity.memberIds.length}`)}{row('Подготовка', `${Math.round(entity.training)}%`)}{row('Сплочённость', `${Math.round(entity.cohesion)}%`)}{row('Оснащение', `${Math.round(entity.equipmentCoverage)}%`)}{row('Лошади', entity.horseCount)}{row('Опыт', `${Math.round(entity.experience)}%`)}{row('Состав', links(world, entity.memberIds.slice(0, 32).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'supplyWagon') {
    const army = world.armies.find(item => item.id === entity.armyId);
    return <>{row('Армия', army ? link(army.name, { kind: 'army', id: army.id }, onSelect) : 'нет')}{row('Состояние', entity.status)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Повозки', entity.wagonCount)}{row('Лошади', entity.horseCount)}{row('Вместимость', entity.capacity)}{row('Состояние повозок', `${Math.round(entity.condition)}%`)}{row('Охрана', links(world, entity.escortIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}{row('Груз', links(world, entity.inventoryItemIds.slice(0, 40).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'travelingMerchant') {
    const character = world.characters.find(item => item.id === entity.characterId);
    const current = world.settlements.find(item => item.id === entity.currentSettlementId);
    const next = entity.nextSettlementId ? world.settlements.find(item => item.id === entity.nextSettlementId) : undefined;
    return <>{row('Торговец', character ? link(character.name, { kind: 'character', id: character.id }, onSelect) : 'неизвестен')}{row('Состояние', entity.status)}{row('Текущая стоянка', current ? link(current.name, { kind: 'settlement', id: current.id }, onSelect) : 'в пути')}{row('Следующая остановка', next ? link(next.name, { kind: 'settlement', id: next.id }, onSelect) : 'не назначена')}{row('Касса', `${Math.round(entity.cash)} крон`)}{row('Товары', links(world, entity.wagonInventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}{row('История', entity.history.join(' '))}</>;
  }
  if (ref.kind === 'field') {
    const farm = world.buildings.find(item => item.id === entity.farmBuildingId);
    const establishment = entity.establishmentId ? world.establishments.find(item => item.id === entity.establishmentId) : undefined;
    return <>
      {row('Культура', entity.crop)}{row('Состояние', entity.state)}{row('Площадь', `${entity.cells.length} клеток`)}
      {row('Плодородие', `${Math.round(entity.fertility)}%`)}{row('Влажность', `${Math.round(entity.moisture)}%`)}{row('Сорняки', `${Math.round(entity.weeds)}%`)}{row('Вредители', `${Math.round(entity.pests)}%`)}
      {row('Работы', `${Math.round(entity.laborDone)} / ${Math.round(entity.laborRequired)}`)}{row('Ожидаемый урожай', entity.expectedYield)}
      {row('Ферма', farm ? link(farm.name, { kind: 'building', id: farm.id }, onSelect) : 'не найдена')}
      {row('Хозяйство', establishment ? link(establishment.name, { kind: 'establishment', id: establishment.id }, onSelect) : 'нет отдельного заведения')}
      {row('Расположение', `квадрат ${entity.globalX}:${entity.globalY}`)}{row('История', entity.history.join(' '))}
    </>;
  }
  if (ref.kind === 'constructionProject') {
    const building = entity.buildingId ? world.buildings.find(item => item.id === entity.buildingId) : undefined;
    const materialLines = Object.entries(entity.requiredMaterials).map(([id, amount]) => `${itemTemplateName(world, id)} ${formatNumber(entity.deliveredMaterials[id] ?? 0)}/${formatNumber(amount as number)}`);
    return <>
      {row('Этап', entity.stage)}{row('Причина', entity.reason)}{row('Площадка', `квадрат ${entity.globalX}:${entity.globalY}, область ${entity.localX}:${entity.localY} — ${entity.localWidth}×${entity.localHeight}`)}
      {row('Материалы', materialLines.join('; '))}{row('Труд', `${Math.round(entity.laborDone)} / ${Math.round(entity.laborRequired)}`)}
      {row('Строители', links(world, entity.builderIds.slice(0, 18).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Начато', `${entity.startedYear}.${String(entity.startedMonth).padStart(2, '0')}`)}
      {building && row('Готовое здание', link(building.name, { kind: 'building', id: building.id }, onSelect))}
      {row('История', entity.history.join(' '))}
    </>;
  }
  if (ref.kind === 'cemetery') {
    const cemetery = entity as Cemetery;
    const burialRefs = cemetery.burialIds.slice(-80).reverse().map(id => ({ kind: 'burial' as const, id }));
    return <>
      {row('Поселение', cemetery.settlementId ? link(getTitle(world, { kind: 'settlement', id: cemetery.settlementId }), { kind: 'settlement', id: cemetery.settlementId }, onSelect) : 'вне поселения')}
      {row('Расположение', `квадрат ${cemetery.globalX}:${cemetery.globalY}, участок ${cemetery.localX}:${cemetery.localY}`)}
      {row('Основано', `${cemetery.foundedYear} год`)}
      {row('Погребено', `${cemeteryOccupancy(world, cemetery)} / ${cemetery.capacity}`)}
      {row('Смотритель', cemetery.caretakerCharacterId ? link(getTitle(world, { kind: 'character', id: cemetery.caretakerCharacterId }), { kind: 'character', id: cemetery.caretakerCharacterId }, onSelect) : 'нет постоянного смотрителя')}
      {row('Последние захоронения', links(world, burialRefs, onSelect))}
      {row('История', cemetery.history.join(' ') || 'Записей пока нет.')}
    </>;
  }
  if (ref.kind === 'burial' || entityIsBurial(entity)) {
    const burial = entity as BurialRecord;
    const cemetery = burial.cemeteryId ? world.cemeteries.find(item => item.id === burial.cemeteryId) : undefined;
    return <>
      {row('Статус', burialStateLabel(burial.state))}
      {row('Кого хранит запись', burial.subjectKind === 'character' ? 'личность' : burial.subjectKind === 'monster' ? 'чудовище' : 'неизвестные погибшие')}
      {row('Количество', burial.count)}
      {row('Вид', burial.species)}
      {burial.birthYear !== undefined && row('Годы жизни', `${burial.birthYear}–${burial.deathYear}`)}
      {row('Дата смерти', `${burial.deathYear}.${String(burial.deathMonth).padStart(2, '0')}`)}
      {row('Причина смерти', burial.cause)}
      {row('Убийца или виновник', burial.killerName ?? 'не установлен')}
      {burial.profession && row('При жизни', professionLabel(burial.profession))}
      {burial.tier && row('Ранг существа', monsterTierLabel(burial.tier))}
      {burial.power !== undefined && row('Сила при жизни', burial.power)}
      {burial.titles?.length > 0 && row('Титулы', burial.titles.join(', '))}
      {row('Известность', burial.renown)}
      {row('Кладбище', cemetery ? link(cemetery.name, { kind: 'cemetery', id: cemetery.id }, onSelect) : burial.state === 'corpse' ? 'ещё не перенесено' : 'вне кладбища')}
      {row('Место', `квадрат ${burial.globalX}:${burial.globalY}, клетка ${burial.localX}:${burial.localY}`)}
      {row('Сводка', burial.summary)}
      {row('Записи', burial.history.join(' ') || 'Дополнительных записей нет.')}
    </>;
  }
  if (ref.kind === 'building') {
    const settlementRef = { kind: 'settlement' as const, id: entity.settlementId };
    return <>
      {row('Поселение', link(getTitle(world, settlementRef), settlementRef, onSelect))}
      {row('Тип', buildingTypeLabel(entity.type))}{row('Район', entity.districtName)}
      {row('Положение', `квадрат ${entity.globalX}:${entity.globalY}, область ${entity.localX}:${entity.localY} — ${entity.localWidth}×${entity.localHeight} клеток`)}
      {row('Вход', `клетка ${entity.entranceX}:${entity.entranceY}`)}
      {row('Этажи', entity.floors)}{row('Вместимость', entity.capacity)}{row('Состояние', `${entity.condition}%`)}{row('Построено', `${entity.builtYear} год`)}
      {row('Вода', entity.hasWater ? 'есть' : 'нет')}{row('Очаг', entity.hasHearth ? 'есть' : 'нет')}
      {row('Владелец', entity.ownerCharacterId ? link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect) : 'община или власть')}
      {row('Домохозяйство', entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : 'нет')}
      {row('Заведение', entity.establishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.establishmentId }), { kind: 'establishment', id: entity.establishmentId }, onSelect) : 'нет')}
      {row('Жители', links(world, entity.residentIds.slice(0, 20).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Работники', links(world, entity.workerIds.slice(0, 20).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Предметы', links(world, entity.inventoryItemIds.slice(0, 24).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Помещения', entity.rooms.join(', ') || 'не описаны')}{row('История', entity.history.join(' ') || 'Заметных событий не было.')}
    </>;
  }
  if (ref.kind === 'household') {
    return <>
      {row('Глава', link(getTitle(world, { kind: 'character', id: entity.headCharacterId }), { kind: 'character', id: entity.headCharacterId }, onSelect))}
      {row('Члены', links(world, entity.memberIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Дом', entity.homeBuildingId ? link(getTitle(world, { kind: 'building', id: entity.homeBuildingId }), { kind: 'building', id: entity.homeBuildingId }, onSelect) : 'бездомные')}
      {row('Положение', entity.status)}{row('Богатство', `${Math.round(entity.wealth)} крон`)}{row('Долг', `${Math.round(entity.debt)} крон`)}
      {row('Доход в месяц', `${entity.monthlyIncome.toFixed(1)} крон`)}{row('Расходы в месяц', `${entity.monthlyExpenses.toFixed(1)} крон`)}
      {row('Запас еды', `${Math.round(entity.foodReserveDays)} дней`)}{row('Запас топлива', `${Math.round(entity.fuelReserveDays)} дней`)}
      {row('Потребности', `голод ${entity.needs.hunger}%, жажда ${entity.needs.thirst}%, усталость ${entity.needs.rest}%, холод ${entity.needs.warmth}%, безопасность ${entity.needs.safety}%, общение ${entity.needs.social}%`)}
      {row('Имущество', links(world, entity.inventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('История', entity.history.join(' ') || 'Дом ведёт обычную жизнь.')}
    </>;
  }
  if (ref.kind === 'establishment') {
    return <>
      {row('Тип', entity.type)}
      {row('Поселение', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Здание', link(getTitle(world, { kind: 'building', id: entity.buildingId }), { kind: 'building', id: entity.buildingId }, onSelect))}
      {row('Владелец', link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect))}
      {row('Работники', links(world, entity.workerIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Часы работы', `${String(entity.openHour).padStart(2, '0')}:00–${String(entity.closeHour).padStart(2, '0')}:00`)}
      {row('Состояние', entity.active ? 'работает' : 'закрыто')}{row('Репутация', `${entity.reputation}%`)}
      {row('Касса', `${entity.cash.toFixed(1)} крон`)}{row('Долг', `${entity.debt.toFixed(1)} крон`)}
      {row('Выручка за месяц', `${entity.monthlyRevenue.toFixed(1)} крон`)}{row('Расходы за месяц', `${entity.monthlyExpenses.toFixed(1)} крон`)}
      {row('Меню и цены', Object.entries(entity.menu).map(([template, price]) => `${itemTemplateName(world, template)} — ${Number(price).toFixed(1)}`).join(', ') || 'нет')}
      {row('Производство', links(world, entity.recipeIds.map((id: number) => ({ kind: 'productionRecipe' as const, id })), onSelect))}
      {row('Запасы', links(world, entity.inventoryItemIds.slice(0, 30).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Поставщики', links(world, entity.supplierEstablishmentIds.map((id: number) => ({ kind: 'establishment' as const, id })), onSelect))}
      {row('История', entity.history.join(' ') || 'Заметных событий не было.')}
    </>;
  }
  if (ref.kind === 'item') return <>
    {row('Категория', entity.category)}{row('Материал', entity.material)}{row('Количество', `${formatNumber(entity.quantity)} ${entity.unit}`)}
    {row('Вес', `${formatNumber(entity.quantity * entity.weightPerUnit)} ед.`)}{row('Качество', `${entity.quality}%`)}{row('Состояние', `${entity.condition}%`)}{row('Свежесть', `${entity.freshness}%`)}
    {row('Базовая стоимость', `${formatNumber(entity.baseValue * entity.quantity)} крон`)}{row('Создано', `${entity.createdYear} год`)}{row('Источник', entity.source)}
    {entity.equipmentSlot && row('Слот', entity.equipmentSlot)}{entity.dye && row('Цвет', entity.dye)}{entity.warmth !== undefined && row('Тепло', entity.warmth)}{entity.armor !== undefined && row('Защита', entity.armor)}{entity.damage !== undefined && row('Урон', entity.damage)}{entity.toolType && row('Назначение', entity.toolType)}
    {row('Создатель', entity.craftedByCharacterId ? link(getTitle(world, { kind: 'character', id: entity.craftedByCharacterId }), { kind: 'character', id: entity.craftedByCharacterId }, onSelect) : 'не указан')}
    {row('Владелец', entity.ownerCharacterId ? link(getTitle(world, { kind: 'character', id: entity.ownerCharacterId }), { kind: 'character', id: entity.ownerCharacterId }, onSelect) : entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : entity.establishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.establishmentId }), { kind: 'establishment', id: entity.establishmentId }, onSelect) : 'общий запас')}
    {row('Место', entity.buildingId ? link(getTitle(world, { kind: 'building', id: entity.buildingId }), { kind: 'building', id: entity.buildingId }, onSelect) : link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
    {row('История', entity.history.join(' ') || 'Обычная партия товара.')}
  </>;
  if (ref.kind === 'productionRecipe') return <>
    {row('Категория', entity.category)}{row('Профессия', professionLabel(entity.profession))}{row('Где производится', entity.establishmentTypes.join(', '))}
    {row('Вход', entity.inputs.map((input: any) => `${itemTemplateName(world, input.templateId)} × ${formatNumber(input.quantity)}`).join(', '))}
    {row('Выход', entity.outputs.map((output: any) => `${itemTemplateName(world, output.templateId)} × ${formatNumber(output.quantity)}`).join(', '))}
    {row('Топливо', entity.fuelTemplateId ? `${itemTemplateName(world, entity.fuelTemplateId)} × ${entity.fuelQuantity ?? 1}` : 'не требуется')}
    {row('Труд', `${entity.laborHours} ч.`)}{row('Минимальный навык', entity.minimumSkill)}{row('Культура', entity.culture ?? 'распространённый рецепт')}{row('Описание', entity.description)}
  </>;
  if (ref.kind === 'kingdom') {
    const diplomacy = entity.diplomacy.slice().sort((a: any, b: any) => a.score - b.score).slice(0, 5);
    const controlledTiles = world.tiles.filter(tile => tile.kingdomId === entity.id).length;
    return <>
      {row('Правитель', link(getTitle(world, { kind: 'character', id: entity.rulerId }), { kind: 'character', id: entity.rulerId }, onSelect))}
      {row('Государственная система', entity.governmentStateId ? link(getTitle(world, { kind: 'kingdomGovernment', id: entity.governmentStateId }), { kind: 'kingdomGovernment', id: entity.governmentStateId }, onSelect) : 'не оформлена')}
      {row('Правящий дом', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'не закреплён')}
      {row('Столица', link(getTitle(world, { kind: 'settlement', id: entity.capitalId }), { kind: 'settlement', id: entity.capitalId }, onSelect))}
      {row('Народ', speciesLabel(entity.species))}{row('Культура', entity.cultureId ? link(getTitle(world, { kind: 'culture', id: entity.cultureId }), { kind: 'culture', id: entity.cultureId }, onSelect) : entity.culture)}{row('Вера', entity.religionId ? link(getTitle(world, { kind: 'religion', id: entity.religionId }), { kind: 'religion', id: entity.religionId }, onSelect) : entity.religion)}{row('Официальный язык', entity.officialLanguageId ? link(getTitle(world, { kind: 'language', id: entity.officialLanguageId }), { kind: 'language', id: entity.officialLanguageId }, onSelect) : 'не закреплён')}
      {row('Стабильность', `${entity.stability}%`)}{row('Казна', `${Math.round(entity.treasury)} крон`)}{row('Войско', `${entity.armyStrength} воинов`)}
      {row('Контролируемые земли', `${controlledTiles} глобальных клеток`)}{row('Освоение', controlledTiles ? 'границы растут от поселений, дорог и гарнизонов' : 'контроль ещё не закреплён')}
      {row('Законы', entity.laws.join(', '))}
      {(() => { const ruler = world.characters.find(item => item.id === entity.rulerId); const incoming = world.messages.filter(item => item.recipientKingdomId === entity.id || item.toSettlementId === entity.capitalId); return <>{row('Сведения правителя', ruler?.knowledge ? links(world, ruler.knowledge.factIds.slice(-16).reverse().map((id: number) => ({ kind: 'knowledgeFact' as const, id })), onSelect) : 'нет')}{row('Донесения и письма', links(world, incoming.slice(-12).reverse().map(item => ({ kind: 'message' as const, id: item.id })), onSelect))}</>; })()}
      {row('Притязания', links(world, entity.claims.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}
      {row('Отношения', <span className="relationship-stack">{diplomacy.map((record: any) => <span key={record.kingdomId}>{link(getTitle(world, { kind: 'kingdom', id: record.kingdomId }), { kind: 'kingdom', id: record.kingdomId }, onSelect)}<small>{record.status}, {record.score}: {record.reason}</small></span>)}</span>)}
    </>;
  }
  if (ref.kind === 'settlement') return <>
    {row('Государство', link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect))}
    {row('Тип', settlementTypeLabel(entity.type))}{row('Население', `${entity.population} жителей`)}{row('Жилая вместимость', `${entity.residentialCapacity} мест`)}
    {row('Домохозяйства', entity.households)}{row('Глобальные квадраты', `${entity.districts.length} · ${entity.districts.map((item: any) => item.name).join(', ')}`)}{row('Ресурс', entity.resource)}
    {row('Благосостояние', `${entity.prosperity}%`)}{row('Защита', `${entity.defense}%`)}{row('Запасы пищи', entity.food)}
    {row('Беспорядки', `${entity.unrest}%`)}{row('Нехватка', entity.shortages.join(', ') || 'нет')}{row('Болезни', world.epidemics.filter(item => item.settlementId === entity.id && item.status !== 'завершено').map(item => `${item.name}: около ${item.infectedEstimate} больных, ${item.status}`).join('; ') || 'нет активных вспышек')}{row('Повреждения', `${entity.damaged}%`)}
    {(() => { const culture = world.settlementCultures.find(item => item.id === entity.cultureStateId || item.settlementId === entity.id); if (!culture) return null; const dominantCulture = world.cultures.find(item => item.id === culture.dominantCultureId); const dominantReligion = world.religions.find(item => item.id === culture.dominantReligionId); return <>{row('Главная культура', dominantCulture ? link(dominantCulture.name, { kind: 'culture', id: dominantCulture.id }, onSelect) : 'неизвестна')}{row('Культурный состав', culture.cultureShares.map(item => `${world.cultures.find(value => value.id === item.id)?.name ?? item.id}: ${item.share.toFixed(1)}%`).join('; '))}{row('Основная вера', dominantReligion ? link(dominantReligion.name, { kind: 'religion', id: dominantReligion.id }, onSelect) : 'неизвестна')}{row('Религиозный состав', culture.religionShares.map(item => `${world.religions.find(value => value.id === item.id)?.name ?? item.id}: ${item.share.toFixed(1)}%`).join('; '))}{row('Грамотность', `${Math.round(culture.literacy)}%`)}{row('Доступ к образованию', `${Math.round(culture.educationAccess)}%`)}{row('Культурная напряжённость', `${Math.round(culture.culturalTension)}%`)}{culture.activeFestival && row('Текущий праздник', culture.activeFestival)}</>; })()}
    {row('Пути', links(world, entity.tradeRouteIds.map((id: number) => ({ kind: 'tradeRoute' as const, id })), onSelect))}
    {row('Здания', links(world, (entity.buildingIds ?? []).slice(0, 30).map((id: number) => ({ kind: 'building' as const, id })), onSelect))}
    {row('Домохозяйства', links(world, (entity.householdIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'household' as const, id })), onSelect))}
    {row('Заведения', links(world, (entity.establishmentIds ?? []).slice(0, 24).map((id: number) => ({ kind: 'establishment' as const, id })), onSelect))}
    {entity.economy && row('Экономика', `денежная масса ${Math.round(entity.economy.coinSupply)} ${entity.economy.currency}, цены ×${entity.economy.priceIndex.toFixed(2)}, зарплаты ×${entity.economy.wageIndex.toFixed(2)}, аренда ×${entity.economy.rentIndex.toFixed(2)}, налог ${(entity.economy.taxRate * 100).toFixed(1)}%`)}
    {entity.economy && row('Торговля за месяц', `${entity.economy.lastMonthlyTrade.toFixed(1)} крон · банкротств ${entity.economy.bankruptcies}`)}
    {(() => { const knowledge = world.settlementKnowledge.find(item => item.settlementId === entity.id); return <>{row('Общие знания', knowledge ? links(world, knowledge.factIds.slice(-16).reverse().map((id: number) => ({ kind: 'knowledgeFact' as const, id })), onSelect) : 'нет')}{row('Подтверждённые сведения', knowledge?.verifiedFactIds.length ?? 0)}{row('Ходящие слухи', knowledge ? links(world, knowledge.rumorIds.slice(-12).reverse().map((id: number) => ({ kind: 'rumor' as const, id })), onSelect) : 'нет')}{row('Почта', links(world, world.messages.filter(item => item.fromSettlementId === entity.id || item.toSettlementId === entity.id).slice(-12).reverse().map(item => ({ kind: 'message' as const, id: item.id })), onSelect))}</>; })()}
    {row('Постройки по старому учёту', entity.buildings.join(', '))}{row('Склад', Object.entries(entity.stockpile).filter(([, value]) => Number(value) > 0).slice(0, 18).map(([name, value]) => `${name}: ${Math.round(Number(value))}`).join(', ') || 'пусто')}{row('Скот', Object.entries(entity.livestock).map(([name, value]) => `${name}: ${value}`).join(', ') || 'нет')}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'character') {
    const relationships = world.relationships.filter(relation => entity.relationshipIds.includes(relation.id)).slice(0, 10);
    return <>
      {row('Состояние', entity.alive ? `${entity.age} лет` : `умер в ${entity.deathYear} году`)}{row('Вид', speciesLabel(entity.species))}{row('Пол', entity.sex === 'female' ? 'женский' : entity.sex === 'male' ? 'мужской' : 'не указан')}
      {entity.cultureProfile && row('Культура', link(getTitle(world, { kind: 'culture', id: entity.cultureProfile.cultureId }), { kind: 'culture', id: entity.cultureProfile.cultureId }, onSelect))}{entity.cultureProfile && row('Вера', link(getTitle(world, { kind: 'religion', id: entity.cultureProfile.religionId }), { kind: 'religion', id: entity.cultureProfile.religionId }, onSelect))}{entity.cultureProfile && row('Языки', entity.cultureProfile.languages.map((value: any) => `${getTitle(world, { kind: 'language', id: value.languageId })} ${Math.round(value.fluency)}%`).join(', '))}{entity.cultureProfile && row('Образование', `${entity.cultureProfile.education} · грамотность ${Math.round(entity.cultureProfile.literacy)}% · религиозность ${Math.round(entity.cultureProfile.devotion)}%`)}
      {row('Профессия', professionLabel(entity.profession))}{row('Рабочее место', entity.workplace)}{row('Домашний район', entity.homeDistrict ?? 'не закреплён')}{row('Родина', link(getTitle(world, { kind: 'settlement', id: entity.settlementId }), { kind: 'settlement', id: entity.settlementId }, onSelect))}
      {row('Домохозяйство', entity.householdId ? link(getTitle(world, { kind: 'household', id: entity.householdId }), { kind: 'household', id: entity.householdId }, onSelect) : 'не закреплено')}
      {row('Дом', entity.homeBuildingId ? link(getTitle(world, { kind: 'building', id: entity.homeBuildingId }), { kind: 'building', id: entity.homeBuildingId }, onSelect) : 'нет постоянного жилья')}
      {row('Место работы', entity.workplaceBuildingId ? link(getTitle(world, { kind: 'building', id: entity.workplaceBuildingId }), { kind: 'building', id: entity.workplaceBuildingId }, onSelect) : 'не закреплено')}
      {row('Работодатель', entity.employerEstablishmentId ? link(getTitle(world, { kind: 'establishment', id: entity.employerEstablishmentId }), { kind: 'establishment', id: entity.employerEstablishmentId }, onSelect) : 'самостоятельный труд или нет работы')}
      {row('Династия', entity.dynastyId ? link(getTitle(world, { kind: 'dynasty', id: entity.dynastyId }), { kind: 'dynasty', id: entity.dynastyId }, onSelect) : 'нет')}
      {row('Супруг', entity.spouseId ? link(getTitle(world, { kind: 'character', id: entity.spouseId }), { kind: 'character', id: entity.spouseId }, onSelect) : 'нет')}
      {row('Родители', links(world, entity.parentIds.map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Дети', links(world, entity.childIds.slice(0, 12).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
      {row('Известность', entity.renown)}{row('Здоровье', `${entity.health}%`)}{entity.healthProfile && row('Состояние тела', `${entity.healthProfile.lifeStage} · хрупкость ${Math.round(entity.healthProfile.frailty)}% · иммунитет ${Math.round(entity.healthProfile.immunity)}%`)}{row('Богатство', `${Math.round(entity.wealth)} крон`)}{row('Верность', `${entity.loyalty}%`)}
      {row('Цель', entity.ambition)}{row('Титулы', entity.titles.join(', ') || 'нет')}{row('Политическое влияние', `${Math.round(entity.politicalInfluence ?? 0)}%`)}
      {entity.mind && row('Черты', Object.entries(entity.mind.traits).sort((a: any, b: any) => Number(b[1]) - Number(a[1])).map(([key, value]) => `${mindLabel(key)} ${Math.round(Number(value))}`).join(', '))}
      {entity.mind && row('Ценности', Object.entries(entity.mind.values).sort((a: any, b: any) => Number(b[1]) - Number(a[1])).map(([key, value]) => `${mindLabel(key)} ${Math.round(Number(value))}`).join(', '))}
      {entity.mind && row('Эмоции', `страх ${Math.round(entity.mind.emotions.fear)}, злость ${Math.round(entity.mind.emotions.anger)}, горе ${Math.round(entity.mind.emotions.grief)}, надежда ${Math.round(entity.mind.emotions.hope)}, стресс ${Math.round(entity.mind.emotions.stress)}, удовлетворённость ${Math.round(entity.mind.emotions.contentment)}`)}
      {entity.mind && row('Активные цели', entity.mind.goals.filter((goal: any) => goal.status === 'active').map((goal: any) => `${mindLabel(goal.kind)} ${Math.round(goal.priority)}: ${goal.reason}`).join('; ') || 'нет')}
      {entity.mind && row('Обязательства', entity.mind.obligations.map((item: any) => `${mindLabel(item.kind)} ${Math.round(item.strength)}: ${item.reason}`).join('; ') || 'нет')}
      {row('Личные долги и обещания', world.socialObligations.filter(item => item.status === 'active' && (item.debtorCharacterId === entity.id || item.creditorCharacterId === entity.id)).slice(-10).map(item => `${item.debtorCharacterId === entity.id ? 'должен' : 'ожидает от'} ${getTitle(world, { kind: 'character', id: item.debtorCharacterId === entity.id ? item.creditorCharacterId : item.debtorCharacterId })}: ${mindLabel(item.kind)}${item.amount > 0 ? ` ${item.amount.toFixed(1)} крон` : ''} — ${item.reason}`).join('; ') || 'нет')}
      {entity.mind && row('Репутация', entity.mind.reputations.map((item: any) => `${mindLabel(item.group)} ${item.score}`).join(', ') || 'не сложилась')}
      {entity.mind && row('Тайны', entity.mind.secrets.filter((item: any) => !item.exposed).map((item: any) => `${item.summary} [${item.severity}]`).join('; ') || 'неизвестны')}
      {row('Последние решения', world.decisions.filter(item => item.actorRef.kind === 'character' && item.actorRef.id === entity.id).slice(-6).reverse().map(item => `${Math.floor(item.tick / 12) + 1}.${String(item.tick % 12 + 1).padStart(2, '0')} — ${item.goal}: ${item.reason}`).join('; ') || 'нет зафиксированных решений')}
      {row('Земельные титулы', links(world, (entity.nobleTitleIds ?? []).map((id: number) => ({ kind: 'nobleTitle' as const, id })), onSelect))}
      {row('Придворные должности', links(world, (entity.courtOfficeIds ?? []).map((id: number) => ({ kind: 'courtOffice' as const, id })), onSelect))}
      {row('Группировка', entity.courtFactionId ? link(getTitle(world, { kind: 'courtFaction', id: entity.courtFactionId }), { kind: 'courtFaction', id: entity.courtFactionId }, onSelect) : 'не состоит')}
      {row('Травмы', entity.injuries.join(', ') || 'нет')}{entity.healthProfile && row('Активные болезни и травмы', entity.healthProfile.activeConditionIds.map((id: number) => world.healthConditions.find(item => item.id === id)).filter(Boolean).map((item: any) => `${item.name} ${Math.round(item.severity)}%${item.treated ? ' · лечится' : ''}`).join('; ') || 'нет')}{entity.healthProfile?.pregnancyId && row('Беременность', (() => { const pregnancy = world.pregnancies.find(item => item.id === entity.healthProfile?.pregnancyId); return pregnancy ? `срок ${Math.max(0, pregnancy.dueTick - (world.year * 12 + world.month - 1))} мес. · риск ${Math.round(pregnancy.risk)}%` : 'данные не найдены'; })())}
      {entity.schedule && row('Распорядок', `подъём ${entity.schedule.wakeHour}:00, работа ${entity.schedule.workStartHour}:00–${entity.schedule.workEndHour}:00, сон ${entity.schedule.sleepHour}:00, выходной день ${entity.schedule.restDay}; сейчас ${entity.schedule.currentActivity}`)}
      {entity.needs && row('Потребности', `голод ${Math.round(entity.needs.hunger)}%, жажда ${Math.round(entity.needs.thirst)}%, усталость ${Math.round(entity.needs.rest)}%, холод ${Math.round(entity.needs.warmth)}%, безопасность ${Math.round(entity.needs.safety)}%, общение ${Math.round(entity.needs.social)}%`)}
      {row('Личный кошелёк', `${Math.round((entity.wallet ?? 0) * 10) / 10} крон`)}
      {entity.equipment && row('Одежда', `${entity.equipment.socialTier} · ${entity.equipment.material} · ${entity.equipment.color} · состояние ${Math.round(entity.equipment.condition)}%`)}
      {entity.equipment && row('Экипировка', links(world, Object.values(entity.equipment.equippedItemIds ?? {}).filter((id): id is number => typeof id === 'number').map(id => ({ kind: 'item' as const, id })), onSelect))}
      {entity.serviceStatus && entity.serviceStatus !== 'гражданский' && row('Военная служба', `${entity.serviceStatus}${entity.militaryRole ? ` · ${entity.militaryRole}` : ''}`)}
      {entity.serviceStatus === 'пленник' && row('Военный плен', entity.capturedByKingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.capturedByKingdomId }), { kind: 'kingdom', id: entity.capturedByKingdomId }, onSelect) : 'неизвестная сторона')}
      {entity.prisonerOfBattleId && row('Пленён в', link(getTitle(world, { kind: 'battleRecord', id: entity.prisonerOfBattleId }), { kind: 'battleRecord', id: entity.prisonerOfBattleId }, onSelect))}
      {entity.militaryUnitId && row('Подразделение', link(getTitle(world, { kind: 'militaryUnit', id: entity.militaryUnitId }), { kind: 'militaryUnit', id: entity.militaryUnitId }, onSelect))}
      {typeof entity.militaryExperience === 'number' && row('Военный опыт', `${Math.round(entity.militaryExperience)}%`)}
      {(entity.servicePayArrears ?? 0) > 0 && row('Невыплаченное жалование', `${Math.round(entity.servicePayArrears)} крон`)}
      {entity.skills && row('Навыки', Object.entries(entity.skills).sort((a: any, b: any) => Number(b[1]) - Number(a[1])).slice(0, 10).map(([name, value]) => `${professionLabel(name)} ${value}`).join(', ') || 'нет развитых навыков')}
      {row('Личные вещи', links(world, (entity.inventoryItemIds ?? []).slice(0, 20).map((id: number) => ({ kind: 'item' as const, id })), onSelect))}
      {row('Отношения', relationships.length ? <span className="relationship-stack">{relationships.map(relation => relationshipText(world, entity.id, relation, onSelect))}</span> : 'нет заметных связей')}
      {entity.knowledge && row('Известные факты', links(world, entity.knowledge.factIds.slice(-18).reverse().map((id: number) => ({ kind: 'knowledgeFact' as const, id })), onSelect))}
      {entity.knowledge && row('Важные воспоминания', entity.knowledge.memoryIds.slice(-10).reverse().map((id: number) => world.memories.find(item => item.id === id)).filter(Boolean).map((memory: any) => `${memory.summary} (${memory.confidence}%)`).join('; ') || 'нет')}
      {entity.knowledge && row('Личные мнения', <span className="relationship-stack">{entity.knowledge.opinions.slice(-8).map((opinion: any, index: number) => <span key={`${opinion.target.kind}-${opinion.target.id}-${index}`}>{link(getTitle(world, opinion.target), opinion.target, onSelect)}<small>доверие {opinion.trust}, страх {opinion.fear}, уважение {opinion.respect}: {opinion.reason}</small></span>)}</span>)}
      {row('Биография', entity.biography.join(' '))}
    </>;
  }
  if (ref.kind === 'monster') return <>
    {row('Вид', monsterSpeciesLabel(entity.species))}{row('Ранг', monsterTierLabel(entity.tier))}{row('Состояние', entity.alive ? 'живо' : 'мертво')}
    {row('Поведение', entity.behavior)}{row('Цель', entity.goal)}{row('Голод', `${entity.hunger}%`)}{row('Территория', `${entity.territoryRadius} клеток`)}{row('Физический размер', `${entity.footprintWidth ?? 1}×${entity.footprintHeight ?? 1} локальных клеток`)}
    {row('Сила', entity.power)}{row('Здоровье', entity.health)}{row('Возраст', `${entity.age} лет`)}{row('Жертвы', entity.kills)}{row('Сокровища', entity.hoard)}
    {row('Логово', entity.lairDungeonId ? link(getTitle(world, { kind: 'dungeon', id: entity.lairDungeonId }), { kind: 'dungeon', id: entity.lairDungeonId }, onSelect) : 'нет')}
    {row('История', entity.history.join(' ') || 'Пока не оставило заметного следа.')}
  </>;
  if (ref.kind === 'artifact') return <>
    {row('Тип', artifactTypeLabel(entity.type))}{row('Материал', materialLabel(entity.material))}{row('Создан', `${entity.yearCreated} год`)}{row('Изображение', entity.depiction)}{row('Сила', entity.power)}
    {row('Создатель', entity.creatorId ? link(getTitle(world, { kind: 'character', id: entity.creatorId }), { kind: 'character', id: entity.creatorId }, onSelect) : 'неизвестен')}
    {row('Владелец', entity.ownerId ? link(getTitle(world, { kind: 'character', id: entity.ownerId }), { kind: 'character', id: entity.ownerId }, onSelect) : 'утерян')}
    {row('Цепочка владения', entity.ownerHistory.map((record: any) => `${record.year}: ${record.characterId ? getTitle(world, { kind: 'character', id: record.characterId }) : 'неизвестно'} — ${record.reason}`).join('; '))}
    {row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'book') return <>
    {row('Автор', link(getTitle(world, { kind: 'character', id: entity.authorId }), { kind: 'character', id: entity.authorId }, onSelect))}{row('Год', entity.yearWritten)}
    {row('Язык', entity.language)}{row('Тема', entity.subject)}{row('Достоверность', `${entity.reliability}%`)}{row('Предвзятость', entity.bias)}{row('Копии', entity.copies)}
    {row('Связанные события', entity.referencedEventIds.length)}{row('Содержание', entity.summary)}
  </>;
  if (ref.kind === 'dungeon') return <>
    {row('Происхождение', entity.origin)}{row('Первоначальная цель', entity.purpose)}{row('Построено', `${entity.builtYear} год`)}{row('Известно миру', entity.discovered ? 'да' : 'нет')}
    {row('Опасность', `${entity.danger}/10`)}{row('Глубина', `${entity.depth} уровней`)}{row('Обитатели', entity.currentInhabitants)}
    {row('Владелец земель', entity.ownerKingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.ownerKingdomId }), { kind: 'kingdom', id: entity.ownerKingdomId }, onSelect) : 'никто')}
    {row('Артефакты', links(world, entity.artifactIds.map((id: number) => ({ kind: 'artifact' as const, id })), onSelect))}{row('История', entity.history.join(' ') || 'История места ещё скрыта.')}
  </>;
  if (ref.kind === 'war') return <>
    {row('Нападающая сторона', link(getTitle(world, { kind: 'kingdom', id: entity.attackerId }), { kind: 'kingdom', id: entity.attackerId }, onSelect))}
    {row('Защитники', link(getTitle(world, { kind: 'kingdom', id: entity.defenderId }), { kind: 'kingdom', id: entity.defenderId }, onSelect))}
    {row('Причина', entity.cause)}{row('Цель', entity.goal)}{row('Спорные земли', links(world, entity.contestedSettlementIds.map((id: number) => ({ kind: 'settlement' as const, id })), onSelect))}
    {row('Начало', entity.startYear)}{row('Конец', entity.endYear ?? 'война идёт')}{row('Победитель', entity.victorId ? link(getTitle(world, { kind: 'kingdom', id: entity.victorId }), { kind: 'kingdom', id: entity.victorId }, onSelect) : 'не определён')}
    {row('Мирные условия', entity.peaceTerms ?? 'не заключены')}{row('Сражения', entity.battles)}{row('Потери атакующих', entity.attackerLosses)}{row('Потери защитников', entity.defenderLosses)}
    {row('Ход войны', entity.history.join(' '))}
  </>;
  if (ref.kind === 'dynasty') return <>
    {row('Основатель', link(getTitle(world, { kind: 'character', id: entity.founderId }), { kind: 'character', id: entity.founderId }, onSelect))}
    {row('Глава дома', link(getTitle(world, { kind: 'character', id: entity.currentHeadId }), { kind: 'character', id: entity.currentHeadId }, onSelect))}
    {row('Государство', entity.kingdomId ? link(getTitle(world, { kind: 'kingdom', id: entity.kingdomId }), { kind: 'kingdom', id: entity.kingdomId }, onSelect) : 'нет')}
    {row('Члены', links(world, entity.memberIds.slice(0, 18).map((id: number) => ({ kind: 'character' as const, id })), onSelect))}
    {row('Престиж', entity.prestige)}{row('Богатство', `${entity.wealth} крон`)}
    {row('Притязания', links(world, entity.claimKingdomIds.map((id: number) => ({ kind: 'kingdom' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'tradeRoute') return <>
    {row('Начало', link(getTitle(world, { kind: 'settlement', id: entity.fromSettlementId }), { kind: 'settlement', id: entity.fromSettlementId }, onSelect))}
    {row('Конец', link(getTitle(world, { kind: 'settlement', id: entity.toSettlementId }), { kind: 'settlement', id: entity.toSettlementId }, onSelect))}
    {row('Товары', entity.goods.join(', '))}{row('Объём', entity.volume)}{row('Безопасность', `${entity.safety}%`)}{row('Состояние', entity.active ? 'действует' : 'закрыт')}
    {row('Контроль', links(world, entity.controlledByKingdomIds.map((id: number) => ({ kind: 'kingdom' as const, id })), onSelect))}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'animalPopulation') return <>
    {row('Вид', entity.species)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Численность', `${entity.count} особей`)}{row('Вместимость биома', entity.carryingCapacity)}
    {row('Питание', entity.diet)}{row('Добыча', entity.preySpecies.join(', ') || 'растительность и падаль')}{row('Хищники', entity.predatorSpecies.join(', ') || 'нет обычных хищников')}
    {row('Здоровье', `${entity.health}%`)}{row('Размножение', entity.reproductionRate)}{row('Миграционное давление', `${entity.migrationDrive}%`)}{row('Добыто охотой за год', entity.huntedThisYear)}
    {row('Последняя причина изменения', entity.lastCause)}{row('История', entity.history.join(' ') || 'Заметных событий не было.')}
  </>;
  if (ref.kind === 'ingredient') return <>
    {row('Тип', entity.kind)}{row('Координаты', `${entity.x}:${entity.y}`)}{row('Запас', Math.round(entity.abundance))}{row('Предел восстановления', entity.carryingCapacity)}
    {row('Скорость восстановления', entity.regenerationRate)}{row('Сезон', entity.seasonMonths.join(', '))}{row('Свойства', entity.properties.join(', '))}{row('Токсичность', `${entity.toxicity}%`)}
    {row('Собрано за год', entity.harvestedThisYear)}{row('История', entity.history.join(' '))}
  </>;
  if (ref.kind === 'recipe') return <>
    {row('Результат', entity.result)}{row('Эффект', entity.effect)}{row('Риск', entity.risk)}{row('Открыт', `${entity.discoveryYear} год`)}
    {row('Открыватель', entity.discoveredById ? link(getTitle(world, { kind: 'character', id: entity.discoveredById }), { kind: 'character', id: entity.discoveredById }, onSelect) : 'неизвестен')}
    {row('Ингредиенты', links(world, entity.ingredientIds.map((id: number) => ({ kind: 'ingredient' as const, id })), onSelect))}{row('Источник знания', entity.source)}{row('Создано партий', entity.batchesCreated)}{row('История', entity.history.join(' '))}
  </>;
  return null;
}
