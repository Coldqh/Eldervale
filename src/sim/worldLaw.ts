import type { Character, WorldState } from '../types';
import { livestockIntegrityIssues } from './livestockSystem';

const WORLD_LAW_VERSION = 1 as const;
const SYNTHETIC_DEPOSIT_MARKER = 'чтобы его хозяйство имело физическую ресурсную базу';

export function initializeWorldLaw(world: WorldState): void {
  if (world.simulation.worldLawVersion === WORLD_LAW_VERSION) return;

  // 5.9 страховала поселения, создавая ресурс прямо под городом. В 6.0
  // нетронутые технические залежи удаляются: плохая география становится
  // настоящей причиной торговли, переселения, бедности или упадка.
  world.resourceDeposits = (world.resourceDeposits ?? []).filter(deposit => {
    const synthetic = deposit.history.some(entry => entry.includes(SYNTHETIC_DEPOSIT_MARKER));
    const untouched = deposit.lastExtractionTick === undefined && Math.abs(deposit.remaining - deposit.initialAmount) < .0001;
    return !(synthetic && untouched);
  });

  reconcileWorldLawStates(world);
  world.simulation.worldLawVersion = WORLD_LAW_VERSION;
}

export function reconcileWorldLawStates(world: WorldState): void {
  const imprisonedIds = new Set(world.characters
    .filter(character => character.alive && (character.legalStatus === 'заключён' || character.legalStatus === 'под стражей'))
    .map(character => character.id));
  const travelingIds = new Set((world.travelingMerchants ?? []).map(merchant => merchant.characterId));
  const expeditionIds = new Set((world.settlementExpeditions ?? [])
    .filter(expedition => ['forming', 'traveling', 'camped', 'returning'].includes(expedition.status))
    .flatMap(expedition => expedition.memberIds));
  const servingIds = new Set(world.armies.flatMap(army => army.soldierIds ?? []));
  const unavailableForCivilianWork = new Set([...imprisonedIds, ...travelingIds, ...expeditionIds, ...servingIds]);

  if (imprisonedIds.size) {
    for (const army of world.armies) army.soldierIds = army.soldierIds.filter(id => !imprisonedIds.has(id));
    for (const unit of world.militaryUnits ?? []) unit.memberIds = unit.memberIds.filter(id => !imprisonedIds.has(id));
    for (const wagon of world.supplyWagons ?? []) wagon.escortIds = wagon.escortIds.filter(id => !imprisonedIds.has(id));
    for (const structure of world.armyCampStructures ?? []) structure.assignedCharacterIds = structure.assignedCharacterIds.filter(id => !imprisonedIds.has(id));
    world.armyLocalPositions = (world.armyLocalPositions ?? []).filter(position => !imprisonedIds.has(position.characterId));
  }

  const establishmentById = new Map(world.establishments.map(establishment => [establishment.id, establishment]));
  const buildingById = new Map(world.buildings.map(building => [building.id, building]));
  for (const contract of world.employments) {
    if (!contract.active || !unavailableForCivilianWork.has(contract.characterId)) continue;
    contract.active = false;
    const character = world.characters.find(item => item.id === contract.characterId);
    const establishment = establishmentById.get(contract.establishmentId);
    if (establishment) establishment.workerIds = establishment.workerIds.filter(id => id !== contract.characterId);
    const building = establishment ? buildingById.get(establishment.buildingId) : undefined;
    if (building) building.workerIds = building.workerIds.filter(id => id !== contract.characterId);
    if (character?.employmentContractId === contract.id) character.employmentContractId = undefined;
    if (character?.employerEstablishmentId === contract.establishmentId) character.employerEstablishmentId = undefined;
    if (character && establishment && character.workplaceBuildingId === establishment.buildingId) character.workplaceBuildingId = undefined;
  }

  for (const character of world.characters) {
    if (!imprisonedIds.has(character.id)) continue;
    character.serviceStatus = 'гражданский';
    character.militaryRole = undefined;
  }
}

