import { useMemo, useState } from 'react';
import type { EntityKind, EntityRef, WorldState } from '../types';
import { armyStatusLabel, buildingTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel, professionLabel, settlementTypeLabel, speciesLabel } from '../i18n';
import { getTitle } from './EntityPanel';
import { TextureIcon } from './TextureIcon';

const groups: { kind: EntityKind; label: string }[] = [
  { kind: 'character', label: 'Живые личности' }, { kind: 'household', label: 'Домохозяйства' }, { kind: 'settlement', label: 'Поселения' }, { kind: 'building', label: 'Здания' }, { kind: 'establishment', label: 'Заведения' }, { kind: 'item', label: 'Предметы' }, { kind: 'productionRecipe', label: 'Рецепты производства' }, { kind: 'field', label: 'Поля' }, { kind: 'constructionProject', label: 'Стройки' }, { kind: 'dynasty', label: 'Династии' }, { kind: 'kingdom', label: 'Государства' },
  { kind: 'monster', label: 'Живые существа' }, { kind: 'burial', label: 'Умершие и павшие' }, { kind: 'cemetery', label: 'Кладбища' }, { kind: 'artifact', label: 'Артефакты' }, { kind: 'book', label: 'Книги' },
  { kind: 'dungeon', label: 'Подземелья' }, { kind: 'animalPopulation', label: 'Животные' }, { kind: 'ingredient', label: 'Ресурсы' }, { kind: 'recipe', label: 'Алхимия' },
  { kind: 'settlementGovernment', label: 'Местная власть' }, { kind: 'districtCivic', label: 'Районы и службы' }, { kind: 'patrol', label: 'Патрули' }, { kind: 'crime', label: 'Преступления' }, { kind: 'courtCase', label: 'Судебные дела' }, { kind: 'fireIncident', label: 'Пожары' },
  { kind: 'knowledgeFact', label: 'Знания' }, { kind: 'rumor', label: 'Слухи' }, { kind: 'message', label: 'Письма и донесения' },
  { kind: 'tradeRoute', label: 'Торговые пути' }, { kind: 'travelingMerchant', label: 'Странствующие торговцы' }, { kind: 'army', label: 'Армии' }, { kind: 'militaryUnit', label: 'Военные подразделения' }, { kind: 'supplyWagon', label: 'Военные обозы' }, { kind: 'war', label: 'Войны' },
];

function listFor(world: WorldState, kind: EntityKind): any[] {
  const lists: Record<EntityKind, any[]> = {
    character: world.characters, settlement: world.settlements, kingdom: world.kingdoms, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, army: world.armies, war: world.wars,
    dynasty: world.dynasties, tradeRoute: world.tradeRoutes, animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes, building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes, field: world.fields, constructionProject: world.constructionProjects, cemetery: world.cemeteries, burial: world.burials, travelingMerchant: world.travelingMerchants, militaryUnit: world.militaryUnits, supplyWagon: world.supplyWagons, knowledgeFact: world.knowledgeFacts, rumor: world.rumors, message: world.messages, settlementGovernment: world.settlementGovernments, districtCivic: world.districtCivicStates, patrol: world.civicPatrols, crime: world.crimes, courtCase: world.courtCases, fireIncident: world.fireIncidents,
  };
  return lists[kind];
}

export function Encyclopedia({ world, onSelect }: { world: WorldState; onSelect: (ref: EntityRef) => void }) {
  const [kind, setKind] = useState<EntityKind>('character');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return listFor(world, kind).filter(item => !normalized || getTitle(world, { kind, id: item.id }).toLowerCase().includes(normalized)).slice(0, 220);
  }, [world, kind, query]);
  return <div className="encyclopedia">
    <div className="search-box"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти имя, место или книгу…" /></div>
    <div className="chip-row">{groups.map(group => <button className={kind === group.kind ? 'chip active' : 'chip'} key={group.kind} onClick={() => setKind(group.kind)}>{group.label}<small>{listFor(world, group.kind).length}</small></button>)}</div>
    <div className="entity-list">{rows.map(item => {
      const ref: EntityRef = { kind, id: item.id };
      return <button key={item.id} className="entity-card" onClick={() => onSelect(ref)}>
        <TextureIcon kind={kind} subtype={kind === 'monster' ? item.species : undefined} className="entity-rune" />
        <span><strong>{getTitle(world, ref)}</strong><small>{subtitle(kind, item)}</small></span>
      </button>;
    })}</div>
  </div>;
}

function rune(kind: EntityKind): string {
  return ({ monster: '△', book: '▤', artifact: '✦', settlement: '⌂', dynasty: '♜', tradeRoute: '⌁', war: '⚔', army: '♙', dungeon: '▣', kingdom: '♛', character: '◇', animalPopulation: '◌', ingredient: '❧', recipe: '⚗', building: '▦', household: '⌂', establishment: '☕', item: '◆', productionRecipe: '⚒', field: '▥', constructionProject: '▧', cemetery: '†', burial: '✝', travelingMerchant: '♢', militaryUnit: '♞', supplyWagon: '▰', knowledgeFact: '◈', rumor: '≈', message: '✉', settlementGovernment: '⚖', districtCivic: '▦', patrol: '♙', crime: '!', courtCase: '§', fireIncident: '♨' } as Record<EntityKind, string>)[kind];
}

