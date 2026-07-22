import type { Building, Character, Settlement, WorldState } from '../types';
import type {
  BuildingCityAudit, CityProblem, CityProblemKind, HouseholdHousingAudit, HousingStatus, SettlementCityState,
} from '../cityTypes';
import { raceDefinition } from '../raceCatalog';
import { worldTick } from './scheduler';
import { buildingCapacityProfile } from './cityCapacity';

const CITY_VERSION = 1 as const;
const RESIDENTIAL_TYPES = new Set<Building['type']>(['house', 'tenement', 'manor', 'barracks', 'monastery', 'castle']);

export function initializeCitySimulation(world: WorldState): void {
  world.cityStates ??= [];
  advanceCitySimulation(world);
}

export function advanceCitySimulation(world: WorldState, settlementIds?: ReadonlySet<number>): void {
  world.cityStates ??= [];
  const requested = settlementIds ?? new Set(world.settlements.map(settlement => settlement.id));
  const nextBySettlement = new Map(world.cityStates.map(state => [state.settlementId, state]));
  for (const settlement of world.settlements) {
    if (!requested.has(settlement.id)) continue;
    nextBySettlement.set(settlement.id, auditSettlementCity(world, settlement));
  }
  world.cityStates = world.settlements.map(settlement => nextBySettlement.get(settlement.id)).filter((state): state is SettlementCityState => Boolean(state));
}

export function cityStateForSettlement(world: WorldState, settlementId: number): SettlementCityState | undefined {
  return world.cityStates?.find(state => state.settlementId === settlementId);
}

