import type { BuildingInteriorPlan } from './interiorTypes';
import type { BuildingCapacityProfile, HousingStatus, SettlementCityState, SettlementLayoutPlan, UrbanState } from './cityTypes';
import type { Civilization } from './civilizationTypes';
import type { SettlementTechnologyKnowledge, TechnologyTransmission } from './technologyKnowledgeTypes';
import type { SettlementExpedition } from './settlementLifecycleTypes';
import type { PoliticalCommunity, PoliticalTransition } from './stateFormationTypes';
import type { ResourceDeposit, SettlementRegionalEconomy, TradeContract } from './regionalEconomyTypes';
import type { InstitutionDecision } from './institutionTypes';
export type Terrain = 'ocean' | 'coast' | 'plains' | 'forest' | 'hills' | 'mountains' | 'marsh' | 'desert' | 'tundra';
export type Species = 'human' | 'elf' | 'orc' | 'dwarf';
export type EventKind = 'health' | 'disease' | 'birth' | 'death' | 'war' | 'battle' | 'dragon' | 'monster' | 'hero' | 'artifact' | 'book' | 'settlement' | 'politics' | 'trade' | 'dynasty' | 'disaster' | 'ecology' | 'hunt' | 'foraging' | 'alchemy' | 'migration' | 'construction' | 'agriculture' | 'household' | 'food' | 'craft' | 'work' | 'establishment' | 'market' | 'equipment' | 'employment' | 'retail' | 'military' | 'knowledge' | 'rumor' | 'message' | 'crime' | 'justice' | 'fire' | 'civic' | 'poverty' | 'state' | 'court' | 'rebellion' | 'diplomacy' | 'culture' | 'religion' | 'education';
export type EntityKind = 'kingdom' | 'settlement' | 'character' | 'army' | 'battleRecord' | 'monster' | 'artifact' | 'book' | 'dungeon' | 'war' | 'dynasty' | 'tradeRoute' | 'animalPopulation' | 'ingredient' | 'recipe' | 'building' | 'household' | 'establishment' | 'item' | 'productionRecipe' | 'field' | 'constructionProject' | 'cemetery' | 'burial' | 'travelingMerchant' | 'militaryUnit' | 'supplyWagon' | 'knowledgeFact' | 'rumor' | 'message' | 'settlementGovernment' | 'districtCivic' | 'crime' | 'courtCase' | 'fireIncident' | 'patrol' | 'kingdomGovernment' | 'nobleTitle' | 'vassalContract' | 'courtOffice' | 'courtFaction' | 'royalOrder' | 'stateCrisis' | 'diplomaticAgreement' | 'culture' | 'language' | 'religion';
export type RelationKind = 'родство' | 'дружба' | 'любовь' | 'верность' | 'долг' | 'страх' | 'соперничество' | 'ненависть';
export type SocialContextKind = 'family' | 'household' | 'neighbors' | 'work' | 'market' | 'faith' | 'army' | 'court' | 'travel' | 'crime';
export type RelationshipStatus = 'distant' | 'stable' | 'close' | 'strained' | 'hostile' | 'broken';
export type LocalGround = 'grass' | 'dirt' | 'sand' | 'water' | 'mud' | 'snow' | 'stone' | 'road' | 'floor' | 'ash';
export type LocalFeature = 'tree' | 'bush' | 'rock' | 'reeds' | 'wall' | 'door' | 'field' | 'tilled-soil' | 'seedlings' | 'crop' | 'ripe-crop' | 'construction-foundation' | 'construction-frame' | 'construction-wall' | 'scaffold' | 'rubble' | 'looted' | 'fire' | 'trash' | 'blood' | 'body' | 'bones' | 'grave' | 'cemetery' | 'chest' | 'stairs-down' | 'stairs-up' | 'bridge' | 'herb' | 'berry' | 'mushroom' | 'animal-trail' | 'tent' | 'campfire' | 'latrine' | 'palisade' | 'hitching-post';
export type LocalEffectKind = 'burn' | 'rubble' | 'looted' | 'blood' | 'body' | 'lost-item' | 'camp' | 'grave' | 'repaired';



export type BiologicalSex = 'female' | 'male';
export type LifeStage = 'младенец' | 'ребёнок' | 'подросток' | 'взрослый' | 'пожилой' | 'старый';
export type HealthConditionKind = 'болезнь' | 'травма' | 'инфекция' | 'хроническое состояние' | 'осложнение родов';
export type HealthConditionStatus = 'активно' | 'выздоровление' | 'вылечено' | 'хроническое' | 'смерть';
export type PregnancyStatus = 'беременность' | 'роды' | 'завершено' | 'потеря';
export type EpidemicStatus = 'зарождение' | 'распространение' | 'спад' | 'завершено';

export interface CharacterHealthProfile {
  lifeStage: LifeStage;
  frailty: number;
  immunity: number;
  fertility: number;
  activeConditionIds: number[];
  pregnancyId?: number;
  chronicConditions: string[];
  lastHealthTick: number;
}

export interface HealthCondition {
  id: number;
  characterId: number;
  settlementId: number;
  kind: HealthConditionKind;
  diseaseId?: string;
  name: string;
  severity: number;
  contagiousness: number;
  startedTick: number;
  expectedEndTick: number;
  status: HealthConditionStatus;
  treated: boolean;
  careQuality: number;
  sourceCharacterId?: number;
  cause: string;
  history: string[];
}

export interface Pregnancy {
  id: number;
  parentAId: number;
  parentBId: number;
  gestatingParentId: number;
  settlementId: number;
  conceivedTick: number;
  dueTick: number;
  status: PregnancyStatus;
  risk: number;
  childId?: number;
  history: string[];
}

export interface Epidemic {
  id: number;
  diseaseId: string;
  name: string;
  settlementId: number;
  startTick: number;
  endTick?: number;
  status: EpidemicStatus;
  infectedEstimate: number;
  severeEstimate: number;
  deaths: number;
  recovered: number;
  transmission: number;
  history: string[];
}

export type ItemCategory = 'еда' | 'напиток' | 'семена' | 'сырьё' | 'топливо' | 'инструмент' | 'одежда' | 'броня' | 'оружие' | 'краситель' | 'мебель' | 'лекарство' | 'предмет быта';
export type BuildingType = 'house' | 'tenement' | 'manor' | 'barracks' | 'monastery' | 'warehouse' | 'farm' | 'mill' | 'bakery' | 'tavern' | 'inn' | 'brewery' | 'winery' | 'blacksmith' | 'carpenter' | 'weaver' | 'tailor' | 'dyehouse' | 'tannery' | 'cobbler' | 'armorer' | 'toolmaker' | 'kiln' | 'quarry' | 'market' | 'shop' | 'bathhouse' | 'healer' | 'temple' | 'guildhall' | 'stable' | 'fishery' | 'mine' | 'cemetery' | 'castle' | 'arsenal' | 'watchtower' | 'siegeWorkshop' | 'townHall' | 'courthouse' | 'prison' | 'fireStation' | 'school' | 'shelter' | 'public';
export type EstablishmentType = 'таверна' | 'постоялый двор' | 'пекарня' | 'пивоварня' | 'винодельня' | 'кузница' | 'плотницкая мастерская' | 'ткацкая мастерская' | 'портная мастерская' | 'красильня' | 'кожевенная мастерская' | 'сапожная мастерская' | 'бронная мастерская' | 'инструментальная мастерская' | 'кирпичная мастерская' | 'каменоломня' | 'рынок' | 'лавка' | 'продовольственная лавка' | 'одежная лавка' | 'оружейная лавка' | 'баня' | 'лечебница' | 'храм' | 'гильдейский дом' | 'склад' | 'конюшня' | 'мельница' | 'ферма' | 'рыбный промысел' | 'рудник' | 'казарма' | 'арсенал' | 'замковое хозяйство' | 'осадная мастерская' | 'городская управа' | 'суд' | 'тюрьма' | 'пожарная команда' | 'школа' | 'приют';
export type HouseholdStatus = 'нищие' | 'бедные' | 'обычные' | 'зажиточные' | 'богатые' | 'знатные' | 'служебное общежитие';
export type RecipeCategory = 'добыча' | 'переработка' | 'готовка' | 'ремесло';


