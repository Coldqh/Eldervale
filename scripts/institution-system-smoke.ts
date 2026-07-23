import assert from 'node:assert/strict';
import { CIVILIZATION_CONTENT } from '../src/content/coreContent';
import { defaultConfig } from '../src/sim/generator';
import { generateHistoricalWorld } from '../src/sim/historicalEngine';
import { advanceConstruction } from '../src/sim/agricultureConstruction';
import { requestCityProject } from '../src/sim/cityProjects';
import { buildWorldIndexes } from '../src/sim/indexes';
import {
  advanceInstitutionSystem,
  authorizeTechnologyResearch,
  institutionDecisionIntegrityIssues,
} from '../src/sim/institutionSystem';
import { ensureCharacterMind } from '../src/sim/mindSystem';
import { RNG } from '../src/sim/rng';
import { worldTick } from '../src/sim/scheduler';

const world = generateHistoricalWorld({
  ...defaultConfig,
  seed: 'living-institutions-smoke',
  width: 20,
  height: 14,
  historyYears: 18,
  kingdomCount: 3,
  settlementCount: 8,
  populationScale: .24,
  monsterDensity: .08,
  artifactDensity: .08,
  ecologyDensity: .24,
});

assert.equal(world.version, 35, 'живые институты должны использовать схему 35');
assert.equal(world.simulation.institutionSystemVersion, 1, 'институциональная система должна быть инициализирована');

const governed = world.settlements
  .map(settlement => ({ settlement, government: world.settlementGovernments.find(item => item.settlementId === settlement.id) }))
  .filter((entry): entry is { settlement: typeof world.settlements[number]; government: typeof world.settlementGovernments[number] } => Boolean(entry.government))
  .filter(entry => world.characters.some(character => character.id === entry.government.leaderCharacterId && character.alive && character.settlementId === entry.settlement.id))
  .filter(entry => world.constructionProjects.filter(project => project.settlementId === entry.settlement.id && !['завершено', 'заброшено'].includes(project.stage)).length < 3);
assert.ok(governed.length >= 2, 'проверка требует две действующие местные власти');

world.month = 2;
const approvedEntry = governed[0]!;
const approvedUrban = world.urbanStates.find(item => item.settlementId === approvedEntry.settlement.id)!;
for (const request of approvedUrban.projectQueue.filter(item => ['requested', 'approved'].includes(item.status))) {
  request.status = 'blocked';
  request.nextReviewTick = worldTick(world) + 24;
}
approvedEntry.government.treasury = 1_000;
approvedEntry.government.corruption = 4;
const leader = world.characters.find(item => item.id === approvedEntry.government.leaderCharacterId)!;
const leaderMind = ensureCharacterMind(world, leader);
leaderMind.values.order = 100;
leaderMind.values.family = 100;
leaderMind.traits.empathy = 100;
leaderMind.emotions.fear = 0;
for (const memberId of approvedEntry.government.councilCharacterIds) {
  const member = world.characters.find(item => item.id === memberId && item.alive);
  if (!member) continue;
  const mind = ensureCharacterMind(world, member);
  mind.values.order = 100;
  mind.values.family = 100;
  mind.traits.empathy = 100;
}
const proposal = requestCityProject(world, approvedEntry.settlement.id, 'watchtower', 'пограничный район не защищён', {
  source: 'institution-smoke', priority: 100, triggerProblemIds: ['institution-smoke:defense'], expectedRelief: ['fire-risk'], targetDistrictRole: 'окраина',
});
const projectsBeforeAuthorization = world.constructionProjects.length;
advanceConstruction(world, new RNG('institution-no-authorization'), buildWorldIndexes(world), new Set([approvedEntry.settlement.id]));
assert.equal(world.constructionProjects.some(project => project.cityRequestId === proposal.id), false, 'городской запрос не должен сам превращаться в стройку');
assert.equal(proposal.status, 'requested', 'до решения совета запрос должен оставаться предложением');