export function auditSettlementCity(world: WorldState, settlement: Settlement): SettlementCityState {
  const living = world.characters.filter(character => character.alive && character.settlementId === settlement.id);
  const buildings = world.buildings.filter(building => building.settlementId === settlement.id);
  const households = world.households.filter(household => household.settlementId === settlement.id);
  const buildingById = new Map(buildings.map(building => [building.id, building]));
  const establishmentById = new Map(world.establishments.filter(item => item.settlementId === settlement.id).map(item => [item.id, item]));
  const activeContractByCharacter = new Map(world.employments.filter(contract => contract.active).map(contract => [contract.characterId, contract]));
  const storageUsedByBuilding = storageUsed(world, settlement.id, establishmentById);
  const studentsBySchool = studentsByBuilding(world, settlement.id);

  const buildingAudits: BuildingCityAudit[] = buildings.map(building => {
    const capacity = buildingCapacityProfile(building);
    building.cityCapacity = capacity;
    const residents = living.filter(character => character.homeBuildingId === building.id || building.residentIds.includes(character.id));
    const workers = living.filter(character => character.workplaceBuildingId === building.id || building.workerIds.includes(character.id));
    const students = studentsBySchool.get(building.id) ?? [];
    const used = storageUsedByBuilding.get(building.id) ?? 0;
    const warnings: string[] = [];
    const housingOccupancy = capacity.permanentBeds > 0 ? residents.length / capacity.permanentBeds : residents.length ? Number.POSITIVE_INFINITY : 0;
    const workOccupancy = capacity.workstations > 0 ? workers.length / capacity.workstations : workers.length ? Number.POSITIVE_INFINITY : 0;
    const storageOccupancy = capacity.storageVolume > 0 ? used / capacity.storageVolume : used ? Number.POSITIVE_INFINITY : 0;
    if (housingOccupancy > 1) warnings.push(`перенаселение ${residents.length}/${capacity.permanentBeds}`);
    if (workOccupancy > 1) warnings.push(`работников больше рабочих мест: ${workers.length}/${capacity.workstations}`);
    if (building.type === 'school' && students.length > capacity.studentSeats) warnings.push(`учеников больше мест: ${students.length}/${capacity.studentSeats}`);
    if (storageOccupancy > 1) warnings.push(`складской объём превышен на ${Math.round((storageOccupancy - 1) * 100)}%`);
    return {
      buildingId: building.id,
      settlementId: settlement.id,
      districtName: building.districtName,
      type: building.type,
      floorArea: capacity.usableFloorCells,
      circulationCells: capacity.circulationCells,
      residentCount: residents.length,
      workerCount: workers.length,
      studentCount: students.length,
      storageUsed: used,
      capacity,
      housingOccupancy: finiteRatio(housingOccupancy),
      workOccupancy: finiteRatio(workOccupancy),
      storageOccupancy: finiteRatio(storageOccupancy),
      overloaded: warnings.length > 0,
      warnings,
    };
  });

  const housing = auditHousing(world, settlement, living, households, buildingById, buildingAudits);
  applyHousingStatuses(world, settlement, living, housing.characterStatuses, housing.shelterAssignments);

  const schoolAgeChildren = living.filter(isSchoolAge).length;
  const classrooms = buildingAudits.reduce((sum, audit) => sum + audit.capacity.classrooms, 0);
  const studentSeats = buildingAudits.reduce((sum, audit) => sum + audit.capacity.studentSeats, 0);
  const teacherStations = buildingAudits.reduce((sum, audit) => sum + audit.capacity.teacherStations, 0);
  const teacherIds = new Set<number>();
  const government = world.settlementGovernments.find(item => item.settlementId === settlement.id);
  for (const id of government?.teacherIds ?? []) if (living.some(character => character.id === id)) teacherIds.add(id);
  for (const character of living) {
    const contract = activeContractByCharacter.get(character.id);
    const establishment = contract ? establishmentById.get(contract.establishmentId) : undefined;
    if (establishment && buildingById.get(establishment.buildingId)?.type === 'school') teacherIds.add(character.id);
  }
  const activeTeachers = teacherIds.size;
  const effectiveSeats = Math.min(studentSeats, teacherStations * 18, activeTeachers * 18);
  const unservedChildren = Math.max(0, schoolAgeChildren - effectiveSeats);

  const workingAge = living.filter(character => character.age >= raceDefinition(character.species).adultAge && character.legalStatus !== 'заключён');
  const activeWorkers = workingAge.filter(character => activeContractByCharacter.has(character.id) || ['гарнизон', 'поход'].includes(character.serviceStatus ?? '')).length;
  const workstations = buildingAudits.reduce((sum, audit) => sum + audit.capacity.workstations, 0);
  const unemployedPeople = Math.max(0, workingAge.length - activeWorkers);
  const vacantWorkstations = Math.max(0, workstations - activeWorkers);

  const storageCapacity = buildingAudits.reduce((sum, audit) => sum + audit.capacity.storageVolume, 0);
  const storageUsedTotal = buildingAudits.reduce((sum, audit) => sum + audit.storageUsed, 0);
  const storageOverflow = Math.max(0, storageUsedTotal - storageCapacity);

  const land = landAudit(world, settlement, buildings);
  const waterBuildings = buildings.filter(building => building.hasWater).length;
  const waterCoverage = buildings.length ? waterBuildings / buildings.length : 0;
  const districtStates = world.districtCivicStates.filter(state => state.settlementId === settlement.id);
  const averageFireRisk = districtStates.length ? districtStates.reduce((sum, state) => sum + state.fireRisk, 0) / districtStates.length : 0;

  settlement.population = living.length;
  settlement.households = households.length;
  settlement.residentialCapacity = housing.permanentBeds;

  const stateBase: Omit<SettlementCityState, 'problems'> = {
    version: CITY_VERSION,
    settlementId: settlement.id,
    updatedTick: worldTick(world),
    population: living.length,
    households: households.length,
    land,
    housing: {
      residentialUnits: buildingAudits.reduce((sum, audit) => sum + audit.capacity.residentialUnits, 0),
      householdBeds: housing.householdBeds,
      institutionalBeds: housing.institutionalBeds,
      permanentBeds: housing.permanentBeds,
      occupiedBeds: housing.occupiedBeds,
      peopleWithoutPermanentBed: housing.peopleWithoutPermanentBed,
      shelterBeds: housing.shelterBeds,
      homelessPeople: housing.homelessPeople,
      overcrowdedPeople: housing.overcrowdedPeople,
      overcrowdedHouseholds: housing.overcrowdedHouseholds,
      vacancyRate: housing.permanentBeds ? Math.max(0, (housing.permanentBeds - housing.occupiedBeds) / housing.permanentBeds) : 0,
    },
    education: { schoolAgeChildren, classrooms, studentSeats, teacherStations, activeTeachers, effectiveSeats, unservedChildren },
    employment: { workingAgePeople: workingAge.length, workstations, activeWorkers, unemployedPeople, vacantWorkstations },
    storage: { capacity: storageCapacity, used: storageUsedTotal, overflow: storageOverflow },
    services: {
      waterCoverage,
      averageFireRisk,
      publicSeats: buildingAudits.reduce((sum, audit) => sum + audit.capacity.publicSeats, 0),
      treatmentBeds: buildingAudits.reduce((sum, audit) => sum + audit.capacity.treatmentBeds, 0),
      prisonBeds: buildingAudits.reduce((sum, audit) => sum + audit.capacity.prisonBeds, 0),
    },
    buildingAudits,
    householdAudits: housing.householdAudits,
  };
  return { ...stateBase, problems: buildProblems(settlement, stateBase, living) };
}