export type EquipmentSlot = 'head' | 'body' | 'legs' | 'feet' | 'hands' | 'cloak' | 'mainHand' | 'offHand' | 'workTool';
export type SocialTier = 'нищий' | 'бедный' | 'обычный' | 'зажиточный' | 'богатый' | 'знатный' | 'правитель';

export interface EquipmentProfile {
  material: string;
  color: string;
  quality: number;
  condition: number;
  socialTier: SocialTier;
  equippedItemIds: Partial<Record<EquipmentSlot, number>>;
  compact: boolean;
  lastMaintainedTick: number;
}

export interface TravelingMerchant {
  id: number;
  characterId: number;
  routeSettlementIds: number[];
  currentSettlementId: number;
  nextSettlementId?: number;
  arrivalTick: number;
  wagonInventoryItemIds: number[];
  cash: number;
  status: 'торгует' | 'в пути' | 'отдыхает' | 'ограблен';
  history: string[];
}

export interface MarketTransaction {
  id: number;
  tick: number;
  settlementId: number;
  buyerCharacterId?: number;
  sellerCharacterId?: number;
  establishmentId?: number;
  travelingMerchantId?: number;
  templateId: string;
  quantity: number;
  totalPrice: number;
  purpose: string;
}




export type KnowledgeTopic = 'событие' | 'чудовище' | 'личность' | 'государство' | 'поселение' | 'дорога' | 'война' | 'торговля' | 'тайна' | 'место' | 'закон';
export type KnowledgeSourceKind = 'свидетель' | 'слух' | 'письмо' | 'донесение' | 'указ' | 'книга' | 'торговец' | 'солдат' | 'жрец' | 'чиновник' | 'личный опыт';
export type RumorStatus = 'местный' | 'в пути' | 'затих' | 'подтверждён' | 'опровергнут';
export type MessageKind = 'письмо' | 'донесение' | 'королевский указ' | 'военный рапорт' | 'торговая весть' | 'тайное сообщение';

export interface KnowledgeFact {
  id: number;
  topic: KnowledgeTopic;
  subjectRef?: EntityRef;
  eventId?: number;
  statement: string;
  canonicalStatement: string;
  truth: number;
  verified: boolean;
  importance: number;
  secrecy: number;
  originSettlementId?: number;
  originCharacterId?: number;
  createdTick: number;
  x?: number;
  y?: number;
  tags: string[];
  history: string[];
}

export interface PersonalMemory {
  id: number;
  characterId: number;
  factId?: number;
  eventId?: number;
  kind: 'встреча' | 'опасность' | 'долг' | 'спасение' | 'предательство' | 'потеря' | 'война' | 'работа' | 'семья' | 'слух';
  summary: string;
  learnedTick: number;
  sourceKind: KnowledgeSourceKind;
  sourceCharacterId?: number;
  confidence: number;
  emotionalWeight: number;
  distortion: number;
  private: boolean;
  lastRecalledTick: number;
}

export interface CharacterOpinion {
  target: EntityRef;
  trust: number;
  fear: number;
  respect: number;
  affinity: number;
  reason: string;
  updatedTick: number;
}

export interface CharacterKnowledgeState {
  factIds: number[];
  memoryIds: number[];
  opinions: CharacterOpinion[];
  detailed: boolean;
  lastGossipTick: number;
}

export interface Rumor {
  id: number;
  factId: number;
  text: string;
  originSettlementId: number;
  currentSettlementId: number;
  carrierCharacterId?: number;
  confidence: number;
  distortion: number;
  spreadCount: number;
  status: RumorStatus;
  createdTick: number;
  lastSpreadTick: number;
  history: string[];
}

export interface Message {
  id: number;
  kind: MessageKind;
  senderCharacterId?: number;
  recipientCharacterId?: number;
  recipientKingdomId?: number;
  fromSettlementId: number;
  toSettlementId: number;
  knowledgeFactIds: number[];
  departedTick: number;
  arrivalTick: number;
  status: 'готовится' | 'в пути' | 'доставлено' | 'перехвачено' | 'утрачено';
  reliability: number;
  sealed: boolean;
  history: string[];
}

export interface SettlementKnowledge {
  settlementId: number;
  factIds: number[];
  verifiedFactIds: number[];
  rumorIds: number[];
  lastUpdatedTick: number;
}



export type EducationLevel = 'нет' | 'семейное' | 'начальное' | 'ученичество' | 'учёное' | 'духовное';

export interface LanguageKnowledge {
  languageId: number;
  fluency: number;
}

export interface CharacterCultureProfile {
  cultureId: number;
  nativeLanguageId: number;
  languages: LanguageKnowledge[];
  religionId: number;
  devotion: number;
  literacy: number;
  education: EducationLevel;
  culturalOpenness: number;
  lastUpdatedTick: number;
}

export interface CultureDefinition {
  id: number;
  name: string;
  species: Species;
  languageId: number;
  parentCultureId?: number;
  traditions: string[];
  taboos: string[];
  holidays: string[];
  clothingStyle: string;
  namingStyle: string;
  marriageCustom: string;
  burialCustom: string;
  openness: number;
  cohesion: number;
  prestige: number;
  settlementIds: number[];
  history: string[];
}

export interface LanguageDefinition {
  id: number;
  name: string;
  script: string;
  parentLanguageId?: number;
  dialectOfCultureId?: number;
  difficulty: number;
  prestige: number;
  commonPhrases: string[];
  history: string[];
}

export interface ReligionDefinition {
  id: number;
  name: string;
  parentReligionId?: number;
  doctrines: string[];
  taboos: string[];
  holyDays: string[];
  clergyTitle: string;
  tolerance: number;
  conversionPressure: number;
  authority: number;
  settlementIds: number[];
  history: string[];
}

export interface CulturalShare {
  id: number;
  share: number;
}

export interface SettlementCultureState {
  id: number;
  settlementId: number;
  dominantCultureId: number;
  cultureShares: CulturalShare[];
  dominantReligionId: number;
  religionShares: CulturalShare[];
  literacy: number;
  educationAccess: number;
  schoolCapacity: number;
  templeCapacity: number;
  culturalTension: number;
  activeFestival?: string;
  lastUpdatedYear: number;
  history: string[];
}

export type CrimeType = 'кража' | 'грабёж' | 'нападение' | 'убийство' | 'поджог' | 'контрабанда' | 'мошенничество' | 'взлом' | 'браконьерство';
export type CrimeStatus = 'совершено' | 'расследуется' | 'подозреваемый найден' | 'передано в суд' | 'раскрыто' | 'не раскрыто';
export type LegalStatus = 'свободен' | 'разыскивается' | 'под стражей' | 'заключён' | 'сбежал';
export type SentenceKind = 'оправдание' | 'штраф' | 'общественные работы' | 'заключение' | 'изгнание' | 'смертная казнь';

