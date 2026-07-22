import type { Character, WorldState } from '../types';

export function populationIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const settlementById = new Map(world.settlements.map(item => [item.id, item]));
  const characterById = new Map(world.characters.map(item => [item.id, item]));
  const buildingById = new Map(world.buildings.map(item => [item.id, item]));
  const householdById = new Map(world.households.map(item => [item.id, item]));
  const establishmentById = new Map(world.establishments.map(item => [item.id, item]));
  const activeExpeditionByCharacter = new Map<number, number>();
  for (const expedition of world.settlementExpeditions ?? []) if (['forming', 'traveling', 'camped', 'returning'].includes(expedition.status)) for (const characterId of expedition.memberIds) activeExpeditionByCharacter.set(characterId, expedition.id);

  for (const settlement of world.settlements) {
    const residents = world.characters.filter(character => character.alive && character.settlementId === settlement.id);
    if (settlement.population !== residents.length) {
      issues.push(`${settlement.name}: население ${settlement.population}, но живых жителей ${residents.length}`);
    }
    const state = world.simulation.population?.settlements.find(item => item.settlementId === settlement.id);
    if (state) {
      const counted = state.shares.reduce((sum, share) => sum + share.count, 0);
      const totalShare = state.shares.reduce((sum, share) => sum + share.share, 0);
      if (counted !== residents.length) issues.push(`${settlement.name}: демографический состав считает ${counted} жителей вместо ${residents.length}`);
      if (residents.length && Math.abs(totalShare - 1) > .0001) issues.push(`${settlement.name}: доли народов не дают 100%`);
      if (!residents.length && state.shares.length) issues.push(`${settlement.name}: пустое поселение имеет демографические доли`);
    }
  }

  for (const household of world.households) {
    const members = household.memberIds
      .map(id => characterById.get(id))
      .filter((character): character is Character => Boolean(character?.alive));
    const settlements = new Set(members.map(character => character.settlementId));
    if (settlements.size > 1) issues.push(`Домохозяйство №${household.id}: живые члены находятся в разных поселениях`);
    const memberSettlement = members[0]?.settlementId;
    if (memberSettlement !== undefined && household.settlementId !== memberSettlement) {
      issues.push(`Домохозяйство №${household.id}: поселение семьи ${household.settlementId}, поселение членов ${memberSettlement}`);
    }
    const travelingHousehold = household.settlementId === 0 && members.length > 0 && members.every(member => activeExpeditionByCharacter.has(member.id));
    if (!settlementById.has(household.settlementId) && !travelingHousehold) issues.push(`Домохозяйство №${household.id}: отсутствует поселение ${household.settlementId}`);
    if (household.homeBuildingId !== undefined) {
      const home = buildingById.get(household.homeBuildingId);
      if (!home) issues.push(`Домохозяйство №${household.id}: отсутствует дом ${household.homeBuildingId}`);
      else {
        if (home.settlementId !== household.settlementId) issues.push(`Домохозяйство №${household.id}: дом находится в другом поселении`);
        for (const member of members) if (!home.residentIds.includes(member.id)) issues.push(`${member.name}: не записан жителем дома своей семьи`);
      }
    }
  }

  for (const character of world.characters) {
    if (character.householdId !== undefined) {
      const household = householdById.get(character.householdId);
      if (!household) issues.push(`${character.name}: отсутствует домохозяйство ${character.householdId}`);
      else {
        if (!household.memberIds.includes(character.id)) issues.push(`${character.name}: домохозяйство не содержит жителя в memberIds`);
        if (household.settlementId !== character.settlementId) issues.push(`${character.name}: живёт отдельно от своего домохозяйства`);
      }
    }
    if (character.homeBuildingId !== undefined) {
      const building = buildingById.get(character.homeBuildingId);
      if (!building) issues.push(`${character.name}: отсутствует жилое здание ${character.homeBuildingId}`);
      else {
        if (building.settlementId !== character.settlementId) issues.push(`${character.name}: жилое здание находится в другом поселении`);
        if (!building.residentIds.includes(character.id)) issues.push(`${character.name}: здание не содержит жителя в residentIds`);
      }
    }
  }

  const activeContractsByCharacter = new Map<number, number[]>();
  for (const contract of world.employments.filter(item => item.active)) {
    const list = activeContractsByCharacter.get(contract.characterId) ?? [];
    list.push(contract.id);
    activeContractsByCharacter.set(contract.characterId, list);
    const character = characterById.get(contract.characterId);
    const establishment = establishmentById.get(contract.establishmentId);
    if (!character) issues.push(`Трудовой договор №${contract.id}: отсутствует работник ${contract.characterId}`);
    if (!establishment) issues.push(`Трудовой договор №${contract.id}: отсутствует заведение ${contract.establishmentId}`);
    if (character && establishment) {
      if (character.settlementId !== establishment.settlementId) issues.push(`${character.name}: активный договор остался в другом поселении`);
      if (!establishment.workerIds.includes(character.id)) issues.push(`${character.name}: активный договор не отражён в workerIds заведения`);
    }
  }
  for (const [characterId, contracts] of activeContractsByCharacter) {
    if (contracts.length > 1) issues.push(`Житель №${characterId}: одновременно имеет ${contracts.length} активных трудовых договора`);
  }

  for (const establishment of world.establishments) {
    for (const workerId of establishment.workerIds) {
      const worker = characterById.get(workerId);
      if (!worker) issues.push(`${establishment.name}: отсутствует работник ${workerId}`);
      else if (worker.settlementId !== establishment.settlementId) issues.push(`${establishment.name}: работник ${worker.name} живёт в другом поселении`);
    }
  }
  for (const building of world.buildings) {
    for (const workerId of building.workerIds) {
      const worker = characterById.get(workerId);
      if (!worker) issues.push(`${building.name}: отсутствует работник ${workerId}`);
      else if (worker.settlementId !== building.settlementId) issues.push(`${building.name}: работник ${worker.name} живёт в другом поселении`);
    }
  }

  const migrationIds = new Set<number>();
  for (const migration of world.simulation.population?.migrations ?? []) {
    if (migrationIds.has(migration.id)) issues.push(`Миграция №${migration.id}: повтор идентификатора`);
    migrationIds.add(migration.id);
    if (!settlementById.has(migration.fromSettlementId)) issues.push(`Миграция №${migration.id}: отсутствует исходное поселение`);
    if (!settlementById.has(migration.toSettlementId)) issues.push(`Миграция №${migration.id}: отсутствует поселение назначения`);
    if (migration.fromSettlementId === migration.toSettlementId) issues.push(`Миграция №${migration.id}: исходное и конечное поселение совпадают`);
    if (new Set(migration.characterIds).size !== migration.characterIds.length) issues.push(`Миграция №${migration.id}: повтор жителей внутри записи`);
  }

  return [...new Set(issues)];
}