export function cityIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const stateBySettlement = new Map((world.cityStates ?? []).map(state => [state.settlementId, state]));
  for (const settlement of world.settlements) {
    const state = stateBySettlement.get(settlement.id);
    if (!state) { issues.push(`${settlement.name}: отсутствует городской аудит`); continue; }
    if (state.version !== CITY_VERSION) issues.push(`${settlement.name}: устаревшая версия городского ядра`);
    if (state.population !== settlement.population) issues.push(`${settlement.name}: городской аудит считает ${state.population} жителей, поселение хранит ${settlement.population}`);
    if (settlement.residentialCapacity !== state.housing.permanentBeds) issues.push(`${settlement.name}: агрегат жилья не совпадает с физическими спальными местами`);
    if (state.land.freeBuildableCells < 0) issues.push(`${settlement.name}: отрицательная свободная земля`);
    if (state.housing.occupiedBeds > state.housing.permanentBeds) issues.push(`${settlement.name}: занятых постоянных мест больше физической вместимости`);
    for (const audit of state.buildingAudits) {
      const building = world.buildings.find(item => item.id === audit.buildingId);
      if (!building) issues.push(`${settlement.name}: аудит ссылается на отсутствующее здание №${audit.buildingId}`);
      else if (building.cityCapacity?.version !== 1) issues.push(`${building.name}: отсутствует профиль функциональной вместимости`);
      if (audit.capacity.circulationCells + audit.capacity.serviceCells >= audit.capacity.usableFloorCells && audit.capacity.usableFloorCells > 2) issues.push(`${building?.name ?? audit.buildingId}: нет полезной площади после проходов и служб`);
    }
  }
  return [...new Set(issues)];
}