export interface DistrictCivicState {
  id: number;
  settlementId: number;
  districtName: string;
  safety: number;
  cleanliness: number;
  fireRisk: number;
  waterAccess: number;
  rentMultiplier: number;
  crimeRate: number;
  homelessCount: number;
  patrolIds: number[];
  history: string[];
}

export interface SettlementGovernment {
  id: number;
  settlementId: number;
  leaderCharacterId: number;
  councilCharacterIds: number[];
  treasury: number;
  monthlyTaxIncome: number;
  monthlyExpenses: number;
  corruption: number;
  guardIds: number[];
  judgeIds: number[];
  firefighterIds: number[];
  teacherIds: number[];
  gravediggerIds: number[];
  prisonerIds: number[];
  laws: string[];
  activeDecision: string;
  history: string[];
}

export interface CivicPatrol {
  id: number;
  settlementId: number;
  districtName: string;
  guardIds: number[];
  shift: 'дневная' | 'ночная';
  status: 'патрулирует' | 'отдыхает' | 'реагирует' | 'разбита';
  arrests: number;
  lastPatrolTick: number;
  history: string[];
}

export interface CrimeIncident {
  id: number;
  type: CrimeType;
  settlementId: number;
  districtName: string;
  perpetratorId?: number;
  victimCharacterId?: number;
  victimEstablishmentId?: number;
  witnessIds: number[];
  evidence: number;
  severity: number;
  stolenItemIds: number[];
  status: CrimeStatus;
  createdTick: number;
  resolvedTick?: number;
  history: string[];
}

export interface CourtCase {
  id: number;
  crimeId: number;
  settlementId: number;
  judgeId?: number;
  defendantId?: number;
  status: 'ожидает суда' | 'слушается' | 'завершено' | 'прекращено';
  verdict?: SentenceKind;
  sentenceMonths: number;
  fine: number;
  openedTick: number;
  closedTick?: number;
  history: string[];
}

export interface FireIncident {
  id: number;
  settlementId: number;
  originBuildingId?: number;
  affectedBuildingIds: number[];
  firefighterIds: number[];
  intensity: number;
  spreadRisk: number;
  status: 'горит' | 'локализован' | 'потушен' | 'выгорел';
  startedTick: number;
  endedTick?: number;
  deaths: number;
  destroyedBuildingIds: number[];
  history: string[];
}

export type GovernmentForm = 'феодальная монархия' | 'племенной союз' | 'выборная монархия' | 'республика' | 'теократия' | 'военная диктатура' | 'городской союз' | 'кочевая конфедерация';
export type NobleRank = 'корона' | 'герцогство' | 'графство' | 'баронство' | 'лордство';
export type CourtOfficeKind = 'канцлер' | 'казначей' | 'маршал' | 'глава разведки' | 'придворный лекарь' | 'верховный жрец' | 'придворный маг';
export type CourtFactionKind = 'корона' | 'знать' | 'армия' | 'духовенство' | 'купцы' | 'народ';
export type RoyalOrderKind = 'помощь поселению' | 'укрепление границы' | 'требование налогов' | 'назначение чиновника' | 'расследование коррупции' | 'дарование автономии' | 'созыв ополчения' | 'дипломатическая миссия';
export type RoyalOrderStatus = 'обсуждается' | 'утверждён' | 'в пути' | 'исполнен' | 'отказано' | 'провален';
export type StateCrisisKind = 'кризис наследования' | 'заговор' | 'вассальный мятеж' | 'гражданская война' | 'переворот' | 'сепаратизм' | 'регентский кризис';
export type StateCrisisStatus = 'назревает' | 'активен' | 'подавлен' | 'победа мятежников' | 'урегулирован';
export type DiplomaticAgreementKind = 'ненападение' | 'торговый договор' | 'оборонительный союз' | 'дань' | 'династический брак' | 'гарантия границ';

export interface NobleTitle {
  id: number;
  kingdomId: number;
  settlementId?: number;
  name: string;
  rank: NobleRank;
  holderCharacterId: number;
  liegeTitleId?: number;
  hereditary: boolean;
  taxShare: number;
  levyShare: number;
  legitimacy: number;
  autonomy: number;
  status: 'действует' | 'вакантен' | 'конфискован' | 'оспаривается';
  claimantIds: number[];
  history: string[];
}

export interface VassalContract {
  id: number;
  kingdomId: number;
  liegeTitleId: number;
  vassalTitleId: number;
  liegeCharacterId: number;
  vassalCharacterId: number;
  taxRate: number;
  levyRate: number;
  loyalty: number;
  autonomy: number;
  taxArrears: number;
  levyArrears: number;
  status: 'верен' | 'напряжение' | 'отказывается' | 'мятеж';
  lastPaidTick: number;
  history: string[];
}

export interface CourtOffice {
  id: number;
  kingdomId: number;
  kind: CourtOfficeKind;
  holderCharacterId?: number;
  salary: number;
  influence: number;
  competence: number;
  loyalty: number;
  appointedTick: number;
  vacantSinceTick?: number;
  history: string[];
}

export interface CourtFaction {
  id: number;
  kingdomId: number;
  name: string;
  kind: CourtFactionKind;
  leaderCharacterId: number;
  memberIds: number[];
  influence: number;
  loyalty: number;
  treasury: number;
  goal: string;
  grievance: string;
  status: 'лояльна' | 'торгуется' | 'в оппозиции' | 'заговор';
  history: string[];
}

export interface RoyalOrder {
  id: number;
  kingdomId: number;
  kind: RoyalOrderKind;
  issuerCharacterId: number;
  targetSettlementId?: number;
  targetCharacterId?: number;
  targetKingdomId?: number;
  messageId?: number;
  factId?: number;
  status: RoyalOrderStatus;
  priority: number;
  cost: number;
  createdTick: number;
  dispatchedTick?: number;
  resolvedTick?: number;
  reason: string;
  outcome?: string;
  history: string[];
}

export interface StateCrisis {
  id: number;
  kingdomId: number;
  kind: StateCrisisKind;
  instigatorCharacterId?: number;
  factionId?: number;
  claimantCharacterId?: number;
  settlementIds: number[];
  severity: number;
  support: number;
  opposition: number;
  status: StateCrisisStatus;
  startedTick: number;
  resolvedTick?: number;
  history: string[];
}

export interface DiplomaticAgreement {
  id: number;
  kingdomIds: [number, number];
  kind: DiplomaticAgreementKind;
  status: 'переговоры' | 'действует' | 'нарушен' | 'истёк' | 'отклонён';
  initiatorKingdomId: number;
  messageId?: number;
  signedTick?: number;
  expiresTick?: number;
  tributeAmount: number;
  marriageCharacterIds?: [number, number];
  terms: string[];
  history: string[];
}

