import type {
  Building, BuildingType, ConstructionProject, ConstructionStage, CropKind, Establishment, EstablishmentType,
  FieldPlot, FieldState, Settlement, WorldState,
} from '../types';
import type { WorldIndexes } from './indexes';
import { appendCausalEvent } from './causality';
import { addMaterialItem, consumeSettlementMaterial } from './materialEconomy';
import { RNG, hashSeed } from './rng';
import { assignConstructionFootprint, assignFieldCells, buildingDimensions } from './spatial';
import { worldTick } from './scheduler';

interface CropDefinition {
  crop: CropKind;
  seedTemplateId: string;
  outputTemplateId: string;
  byproductTemplateId?: string;
  sowMonths: number[];
  harvestMonths: number[];
  baseYieldPerCell: number;
  moistureTarget: number;
  laborPerCell: number;
}

const CROPS: Record<CropKind, CropDefinition> = {
  пшеница: { crop: 'пшеница', seedTemplateId: 'wheat_seed', outputTemplateId: 'wheat', byproductTemplateId: 'straw', sowMonths: [3, 4], harvestMonths: [8, 9], baseYieldPerCell: .44, moistureTarget: 55, laborPerCell: 1.25 },
  ячмень: { crop: 'ячмень', seedTemplateId: 'barley_seed', outputTemplateId: 'barley', byproductTemplateId: 'straw', sowMonths: [3, 4], harvestMonths: [7, 8], baseYieldPerCell: .4, moistureTarget: 46, laborPerCell: 1.05 },
  рожь: { crop: 'рожь', seedTemplateId: 'rye_seed', outputTemplateId: 'rye', byproductTemplateId: 'straw', sowMonths: [2, 3], harvestMonths: [8, 9], baseYieldPerCell: .38, moistureTarget: 48, laborPerCell: 1.05 },
  лён: { crop: 'лён', seedTemplateId: 'flax_seed', outputTemplateId: 'flax', sowMonths: [3, 4], harvestMonths: [7, 8], baseYieldPerCell: .3, moistureTarget: 62, laborPerCell: 1.4 },
  овощи: { crop: 'овощи', seedTemplateId: 'vegetable_seed', outputTemplateId: 'vegetables', sowMonths: [3, 4, 5], harvestMonths: [7, 8, 9], baseYieldPerCell: .55, moistureTarget: 68, laborPerCell: 1.55 },
};

function equippedToolFactor(world: WorldState, workers: Array<WorldState['characters'][number] | undefined>, acceptedToolTypes: readonly string[]): number {
  const validWorkers = workers.filter((worker): worker is WorldState['characters'][number] => Boolean(worker?.alive));
  if (!validWorkers.length) return .18;
  const factors = validWorkers.map(worker => {
    const itemId = worker.equipment?.equippedItemIds?.workTool;
    const item = itemId ? world.items.find(candidate => candidate.id === itemId) : undefined;
    if (item && item.condition > 0 && item.toolType && acceptedToolTypes.includes(item.toolType)) return Math.max(.35, Math.min(1.2, .5 + item.condition / 150 + item.quality / 600));
    if (worker.equipment?.compact && worker.equipment.condition > 15) return Math.max(.45, Math.min(.9, .45 + worker.equipment.condition / 180));
    return .16;
  });
  return factors.reduce((sum, value) => sum + value, 0) / factors.length;
}

const ESTABLISHMENT_FOR_BUILDING: Partial<Record<BuildingType, EstablishmentType>> = {
  farm: 'ферма', mill: 'мельница', bakery: 'пекарня', tavern: 'таверна', inn: 'постоялый двор', brewery: 'пивоварня', winery: 'винодельня',
  blacksmith: 'кузница', carpenter: 'плотницкая мастерская', weaver: 'ткацкая мастерская', tailor: 'портная мастерская', dyehouse: 'красильня', tannery: 'кожевенная мастерская', cobbler: 'сапожная мастерская', armorer: 'бронная мастерская', toolmaker: 'инструментальная мастерская', kiln: 'кирпичная мастерская', quarry: 'каменоломня',
  market: 'рынок', shop: 'лавка', bathhouse: 'баня', healer: 'лечебница', temple: 'храм', guildhall: 'гильдейский дом', warehouse: 'склад', stable: 'конюшня', fishery: 'рыбный промысел', mine: 'рудник',
};