function auditHousing(
  world: WorldState,
  settlement: Settlement,
  living: Character[],
  households: WorldState['households'],
  buildingById: Map<number, Building>,
  buildingAudits: BuildingCityAudit[],
) {
  const auditByBuilding = new Map(buildingAudits.map(audit => [audit.buildingId, audit]));
  const householdById = new Map(households.map(household => [household.id, household]));
  const householdAudits: HouseholdHousingAudit[] = [];
  const characterStatuses = new Map<number, HousingStatus>();
  const handledHouseholds = new Set<number>();
  let occupiedBeds = 0;
  let peopleWithoutPermanentBed = 0;
  let overcrowdedPeople = 0;
  let overcrowdedHouseholds = 0;

  for (const building of [...buildingById.values()].filter(item => RESIDENTIAL_TYPES.has(item.type)).sort((a, b) => a.id - b.id)) {
    const capacity = auditByBuilding.get(building.id)?.capacity.permanentBeds ?? 0;
    const residents = living
      .filter(character => character.homeBuildingId === building.id || building.residentIds.includes(character.id))
      .sort((a, b) => a.id - b.id);
    const grouped = new Map<string, { householdId?: number; members: Character[] }>();
    for (const resident of residents) {
      const household = resident.householdId ? householdById.get(resident.householdId) : undefined;
      const key = household ? `household:${household.id}` : `character:${resident.id}`;
      const group = grouped.get(key) ?? { householdId: household?.id, members: [] };
      group.members.push(resident);
      grouped.set(key, group);
    }
    const groups = [...grouped.values()].sort((a, b) => (a.householdId ?? Number.MAX_SAFE_INTEGER) - (b.householdId ?? Number.MAX_SAFE_INTEGER) || a.members[0]!.id - b.members[0]!.id);
    const allocations = proportionalAllocations(groups.map(group => group.members.length), capacity);
    let remainingBeds = capacity;
    groups.forEach((group, index) => {
      const allocated = Math.min(group.members.length, allocations[index] ?? 0, remainingBeds);
      remainingBeds -= allocated;
      occupiedBeds += allocated;
      const missing = Math.max(0, group.members.length - allocated);
      peopleWithoutPermanentBed += missing;
      const status: HousingStatus = allocated >= group.members.length ? 'secure' : allocated > 0 ? 'overcrowded' : 'shared';
      for (const member of group.members) characterStatuses.set(member.id, status);
      if (status !== 'secure') overcrowdedPeople += group.members.length;
      if (group.householdId && !handledHouseholds.has(group.householdId)) {
        handledHouseholds.add(group.householdId);
        if (status !== 'secure') overcrowdedHouseholds += 1;
        householdAudits.push({
          householdId: group.householdId,
          buildingId: building.id,
          memberCount: group.members.length,
          permanentBedCount: allocated,
          status,
          overcrowdingRatio: allocated ? group.members.length / allocated : group.members.length,
        });
      }
    });
  }

  for (const household of households.filter(item => !handledHouseholds.has(item.id))) {
    const members = household.memberIds.map(id => living.find(character => character.id === id)).filter((item): item is Character => Boolean(item));
    if (!members.length) continue;
    const home = household.homeBuildingId ? buildingById.get(household.homeBuildingId) : undefined;
    const validResidentialHome = Boolean(home && RESIDENTIAL_TYPES.has(home.type));
    const status: HousingStatus = validResidentialHome ? 'shared' : 'homeless';
    for (const member of members) if (!characterStatuses.has(member.id)) characterStatuses.set(member.id, status);
    householdAudits.push({
      householdId: household.id,
      buildingId: household.homeBuildingId,
      memberCount: members.length,
      permanentBedCount: 0,
      status,
      overcrowdingRatio: members.length,
    });
    peopleWithoutPermanentBed += members.length;
    if (validResidentialHome) { overcrowdedPeople += members.length; overcrowdedHouseholds += 1; }
  }

  // Персонажи вне домохозяйств тоже входят в физический жилищный баланс.
  for (const character of living) {
    if (characterStatuses.has(character.id)) continue;
    const home = character.homeBuildingId ? buildingById.get(character.homeBuildingId) : undefined;
    const status: HousingStatus = home && RESIDENTIAL_TYPES.has(home.type) ? 'shared' : 'homeless';
    characterStatuses.set(character.id, status);
    peopleWithoutPermanentBed += 1;
    if (status === 'shared') overcrowdedPeople += 1;
  }

  const peopleWithoutValidHome = living.filter(character => {
    const home = character.homeBuildingId ? buildingById.get(character.homeBuildingId) : undefined;
    return !home || !RESIDENTIAL_TYPES.has(home.type);
  });
  const shelters = [...buildingById.values()]
    .filter(building => building.type === 'shelter')
    .sort((a, b) => a.id - b.id)
    .map(building => ({ building, remaining: auditByBuilding.get(building.id)?.capacity.shelterBeds ?? 0 }));
  const shelterAssignments = new Map<number, number>();
  const vulnerable = [...peopleWithoutValidHome].sort((a, b) => Number(b.age < 16) - Number(a.age < 16) || a.health - b.health || a.wealth - b.wealth || a.id - b.id);
  for (const character of vulnerable) {
    const shelter = shelters.find(candidate => candidate.remaining > 0);
    if (!shelter) break;
    shelterAssignments.set(character.id, shelter.building.id);
    shelter.remaining -= 1;
    characterStatuses.set(character.id, 'shelter');
  }
  const homelessPeople = Math.max(0, peopleWithoutValidHome.length - shelterAssignments.size);
  for (const character of peopleWithoutValidHome) if (!shelterAssignments.has(character.id)) characterStatuses.set(character.id, 'homeless');

  const householdBeds = buildingAudits.reduce((sum, audit) => sum + audit.capacity.householdBeds, 0);
  const institutionalBeds = buildingAudits.reduce((sum, audit) => sum + audit.capacity.institutionalBeds, 0);
  return {
    householdAudits,
    characterStatuses,
    shelterAssignments,
    householdBeds,
    institutionalBeds,
    permanentBeds: householdBeds + institutionalBeds,
    occupiedBeds,
    peopleWithoutPermanentBed,
    shelterBeds: buildingAudits.reduce((sum, audit) => sum + audit.capacity.shelterBeds, 0),
    homelessPeople,
    overcrowdedPeople,
    overcrowdedHouseholds,
  };
}

