import { useMemo, useState } from 'react';
import type { EntityKind, EntityRef, WorldState } from '../types';
import { armyStatusLabel, buildingTypeLabel, materialLabel, monsterSpeciesLabel, monsterTierLabel, professionLabel, settlementTypeLabel, speciesLabel } from '../i18n';
import { getTitle } from './EntityPanel';
import { TextureIcon } from './TextureIcon';

const groups: { kind: EntityKind; label: string }[] = [
  { kind: 'character', label: 'Живые личности' }, { kind: 'household', label: 'Домохозяйства' }, { kind: 'settlement', label: 'Поселения' }, { kind: 'building', label: 'Здания' }, { kind: 'establishment', label: 'Заведения' }, { kind: 'item', label: 'Предметы' }, { kind: 'productionRecipe', label: 'Рецепты производства' }, { kind: 'field', label: 'Поля' }, { kind: 'constructionProject', label: 'Стройки' }, { kind: 'dynasty', label: 'Династии' }, { kind: 'kingdom', label: 'Государства' },
  { kind: 'monster', label: 'Живые существа' }, { kind: 'burial', label: 'Умершие и павшие' }, { kind: 'cemetery', label: 'Кладбища' }, { kind: 'artifact', label: 'Артефакты' }, { kind: 'book', label: 'Книги' },
  { kind: 'dungeon', label: 'Подземелья' }, { kind: 'animalPopulation', label: 'Животные' }, { kind: 'ingredient', label: 'Ресурсы' }, { kind: 'recipe', label: 'Алхимия' },
  { kind: 'tradeRoute', label: 'Торговые пути' }, { kind: 'travelingMerchant', label: 'Странствующие торговцы' }, { kind: 'army', label: 'Армии' }, { kind: 'war', label: 'Войны' },
];

function listFor(world: WorldState, kind: EntityKind): any[] {
  const lists: Record<EntityKind, any[]> = {
    character: world.characters, settlement: world.settlements, kingdom: world.kingdoms, monster: world.monsters,
    artifact: world.artifacts, book: world.books, dungeon: world.dungeons, army: world.armies, war: world.wars,
    dynasty: world.dynasties, tradeRoute: world.tradeRoutes, animalPopulation: world.animalPopulations, ingredient: world.ingredients, recipe: world.alchemyRecipes, building: world.buildings, household: world.households, establishment: world.establishments, item: world.items, productionRecipe: world.productionRecipes, field: world.fields, constructionProject: world.constructionProjects, cemetery: world.cemeteries, burial: world.burials, travelingMerchant: world.travelingMerchants,
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
  return ({ monster: '△', book: '▤', artifact: '✦', settlement: '⌂', dynasty: '♜', tradeRoute: '⌁', war: '⚔', army: '♙', dungeon: '▣', kingdom: '♛', character: '◇', animalPopulation: '◌', ingredient: '❧', recipe: '⚗', building: '▦', household: '⌂', establishment: '☕', item: '◆', productionRecipe: '⚒', field: '▥', constructionProject: '▧', cemetery: '†', burial: '✝', travelingMerchant: '♢' } as Record<EntityKind, string>)[kind];
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
  if (kind === 'army') return `${item.strength} воинов · ${armyStatusLabel(item.status)}`;
  if (kind === 'war') return item.active ? `${item.goal} · война продолжается` : `окончена в ${item.endYear} году`;
  if (kind === 'dynasty') return `${item.memberIds.length} членов · престиж ${item.prestige}`;
  if (kind === 'travelingMerchant') return `${item.status} · ${Math.round(item.cash)} крон · ${item.routeSettlementIds.length} остановки`;
  if (kind === 'tradeRoute') return `${item.goods.join(', ')} · безопасность ${item.safety}% · ${item.active ? 'открыт' : 'закрыт'}`;
  if (kind === 'animalPopulation') return `${item.count} особей · ${item.diet} · клетка ${item.x}:${item.y}`;
  if (kind === 'ingredient') return `${item.kind} · запас ${Math.round(item.abundance)} · клетка ${item.x}:${item.y}`;
  if (kind === 'recipe') return `${item.result} · создано партий ${item.batchesCreated}`;
  return '';
}