export interface KingdomGovernment {
  id: number;
  kingdomId: number;
  form: GovernmentForm;
  sovereignCharacterId: number;
  heirCharacterId?: number;
  regentCharacterId?: number;
  capitalSettlementId: number;
  sovereignTitleId: number;
  titleIds: number[];
  vassalContractIds: number[];
  courtOfficeIds: number[];
  factionIds: number[];
  orderIds: number[];
  crisisIds: number[];
  agreementIds: number[];
  legitimacy: number;
  centralization: number;
  administration: number;
  corruption: number;
  monthlyTaxIncome: number;
  monthlyCourtCost: number;
  monthlyInfrastructureCost: number;
  monthlyReliefCost: number;
  debt: number;
  taxRate: number;
  levyRate: number;
  successionLaw: string;
  activeDecision: string;
  history: string[];
}

export type CharacterTraitKey = 'greed' | 'empathy' | 'courage' | 'patience' | 'honesty' | 'cruelty' | 'ambition' | 'riskTolerance';
export type CharacterValueKey = 'family' | 'faith' | 'wealth' | 'power' | 'freedom' | 'order';
export type PersonalGoalKind = 'survive' | 'feed_family' | 'earn_wealth' | 'gain_power' | 'protect_home' | 'serve_faith' | 'revenge' | 'escape_justice' | 'master_craft' | 'explore';
export type PersonalGoalStatus = 'active' | 'blocked' | 'completed' | 'abandoned';

export interface PersonalGoal {
  id: string;
  kind: PersonalGoalKind;
  priority: number;
  status: PersonalGoalStatus;
  targetRef?: EntityRef;
  reason: string;
  progress: number;
  createdTick: number;
  updatedTick: number;
}

export interface CharacterObligation {
  id: string;
  kind: 'family' | 'debt' | 'employment' | 'oath' | 'office' | 'vassalage' | 'promise';
  targetRef?: EntityRef;
  strength: number;
  dueTick?: number;
  fulfilled: boolean;
  reason: string;
}

export interface CharacterSecret {
  id: string;
  kind: 'crime' | 'affair' | 'plot' | 'hidden_debt' | 'forbidden_knowledge' | 'betrayal';
  factId?: number;
  severity: number;
  knownByCharacterIds: number[];
  exposed: boolean;
  summary: string;
}

export interface GroupReputation {
  group: 'family' | 'neighbors' | 'workers' | 'merchants' | 'guards' | 'clergy' | 'nobility' | 'army' | 'court';
  score: number;
  reason: string;
  updatedTick: number;
}

export interface CharacterMind {
  traits: Record<CharacterTraitKey, number>;
  values: Record<CharacterValueKey, number>;
  emotions: {
    fear: number;
    anger: number;
    grief: number;
    hope: number;
    stress: number;
    contentment: number;
    updatedTick: number;
  };
  goals: PersonalGoal[];
  obligations: CharacterObligation[];
  secrets: CharacterSecret[];
  reputations: GroupReputation[];
  lastDecisionTick: number;
}


export type SocialObligationKind = 'loan' | 'service' | 'promise' | 'protection' | 'patronage' | 'family_support' | 'work_referral' | 'silence';
export type SocialObligationStatus = 'active' | 'fulfilled' | 'defaulted' | 'forgiven' | 'broken';

export interface SocialObligation {
  id: number;
  kind: SocialObligationKind;
  debtorCharacterId: number;
  creditorCharacterId: number;
  settlementId: number;
  amount: number;
  strength: number;
  createdTick: number;
  dueTick?: number;
  resolvedTick?: number;
  status: SocialObligationStatus;
  reason: string;
  secret: boolean;
  history: string[];
}

export interface DecisionOptionScore {
  id: string;
  label: string;
  utility: number;
  factors: Record<string, number>;
  blockedReason?: string;
}

export interface DecisionRecord {
  id: number;
  tick: number;
  actorRef: EntityRef;
  goal: string;
  context: string;
  knownFactIds: number[];
  optionScores: DecisionOptionScore[];
  chosenOptionId: string;
  reason: string;
  stateDeltaIds: number[];
  eventId?: number;
  historical: boolean;
  tags: string[];
}

export interface StateDelta {
  id: number;
  tick: number;
  entityRef: EntityRef;
  field: string;
  before: string;
  after: string;
  amount?: number;
  cause: string;
  decisionId?: number;
  eventId?: number;
  historical: boolean;
}

export interface NeedState {
  hunger: number;
  thirst: number;
  rest: number;
  warmth: number;
  safety: number;
  social: number;
  lastUpdatedTick: number;
}

export interface CharacterSchedule {
  wakeHour: number;
  workStartHour: number;
  workEndHour: number;
  sleepHour: number;
  restDay: number;
  currentActivity: string;
}

export interface SettlementEconomy {
  currency: string;
  coinSupply: number;
  priceIndex: number;
  wageIndex: number;
  rentIndex: number;
  taxRate: number;
  prices: Record<string, number>;
  supply: Record<string, number>;
  demand: Record<string, number>;
  imports: Record<string, number>;
  exports: Record<string, number>;
  lastMonthlyTrade: number;
  bankruptcies: number;
}

export interface Building {
  id: number;
  settlementId: number;
  districtName: string;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  localWidth: number;
  localHeight: number;
  entranceX: number;
  entranceY: number;
  name: string;
  type: BuildingType;
  floors: number;
  capacity: number;
  condition: number;
  builtYear: number;
  ownerCharacterId?: number;
  householdId?: number;
  establishmentId?: number;
  residentIds: number[];
  workerIds: number[];
  inventoryItemIds: number[];
  rooms: string[];
  hasWater: boolean;
  hasHearth: boolean;
  history: string[];
  interior?: BuildingInteriorPlan;
  cityCapacity?: BuildingCapacityProfile;
  spatialVersion?: 1 | 2;
}


export type CropKind = 'пшеница' | 'ячмень' | 'рожь' | 'лён' | 'овощи';
export type FieldState = 'пар' | 'подготовка' | 'посеяно' | 'всходы' | 'рост' | 'созревание' | 'готово к жатве' | 'убрано' | 'погибло';

export interface FieldCell { x: number; y: number; }

export interface FieldPlot {
  id: number;
  settlementId: number;
  farmBuildingId: number;
  establishmentId?: number;
  globalX: number;
  globalY: number;
  cells: FieldCell[];
  crop: CropKind;
  state: FieldState;
  fertility: number;
  moisture: number;
  weeds: number;
  pests: number;
  plantedYear?: number;
  plantedMonth?: number;
  harvestedYear?: number;
  expectedYield: number;
  laborRequired: number;
  laborDone: number;
  lastWorkedTick: number;
  history: string[];
}

export type ConstructionStage = 'планирование' | 'доставка материалов' | 'фундамент' | 'каркас' | 'стены' | 'крыша' | 'отделка' | 'завершено' | 'заброшено';

export interface ConstructionProject {
  id: number;
  settlementId: number;
  requestedByKingdomId?: number;
  cityRequestId?: string;
  buildingType: BuildingType;
  name: string;
  reason: string;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  localWidth: number;
  localHeight: number;
  entranceX: number;
  entranceY: number;
  requiredMaterials: Record<string, number>;
  deliveredMaterials: Record<string, number>;
  laborRequired: number;
  laborDone: number;
  builderIds: number[];
  stage: ConstructionStage;
  startedYear: number;
  startedMonth: number;
  completedYear?: number;
  completedMonth?: number;
  buildingId?: number;
  history: string[];
}

export interface Household {
  id: number;
  settlementId: number;
  homeBuildingId?: number;
  headCharacterId: number;
  memberIds: number[];
  status: HouseholdStatus;
  wealth: number;
  debt: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  foodReserveDays: number;
  fuelReserveDays: number;
  inventoryItemIds: number[];
  needs: NeedState;
  history: string[];
}