function applyHousingStatuses(
  world: WorldState,
  settlement: Settlement,
  living: Character[],
  characterStatuses: ReadonlyMap<number, HousingStatus>,
  shelterAssignments: ReadonlyMap<number, number>,
): void {
  for (const character of living) {
    const status = characterStatuses.get(character.id) ?? 'homeless';
    character.housingStatus = status;
    character.temporaryShelterBuildingId = shelterAssignments.get(character.id);
    character.homeless = status === 'homeless';
  }
  const states = world.districtCivicStates.filter(state => state.settlementId === settlement.id);
  states.forEach(state => { state.homelessCount = 0; });
  for (const character of living.filter(item => item.housingStatus === 'homeless')) {
    const state = states.find(item => item.districtName === character.homeDistrict) ?? states.find(item => /окра/i.test(item.districtName)) ?? states[0];
    if (state) state.homelessCount += 1;
  }
}

function landAudit(world: WorldState, settlement: Settlement, buildings: Building[]) {
  const localSize = world.config.localMapSize ?? 128;
  const projects = world.constructionProjects.filter(project => project.settlementId === settlement.id && project.stage !== 'завершено' && project.stage !== 'заброшено');
  const fields = world.fields.filter(field => field.settlementId === settlement.id);
  const tileKeys = new Set<string>(settlement.districts.map(district => `${district.x}:${district.y}`));
  for (const building of buildings) tileKeys.add(`${building.globalX}:${building.globalY}`);
  for (const project of projects) tileKeys.add(`${project.globalX}:${project.globalY}`);
  for (const field of fields) tileKeys.add(`${field.globalX}:${field.globalY}`);
  if (!tileKeys.size) tileKeys.add(`${settlement.x}:${settlement.y}`);

  const buildingCells = new Set<string>();
  const constructionCells = new Set<string>();
  const fieldCells = new Set<string>();
  const claimed = new Set<string>();
  const overlaps = new Set<string>();
  const claim = (target: Set<string>, globalX: number, globalY: number, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= localSize || y >= localSize) return;
    const key = `${globalX}:${globalY}:${x}:${y}`;
    target.add(key);
    if (claimed.has(key)) overlaps.add(key);
    claimed.add(key);
  };
  for (const building of buildings) {
    for (let y = building.localY; y < building.localY + building.localHeight; y += 1) {
      for (let x = building.localX; x < building.localX + building.localWidth; x += 1) claim(buildingCells, building.globalX, building.globalY, x, y);
    }
  }
  for (const project of projects) {
    for (let y = project.localY; y < project.localY + project.localHeight; y += 1) {
      for (let x = project.localX; x < project.localX + project.localWidth; x += 1) claim(constructionCells, project.globalX, project.globalY, x, y);
    }
  }
  for (const field of fields) for (const cell of field.cells) claim(fieldCells, field.globalX, field.globalY, cell.x, cell.y);

  const totalCells = tileKeys.size * localSize * localSize;
  const reservedPublicCells = Math.round(totalCells * .22);
  const freeBuildableCells = Math.max(0, totalCells - claimed.size - reservedPublicCells);
  return {
    totalCells,
    buildingCells: buildingCells.size,
    constructionCells: constructionCells.size,
    fieldCells: fieldCells.size,
    reservedPublicCells,
    freeBuildableCells,
    overlapCells: overlaps.size,
    districtTiles: tileKeys.size,
    density: totalCells ? claimed.size / totalCells : 0,
  };
}

function storageUsed(world: WorldState, settlementId: number, establishmentById: Map<number, WorldState['establishments'][number]>): Map<number, number> {
  const result = new Map<number, number>();
  for (const item of world.items) {
    if (item.settlementId !== settlementId || item.quantity <= 0) continue;
    const buildingId = item.buildingId ?? (item.establishmentId ? establishmentById.get(item.establishmentId)?.buildingId : undefined);
    if (!buildingId) continue;
    const weight = Math.max(.05, item.weightPerUnit || 1) * item.quantity;
    result.set(buildingId, (result.get(buildingId) ?? 0) + weight);
  }
  return result;
}