function subtitle(kind: EntityKind, item: any): string {
  if (kind === 'building') return `${buildingTypeLabel(item.type)} · ${item.rooms.length} помещений · состояние ${item.condition}%`;
  if (kind === 'household') return `${item.memberIds.length} жителей · ${item.status} · запас еды ${Math.round(item.foodReserveDays)} дней`;
  if (kind === 'establishment') return `${item.type} · ${item.workerIds.length} работников · репутация ${item.reputation}%`;
  if (kind === 'item') return `${item.category} · ${Number(item.quantity).toFixed(item.quantity < 10 ? 1 : 0)} ${item.unit} · качество ${item.quality}%`;
  if (kind === 'productionRecipe') return `${item.category} · ${professionLabel(item.profession)} · ${item.outputs.length} результата`;
  if (kind === 'field') return `${item.crop} · ${item.state} · ${item.cells.length} клеток`;
  if (kind === 'constructionProject') return `${item.stage} · труд ${Math.round(item.laborDone)}/${Math.round(item.laborRequired)}`;
  if (kind === 'character') return `${speciesLabel(item.species)} · ${professionLabel(item.profession)} · ${item.alive ? `${item.age} лет` : 'мёртв'}`;
  if (kind === 'settlement') return `${settlementTypeLabel(item.type)} · ${item.population} жителей · ${item.resource}`;
  if (kind === 'kingdom') return `${speciesLabel(item.species)} · ${item.culture} · стабильность ${item.stability}%`;
  if (kind === 'monster') return `${monsterSpeciesLabel(item.species)} · ${monsterTierLabel(item.tier)} · живо`;
  if (kind === 'burial') return `${item.subjectKind === 'monster' ? 'павшее существо' : item.subjectKind === 'anonymous' ? `${item.count} погибших` : 'умерший'} · ${item.deathYear} год · ${item.state}`;
  if (kind === 'cemetery') return `${item.burialIds.length} записей · вместимость ${item.capacity}`;
  if (kind === 'artifact') return `${materialLabel(item.material)} · сила ${item.power}`;
  if (kind === 'book') return `${item.subject} · ${item.copies} копий`;
  if (kind === 'dungeon') return `${item.origin} · опасность ${item.danger}/10`;
  if (kind === 'army') return `${item.soldierIds?.length ?? item.strength} воинов · готовность ${Math.round(item.readiness ?? 0)}% · ${armyStatusLabel(item.status)}`;
  if (kind === 'militaryUnit') return `${item.type} · ${item.memberIds.length} бойцов · подготовка ${Math.round(item.training)}%`;
  if (kind === 'supplyWagon') return `${item.wagonCount} повозок · ${item.horseCount} лошадей · ${item.status}`;
  if (kind === 'war') return item.active ? `${item.goal} · война продолжается` : `окончена в ${item.endYear} году`;
  if (kind === 'dynasty') return `${item.memberIds.length} членов · престиж ${item.prestige}`;
  if (kind === 'travelingMerchant') return `${item.status} · ${Math.round(item.cash)} крон · ${item.routeSettlementIds.length} остановки`;
  if (kind === 'settlementGovernment') return `казна ${Math.round(item.treasury)} · стража ${item.guardIds.length} · коррупция ${Math.round(item.corruption)}%`;
  if (kind === 'districtCivic') return `безопасность ${Math.round(item.safety)}% · чистота ${Math.round(item.cleanliness)}% · преступность ${Math.round(item.crimeRate)}%`;
  if (kind === 'patrol') return `${item.shift} смена · ${item.guardIds.length} стражников · ${item.status}`;
  if (kind === 'crime') return `${item.type} · ${item.status} · тяжесть ${item.severity}`;
  if (kind === 'courtCase') return `${item.status} · ${item.verdict ?? 'решение не вынесено'}`;
  if (kind === 'fireIncident') return `${item.status} · интенсивность ${Math.round(item.intensity)}% · зданий ${item.affectedBuildingIds.length}`;
  if (kind === 'knowledgeFact') return `${item.topic} · достоверность ${Math.round(item.truth)}% · ${item.verified ? 'подтверждено' : 'не подтверждено'}`;
  if (kind === 'rumor') return `${item.status} · уверенность ${Math.round(item.confidence)}% · искажение ${Math.round(item.distortion)}%`;
  if (kind === 'message') return `${item.kind} · ${item.status} · надёжность ${Math.round(item.reliability)}%`;
  if (kind === 'tradeRoute') return `${item.goods.join(', ')} · безопасность ${item.safety}% · ${item.active ? 'открыт' : 'закрыт'}`;
  if (kind === 'animalPopulation') return `${item.count} особей · ${item.diet} · клетка ${item.x}:${item.y}`;
  if (kind === 'ingredient') return `${item.kind} · запас ${Math.round(item.abundance)} · клетка ${item.x}:${item.y}`;
  if (kind === 'recipe') return `${item.result} · создано партий ${item.batchesCreated}`;
  return '';
}
