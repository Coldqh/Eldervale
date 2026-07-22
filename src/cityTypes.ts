export type HousingStatus = 'secure' | 'overcrowded' | 'shared' | 'shelter' | 'homeless';

export type CityProblemKind =
  | 'homelessness'
  | 'overcrowding'
  | 'housing-shortage'
  | 'school-shortage'
  | 'unemployment'
  | 'worker-shortage'
  | 'storage-shortage'
  | 'land-shortage'
  | 'land-conflict'
  | 'water-shortage'
  | 'fire-risk';

export interface BuildingCapacityProfile {
  version: 1;
  usableFloorCells: number;
  circulationCells: number;
  serviceCells: number;
  residentialUnits: number;
  householdBeds: number;
  institutionalBeds: number;
  permanentBeds: number;
  shelterBeds: number;
  guestBeds: number;
  classrooms: number;
  studentSeats: number;
  teacherStations: number;
  workstations: number;
  storageVolume: number;
  loadingBays: number;
  publicSeats: number;
  treatmentBeds: number;
  prisonBeds: number;
  stableStalls: number;
}

export interface BuildingCityAudit {
  buildingId: number;
  settlementId: number;
  districtName: string;
  type: string;
  floorArea: number;
  circulationCells: number;
  residentCount: number;
  workerCount: number;
  studentCount: number;
  storageUsed: number;
  capacity: BuildingCapacityProfile;
  housingOccupancy: number;
  workOccupancy: number;
  storageOccupancy: number;
  overloaded: boolean;
  warnings: string[];
}

export interface HouseholdHousingAudit {
  householdId: number;
  buildingId?: number;
  memberCount: number;
  permanentBedCount: number;
  status: HousingStatus;
  overcrowdingRatio: number;
}

export interface CityProblem {
  id: string;
  kind: CityProblemKind;
  severity: number;
  title: string;
  description: string;
  causes: string[];
  consequences: string[];
  affectedBuildingIds: number[];
  affectedCharacterIds: number[];
  districtNames: string[];
}

export interface SettlementCityState {
  version: 1;
  settlementId: number;
  updatedTick: number;
  population: number;
  households: number;
  land: {
    totalCells: number;
    buildingCells: number;
    constructionCells: number;
    fieldCells: number;
    reservedPublicCells: number;
    freeBuildableCells: number;
    overlapCells: number;
    districtTiles: number;
    density: number;
  };
  housing: {
    residentialUnits: number;
    householdBeds: number;
    institutionalBeds: number;
    permanentBeds: number;
    occupiedBeds: number;
    peopleWithoutPermanentBed: number;
    shelterBeds: number;
    homelessPeople: number;
    overcrowdedPeople: number;
    overcrowdedHouseholds: number;
    vacancyRate: number;
  };
  education: {
    schoolAgeChildren: number;
    classrooms: number;
    studentSeats: number;
    teacherStations: number;
    activeTeachers: number;
    effectiveSeats: number;
    unservedChildren: number;
  };
  employment: {
    workingAgePeople: number;
    workstations: number;
    activeWorkers: number;
    unemployedPeople: number;
    vacantWorkstations: number;
  };
  storage: {
    capacity: number;
    used: number;
    overflow: number;
  };
  services: {
    waterCoverage: number;
    averageFireRisk: number;
    publicSeats: number;
    treatmentBeds: number;
    prisonBeds: number;
  };
  buildingAudits: BuildingCityAudit[];
  householdAudits: HouseholdHousingAudit[];
  problems: CityProblem[];
}