function studentsByBuilding(world: WorldState, settlementId: number): Map<number, Character[]> {
  const schools = world.buildings
    .filter(building => building.settlementId === settlementId && building.type === 'school')
    .sort((a, b) => a.id - b.id)
    .map(building => ({ building, capacity: buildingCapacityProfile(building).studentSeats, assigned: [] as Character[] }));
  const result = new Map<number, Character[]>();
  if (!schools.length) return result;
  const students = world.characters
    .filter(item => item.alive && item.settlementId === settlementId && isSchoolAge(item))
    .sort((a, b) => a.age - b.age || a.id - b.id);
  for (const student of students) {
    const school = [...schools].sort((a, b) => {
      const aRemaining = a.capacity - a.assigned.length;
      const bRemaining = b.capacity - b.assigned.length;
      if ((aRemaining > 0) !== (bRemaining > 0)) return bRemaining > 0 ? 1 : -1;
      if (aRemaining !== bRemaining) return bRemaining - aRemaining;
      const aRatio = a.assigned.length / Math.max(1, a.capacity);
      const bRatio = b.assigned.length / Math.max(1, b.capacity);
      return aRatio - bRatio || a.building.id - b.building.id;
    })[0]!;
    school.assigned.push(student);
  }
  for (const school of schools) result.set(school.building.id, school.assigned);
  return result;
}

function isSchoolAge(character: Character): boolean {
  const adultAge = raceDefinition(character.species).adultAge;
  return character.age >= Math.max(5, Math.round(adultAge * .3)) && character.age < adultAge;
}