const PROFESSION_FOR_ESTABLISHMENT: Record<EstablishmentType, string[]> = {
  'таверна': ['brewer', 'merchant'], 'постоялый двор': ['merchant', 'brewer'], 'пекарня': ['miller', 'brewer'], 'пивоварня': ['brewer'], 'винодельня': ['brewer'],
  'кузница': ['blacksmith'], 'плотницкая мастерская': ['carpenter'], 'ткацкая мастерская': ['weaver'], 'портная мастерская': ['tailor', 'weaver'], 'красильня': ['dyer', 'weaver'], 'кожевенная мастерская': ['tanner'], 'сапожная мастерская': ['cobbler', 'tanner'], 'бронная мастерская': ['armorer', 'blacksmith'], 'инструментальная мастерская': ['toolmaker', 'blacksmith'], 'кирпичная мастерская': ['carpenter', 'miner'], 'каменоломня': ['miner'],
  'рынок': ['merchant'], 'лавка': ['merchant'], 'продовольственная лавка': ['merchant'], 'одежная лавка': ['merchant', 'tailor'], 'оружейная лавка': ['merchant', 'blacksmith'], 'баня': ['healer', 'merchant'], 'лечебница': ['healer', 'herbalist'], 'храм': ['priest'], 'гильдейский дом': ['merchant', 'scribe'],
  'склад': ['merchant'], 'конюшня': ['farmer', 'guard'], 'мельница': ['miller'], 'ферма': ['farmer'], 'рыбный промысел': ['fisher'], 'рудник': ['miner'],
};

export function initializeAgricultureAndConstruction(world: WorldState, rng: RNG): void {
  world.fields ??= [];
  world.constructionProjects ??= [];
  world.nextIds.field ??= Math.max(0, ...world.fields.map(field => field.id)) + 1;
  world.nextIds.constructionProject ??= Math.max(0, ...world.constructionProjects.map(project => project.id)) + 1;
  ensureFieldsForFarms(world, rng);
}

export function ensureFieldsForFarms(world: WorldState, rng: RNG): void {
  const existingFarmIds = new Set(world.fields.map(field => field.farmBuildingId));
  const farms = world.buildings.filter(building => building.type === 'farm');
  for (const farm of farms) {
    if (existingFarmIds.has(farm.id)) continue;
    const settlement = world.settlements.find(item => item.id === farm.settlementId);
    if (!settlement) continue;
    const establishment = world.establishments.find(item => item.buildingId === farm.id);
    const fieldCount = Math.max(1, Math.min(4, Math.ceil(farm.capacity / 16)));
    for (let index = 0; index < fieldCount; index += 1) {
      const id = world.nextIds.field++;
      const desiredCells = Math.max(28, Math.min(120, Math.round(farm.capacity * rng.int(160, 260) / 100 / fieldCount)));
      const crop = chooseCrop(world, farm, index);
      const cells = assignFieldCells(world, farm.globalX, farm.globalY, { x: farm.localX + farm.localWidth, y: farm.localY + farm.localHeight }, desiredCells, `${world.config.seed}:поле:${id}`, id);
      if (!cells.length) continue;
      const field: FieldPlot = {
        id, settlementId: settlement.id, farmBuildingId: farm.id, establishmentId: establishment?.id, globalX: farm.globalX, globalY: farm.globalY,
        cells, crop, state: stateForMonth(world.month), fertility: rng.int(48, 92), moisture: rng.int(38, 82), weeds: rng.int(0, 24), pests: rng.int(0, 12),
        expectedYield: Math.max(1, Math.round(cells.length * CROPS[crop].baseYieldPerCell)), laborRequired: Math.max(12, Math.round(cells.length * CROPS[crop].laborPerCell)),
        laborDone: 0, lastWorkedTick: worldTick(world), history: [`Поле размечено у ${farm.name}.`],
      };
      world.fields.push(field);
      seedFarmForField(world, field);
    }
  }
}

function chooseCrop(world: WorldState, farm: Building, index: number): CropKind {
  const terrain = world.tiles[farm.globalY * world.config.width + farm.globalX]?.terrain;
  const choices: CropKind[] = terrain === 'marsh' ? ['овощи', 'лён', 'рожь'] : terrain === 'tundra' ? ['рожь', 'ячмень'] : terrain === 'desert' ? ['ячмень', 'овощи'] : ['пшеница', 'ячмень', 'рожь', 'лён', 'овощи'];
  return choices[hashSeed(`${world.config.seed}:культура:${farm.id}:${index}`) % choices.length]!;
}

function stateForMonth(month: number): FieldState {
  if (month <= 2) return 'пар';
  if (month === 3) return 'подготовка';
  if (month === 4) return 'посеяно';
  if (month === 5) return 'всходы';
  if (month <= 7) return 'рост';
  if (month === 8) return 'созревание';
  if (month === 9) return 'готово к жатве';
  return 'убрано';
}

function seedFarmForField(world: WorldState, field: FieldPlot): void {
  const seed = CROPS[field.crop].seedTemplateId;
  const owner = field.establishmentId ? { establishmentId: field.establishmentId, buildingId: field.farmBuildingId } : { buildingId: field.farmBuildingId };
  addMaterialItem(world, seed, Math.max(3, Math.ceil(field.cells.length / 12)), field.settlementId, owner, `семенной запас поля №${field.id}`, 58);
}