export interface WorldItem {
  id: number;
  templateId: string;
  name: string;
  category: ItemCategory;
  material: string;
  quantity: number;
  unit: string;
  weightPerUnit: number;
  quality: number;
  condition: number;
  freshness: number;
  perishabilityMonths: number;
  baseValue: number;
  settlementId: number;
  buildingId?: number;
  householdId?: number;
  establishmentId?: number;
  ownerCharacterId?: number;
  craftedByCharacterId?: number;
  createdYear: number;
  source: string;
  history: string[];
  equipmentSlot?: EquipmentSlot;
  dye?: string;
  warmth?: number;
  armor?: number;
  damage?: number;
  toolType?: string;
  requiredProfession?: string;
  maxCondition?: number;
  equippedByCharacterId?: number;
  supplyWagonId?: number;
}

export interface ProductionRecipeInput { templateId: string; quantity: number; }
export interface ProductionRecipeOutput { templateId: string; quantity: number; qualityBonus?: number; }
export interface ProductionRecipe {
  id: number;
  key: string;
  name: string;
  category: RecipeCategory;
  profession: string;
  establishmentTypes: EstablishmentType[];
  inputs: ProductionRecipeInput[];
  outputs: ProductionRecipeOutput[];
  fuelTemplateId?: string;
  fuelQuantity?: number;
  laborHours: number;
  minimumSkill: number;
  culture?: string;
  requiredTechnologyId?: string;
  description: string;
}

export interface Establishment {
  id: number;
  settlementId: number;
  buildingId: number;
  name: string;
  type: EstablishmentType;
  ownerCharacterId: number;
  workerIds: number[];
  supplierEstablishmentIds: number[];
  customerHouseholdIds: number[];
  inventoryItemIds: number[];
  recipeIds: number[];
  openHour: number;
  closeHour: number;
  reputation: number;
  cash: number;
  debt: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  active: boolean;
  menu: Record<string, number>;
  history: string[];
}

export interface EmploymentContract {
  id: number;
  characterId: number;
  establishmentId: number;
  role: string;
  wage: number;
  hoursPerWeek: number;
  sinceYear: number;
  apprenticeOfCharacterId?: number;
  active: boolean;
  arrears?: number;
}

export interface TradeShipment {
  id: number;
  routeId: number;
  fromSettlementId: number;
  toSettlementId: number;
  sellerEstablishmentId?: number;
  buyerEstablishmentId?: number;
  goods: { templateId: string; quantity: number; unitPrice: number }[];
  departedTick: number;
  arrivalTick: number;
  status: 'в пути' | 'доставлен' | 'потерян';
  value: number;
  cause?: string;
}

export interface WorldConfig {
  seed: string;
  width: number;
  height: number;
  historyYears: number;
  kingdomCount: number;
  settlementCount: number;
  populationScale: number;
  magic: number;
  warlike: number;
  monsterDensity: number;
  artifactDensity: number;
  localMapSize: 96 | 128 | 160;
  ecologyDensity: number;
  huntingPressure: number;
}

export type SimulationOperation = 'загрузка' | 'генерация' | 'история' | 'симуляция' | 'сохранение';


export type HistoricalEraKind = 'древняя эпоха' | 'эпоха становления' | 'династическая эпоха' | 'современная эпоха';

export interface FallenRealm {
  id: number;
  name: string;
  species: Species;
  foundedYear: number;
  fallenYear: number;
  capitalName: string;
  causeOfFall: string;
  successorKingdomId?: number;
  ruinDungeonId?: number;
  formerKingdomId?: number;
  color?: string;
}

export interface HistoricalEraSummary {
  id: number;
  kind: HistoricalEraKind;
  name: string;
  startYear: number;
  endYear: number;
  stepYears: number;
  eventIds: number[];
  summary: string;
}

export interface GenesisSitePlan {
  id: number;
  originalSettlementId: number;
  originalName: string;
  x: number;
  y: number;
  terrain: Terrain;
  resource: string;
  sponsorKingdomId: number;
  targetYear: number;
  status: 'planned' | 'traveling' | 'founded' | 'failed';
  attempts: number;
  lastAttemptYear?: number;
  expeditionId?: number;
  foundedSettlementId?: number;
  foundedYear?: number;
}

export interface LivedHistoryGenesisSummary {
  version: 1;
  initialSettlementIds: number[];
  initialKingdomIds: number[];
  initialPopulation: number;
  plannedSiteCount: number;
  foundedSiteCount: number;
  failedSiteCount: number;
  coarseSteps: number;
  detailedMonths: number;
  sitePlans: GenesisSitePlan[];
  finalSettlementIds: number[];
  formedKingdomIds: number[];
  finalPopulation: number;
}

export interface HistoricalState {
  engineVersion: 1 | 2 | 3;
  generatedYears: number;
  eras: HistoricalEraSummary[];
  landmarkEventIds: number[];
  fallenRealms: FallenRealm[];
  compressedEventCount: number;
  logicWarnings: string[];
  historicalSimulationVersion?: 1 | 2;
  livedDecisionIds?: number[];
  genesis?: LivedHistoryGenesisSummary;
}

export interface WorldSlotMeta {
  id: string;
  name: string;
  seed: string;
  createdAt: number;
  updatedAt: number;
  year: number;
  month: number;
  schemaVersion: number;
  appVersion: string;
  sizeBytes: number;
  snapshotCount: number;
  lastSnapshotYear?: number;
}

export interface WorldSnapshotMeta {
  id: string;
  slotId: string;
  year: number;
  month: number;
  createdAt: number;
  reason: 'автоматический' | 'ручной' | 'перед импортом' | 'перед миграцией';
  sizeBytes: number;
}

export interface StorageProfile {
  slotId: string;
  writtenRecords: number;
  skippedRecords: number;
  deletedRecords: number;
  bytesEstimated: number;
  snapshotCreated: boolean;
  totalMs: number;
}

export interface SimulationProgress {
  operation: SimulationOperation;
  phase: string;
  completed: number;
  total: number;
  percent: number;
  elapsedMs: number;
  etaMs?: number;
  year?: number;
  month?: number;
  detail?: string;
}

export interface SimulationProfile {
  operation: SimulationOperation;
  months?: number;
  totalMs: number;
  simulationMs?: number;
  workerRoundTripMs?: number;
  saveMs?: number;
  indexedEntities?: number;
  processedTasks?: number;
  activeRegions?: number;
  sleepingRegions?: number;
  fastForward?: boolean;
  exactMonths?: number;
  coarseMonths?: number;
  phaseTimings?: SimulationPhaseProfile[];
  generatedAt: number;
}

export interface SimulationPhaseProfile {
  phase: string;
  totalMs: number;
  calls: number;
  maxMs: number;
}

export type ScheduledActionKind = 'army' | 'monster' | 'war' | 'region';

export interface ScheduledAction {
  id: string;
  kind: ScheduledActionKind;
  dueTick: number;
  entityId?: number;
  regionKey?: string;
  repeatEvery?: number;
}

