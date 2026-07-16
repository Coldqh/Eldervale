import type { EntityKind, WorldState } from '../types';
import { buildingTypeLabel, monsterSpeciesLabel } from '../i18n';

export interface ArchiveCatalogRow {
  key: string;
  kind: EntityKind;
  representativeId: number;
  title: string;
  subtitle: string;
  subtype?: string;
  entries: number;
  total: number;
}

export const aggregatedArchiveKinds = new Set<EntityKind>([
  'animalPopulation', 'ingredient', 'item', 'field', 'building', 'establishment',
]);

export function aggregateArchiveRows(world: WorldState, kind: EntityKind): ArchiveCatalogRow[] | undefined {
  if (!aggregatedArchiveKinds.has(kind)) return undefined;
  if (kind === 'animalPopulation') {
    const groups = groupBy(world.animalPopulations, population => population.species);
    return [...groups.entries()].map(([species, populations]) => ({
      key: species, kind, representativeId: populations[0]!.id, title: monsterSpeciesLabel(species), subtype: species,
      entries: populations.length, total: populations.reduce((sum, population) => sum + Math.max(0, population.count), 0),
      subtitle: `${format(populations.reduce((sum, population) => sum + Math.max(0, population.count), 0))} особей · ${populations.length} популяций · ${uniqueLocations(populations).size} клеток`,
    })).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
  }
  if (kind === 'ingredient') {
    const groups = groupBy(world.ingredients, ingredient => `${ingredient.kind}:${ingredient.name}`);
    return [...groups.values()].map(resources => {
      const sample = resources[0]!;
      const total = resources.reduce((sum, resource) => sum + Math.max(0, resource.abundance), 0);
      return {
        key: `${sample.kind}:${sample.name}`, kind, representativeId: sample.id, title: sample.name,
        entries: resources.length, total,
        subtitle: `${sample.kind} · общий запас ${format(total)} · ${resources.length} залежей · ${uniqueLocations(resources).size} клеток`,
      };
    }).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
  }
  if (kind === 'item') {
    const groups = groupBy(world.items.filter(item => item.quantity > .0001 && item.condition > 0), item => item.templateId);
    return [...groups.values()].map(items => {
      const sample = items[0]!;
      const total = items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
      const settlements = new Set(items.map(item => item.settlementId));
      return {
        key: sample.templateId, kind, representativeId: sample.id, title: sample.name,
        entries: items.length, total,
        subtitle: `${sample.category} · ${format(total)} ${sample.unit} · ${items.length} партий · ${settlements.size} поселений`,
      };
    }).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
  }
  if (kind === 'field') {
    const groups = groupBy(world.fields, field => field.crop);
    return [...groups.entries()].map(([crop, fields]) => {
      const total = fields.reduce((sum, field) => sum + field.cells.length, 0);
      return {
        key: crop, kind, representativeId: fields[0]!.id, title: `Поля: ${crop}`,
        entries: fields.length, total,
        subtitle: `${fields.length} полей · ${format(total)} клеток · ${new Set(fields.map(field => field.settlementId)).size} поселений`,
      };
    }).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
  }
  if (kind === 'building') {
    const groups = groupBy(world.buildings, building => building.type);
    return [...groups.entries()].map(([type, buildings]) => ({
      key: type, kind, representativeId: buildings[0]!.id, title: buildingTypeLabel(type),
      entries: buildings.length, total: buildings.length,
      subtitle: `${buildings.length} строений · среднее состояние ${Math.round(buildings.reduce((sum, building) => sum + building.condition, 0) / Math.max(1, buildings.length))}% · ${new Set(buildings.map(building => building.settlementId)).size} поселений`,
    })).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
  }
  const groups = groupBy(world.establishments, establishment => establishment.type);
  return [...groups.entries()].map(([type, establishments]) => ({
    key: type, kind, representativeId: establishments[0]!.id, title: type,
    entries: establishments.length, total: establishments.length,
    subtitle: `${establishments.length} заведений · ${establishments.reduce((sum, establishment) => sum + establishment.workerIds.length, 0)} работников · ${new Set(establishments.map(establishment => establishment.settlementId)).size} поселений`,
  })).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title, 'ru'));
}

function groupBy<T>(items: readonly T[], keyFor: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function uniqueLocations(items: readonly { x: number; y: number }[]): Set<string> {
  return new Set(items.map(item => `${item.x}:${item.y}`));
}

function format(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: value < 10 ? 1 : 0 });
}
