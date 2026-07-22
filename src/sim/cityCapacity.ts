import type { Building } from '../types';
import type { BuildingCapacityProfile } from '../cityTypes';

const RESIDENTIAL = new Set<Building['type']>(['house', 'tenement', 'manor', 'barracks', 'monastery', 'castle']);
const WORKPLACE = new Set<Building['type']>([
  'warehouse', 'farm', 'mill', 'bakery', 'tavern', 'inn', 'brewery', 'winery', 'blacksmith', 'carpenter', 'weaver', 'tailor',
  'dyehouse', 'tannery', 'cobbler', 'armorer', 'toolmaker', 'kiln', 'quarry', 'market', 'shop', 'bathhouse', 'healer',
  'temple', 'guildhall', 'stable', 'fishery', 'mine', 'castle', 'arsenal', 'watchtower', 'siegeWorkshop', 'townHall',
  'courthouse', 'prison', 'fireStation', 'school', 'shelter', 'barracks', 'monastery',
]);

export function buildingCapacityProfile(building: Building): BuildingCapacityProfile {
  const innerWidth = Math.max(1, building.localWidth - 2);
  const innerHeight = Math.max(1, building.localHeight - 2);
  const usableFloorCells = innerWidth * innerHeight * Math.max(1, building.floors);
  const circulationCells = exactCirculationCells(building);
  const remainingAfterCirculation = Math.max(1, usableFloorCells - circulationCells);
  const serviceCells = Math.max(1, Math.ceil(remainingAfterCirculation * serviceRatioFor(building.type)));
  // Перегородки, доступ к мебели и рабочие зоны тоже занимают площадь.
  // Коэффициент не даёт арифметической вместимости обещать больше мест,
  // чем затем способен физически разместить интерьерный layout.
  const functionalCells = Math.max(1, Math.floor((remainingAfterCirculation - serviceCells) * layoutEfficiencyFor(building.type)));

  const profile: BuildingCapacityProfile = {
    version: 1,
    usableFloorCells,
    circulationCells,
    serviceCells,
    residentialUnits: 0,
    householdBeds: 0,
    institutionalBeds: 0,
    permanentBeds: 0,
    shelterBeds: 0,
    guestBeds: 0,
    classrooms: 0,
    studentSeats: 0,
    teacherStations: 0,
    workstations: 0,
    storageVolume: 0,
    loadingBays: 0,
    publicSeats: 0,
    treatmentBeds: 0,
    prisonBeds: 0,
    stableStalls: 0,
  };

  if (RESIDENTIAL.has(building.type)) {
    const cellsPerBed = building.type === 'tenement' || building.type === 'barracks' ? 4
      : building.type === 'castle' ? 8
        : building.type === 'manor' ? 7
          : building.type === 'monastery' ? 5
            : 6;
    const beds = Math.max(1, Math.floor(functionalCells / cellsPerBed));
    if (building.type === 'house' || building.type === 'tenement' || building.type === 'manor') profile.householdBeds = beds;
    else profile.institutionalBeds = beds;
    profile.permanentBeds = profile.householdBeds + profile.institutionalBeds;
    profile.residentialUnits = building.type === 'tenement'
      ? Math.max(1, Math.floor(profile.householdBeds / 5))
      : building.type === 'house' || building.type === 'manor' ? 1 : 0;
  }

  if (building.type === 'shelter') profile.shelterBeds = Math.max(4, Math.floor(functionalCells / 3));
  if (building.type === 'inn') profile.guestBeds = Math.max(2, Math.floor(functionalCells * .35 / 4));
  if (building.type === 'healer') profile.treatmentBeds = Math.max(2, Math.floor(functionalCells * .45 / 4));
  if (building.type === 'prison') profile.prisonBeds = Math.max(4, Math.floor(functionalCells * .58 / 3));
  if (building.type === 'stable') profile.stableStalls = Math.max(2, Math.floor(functionalCells / 4));

  if (building.type === 'school') {
    profile.classrooms = Math.max(1, Math.floor(functionalCells / 34));
    profile.teacherStations = profile.classrooms;
    profile.studentSeats = Math.max(6, profile.classrooms * Math.max(8, Math.min(18, Math.floor(functionalCells / profile.classrooms / 2))));
  }

  if (WORKPLACE.has(building.type)) profile.workstations = workstationCapacity(building.type, functionalCells);
  profile.storageVolume = storageCapacity(building.type, functionalCells);
  profile.loadingBays = ['warehouse', 'market', 'inn', 'tavern', 'arsenal', 'stable'].includes(building.type)
    ? Math.max(1, Math.floor(innerWidth / 5)) : 0;
  profile.publicSeats = publicSeatCapacity(building.type, functionalCells);

  return profile;
}