advanceInstitutionSystem(world, new RNG('institution-city-approval'));
assert.equal(proposal.status, 'approved', 'обеспеченный и поддержанный проект должен получить решение совета');
assert.ok(proposal.institutionDecisionId, 'одобренный проект должен ссылаться на решение живого института');
const cityDecision = world.institutionDecisions.find(item => item.id === proposal.institutionDecisionId)!;
assert.equal(cityDecision.actorCharacterId, leader.id, 'инициатором решения должен быть реальный руководитель');
assert.equal(cityDecision.status, 'approved');
assert.ok(cityDecision.decisionRecordId, 'решение института должно быть связано с общим причинным ядром');
assert.ok(cityDecision.optionScores.some(option => option.id === 'approve') && cityDecision.optionScores.some(option => option.id === 'reject'), 'совет должен хранить реальные альтернативы');

advanceConstruction(world, new RNG('institution-authorized-construction'), buildWorldIndexes(world), new Set([approvedEntry.settlement.id]));
assert.ok(['started', 'blocked', 'completed'].includes(proposal.status), 'после политического разрешения проект должен пройти физическую строительную проверку');

const deniedEntry = governed[1]!;
const deniedUrban = world.urbanStates.find(item => item.settlementId === deniedEntry.settlement.id)!;
for (const request of deniedUrban.projectQueue.filter(item => ['requested', 'approved'].includes(item.status))) {
  request.status = 'blocked';
  request.nextReviewTick = worldTick(world) + 24;
}
deniedEntry.government.treasury = 0;
deniedEntry.government.corruption = 70;
const deniedProposal = requestCityProject(world, deniedEntry.settlement.id, 'castle', 'местная знать требует дорогую резиденцию', {
  source: 'institution-smoke', priority: 46, targetDistrictRole: 'крепость',
});
advanceInstitutionSystem(world, new RNG('institution-city-denial'));
assert.ok(['blocked', 'rejected'].includes(deniedProposal.status), 'пустая казна не должна разрешать дорогой проект');
assert.ok(deniedProposal.institutionDecisionId, 'отказ или отсрочка тоже должны иметь автора и решение');
assert.ok(!world.constructionProjects.some(project => project.cityRequestId === deniedProposal.id), 'неодобренный проект не должен занимать землю');

const civilization = world.civilizations.find(item => world.settlements.some(settlement => settlement.civilizationId === item.id));
assert.ok(civilization, 'для проверки исследования нужна цивилизация');
const researchSettlement = world.settlements.find(item => item.civilizationId === civilization!.id
  && world.characters.some(character => character.alive && character.settlementId === item.id && character.age >= 14));
assert.ok(researchSettlement, 'исследование требует живое поселение');
const researcher = world.characters
  .filter(character => character.alive && character.settlementId === researchSettlement!.id && character.age >= 14)
  .sort((a, b) => Math.max(...Object.values(b.skills ?? {}), 0) - Math.max(...Object.values(a.skills ?? {}), 0) || a.id - b.id)[0]!;
const researcherMind = ensureCharacterMind(world, researcher);
researcherMind.traits.ambition = 100;
researcherMind.traits.patience = 100;
researcherMind.emotions.fear = 0;
const technology = CIVILIZATION_CONTENT.technologyById.get('carpentry')!;
const researchDecision = authorizeTechnologyResearch(world, civilization!.id, researchSettlement!, technology, researcher, 100);
assert.equal(researchDecision.actorCharacterId, researcher.id, 'исследование должно начинаться конкретным мастером');
assert.equal(researchDecision.chosenOptionId, 'attempt', 'подготовленный мастер должен выбрать физический опыт');
assert.equal(researchDecision.status, 'approved', 'согласованный опыт должен быть разрешён, но не выдавать технологию сам');
assert.ok(researchDecision.supporterCharacterIds.every(id => world.characters.some(character => character.id === id && character.alive)), 'сторонники исследования должны быть живыми людьми');

assert.ok(world.tradeContracts.filter(contract => contract.status === 'active').every(contract => Boolean(contract.institutionDecisionId)), 'активные договоры должны иметь решение участников');
assert.deepEqual(institutionDecisionIntegrityIssues(world), [], 'живые институты должны сохранять собственные инварианты');

console.log(`OK LIVING INSTITUTIONS: решений ${world.institutionDecisions.length}, городской проект ${proposal.status}, отказ ${deniedProposal.status}, опыт ${researchDecision.status}.`);