export function worldLawIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  if (world.simulation.worldLawVersion !== WORLD_LAW_VERSION) issues.push('Единый закон мира не инициализирован.');

  const livingById = new Map(world.characters.filter(character => character.alive).map(character => [character.id, character]));
  const activeEmploymentByCharacter = new Map(world.employments.filter(contract => contract.active).map(contract => [contract.characterId, contract]));
  const travelingIds = new Set((world.travelingMerchants ?? []).map(merchant => merchant.characterId));
  const expeditionIds = new Set((world.settlementExpeditions ?? [])
    .filter(expedition => ['forming', 'traveling', 'camped', 'returning'].includes(expedition.status))
    .flatMap(expedition => expedition.memberIds));
  const servingIds = new Set(world.armies.flatMap(army => army.soldierIds ?? []));

  for (const character of world.characters) {
    const states = [
      travelingIds.has(character.id) ? 'странствующая торговля' : undefined,
      expeditionIds.has(character.id) ? 'экспедиция' : undefined,
      servingIds.has(character.id) || ['гарнизон', 'поход'].includes(character.serviceStatus ?? '') ? 'военная служба' : undefined,
      character.legalStatus === 'заключён' || character.legalStatus === 'под стражей' ? 'заключение' : undefined,
    ].filter((state): state is string => Boolean(state));
    if (states.length > 1) issues.push(`${character.name}: одновременно находится в несовместимых состояниях — ${states.join(', ')}.`);
    if (states.length && activeEmploymentByCharacter.has(character.id)) issues.push(`${character.name}: имеет гражданский трудовой договор во время состояния «${states[0]}».`);
  }

  for (const pregnancy of world.pregnancies.filter(item => item.status === 'беременность' || item.status === 'роды')) {
    const gestating = livingById.get(pregnancy.gestatingParentId);
    if (!gestating) {
      issues.push(`Беременность ${pregnancy.id}: нет живого вынашивающего родителя.`);
      continue;
    }
    if (gestating.healthProfile?.pregnancyId !== pregnancy.id) issues.push(`Беременность ${pregnancy.id}: профиль вынашивающего родителя не ссылается на неё.`);
  }

  for (const item of world.items) {
    if (!item.source?.trim()) issues.push(`Предмет ${item.id} «${item.name}»: не указано происхождение.`);
    if (item.quantity < -.0001) issues.push(`Предмет ${item.id} «${item.name}»: отрицательное количество.`);
  }

  for (const deposit of world.resourceDeposits ?? []) {
    if (deposit.history.some(entry => entry.includes(SYNTHETIC_DEPOSIT_MARKER))) issues.push(`Месторождение ${deposit.id}: сохранена искусственная ресурсная страховка поселения.`);
  }

  for (const merchant of world.travelingMerchants ?? []) {
    const character = livingById.get(merchant.characterId);
    if (!character) continue;
    for (const itemId of merchant.wagonInventoryItemIds) {
      const item = world.items.find(candidate => candidate.id === itemId);
      if (item && item.ownerCharacterId !== character.id) issues.push(`Странствующий торговец ${character.name}: товар ${item.id} не принадлежит владельцу каравана.`);
    }
  }

  return [...new Set([...issues, ...livestockIntegrityIssues(world)])];
}

export function characterActivityState(world: WorldState, character: Character): string {
  if ((world.travelingMerchants ?? []).some(merchant => merchant.characterId === character.id)) return 'странствующая торговля';
  if ((world.settlementExpeditions ?? []).some(expedition => ['forming', 'traveling', 'camped', 'returning'].includes(expedition.status) && expedition.memberIds.includes(character.id))) return 'экспедиция';
  if (world.armies.some(army => army.soldierIds.includes(character.id))) return 'военная служба';
  if (character.legalStatus === 'заключён' || character.legalStatus === 'под стражей') return 'заключение';
  return 'гражданская жизнь';
}