export interface SimulationRuntimeState {
  schedulerVersion: 1;
  observerFocus?: { x: number; y: number; level: number; radius: number };
  livingEconomyVersion?: 1;
  militaryInfrastructureVersion?: 1;
  knowledgeSystemVersion?: 1;
  settlementLifeVersion?: 1;
  stateMachineVersion?: 1;
  socialSystemVersion?: 1;
  physicalArmyVersion?: 1;
  healthSystemVersion?: 1;
  battleSystemVersion?: 1;
  cultureSystemVersion?: 1;
  civilizationSystemVersion?: 1;
  technologyKnowledgeVersion?: 1;
  lastTechnologyKnowledgeAdvanceYear?: number;
  settlementLifecycleVersion?: 1;
  stateFormationVersion?: 1;
  regionalEconomyVersion?: 1;
  worldLawVersion?: 1;
  institutionSystemVersion?: 1;
  economyLastTickBySettlement?: Record<string, number>;
  agricultureLastTickBySettlement?: Record<string, number>;
  cemeteryPlacementVersion?: 1;
  lastKnowledgeTrimTick?: number;
  lastSocialBurialId?: number;
  decisionCoreVersion?: 1;
  mindSystemVersion?: 1;
  performanceCoreVersion?: 1;
  clockTick: number;
  activeRegionKeys: string[];
  sleepingRegionCount: number;
  queuedActions: ScheduledAction[];
  lastProfile?: SimulationProfile;
}

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number;
  moisture: number;
  kingdomId?: number;
  controlledSinceYear?: number;
  settlementId?: number;
  settlementDistrict?: string;
  dungeonId?: number;
  monsterId?: number;
}

export interface DiplomacyRecord {
  kingdomId: number;
  score: number;
  status: 'союз' | 'мир' | 'напряжение' | 'война';
  reason: string;
}

export interface Kingdom {
  id: number;
  name: string;
  color: string;
  species: Species;
  rulerId: number;
  capitalId: number;
  dynastyId?: number;
  treasury: number;
  armyStrength: number;
  stability: number;
  aggression: number;
  culture: string;
  religion: string;
  cultureId?: number;
  religionId?: number;
  officialLanguageId?: number;
  foundedYear: number;
  enemies: number[];
  claims: number[];
  diplomacy: DiplomacyRecord[];
  laws: string[];
  governmentStateId?: number;
  civilizationId?: number;
  foundingCommunityId?: number;
  predecessorKingdomIds?: number[];
  politicalOrigin?: 'generated' | 'genesis' | 'secession' | 'league' | 'union' | 'conquest';
  foundingGovernmentForm?: GovernmentForm;
}

export interface SettlementDistrict {
  x: number;
  y: number;
  name: string;
  role: 'центр' | 'жилой район' | 'рынок' | 'ремесленный район' | 'крепость' | 'порт' | 'поля' | 'окраина';
}

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  kingdomId: number;
  population: number;
  prosperity: number;
  defense: number;
  food: number;
  foundedYear: number;
  type: 'hamlet' | 'village' | 'town' | 'city' | 'fortress' | 'port';
  buildings: string[];
  buildingCounts: Record<string, number>;
  households: number;
  residentialCapacity: number;
  districts: SettlementDistrict[];
  notableCharacterIds: number[];
  damaged: number;
  resource: string;
  stockpile: Record<string, number>;
  livestock: Record<string, number>;
  shortages: string[];
  tradeRouteIds: number[];
  unrest: number;
  history: string[];
  buildingIds: number[];
  householdIds: number[];
  establishmentIds: number[];
  economy: SettlementEconomy;
  cultureStateId?: number;
  civilizationId?: number;
  politicalStatus?: 'integrated' | 'frontier' | 'independent' | 'occupied';
  foundingExpeditionId?: number;
  claimantKingdomId?: number;
  politicalCommunityId?: number;
  layout?: SettlementLayoutPlan;
}

export interface Character {
  sex?: BiologicalSex;
  id: number;
  name: string;
  species: Species;
  age: number;
  birthYear: number;
  deathYear?: number;
  alive: boolean;
  settlementId: number;
  kingdomId: number;
  dynastyId?: number;
  profession: string;
  workplace: string;
  homeDistrict?: string;
  renown: number;
  health: number;
  wealth: number;
  loyalty: number;
  ambition: string;
  parentIds: number[];
  childIds: number[];
  spouseId?: number;
  relationshipIds: number[];
  titles: string[];
  artifactIds: number[];
  bookIds: number[];
  injuries: string[];
  kills: number;
  biography: string[];
  householdId?: number;
  homeBuildingId?: number;
  workplaceBuildingId?: number;
  employerEstablishmentId?: number;
  employmentContractId?: number;
  inventoryItemIds: number[];
  skills: Record<string, number>;
  needs: NeedState;
  schedule: CharacterSchedule;
  wallet: number;
  equipment: EquipmentProfile;
  militaryRole?: MilitaryRole;
  militaryUnitId?: number;
  serviceStatus?: ServiceStatus;
  militaryExperience?: number;
  servicePayArrears?: number;
  visualRole?: string;
  knowledge: CharacterKnowledgeState;
  technologyIds?: string[];
  technologyLearning?: Record<string, number>;
  legalStatus?: LegalStatus;
  wantedForCrimeIds?: number[];
  sentenceUntilTick?: number;
  homeless?: boolean;
  housingStatus?: HousingStatus;
  temporaryShelterBuildingId?: number;
  nobleTitleIds?: number[];
  courtOfficeIds?: number[];
  courtFactionId?: number;
  politicalInfluence?: number;
  mind?: CharacterMind;
  healthProfile?: CharacterHealthProfile;
  capturedByKingdomId?: number;
  prisonerOfBattleId?: number;
  cultureProfile?: CharacterCultureProfile;
  expeditionId?: number;
}


export interface Relationship {
  id: number;
  characterAId: number;
  characterBId: number;
  kind: RelationKind;
  strength: number;
  sinceYear: number;
  public: boolean;
  reason: string;
  contexts?: SocialContextKind[];
  trust?: number;
  affection?: number;
  respect?: number;
  fear?: number;
  tension?: number;
  familiarity?: number;
  interactionCount?: number;
  lastInteractionTick?: number;
  status?: RelationshipStatus;
  history?: string[];
}

export interface Dynasty {
  id: number;
  name: string;
  founderId: number;
  currentHeadId: number;
  memberIds: number[];
  kingdomId?: number;
  prestige: number;
  wealth: number;
  claimKingdomIds: number[];
  history: string[];
}



export type MilitaryRole = 'ополченец' | 'пехотинец' | 'лучник' | 'арбалетчик' | 'копейщик' | 'всадник' | 'рыцарь' | 'сержант' | 'офицер' | 'командир';
export type MilitaryUnitType = 'ополчение' | 'пехота' | 'стрелки' | 'копейщики' | 'конница' | 'рыцари' | 'штаб';
export type ServiceStatus = 'гражданский' | 'резерв' | 'гарнизон' | 'поход' | 'ранен' | 'пленник' | 'дезертир' | 'ветеран';

export interface MilitaryUnit {
  id: number;
  armyId: number;
  kingdomId: number;
  name: string;
  type: MilitaryUnitType;
  commanderId: number;
  memberIds: number[];
  training: number;
  cohesion: number;
  equipmentCoverage: number;
  horseCount: number;
  experience: number;
  history: string[];
}