export function advanceAgriculture(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>): void {
  if (!world.fields?.length) initializeAgricultureAndConstruction(world, rng);
  const tick = worldTick(world);
  for (const field of world.fields) {
    if (!settlementIds.has(field.settlementId)) continue;
    const crop = CROPS[field.crop];
    const tile = indexes.tileByCoordinate.get(`${field.globalX}:${field.globalY}`);
    const establishment = field.establishmentId ? indexes.establishmentById.get(field.establishmentId) : undefined;
    const workers = establishment?.workerIds.map(id => indexes.characterById.get(id)).filter(character => character?.alive) ?? [];
    const farmerSkill = workers.length ? workers.reduce((sum, character) => sum + (character?.skills.farmer ?? 8), 0) / workers.length : 5;
    const toolFactor = equippedToolFactor(world, workers, ['земледелие']);
    const availableLabor = Math.max(.5, workers.length * (9 + farmerSkill / 8) * toolFactor);
    const weatherMoisture = (tile?.moisture ?? 50) + rng.int(-14, 14);
    field.moisture = clamp(field.moisture * .65 + weatherMoisture * .35, 0, 100);

    if (world.month <= 2) {
      if (field.state === 'убрано' || field.state === 'погибло') rotateField(field, world);
      field.state = 'пар';
      field.weeds = Math.max(0, field.weeds - 8);
      field.pests = Math.max(0, field.pests - 6);
      field.laborDone = 0;
      continue;
    }

    if (world.month === 3 && field.state === 'пар') field.state = 'подготовка';
    if (field.state === 'подготовка') {
      field.laborDone += availableLabor;
      field.weeds = Math.max(0, field.weeds - Math.round(availableLabor / 8));
      if (field.laborDone >= field.cells.length * .35 && crop.sowMonths.includes(world.month)) {
        const neededSeed = Math.max(1, Math.ceil(field.cells.length / 12));
        const delivered = consumeSettlementMaterial(world, field.settlementId, crop.seedTemplateId, neededSeed);
        if (delivered >= neededSeed * .75) {
          field.state = 'посеяно'; field.plantedYear = world.year; field.plantedMonth = world.month; field.laborDone = 0;
          field.history.push(`В ${world.year}.${String(world.month).padStart(2, '0')} поле засеяно: ${field.crop}.`);
        }
      }
      field.lastWorkedTick = tick;
      continue;
    }

    if (field.state === 'посеяно' && tick - field.lastWorkedTick >= 1) field.state = 'всходы';
    else if (field.state === 'всходы' && world.month >= 5) field.state = 'рост';
    else if (field.state === 'рост' && world.month >= 7) field.state = 'созревание';
    else if (field.state === 'созревание' && crop.harvestMonths.includes(world.month)) field.state = 'готово к жатве';

    if (['всходы', 'рост', 'созревание'].includes(field.state)) {
      const care = Math.min(availableLabor, field.cells.length * .35);
      field.laborDone += care;
      field.weeds = clamp(field.weeds + rng.int(2, 8) - care / 9, 0, 100);
      field.pests = clamp(field.pests + rng.int(-2, 7) - care / 14, 0, 100);
      if (Math.abs(field.moisture - crop.moistureTarget) > 38) field.fertility = Math.max(15, field.fertility - rng.int(1, 4));
      field.lastWorkedTick = tick;
    }

    if (field.state === 'готово к жатве') harvestField(world, field, crop, establishment, availableLabor, rng);
    if (world.month >= 11 && !['убрано', 'пар'].includes(field.state)) failField(world, field, 'урожай не успели убрать до холодов');
  }
}

