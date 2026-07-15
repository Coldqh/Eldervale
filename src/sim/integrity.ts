import type { WorldState } from '../types';
import { causalIntegrityIssues } from './causality';
import { ecologyIntegrityIssues } from './ecology';
import { housingIntegrity } from './settlements';
import { materialEconomyIntegrityIssues } from './materialEconomy';
import { territoryIntegrityIssues } from './territory';

export interface WorldIntegrityReport {
  errors: string[];
  warnings: string[];
  checks: number;
}

export function inspectWorldIntegrity(world: WorldState): WorldIntegrityReport {
  const territory = territoryIntegrityIssues(world);
  const errors = [...causalIntegrityIssues(world), ...ecologyIntegrityIssues(world), ...materialEconomyIntegrityIssues(world), ...territory.errors];
  const warnings: string[] = [...territory.warnings];
  let checks = world.events.length * 6 + world.settlements.length * 4 + world.characters.length + world.animalPopulations.length + world.alchemyRecipes.length + (world.buildings?.length ?? 0) + (world.households?.length ?? 0) + (world.establishments?.length ?? 0) + (world.items?.length ?? 0);

  for (const settlement of world.settlements) {
    const housing = housingIntegrity(settlement);
    if (housing) errors.push(housing);
    const tiles = world.tiles.filter(tile => tile.settlementId === settlement.id);
    if (!tiles.length) errors.push(`${settlement.name}: нет квадрата на глобальной карте`);
    if (settlement.districts.length !== tiles.length) warnings.push(`${settlement.name}: число районов и занятых квадратов различается`);
    if ((settlement.type === 'city' || settlement.type === 'port') && settlement.population >= 700 && settlement.districts.length < 2) warnings.push(`${settlement.name}: крупный город занимает только один квадрат`);
  }

  const settlementIds = new Set(world.settlements.map(item => item.id));
  const characterIds = new Set(world.characters.map(item => item.id));
  const ingredientIds = new Set(world.ingredients.map(item => item.id));
  const tileKeys = new Set(world.tiles.map(tile => `${tile.x}:${tile.y}`));
  for (const character of world.characters) {
    if (!settlementIds.has(character.settlementId)) errors.push(`${character.name}: не существует поселение проживания ${character.settlementId}`);
    if (!character.workplace) warnings.push(`${character.name}: не определено рабочее место`);
  }
  for (const army of world.armies) if (!characterIds.has(army.commanderId)) errors.push(`${army.name}: не существует командир`);
  for (const artifact of world.artifacts) if (artifact.ownerId && !characterIds.has(artifact.ownerId)) errors.push(`${artifact.name}: не существует владелец`);
  for (const recipe of world.alchemyRecipes) {
    if (recipe.ingredientIds.some(id => !ingredientIds.has(id))) errors.push(`${recipe.name}: отсутствует ингредиент`);
  }
  for (const monster of world.monsters) {
    if ((monster.footprintWidth ?? 0) < 1 || (monster.footprintHeight ?? 0) < 1) errors.push(`${monster.name}: неверный физический размер`);
    if ((monster.footprintWidth ?? 1) > 16 || (monster.footprintHeight ?? 1) > 16) warnings.push(`${monster.name}: занимает слишком много локальных клеток`);
  }
  for (const population of world.animalPopulations) {
    if (population.count > population.carryingCapacity * 1.8) warnings.push(`${population.species} ${population.x}:${population.y}: сильное перенаселение`);
  }

  const scheduledIds = new Set<string>();
  for (const action of world.simulation.queuedActions) {
    if (scheduledIds.has(action.id)) errors.push(`Планировщик: повтор действия ${action.id}`);
    scheduledIds.add(action.id);
    if (action.kind === 'army' && !world.armies.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует армия ${action.entityId}`);
    if (action.kind === 'monster' && !world.monsters.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует существо ${action.entityId}`);
    if (action.kind === 'war' && !world.wars.some(item => item.id === action.entityId)) errors.push(`Планировщик: не существует война ${action.entityId}`);
  }
  for (const key of world.simulation.activeRegionKeys) if (!tileKeys.has(key)) warnings.push(`Планировщик: активный регион ${key} находится вне карты`);

  checks += world.armies.length + world.artifacts.length + world.ingredients.length + world.monsters.length + world.territoryHistory.length + world.tiles.length + world.simulation.queuedActions.length + world.simulation.activeRegionKeys.length;
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], checks };
}