export type ArmyCampMode = 'camp' | 'column' | 'battle';
export type ArmyCampStructureKind = 'soldierTent' | 'officerTent' | 'commandTent' | 'fieldKitchen' | 'infirmary' | 'supplyDepot' | 'workshop' | 'horseLine' | 'wagonPark' | 'latrine' | 'guardPost' | 'campfire';
export type ArmyActivity = 'отдыхает' | 'тренируется' | 'несёт караул' | 'готовит пищу' | 'лечится' | 'чинит снаряжение' | 'ухаживает за лошадьми' | 'разгружает обоз' | 'идёт в колонне' | 'держит строй';

export interface ArmyCampStructure {
  id: number;
  campId: number;
  armyId: number;
  kind: ArmyCampStructureKind;
  localX: number;
  localY: number;
  width: number;
  height: number;
  capacity: number;
  condition: number;
  assignedCharacterIds: number[];
  inventoryItemIds: number[];
  history: string[];
}

export interface ArmyCamp {
  id: number;
  armyId: number;
  kingdomId: number;
  globalX: number;
  globalY: number;
  centerX: number;
  centerY: number;
  perimeterRadius: number;
  mode: ArmyCampMode;
  structureIds: number[];
  establishedTick: number;
  lastUpdatedTick: number;
  layoutSignature: string;
  rosterSignature?: string;
  history: string[];
}

export interface ArmyLocalPosition {
  armyId: number;
  characterId: number;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  activity: ArmyActivity;
  formationIndex: number;
  lastUpdatedTick: number;
}

export interface SupplyWagon {
  id: number;
  armyId: number;
  kingdomId: number;
  x: number;
  y: number;
  wagonCount: number;
  horseCount: number;
  capacity: number;
  condition: number;
  escortIds: number[];
  inventoryItemIds: number[];
  status: 'склад' | 'следует за армией' | 'отстал' | 'разграблен' | 'уничтожен';
  history: string[];
}

export interface ArmyLogistics {
  foodDays: number;
  waterDays: number;
  medicine: number;
  tents: number;
  tools: number;
  horses: number;
  wagons: number;
  equipmentCoverage: number;
  armorCoverage: number;
  rangedCoverage: number;
  payrollDebt: number;
  desertions: number;
  wounded: number;
  lastSupplySettlementId?: number;
}

export interface Army {
  id: number;
  name: string;
  kingdomId: number;
  commanderId: number;
  x: number;
  y: number;
  strength: number;
  morale: number;
  supplies: number;
  targetKingdomId?: number;
  targetSettlementId?: number;
  targetMonsterId?: number;
  status: 'garrison' | 'marching' | 'hunting' | 'raiding' | 'battle' | 'recovering';
  campaignHistory: string[];
  soldierIds: number[];
  unitIds: number[];
  garrisonBuildingId?: number;
  arsenalBuildingId?: number;
  castleBuildingId?: number;
  supplyWagonIds: number[];
  inventoryItemIds: number[];
  logistics: ArmyLogistics;
  monthlyPayroll: number;
  readiness: number;
}



export type BattlePhase = 'сближение' | 'перестрелка' | 'схватка' | 'бегство' | 'последствия';
export type BattleUnitRole = 'front' | 'flank' | 'reserve' | 'missile';

export interface BattleUnitState {
  unitId: number;
  armyId: number;
  role: BattleUnitRole;
  initialCount: number;
  remainingCount: number;
  morale: number;
  cohesion: number;
  fatigue: number;
  casualties: number;
  wounded: number;
  captured: number;
  routed: boolean;
}

export interface BattleRecord {
  id: number;
  warId?: number;
  year: number;
  month: number;
  globalX: number;
  globalY: number;
  settlementId?: number;
  attackerArmyId: number;
  defenderArmyId: number;
  phase: BattlePhase;
  rounds: number;
  winnerArmyId?: number;
  attackerUnitStates: BattleUnitState[];
  defenderUnitStates: BattleUnitState[];
  attackerDead: number;
  defenderDead: number;
  attackerWounded: number;
  defenderWounded: number;
  attackerCaptured: number;
  defenderCaptured: number;
  prisonerIds: number[];
  woundedIds: number[];
  lootedItemIds: number[];
  destroyedWagonIds: number[];
  history: string[];
}

export interface Monster {
  id: number;
  name: string;
  species: string;
  tier: 'common' | 'elite' | 'miniboss' | 'boss';
  x: number;
  y: number;
  health: number;
  power: number;
  age: number;
  alive: boolean;
  hoard: number;
  hunger: number;
  territoryRadius: number;
  behavior: string;
  goal: string;
  targetSettlementId?: number;
  lairDungeonId?: number;
  kills: number;
  history: string[];
  footprintWidth: number;
  footprintHeight: number;
}


export type BurialState = 'corpse' | 'buried' | 'cremated' | 'decayed' | 'trophy' | 'mass-grave';

export interface Cemetery {
  id: number;
  name: string;
  settlementId?: number;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  foundedYear: number;
  capacity: number;
  burialIds: number[];
  caretakerCharacterId?: number;
  history: string[];
}

export interface BurialRecord {
  id: number;
  subjectKind: 'character' | 'monster' | 'anonymous';
  subjectId?: number;
  name: string;
  species: string;
  count: number;
  birthYear?: number;
  deathYear: number;
  deathMonth: number;
  cause: string;
  killerName?: string;
  settlementId?: number;
  kingdomId?: number;
  cemeteryId?: number;
  globalX: number;
  globalY: number;
  localX: number;
  localY: number;
  state: BurialState;
  buriedYear?: number;
  buriedMonth?: number;
  profession?: string;
  titles: string[];
  renown: number;
  parentIds: number[];
  childIds: number[];
  spouseId?: number;
  tier?: Monster['tier'];
  power?: number;
  footprintWidth?: number;
  footprintHeight?: number;
  summary: string;
  history: string[];
}

export interface AnimalPopulation {
  id: number;
  species: string;
  x: number;
  y: number;
  count: number;
  carryingCapacity: number;
  diet: 'травоядное' | 'хищник' | 'всеядное';
  preySpecies: string[];
  predatorSpecies: string[];
  reproductionRate: number;
  migrationDrive: number;
  health: number;
  huntedThisYear: number;
  lastCause: string;
  history: string[];
}

export interface NaturalIngredient {
  id: number;
  name: string;
  x: number;
  y: number;
  kind: 'растение' | 'гриб' | 'минерал' | 'животный компонент';
  abundance: number;
  carryingCapacity: number;
  regenerationRate: number;
  seasonMonths: number[];
  properties: string[];
  toxicity: number;
  harvestedThisYear: number;
  history: string[];
}

export interface AlchemyRecipe {
  id: number;
  name: string;
  ingredientIds: number[];
  result: string;
  effect: string;
  risk: string;
  discoveredById?: number;
  discoveryYear: number;
  source: string;
  batchesCreated: number;
  history: string[];
}

export interface ArtifactOwnerRecord {
  year: number;
  characterId?: number;
  settlementId?: number;
  reason: string;
}

export interface Artifact {
  id: number;
  name: string;
  type: string;
  material: string;
  creatorId?: number;
  ownerId?: number;
  settlementId?: number;
  yearCreated: number;
  power: number;
  depiction: string;
  ownerHistory: ArtifactOwnerRecord[];
  history: string[];
}

export interface Book {
  id: number;
  title: string;
  authorId: number;
  yearWritten: number;
  language: string;
  subject: string;
  reliability: number;
  bias: string;
  summary: string;
  copies: number;
  settlementId: number;
  referencedEventIds: number[];
  technologyIds?: string[];
}