function harvestField(world: WorldState, field: FieldPlot, crop: CropDefinition, establishment: Establishment | undefined, availableLabor: number, rng: RNG): void {
  field.laborDone += availableLabor;
  if (field.laborDone < field.laborRequired) return;
  const moistureFactor = Math.max(.2, 1 - Math.abs(field.moisture - crop.moistureTarget) / 100);
  const careFactor = Math.max(.15, 1 - field.weeds / 150 - field.pests / 130);
  const fertilityFactor = .45 + field.fertility / 125;
  const randomFactor = rng.int(82, 118) / 100;
  const yieldAmount = Math.max(1, Math.round(field.cells.length * crop.baseYieldPerCell * moistureFactor * careFactor * fertilityFactor * randomFactor));
  const owner = establishment ? { establishmentId: establishment.id, buildingId: field.farmBuildingId } : { buildingId: field.farmBuildingId };
  addMaterialItem(world, crop.outputTemplateId, yieldAmount, field.settlementId, owner, `урожай поля №${field.id}`, Math.round(40 + field.fertility * .45));
  if (crop.byproductTemplateId) addMaterialItem(world, crop.byproductTemplateId, Math.max(1, Math.round(yieldAmount * .7)), field.settlementId, owner, `побочный продукт жатвы поля №${field.id}`, 45);
  addMaterialItem(world, crop.seedTemplateId, Math.max(1, Math.ceil(field.cells.length / 15)), field.settlementId, owner, `семена, отобранные после жатвы поля №${field.id}`, 62);
  field.state = 'убрано'; field.harvestedYear = world.year; field.expectedYield = yieldAmount; field.laborDone = 0;
  field.fertility = clamp(field.fertility - rng.int(2, 7), 20, 100);
  field.history.push(`В ${world.year} году собрано ${yieldAmount} единиц урожая.`);
  const settlement = world.settlements.find(item => item.id === field.settlementId);
  if (settlement) settlement.food = Math.min(100, settlement.food + Math.max(1, Math.round(yieldAmount / Math.max(8, settlement.population / 10))));
  if (yieldAmount <= Math.max(2, field.cells.length * crop.baseYieldPerCell * .35) || yieldAmount >= field.cells.length * crop.baseYieldPerCell * 1.05) {
    appendCausalEvent(world, {
      kind: 'agriculture', title: yieldAmount < field.cells.length * crop.baseYieldPerCell * .5 ? `Слабый урожай: ${field.crop}` : `Богатый урожай: ${field.crop}`,
      description: `Поле №${field.id} дало ${yieldAmount} единиц продукции.`,
      cause: `влажность ${Math.round(field.moisture)}%, плодородие ${Math.round(field.fertility)}%, сорняки ${Math.round(field.weeds)}%`,
      conditions: [`обработано ${field.cells.length} клеток`, `уход выполнили ${establishment?.workerIds.length ?? 0} работников`],
      decision: 'фермеры завершили жатву и отобрали семена', outcome: `урожай помещён в запасы фермы`,
      consequences: yieldAmount < field.cells.length * crop.baseYieldPerCell * .5 ? ['местные цены на пищу могут вырасти'] : ['запасы пищи и семян выросли'],
      entityRefs: [{ kind: 'field', id: field.id }, { kind: 'settlement', id: field.settlementId }], importance: 2,
    });
  }
}

function failField(world: WorldState, field: FieldPlot, cause: string): void {
  if (field.state === 'погибло') return;
  field.state = 'погибло'; field.history.push(`В ${world.year} году урожай погиб: ${cause}.`);
  appendCausalEvent(world, {
    kind: 'agriculture', title: `Погиб урожай на поле №${field.id}`, description: `${field.crop} не удалось собрать.`, cause,
    conditions: [`влажность ${Math.round(field.moisture)}%`, `сорняки ${Math.round(field.weeds)}%`, `вредители ${Math.round(field.pests)}%`],
    decision: 'фермеры оставили погибшие растения и начали готовиться к следующему сезону', outcome: 'поле не принесло продукции',
    consequences: ['семенной запас сократился', 'поселение получит меньше пищи'], entityRefs: [{ kind: 'field', id: field.id }], importance: 2,
  });
}

function rotateField(field: FieldPlot, world: WorldState): void {
  const rotation: CropKind[] = ['пшеница', 'ячмень', 'лён', 'рожь', 'овощи'];
  const current = rotation.indexOf(field.crop);
  field.crop = rotation[(current + 1 + hashSeed(`${world.config.seed}:${field.id}:${world.year}`) % 2) % rotation.length]!;
  field.fertility = clamp(field.fertility + (field.crop === 'лён' ? -1 : 4), 20, 100);
  field.state = 'пар'; field.plantedYear = undefined; field.plantedMonth = undefined; field.harvestedYear = undefined;
  field.expectedYield = Math.max(1, Math.round(field.cells.length * CROPS[field.crop].baseYieldPerCell));
  field.laborRequired = Math.max(12, Math.round(field.cells.length * CROPS[field.crop].laborPerCell));
  seedFarmForField(world, field);
}