export function circulationCell(building: Building, x: number, y: number, floor: number): boolean {
  const innerLeft = building.localX + 1;
  const innerTop = building.localY + 1;
  const innerRight = building.localX + building.localWidth - 2;
  const innerBottom = building.localY + building.localHeight - 2;
  if (x < innerLeft || y < innerTop || x > innerRight || y > innerBottom) return false;

  const centralX = innerLeft + Math.floor((innerRight - innerLeft) / 2);
  const centralY = innerTop + Math.floor((innerBottom - innerTop) / 2);
  if (building.type === 'warehouse') return x === centralX || y === centralY || (x - innerLeft) % 4 === 0;
  if (building.type === 'school') return x === centralX || (y - innerTop) % 5 === 0;
  if (building.type === 'castle' || building.type === 'manor') return x === centralX || y === centralY;
  if (building.floors > 1 && floor >= 0 && (x === innerLeft + 1 || y === innerTop + 1)) return true;
  return x === centralX && y >= innerTop;
}

function exactCirculationCells(building: Building): number {
  let count = 0;
  for (let floor = 0; floor < Math.max(1, building.floors); floor += 1) {
    for (let y = building.localY + 1; y <= building.localY + building.localHeight - 2; y += 1) {
      for (let x = building.localX + 1; x <= building.localX + building.localWidth - 2; x += 1) {
        if (circulationCell(building, x, y, floor)) count += 1;
      }
    }
  }
  return Math.min(Math.max(1, count), Math.max(1, (building.localWidth - 2) * (building.localHeight - 2) * Math.max(1, building.floors) - 1));
}

function layoutEfficiencyFor(type: Building['type']): number {
  if (type === 'warehouse') return .78;
  if (type === 'school' || type === 'healer' || type === 'prison') return .72;
  if (type === 'castle' || type === 'manor') return .68;
  if (type === 'house' || type === 'tenement' || type === 'barracks' || type === 'monastery') return .74;
  return .76;
}

function serviceRatioFor(type: Building['type']): number {
  if (type === 'house' || type === 'tenement') return .18;
  if (type === 'warehouse') return .08;
  if (type === 'school') return .14;
  if (type === 'castle' || type === 'manor') return .22;
  return .16;
}

function workstationCapacity(type: Building['type'], cells: number): number {
  const perStation = type === 'blacksmith' || type === 'bakery' || type === 'brewery' || type === 'winery' ? 10
    : type === 'warehouse' ? 18
      : type === 'market' || type === 'shop' || type === 'tavern' || type === 'inn' ? 8
        : type === 'townHall' || type === 'courthouse' || type === 'school' ? 7
          : type === 'farm' || type === 'mine' || type === 'quarry' || type === 'fishery' ? 12
            : 9;
  return Math.max(1, Math.floor(cells / perStation));
}

function storageCapacity(type: Building['type'], cells: number): number {
  const multiplier = type === 'warehouse' ? 18
    : type === 'arsenal' ? 12
      : type === 'market' || type === 'shop' || type === 'tavern' || type === 'inn' ? 7
        : type === 'farm' || type === 'mill' || type === 'bakery' || type === 'brewery' || type === 'winery' ? 8
          : type === 'house' || type === 'tenement' || type === 'manor' ? 2
            : 4;
  return Math.max(0, Math.floor(cells * multiplier));
}

function publicSeatCapacity(type: Building['type'], cells: number): number {
  if (type === 'tavern' || type === 'inn') return Math.max(6, Math.floor(cells / 2.4));
  if (type === 'temple' || type === 'monastery') return Math.max(8, Math.floor(cells / 2));
  if (type === 'castle' || type === 'townHall' || type === 'courthouse') return Math.max(8, Math.floor(cells / 3));
  if (type === 'market') return Math.max(4, Math.floor(cells / 4));
  return 0;
}