export interface Dungeon {
  id: number;
  name: string;
  x: number;
  y: number;
  origin: string;
  purpose: string;
  builtYear: number;
  danger: number;
  depth: number;
  currentInhabitants: string;
  ownerKingdomId?: number;
  discovered: boolean;
  artifactIds: number[];
  history: string[];
}

export interface War {
  id: number;
  name: string;
  attackerId: number;
  defenderId: number;
  startYear: number;
  endYear?: number;
  active: boolean;
  cause: string;
  goal: string;
  contestedSettlementIds: number[];
  battles: number;
  attackerLosses: number;
  defenderLosses: number;
  victorId?: number;
  peaceTerms?: string;
  history: string[];
}

export interface TradeRoute {
  id: number;
  name: string;
  fromSettlementId: number;
  toSettlementId: number;
  goods: string[];
  volume: number;
  safety: number;
  active: boolean;
  controlledByKingdomIds: number[];
  history: string[];
}

export interface WorldEvent {
  id: number;
  year: number;
  month: number;
  kind: EventKind;
  title: string;
  description: string;
  cause: string;
  conditions: string[];
  decision: string;
  outcome: string;
  consequences: string[];
  traces: EntityRef[];
  entityRefs: EntityRef[];
  importance: number;
  decisionId?: number;
  stateDeltaIds?: number[];
}

export interface CausalEventInput {
  kind: EventKind;
  title: string;
  description: string;
  cause: string;
  conditions?: string[];
  decision?: string;
  outcome?: string;
  consequences: string[];
  entityRefs: EntityRef[];
  importance: number;
  traces?: EntityRef[];
  decisionId?: number;
  stateDeltaIds?: number[];
}


export interface TerritoryChange {
  id: number;
  year: number;
  month: number;
  x: number;
  y: number;
  kingdomId?: number;
  previousKingdomId?: number;
  sourceSettlementId?: number;
  reason: 'основание столицы' | 'мирное освоение' | 'рост поселения' | 'торговый путь' | 'военное завоевание' | 'политическое отделение' | 'добровольное объединение' | 'утрата контроля';
}

export interface LocalMapEffect {
  id: string;
  globalX: number;
  globalY: number;
  level: number;
  localX: number;
  localY: number;
  kind: LocalEffectKind;
  year: number;
  month?: number;
  expiresTick?: number;
  burialId?: number;
  label: string;
  entityRef?: EntityRef;
}

export interface LocalCell {
  x: number;
  y: number;
  ground: LocalGround;
  feature?: LocalFeature;
  building?: string;
  buildingId?: number;
  establishmentId?: number;
  fieldId?: number;
  constructionProjectId?: number;
  armyCampStructureId?: number;
  resourceIngredientId?: number;
  resourceUnitIndex?: number;
  blocked: boolean;
}

export interface LocalMarker {
  id: string;
  x: number;
  y: number;
  kind: 'person' | 'patrol' | 'army' | 'camp' | 'monster' | 'settlement' | 'dungeon' | 'artifact' | 'effect' | 'group' | 'fauna' | 'resource' | 'building' | 'establishment' | 'field' | 'construction' | 'cemetery' | 'grave' | 'item' | 'corpse' | 'merchant';
  label: string;
  refs: EntityRef[];
  count?: number;
  detail?: string;
  footprintWidth?: number;
  footprintHeight?: number;
  visualRole?: string;
}

export interface LocalExit {
  side: 'north' | 'east' | 'south' | 'west';
  position: number;
  road: boolean;
}

export interface LocalMapData {
  key: string;
  globalX: number;
  globalY: number;
  level: number;
  width: number;
  height: number;
  title: string;
  subtitle: string;
  terrain: Terrain;
  cells: LocalCell[];
  markers: LocalMarker[];
  exits: LocalExit[];
  availableLevels: number[];
}

export interface WorldState {
  version: 35;
  language?: 'ru';
  appVersion?: string;
  config: WorldConfig;
  name: string;
  year: number;
  month: number;
  tiles: Tile[];
  kingdoms: Kingdom[];
  settlements: Settlement[];
  settlementExpeditions: SettlementExpedition[];
  politicalCommunities: PoliticalCommunity[];
  politicalTransitions: PoliticalTransition[];
  characters: Character[];
  relationships: Relationship[];
  dynasties: Dynasty[];
  armies: Army[];
  battleRecords: BattleRecord[];
  militaryUnits: MilitaryUnit[];
  supplyWagons: SupplyWagon[];
  armyCamps: ArmyCamp[];
  armyCampStructures: ArmyCampStructure[];
  armyLocalPositions: ArmyLocalPosition[];
  monsters: Monster[];
  cemeteries: Cemetery[];
  burials: BurialRecord[];
  animalPopulations: AnimalPopulation[];
  ingredients: NaturalIngredient[];
  alchemyRecipes: AlchemyRecipe[];
  artifacts: Artifact[];
  books: Book[];
  dungeons: Dungeon[];
  wars: War[];
  tradeRoutes: TradeRoute[];
  buildings: Building[];
  households: Household[];
  establishments: Establishment[];
  fields: FieldPlot[];
  constructionProjects: ConstructionProject[];
  items: WorldItem[];
  productionRecipes: ProductionRecipe[];
  employments: EmploymentContract[];
  shipments: TradeShipment[];
  travelingMerchants: TravelingMerchant[];
  marketTransactions: MarketTransaction[];
  knowledgeFacts: KnowledgeFact[];
  memories: PersonalMemory[];
  rumors: Rumor[];
  messages: Message[];
  settlementKnowledge: SettlementKnowledge[];
  settlementTechnologyKnowledge: SettlementTechnologyKnowledge[];
  technologyTransmissions: TechnologyTransmission[];
  resourceDeposits: ResourceDeposit[];
  settlementRegionalEconomies: SettlementRegionalEconomy[];
  tradeContracts: TradeContract[];
  cultures: CultureDefinition[];
  civilizations: Civilization[];
  languages: LanguageDefinition[];
  religions: ReligionDefinition[];
  settlementCultures: SettlementCultureState[];
  settlementGovernments: SettlementGovernment[];
  districtCivicStates: DistrictCivicState[];
  cityStates: SettlementCityState[];
  urbanStates: UrbanState[];
  civicPatrols: CivicPatrol[];
  crimes: CrimeIncident[];
  courtCases: CourtCase[];
  fireIncidents: FireIncident[];
  kingdomGovernments: KingdomGovernment[];
  nobleTitles: NobleTitle[];
  vassalContracts: VassalContract[];
  courtOffices: CourtOffice[];
  courtFactions: CourtFaction[];
  royalOrders: RoyalOrder[];
  stateCrises: StateCrisis[];
  diplomaticAgreements: DiplomaticAgreement[];
  socialObligations: SocialObligation[];
  healthConditions: HealthCondition[];
  pregnancies: Pregnancy[];
  epidemics: Epidemic[];
  decisions: DecisionRecord[];
  stateDeltas: StateDelta[];
  institutionDecisions: InstitutionDecision[];
  territoryHistory: TerritoryChange[];
  events: WorldEvent[];
  localMapChanges: LocalMapEffect[];
  simulation: SimulationRuntimeState;
  history: HistoricalState;
  nextIds: Record<string, number>;
}

export interface EntityRef {
  kind: EntityKind;
  id: number;
}