export function requestConstructionProject(world: WorldState, settlement: Settlement, type: BuildingType, reason: string, rng: RNG): ConstructionProject | undefined {
  world.constructionProjects ??= [];
  if (world.constructionProjects.some(project => project.settlementId === settlement.id && project.buildingType === type && !['завершено', 'заброшено'].includes(project.stage))) return undefined;
  const dimensions = buildingDimensions(type, type === 'tenement' || type === 'manor' ? 2 : 1);
  const district = chooseConstructionDistrict(settlement, type);
  if (!district) return undefined;
  const project: ConstructionProject = {
    id: world.nextIds.constructionProject++, settlementId: settlement.id, requestedByKingdomId: settlement.kingdomId, buildingType: type,
    name: constructionName(type, settlement, world.nextIds.constructionProject), reason, globalX: district.x, globalY: district.y,
    localX: 4 + rng.int(0, Math.max(1, (world.config.localMapSize ?? 128) - dimensions.width - 9)), localY: 4 + rng.int(0, Math.max(1, (world.config.localMapSize ?? 128) - dimensions.height - 9)),
    localWidth: dimensions.width, localHeight: dimensions.height, entranceX: 0, entranceY: 0,
    requiredMaterials: constructionMaterials(type), deliveredMaterials: {}, laborRequired: constructionLabor(type), laborDone: 0,
    builderIds: [], stage: 'планирование', startedYear: world.year, startedMonth: world.month,
    history: [`Проект утверждён в ${world.year}.${String(world.month).padStart(2, '0')}: ${reason}.`],
  };
  assignConstructionFootprint(world, project);
  world.constructionProjects.push(project);
  appendCausalEvent(world, {
    kind: 'construction', title: `Начато строительство: ${project.name}`, description: `В ${settlement.name} размечена площадка ${project.localWidth}×${project.localHeight} клеток.`,
    cause: reason, conditions: ['местная власть или община выделила участок', 'проект получил список материалов и объём работ'],
    decision: `построить ${project.name}`, outcome: 'площадка зарезервирована, начат подвоз материалов',
    consequences: ['строители получат работу', 'спрос на древесину, камень и крепёж вырастет'], entityRefs: [{ kind: 'constructionProject', id: project.id }, { kind: 'settlement', id: settlement.id }], importance: 2,
  });
  return project;
}

export function advanceConstruction(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>): void {
  if (!world.constructionProjects) world.constructionProjects = [];
  if ([2, 8].includes(world.month)) evaluateConstructionNeeds(world, rng, indexes, settlementIds);
  for (const project of world.constructionProjects) {
    if (!settlementIds.has(project.settlementId) || ['завершено', 'заброшено'].includes(project.stage)) continue;
    const settlement = indexes.settlementById.get(project.settlementId);
    if (!settlement) { project.stage = 'заброшено'; continue; }
    project.builderIds = chooseBuilders(world, project, indexes);
    deliverProjectMaterials(world, project, settlement);
    const materialRatio = projectMaterialRatio(project);
    const workers = project.builderIds.map(id => indexes.characterById.get(id)).filter(character => character?.alive);
    const skill = workers.length ? workers.reduce((sum, worker) => sum + Math.max(worker?.skills.carpenter ?? 0, worker?.skills.miner ?? 0, 8), 0) / workers.length : 4;
    const toolFactor = equippedToolFactor(world, workers, ['плотницкое дело', 'добыча', 'кузнечное дело']);
    const laborThisMonth = materialRatio < .12 ? 0 : Math.max(.25, workers.length * (5 + skill / 9) * toolFactor);
    project.laborDone = Math.min(project.laborRequired, project.laborDone + laborThisMonth);
    if (materialRatio >= .995 && project.laborDone >= project.laborRequired) completeConstruction(world, project, settlement, rng, indexes);
    else if (world.year - project.startedYear >= 12 && materialRatio < .35) {
      project.stage = 'заброшено'; project.history.push(`Стройка заброшена в ${world.year} году из-за многолетней нехватки материалов.`);
    } else project.stage = constructionStage(project, materialRatio);
  }
}

function evaluateConstructionNeeds(world: WorldState, rng: RNG, indexes: WorldIndexes, settlementIds: ReadonlySet<number>): void {
  for (const settlementId of settlementIds) {
    const settlement = indexes.settlementById.get(settlementId);
    if (!settlement) continue;
    const active = world.constructionProjects.filter(project => project.settlementId === settlement.id && !['завершено', 'заброшено'].includes(project.stage));
    if (active.length >= 3) continue;
    const counts = new Map<BuildingType, number>();
    for (const building of indexes.buildingsBySettlement.get(settlement.id) ?? []) counts.set(building.type, (counts.get(building.type) ?? 0) + 1);
    const spare = settlement.residentialCapacity - settlement.population;
    if (spare < Math.max(3, Math.ceil(settlement.population * .025))) {
      requestConstructionProject(world, settlement, settlement.population > 900 ? 'tenement' : 'house', 'население приблизилось к пределу существующего жилья', rng);
      continue;
    }
    const targets: [BuildingType, number, string][] = [
      ['warehouse', Math.max(1, Math.ceil(settlement.population / 700)), 'склады не успевают принимать урожай и стройматериалы'],
      ['mill', settlement.population >= 80 ? Math.max(1, Math.ceil(settlement.population / 650)) : 0, 'поселению не хватает мощностей для помола зерна'],
      ['bakery', settlement.population >= 120 ? Math.max(1, Math.ceil(settlement.population / 500)) : 0, 'растущему населению требуется больше хлеба'],
      ['kiln', settlement.population >= 320 ? Math.max(1, Math.ceil(settlement.population / 1800)) : 0, 'строительству нужны кирпич и известь'],
      ['quarry', settlement.population >= 220 ? Math.max(1, Math.ceil(settlement.population / 1200)) : 0, 'местным стройкам не хватает камня и глины'],
      ['market', settlement.population >= 260 ? Math.max(1, Math.ceil(settlement.population / 1400)) : 0, 'торговые ряды переполнены'],
    ];
    const missing = targets.find(([type, target]) => (counts.get(type) ?? 0) + active.filter(project => project.buildingType === type).length < target);
    if (missing) requestConstructionProject(world, settlement, missing[0], missing[2], rng);
  }
}