function buildProblems(settlement: Settlement, state: Omit<SettlementCityState, 'problems'>, living: Character[]): CityProblem[] {
  const problems: CityProblem[] = [];
  const add = (kind: CityProblemKind, severity: number, title: string, description: string, causes: string[], consequences: string[], buildingIds: number[] = [], characterIds: number[] = [], districts: string[] = []) => {
    if (severity <= 0) return;
    problems.push({ id: `city:${settlement.id}:${kind}`, kind, severity: clamp(severity, 1, 100), title, description, causes, consequences, affectedBuildingIds: [...new Set(buildingIds)], affectedCharacterIds: [...new Set(characterIds)], districtNames: [...new Set(districts)] });
  };

  const homeless = living.filter(character => character.housingStatus === 'homeless');
  if (state.housing.homelessPeople) add('homelessness', 25 + state.housing.homelessPeople / Math.max(1, state.population) * 180, 'Люди ночуют без крыши', `${state.housing.homelessPeople} жителей не получили ни постоянного жилья, ни места в приюте.`, ['жилья и приютов меньше, чем нуждающихся'], ['болезни', 'уличные лагеря', 'рост преступности'], [], homeless.map(item => item.id), homeless.map(item => item.homeDistrict ?? 'Окраина'));
  if (state.housing.overcrowdedHouseholds) add('overcrowding', 18 + state.housing.overcrowdedPeople / Math.max(1, state.population) * 140, 'Дома переполнены', `${state.housing.overcrowdedHouseholds} домохозяйств делят недостаточное число постоянных спальных мест.`, ['семьи крупнее физической вместимости домов'], ['плохой сон', 'конфликты', 'повышенный пожарный риск'], state.buildingAudits.filter(audit => audit.housingOccupancy > 1).map(audit => audit.buildingId));
  if (state.housing.peopleWithoutPermanentBed > 0) add('housing-shortage', 20 + state.housing.peopleWithoutPermanentBed / Math.max(1, state.population) * 120, 'Не хватает постоянного жилья', `${state.housing.peopleWithoutPermanentBed} жителей не имеют закреплённого постоянного спального места. В городе физически есть ${state.housing.permanentBeds} мест, но часть из них служебная или находится не там, где живут нуждающиеся семьи.`, ['рост населения опередил доступное строительство', 'свободные места распределены между несовместимыми типами жилья'], ['рост аренды', 'перенаселение', 'отток жителей']);
  if (state.education.unservedChildren) add('school-shortage', 18 + state.education.unservedChildren / Math.max(1, state.education.schoolAgeChildren) * 90, 'Школы не принимают всех детей', `${state.education.unservedChildren} детей не обеспечены одновременно партой, классом и учителем.`, ['не хватает классов, парт или учителей'], ['падение грамотности', 'детский труд'], state.buildingAudits.filter(audit => audit.type === 'school').map(audit => audit.buildingId));
  const unemploymentRate = state.employment.unemployedPeople / Math.max(1, state.employment.workingAgePeople);
  if (unemploymentRate > .1) add('unemployment', 10 + unemploymentRate * 100, 'Безработица', `${state.employment.unemployedPeople} взрослых не имеют действующего рабочего места.`, ['население и рабочие места растут несинхронно'], ['бедность', 'миграция', 'преступность']);
  if (state.employment.vacantWorkstations > Math.max(3, state.employment.workstations * .35) && unemploymentRate < .08) add('worker-shortage', 20 + state.employment.vacantWorkstations / Math.max(1, state.employment.workstations) * 70, 'Не хватает работников', `${state.employment.vacantWorkstations} рабочих позиций пустуют.`, ['предприятий больше, чем доступной рабочей силы'], ['остановка производства', 'рост зарплат'], state.buildingAudits.filter(audit => audit.workOccupancy < .65 && audit.capacity.workstations > 0).map(audit => audit.buildingId));
  if (state.storage.overflow > 0) add('storage-shortage', 25 + state.storage.overflow / Math.max(1, state.storage.capacity) * 90, 'Склады переполнены', `Товары превышают физический объём хранения на ${Math.round(state.storage.overflow)} единиц веса.`, ['торговля и производство превысили складскую инфраструктуру'], ['порча товаров', 'задержки поставок', 'рост цен'], state.buildingAudits.filter(audit => audit.storageOccupancy > 1).map(audit => audit.buildingId));
  if (state.land.freeBuildableCells < state.land.totalCells * .08) add('land-shortage', 25 + (1 - state.land.freeBuildableCells / Math.max(1, state.land.totalCells * .08)) * 70, 'Свободная земля заканчивается', `Для новой застройки осталось ${state.land.freeBuildableCells} клеток после дорог, общественного пространства, полей и существующих зданий.`, ['поселение уплотнилось в текущих районах'], ['дорогая земля', 'расширение границ', 'снос ветхих строений']);
  if (state.land.overlapCells > 0) add('land-conflict', 35 + state.land.overlapCells / Math.max(1, state.land.buildingCells + state.land.constructionCells) * 120, 'Застройка конфликтует за землю', `${state.land.overlapCells} клеток одновременно заняты несколькими зданиями, стройплощадками или полями.`, ['старое размещение разрешало строить без свободного участка'], ['заблокированные проходы', 'невозможность честно расширять город']);
  if (state.services.waterCoverage < .7) add('water-shortage', 15 + (1 - state.services.waterCoverage) * 70, 'Не хватает доступа к воде', `Водой обеспечено ${Math.round(state.services.waterCoverage * 100)}% зданий.`, ['колодцы и водоснабжение не успевают за ростом'], ['болезни', 'пожары', 'долгий бытовой путь']);
  if (state.services.averageFireRisk > 62) add('fire-risk', state.services.averageFireRisk, 'Высокий риск городских пожаров', `Средний пожарный риск районов — ${Math.round(state.services.averageFireRisk)}%.`, ['плотная застройка', 'очаги', 'нехватка воды и проходов'], ['быстрое распространение огня', 'потеря жилья']);
  return problems.sort((a, b) => b.severity - a.severity || a.kind.localeCompare(b.kind));
}

function proportionalAllocations(memberCounts: number[], capacity: number): number[] {
  const total = memberCounts.reduce((sum, count) => sum + count, 0);
  if (!total || capacity <= 0) return memberCounts.map(() => 0);
  if (capacity >= total) return [...memberCounts];
  const exact = memberCounts.map(count => count / total * capacity);
  const result = exact.map(value => Math.floor(value));
  let remainder = capacity - result.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of order) {
    if (remainder <= 0) break;
    result[entry.index] = (result[entry.index] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}

function finiteRatio(value: number): number { return Number.isFinite(value) ? value : 99; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