function constructionMaterials(type: BuildingType): Record<string, number> {
  const base: Record<string, number> = { timber: 10, planks: 12, stone: 8, nails: 3, lime: 2 };
  if (type === 'house') return { timber: 8, planks: 10, stone: 4, nails: 2 };
  if (type === 'tenement' || type === 'manor') return { timber: 18, planks: 28, stone: 24, bricks: 18, nails: 6, lime: 6 };
  if (type === 'warehouse' || type === 'barracks') return { timber: 20, planks: 22, stone: 18, nails: 6, lime: 4 };
  if (type === 'kiln') return { stone: 22, bricks: 20, clay: 14, timber: 6, lime: 4 };
  if (type === 'quarry' || type === 'mine') return { timber: 16, planks: 10, tools: 4, rope: 3, nails: 3 };
  if (type === 'temple' || type === 'guildhall' || type === 'market') return { stone: 28, bricks: 20, timber: 14, planks: 18, nails: 5, lime: 8 };
  if (type === 'farm' || type === 'stable') return { timber: 14, planks: 12, stone: 5, nails: 3, straw: 8 };
  return base;
}

function constructionLabor(type: BuildingType): number {
  const dimensions = buildingDimensions(type, type === 'tenement' || type === 'manor' ? 2 : 1);
  const multiplier = ['tenement', 'manor', 'temple', 'guildhall'].includes(type) ? 6 : ['warehouse', 'barracks', 'kiln'].includes(type) ? 4.5 : 3.2;
  return Math.round(dimensions.width * dimensions.height * multiplier);
}

function chooseConstructionDistrict(settlement: Settlement, type: BuildingType) {
  const preferredRoles = type === 'farm' || type === 'quarry' || type === 'mine' ? ['поля', 'окраина'] : type === 'kiln' ? ['ремесленный район', 'окраина'] : type === 'house' || type === 'tenement' ? ['жилой район', 'окраина', 'центр'] : ['ремесленный район', 'центр', 'рынок'];
  return settlement.districts.find(district => preferredRoles.includes(district.role)) ?? settlement.districts[0];
}

function constructionName(type: BuildingType, settlement: Settlement, serial: number): string {
  const labels: Partial<Record<BuildingType, string>> = { house: 'жилой дом', tenement: 'доходный дом', manor: 'усадьба', warehouse: 'склад', mill: 'мельница', bakery: 'пекарня', kiln: 'кирпичная мастерская', quarry: 'каменоломня', market: 'рынок', farm: 'ферма', barracks: 'казарма', temple: 'храм' };
  return `${labels[type] ?? type} «${settlement.name.split(' ')[0]}-${serial}»`;
}

function deliverProjectMaterials(world: WorldState, project: ConstructionProject, settlement: Settlement): void {
  for (const [templateId, required] of Object.entries(project.requiredMaterials)) {
    const delivered = project.deliveredMaterials[templateId] ?? 0;
    if (delivered >= required) continue;
    const monthlyTarget = Math.min(required - delivered, Math.max(1, required * .28));
    let moved = consumeSettlementMaterial(world, settlement.id, templateId, monthlyTarget);
    const stockpileKey: Record<string, string> = { timber: 'древесина', stone: 'камень', iron: 'железо', clay: 'глина' };
    const key = stockpileKey[templateId];
    if (moved < monthlyTarget && key) {
      const available = settlement.stockpile[key] ?? 0;
      const fromStockpile = Math.min(available, monthlyTarget - moved);
      settlement.stockpile[key] = available - fromStockpile;
      moved += fromStockpile;
    }
    project.deliveredMaterials[templateId] = delivered + moved;
  }
}

function projectMaterialRatio(project: ConstructionProject): number {
  const entries = Object.entries(project.requiredMaterials);
  if (!entries.length) return 1;
  return entries.reduce((sum, [id, required]) => sum + Math.min(1, (project.deliveredMaterials[id] ?? 0) / Math.max(.001, required)), 0) / entries.length;
}

function constructionStage(project: ConstructionProject, materialRatio: number): ConstructionStage {
  const laborRatio = project.laborDone / Math.max(1, project.laborRequired);
  const progress = Math.min(materialRatio, laborRatio * 1.18 + .04);
  if (materialRatio < .12) return 'доставка материалов';
  if (progress < .18) return 'фундамент';
  if (progress < .4) return 'каркас';
  if (progress < .62) return 'стены';
  if (progress < .8) return 'крыша';
  return 'отделка';
}

function chooseBuilders(world: WorldState, project: ConstructionProject, indexes: WorldIndexes): number[] {
  const candidates = (indexes.residentsBySettlement.get(project.settlementId) ?? [])
    .filter(character => character.alive && character.age >= 16 && ['carpenter', 'miner', 'farmer', 'blacksmith'].includes(character.profession))
    .sort((a, b) => Math.max(b.skills.carpenter ?? 0, b.skills.miner ?? 0) - Math.max(a.skills.carpenter ?? 0, a.skills.miner ?? 0) || a.id - b.id);
  return candidates.slice(0, Math.max(2, Math.min(18, Math.ceil(project.laborRequired / 50)))).map(character => character.id);
}

function completeConstruction(world: WorldState, project: ConstructionProject, settlement: Settlement, rng: RNG, indexes: WorldIndexes): void {
  const floors = project.buildingType === 'tenement' || project.buildingType === 'manor' ? 2 : 1;
  const building: Building = {
    id: world.nextIds.building++, settlementId: settlement.id, districtName: settlement.districts.find(district => district.x === project.globalX && district.y === project.globalY)?.name ?? settlement.districts[0]?.name ?? 'Новый район',
    globalX: project.globalX, globalY: project.globalY, localX: project.localX, localY: project.localY, localWidth: project.localWidth, localHeight: project.localHeight,
    entranceX: project.entranceX, entranceY: project.entranceY, name: project.name, type: project.buildingType, floors,
    capacity: completedBuildingCapacity(project.buildingType, project.localWidth, project.localHeight), condition: rng.int(92, 100), builtYear: world.year,
    residentIds: [], workerIds: [], inventoryItemIds: [], rooms: completedBuildingRooms(project.buildingType), hasWater: !['quarry', 'mine', 'kiln'].includes(project.buildingType),
    hasHearth: !['warehouse', 'market', 'quarry', 'mine'].includes(project.buildingType), history: [...project.history, `Завершено в ${world.year}.${String(world.month).padStart(2, '0')}.`],
  };
  world.buildings.push(building); settlement.buildingIds.push(building.id); indexes.buildingById.set(building.id, building);
  const list = indexes.buildingsBySettlement.get(settlement.id) ?? []; list.push(building); indexes.buildingsBySettlement.set(settlement.id, list);
  if (['house', 'tenement', 'manor', 'barracks', 'monastery'].includes(building.type)) settlement.residentialCapacity += building.capacity;
  project.stage = 'завершено'; project.completedYear = world.year; project.completedMonth = world.month; project.buildingId = building.id;
  project.history.push(`Строительство завершено; создано здание №${building.id}.`);
  const establishment = createEstablishmentForBuilding(world, building, settlement, rng, indexes);
  if (building.type === 'farm') ensureFieldsForFarms(world, rng);
  appendCausalEvent(world, {
    kind: 'construction', title: `Завершено строительство: ${building.name}`, description: `Постройка заняла ${world.year - project.startedYear} лет и ${Math.max(0, world.month - project.startedMonth)} месяцев.`,
    cause: project.reason, conditions: Object.entries(project.requiredMaterials).map(([id, amount]) => `${id}: ${Math.round(amount)}`),
    decision: 'строители завершили отделку и передали объект владельцам', outcome: establishment ? `открыто заведение ${establishment.name}` : 'здание введено в использование',
    consequences: ['материалы превратились в физическое здание', 'местная вместимость и производство изменились'],
    entityRefs: [{ kind: 'constructionProject', id: project.id }, { kind: 'building', id: building.id }, { kind: 'settlement', id: settlement.id }, ...(establishment ? [{ kind: 'establishment' as const, id: establishment.id }] : [])], importance: 3,
  });
}

function createEstablishmentForBuilding(world: WorldState, building: Building, settlement: Settlement, rng: RNG, indexes: WorldIndexes): Establishment | undefined {
  const type = ESTABLISHMENT_FOR_BUILDING[building.type];
  if (!type) return undefined;
  const preferred = PROFESSION_FOR_ESTABLISHMENT[type];
  const residents = indexes.residentsBySettlement.get(settlement.id) ?? [];
  const owner = residents.filter(character => character.alive && character.age >= 18).sort((a, b) => Number(preferred.includes(b.profession)) - Number(preferred.includes(a.profession)) || b.wealth - a.wealth || a.id - b.id)[0];
  if (!owner) return undefined;
  const workers = [owner, ...residents.filter(character => character.id !== owner.id && character.alive && character.age >= 16 && !character.employerEstablishmentId && preferred.includes(character.profession)).slice(0, Math.max(1, Math.ceil(building.capacity / 10)))];
  const establishment: Establishment = {
    id: world.nextIds.establishment++, settlementId: settlement.id, buildingId: building.id, name: building.name, type, ownerCharacterId: owner.id,
    workerIds: workers.map(worker => worker.id), supplierEstablishmentIds: [], customerHouseholdIds: [], inventoryItemIds: [],
    recipeIds: world.productionRecipes.filter(recipe => recipe.establishmentTypes.includes(type)).map(recipe => recipe.id), openHour: 7, closeHour: 19,
    reputation: rng.int(35, 65), cash: Math.max(20, owner.wealth * .35), debt: 0, monthlyRevenue: 0, monthlyExpenses: 0, active: true, menu: {}, history: [`Открыто после завершения строительства в ${world.year} году.`],
  };
  world.establishments.push(establishment); settlement.establishmentIds.push(establishment.id); building.establishmentId = establishment.id; building.ownerCharacterId = owner.id; building.workerIds = [...establishment.workerIds];
  indexes.establishmentById.set(establishment.id, establishment); const list = indexes.establishmentsBySettlement.get(settlement.id) ?? []; list.push(establishment); indexes.establishmentsBySettlement.set(settlement.id, list);
  for (const worker of workers) {
    worker.employerEstablishmentId = establishment.id; worker.workplaceBuildingId = building.id; worker.workplace = establishment.name;
    const contract = { id: world.nextIds.employment++, characterId: worker.id, establishmentId: establishment.id, role: worker.id === owner.id ? 'владелец и мастер' : worker.profession, wage: worker.id === owner.id ? 0 : rng.int(4, 10), hoursPerWeek: rng.int(38, 58), sinceYear: world.year, active: true };
    world.employments.push(contract); indexes.employmentById.set(contract.id, contract); worker.employmentContractId = contract.id;
  }
  return establishment;
}

function completedBuildingCapacity(type: BuildingType, width: number, height: number): number {
  const area = width * height;
  if (type === 'house') return Math.max(4, Math.round(area / 5));
  if (type === 'tenement') return Math.max(18, Math.round(area * .65));
  if (type === 'manor') return Math.max(10, Math.round(area * .35));
  if (type === 'warehouse' || type === 'market') return Math.round(area * 3);
  return Math.max(8, Math.round(area * .8));
}

function completedBuildingRooms(type: BuildingType): string[] {
  const map: Partial<Record<BuildingType, string[]>> = {
    house: ['общая комната', 'спальные места', 'кладовая'], tenement: ['коридор', 'жилые комнаты', 'общая кухня'], warehouse: ['склад', 'погрузочный двор'],
    mill: ['мельничный зал', 'склад зерна'], bakery: ['печи', 'склад муки', 'лавка'], kiln: ['обжиговая печь', 'сушильный двор', 'склад'], quarry: ['карьер', 'навес инструментов'],
    farm: ['жилой двор', 'сарай', 'склад семян'], market: ['торговые ряды', 'весовая'], barracks: ['спальное помещение', 'оружейная', 'тренировочный двор'],
  };
  return map[type] ?? ['рабочее помещение', 'кладовая'];
}

export function agricultureConstructionIntegrityIssues(world: WorldState): string[] {
  const issues: string[] = [];
  const buildingIds = new Set(world.buildings.map(building => building.id));
  const settlementIds = new Set(world.settlements.map(settlement => settlement.id));
  const fieldIds = new Set<number>();
  const occupiedByTile = new Map<string, Set<string>>();
  for (const field of world.fields ?? []) {
    if (fieldIds.has(field.id)) issues.push(`Поле ${field.id}: повторяющийся ID`); fieldIds.add(field.id);
    if (!settlementIds.has(field.settlementId)) issues.push(`Поле ${field.id}: нет поселения`);
    if (!buildingIds.has(field.farmBuildingId)) issues.push(`Поле ${field.id}: нет фермы`);
    if (!field.cells.length) issues.push(`Поле ${field.id}: нет занятых клеток`);
    const tileKey = `${field.globalX}:${field.globalY}`; const occupied = occupiedByTile.get(tileKey) ?? new Set<string>();
    for (const cell of field.cells) { const key = `${cell.x}:${cell.y}`; if (occupied.has(key)) issues.push(`Поле ${field.id}: клетка ${key} занята другим полем`); occupied.add(key); }
    occupiedByTile.set(tileKey, occupied);
  }
  for (const project of world.constructionProjects ?? []) {
    if (!settlementIds.has(project.settlementId)) issues.push(`${project.name}: нет поселения`);
    if (project.localWidth < 4 || project.localHeight < 4) issues.push(`${project.name}: неверная площадь стройки`);
    for (const [id, required] of Object.entries(project.requiredMaterials)) if ((project.deliveredMaterials[id] ?? 0) > required + .001) issues.push(`${project.name}: доставлено слишком много материала ${id}`);
    if (project.stage === 'завершено' && (!project.buildingId || !buildingIds.has(project.buildingId))) issues.push(`${project.name}: завершённая стройка не создала здание`);
  }
  return issues;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
