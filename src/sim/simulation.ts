import type { Character, Kingdom, Settlement, War, WorldEvent, WorldState } from '../types';
import { RNG } from './rng';
import { personName } from './names';

function addEvent(world: WorldState, event: Omit<WorldEvent, 'id' | 'year' | 'month'>): void {
  world.events.push({ id: world.nextIds.event++, year: world.year, month: world.month, ...event });
  if (world.events.length > 2400) world.events.splice(0, world.events.length - 2400);
}

function nearestSettlement(world: WorldState, x: number, y: number, filter?: (settlement: Settlement) => boolean): Settlement | undefined {
  return world.settlements
    .filter(filter ?? (() => true))
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
}

function ruler(world: WorldState, kingdom: Kingdom): Character {
  return world.characters.find(character => character.id === kingdom.rulerId)!;
}

function advancePopulation(world: WorldState, rng: RNG): void {
  for (const settlement of world.settlements) {
    const residents = world.characters.filter(c => c.alive && c.settlementId === settlement.id);
    settlement.population = residents.length;
    const foodChange = Math.round(settlement.prosperity / 18 - settlement.population / 45 + rng.int(-4, 5));
    settlement.food = Math.max(0, Math.min(160, settlement.food + foodChange));
    settlement.prosperity = Math.max(5, Math.min(100, settlement.prosperity + (settlement.food > 55 ? 1 : -2) - Math.ceil(settlement.damaged / 30)));
    settlement.damaged = Math.max(0, settlement.damaged - (settlement.prosperity > 45 ? 2 : 0));
  }
  if (world.month !== 1) return;
  for (const character of world.characters) {
    if (!character.alive) continue;
    character.age += 1;
    const mortality = character.age < 45 ? 0.002 : character.age < 65 ? 0.01 : character.age < 85 ? 0.055 : 0.16;
    if (rng.chance(mortality + (100 - character.health) / 1500)) {
      character.alive = false;
      character.deathYear = world.year;
      character.biography.push(`Died in ${world.year}.`);
      addEvent(world, { kind: 'death', title: `${character.name} died`, description: `${character.name}, ${character.profession} of ${world.settlements.find(s => s.id === character.settlementId)?.name}, died at the age of ${character.age}.`, entityRefs: [{ kind: 'character', id: character.id }], importance: character.renown > 55 ? 3 : 1 });
    }
  }
  for (const settlement of world.settlements) {
    const adults = world.characters.filter(c => c.alive && c.settlementId === settlement.id && c.age >= 18 && c.age <= 48);
    const births = Math.min(10, Math.floor(adults.length / 18 * (settlement.food > 35 ? 1 : 0.25) * rng.next()));
    for (let i = 0; i < births; i += 1) {
      const parentA = rng.pick(adults);
      const parentBOptions = adults.filter(c => c.id !== parentA.id);
      const parentB = parentBOptions.length ? rng.pick(parentBOptions) : undefined;
      const child: Character = {
        id: world.nextIds.character++, name: personName(rng, parentA.species), species: parentA.species, age: 0,
        birthYear: world.year, alive: true, settlementId: settlement.id, kingdomId: settlement.kingdomId,
        profession: 'child', renown: 0, health: rng.int(70, 100), ambition: 'find a place in the world',
        parentIds: parentB ? [parentA.id, parentB.id] : [parentA.id], childIds: [], titles: [], artifactIds: [], bookIds: [], kills: 0,
        biography: [`Born in ${settlement.name} in ${world.year}.`],
      };
      parentA.childIds.push(child.id); if (parentB) parentB.childIds.push(child.id);
      world.characters.push(child);
      if (rng.chance(0.08)) addEvent(world, { kind: 'birth', title: `${child.name} was born`, description: `A child was born to a household in ${settlement.name}.`, entityRefs: [{ kind: 'character', id: child.id }, { kind: 'settlement', id: settlement.id }], importance: 1 });
    }
  }
}

function startWars(world: WorldState, rng: RNG): void {
  if (!rng.chance(world.config.warlike * 0.075) || world.wars.filter(w => w.active).length >= Math.ceil(world.kingdoms.length / 3)) return;
  const candidates = world.kingdoms.filter(k => !world.wars.some(w => w.active && (w.attackerId === k.id || w.defenderId === k.id)));
  if (candidates.length < 2) return;
  const attacker = [...candidates].sort((a, b) => b.aggression - a.aggression)[rng.int(0, Math.min(2, candidates.length - 1))]!;
  const defender = rng.pick(candidates.filter(k => k.id !== attacker.id));
  const cause = rng.pick(['a disputed border fortress', 'unpaid trade tolls', 'a dynastic claim', 'raids against frontier villages', 'control of an iron road', 'the murder of a royal envoy']);
  const war: War = { id: world.nextIds.war++, name: `${attacker.name}–${defender.name} War`, attackerId: attacker.id, defenderId: defender.id, startYear: world.year, active: true, cause, battles: 0, attackerLosses: 0, defenderLosses: 0 };
  world.wars.push(war); attacker.enemies.push(defender.id); defender.enemies.push(attacker.id);
  const army = world.armies.find(a => a.kingdomId === attacker.id)!;
  const target = nearestSettlement(world, army.x, army.y, s => s.kingdomId === defender.id)!;
  army.targetKingdomId = defender.id; army.targetSettlementId = target.id; army.status = 'marching';
  addEvent(world, { kind: 'war', title: `${war.name} began`, description: `${ruler(world, attacker).name} declared war over ${cause}. The ${army.name} marched toward ${target.name}.`, entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: attacker.id }, { kind: 'kingdom', id: defender.id }, { kind: 'army', id: army.id }], importance: 5 });
}

function moveArmies(world: WorldState, rng: RNG): void {
  for (const army of world.armies) {
    if (army.status !== 'marching' || !army.targetSettlementId) continue;
    const target = world.settlements.find(s => s.id === army.targetSettlementId);
    if (!target) continue;
    const dx = Math.sign(target.x - army.x); const dy = Math.sign(target.y - army.y);
    if (rng.chance(0.7)) army.x += dx; if (rng.chance(0.7)) army.y += dy;
    if (army.x === target.x && army.y === target.y) resolveBattle(world, army.id, target.id, rng);
  }
}

function resolveBattle(world: WorldState, armyId: number, targetId: number, rng: RNG): void {
  const army = world.armies.find(a => a.id === armyId)!;
  const target = world.settlements.find(s => s.id === targetId)!;
  const war = world.wars.find(w => w.active && w.attackerId === army.kingdomId && w.defenderId === target.kingdomId);
  if (!war) { army.status = 'garrison'; return; }
  const defenderArmy = world.armies.find(a => a.kingdomId === target.kingdomId)!;
  const attackPower = army.strength * (0.6 + army.morale / 100) * (0.75 + rng.next() * 0.55);
  const defensePower = (target.defense * 4 + defenderArmy.strength * 0.55) * (0.72 + rng.next() * 0.62);
  const attackLoss = Math.max(8, Math.round(defensePower / 14));
  const defenseLoss = Math.max(8, Math.round(attackPower / 15));
  army.strength = Math.max(0, army.strength - attackLoss); defenderArmy.strength = Math.max(0, defenderArmy.strength - defenseLoss);
  war.attackerLosses += attackLoss; war.defenderLosses += defenseLoss; war.battles += 1;
  const won = attackPower > defensePower;
  if (won) {
    const oldKingdom = target.kingdomId; target.kingdomId = army.kingdomId; target.damaged = Math.min(100, target.damaged + rng.int(18, 48));
    target.defense = Math.max(10, target.defense - rng.int(8, 22));
    world.characters.filter(c => c.settlementId === target.id).forEach(c => { c.kingdomId = army.kingdomId; c.biography.push(`${target.name} was conquered by ${world.kingdoms.find(k => k.id === army.kingdomId)!.name}.`); });
    world.tiles.filter(t => t.settlementId === target.id).forEach(t => { t.kingdomId = army.kingdomId; });
    addEvent(world, { kind: 'battle', title: `${target.name} fell`, description: `${army.name} captured ${target.name} after losing ${attackLoss} soldiers. The defenders lost ${defenseLoss}.`, entityRefs: [{ kind: 'settlement', id: target.id }, { kind: 'army', id: army.id }, { kind: 'war', id: war.id }, { kind: 'kingdom', id: oldKingdom }], importance: 5 });
  } else {
    addEvent(world, { kind: 'battle', title: `${target.name} held its walls`, description: `${army.name} was repelled. ${attackLoss} attackers and ${defenseLoss} defenders were lost.`, entityRefs: [{ kind: 'settlement', id: target.id }, { kind: 'army', id: army.id }, { kind: 'war', id: war.id }], importance: 4 });
  }
  army.status = 'recovering'; army.targetSettlementId = undefined; army.targetKingdomId = undefined; army.morale = Math.max(25, army.morale + (won ? 8 : -16));
  if (war.battles >= 2 && rng.chance(0.28 + war.battles * 0.08)) endWar(world, war, won ? war.attackerId : war.defenderId);
}

function endWar(world: WorldState, war: War, victorId: number): void {
  war.active = false; war.endYear = world.year;
  const attacker = world.kingdoms.find(k => k.id === war.attackerId)!; const defender = world.kingdoms.find(k => k.id === war.defenderId)!;
  attacker.enemies = attacker.enemies.filter(id => id !== defender.id); defender.enemies = defender.enemies.filter(id => id !== attacker.id);
  world.armies.filter(a => a.kingdomId === attacker.id || a.kingdomId === defender.id).forEach(a => { a.status = 'recovering'; a.targetSettlementId = undefined; });
  addEvent(world, { kind: 'war', title: `${war.name} ended`, description: `${world.kingdoms.find(k => k.id === victorId)!.name} dictated the peace after ${war.battles} major battles.`, entityRefs: [{ kind: 'war', id: war.id }, { kind: 'kingdom', id: victorId }], importance: 4 });
}

function recoverArmies(world: WorldState): void {
  for (const army of world.armies) {
    if (army.status !== 'recovering' && army.status !== 'garrison') continue;
    const kingdom = world.kingdoms.find(k => k.id === army.kingdomId)!;
    const capital = world.settlements.find(s => s.id === kingdom.capitalId)!;
    army.x = capital.x; army.y = capital.y;
    const recruitment = Math.max(1, Math.round(capital.population / 180));
    army.strength = Math.min(kingdom.armyStrength, army.strength + recruitment);
    army.morale = Math.min(92, army.morale + 2);
    if (army.strength > kingdom.armyStrength * 0.65) army.status = 'garrison';
  }
}

function monsterActions(world: WorldState, rng: RNG): void {
  for (const monster of world.monsters.filter(m => m.alive)) {
    const actionChance = monster.species === 'dragon' ? 0.045 : 0.018;
    if (!rng.chance(actionChance * world.config.monsterDensity)) continue;
    const target = nearestSettlement(world, monster.x, monster.y);
    if (!target) continue;
    if (monster.species === 'dragon') {
      const damage = rng.int(12, 38); const deaths = Math.min(target.population, rng.int(2, Math.max(3, Math.round(target.population * 0.07))));
      target.damaged = Math.min(100, target.damaged + damage); target.food = Math.max(0, target.food - rng.int(12, 35)); monster.hoard += rng.int(30, 160); monster.kills += deaths;
      const victims = world.characters.filter(c => c.alive && c.settlementId === target.id).sort(() => rng.next() - 0.5).slice(0, deaths);
      victims.forEach(v => { v.alive = false; v.deathYear = world.year; v.biography.push(`Killed when ${monster.name} attacked ${target.name}.`); });
      monster.history.push(`Attacked ${target.name} in ${world.year}.`);
      addEvent(world, { kind: 'dragon', title: `${monster.name} attacked ${target.name}`, description: `Fire struck homes and granaries. ${deaths} people died, and the dragon carried wealth back to its lair.`, entityRefs: [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }], importance: 5 });
      dispatchHero(world, monster.id, target.kingdomId, rng);
    } else {
      target.food = Math.max(0, target.food - rng.int(4, 14)); target.prosperity = Math.max(5, target.prosperity - rng.int(1, 5));
      monster.history.push(`Raided lands near ${target.name}.`);
      addEvent(world, { kind: 'monster', title: `${monster.name} threatened ${target.name}`, description: `Farms were abandoned and travelers vanished along the road.`, entityRefs: [{ kind: 'monster', id: monster.id }, { kind: 'settlement', id: target.id }], importance: monster.tier === 'boss' ? 4 : 2 });
      if (monster.tier === 'boss' || monster.tier === 'miniboss') dispatchHero(world, monster.id, target.kingdomId, rng);
    }
  }
}

function dispatchHero(world: WorldState, monsterId: number, kingdomId: number, rng: RNG): void {
  const monster = world.monsters.find(m => m.id === monsterId)!;
  const king = world.kingdoms.find(k => k.id === kingdomId)!;
  const heroes = world.characters.filter(c => c.alive && c.kingdomId === kingdomId && c.age >= 18 && (c.profession === 'soldier' || c.profession === 'hunter' || c.renown >= 35));
  if (!heroes.length) return;
  const hero = [...heroes].sort((a, b) => b.renown - a.renown)[0]!;
  addEvent(world, { kind: 'hero', title: `${hero.name} was sent against ${monster.name}`, description: `${ruler(world, king).name} offered coin, title and land if the beast was slain.`, entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }, { kind: 'kingdom', id: king.id }], importance: 4 });
  const heroPower = 30 + hero.renown + hero.health * 0.35 + hero.artifactIds.length * 18 + rng.int(0, 55);
  const monsterPower = monster.power + monster.health * 0.08 + rng.int(0, 55);
  if (heroPower > monsterPower) {
    monster.alive = false; hero.renown = Math.min(100, hero.renown + (monster.species === 'dragon' ? 35 : 18)); hero.kills += 1;
    hero.titles.push(monster.species === 'dragon' ? 'Dragonslayer' : 'Beastslayer'); hero.biography.push(`Slew ${monster.name} in ${world.year}.`);
    monster.history.push(`Slain by ${hero.name}.`);
    addEvent(world, { kind: 'hero', title: `${hero.name} slew ${monster.name}`, description: `The hunter returned alive. The beast's hoard and remains became a new source of wealth and dispute.`, entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }], importance: 5 });
  } else if (rng.chance(0.58)) {
    hero.alive = false; hero.deathYear = world.year; hero.biography.push(`Killed while hunting ${monster.name}.`); monster.kills += 1;
    addEvent(world, { kind: 'hero', title: `${hero.name} died hunting ${monster.name}`, description: `The expedition failed. Survivors returned with conflicting accounts of the final fight.`, entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }], importance: 4 });
  } else {
    hero.health = Math.max(12, hero.health - rng.int(18, 45)); hero.biography.push(`Was wounded while hunting ${monster.name}.`);
    addEvent(world, { kind: 'hero', title: `${hero.name} returned wounded`, description: `${monster.name} survived the hunt and remained a threat.`, entityRefs: [{ kind: 'character', id: hero.id }, { kind: 'monster', id: monster.id }], importance: 3 });
  }
}

function succession(world: WorldState, rng: RNG): void {
  for (const kingdom of world.kingdoms) {
    const current = world.characters.find(c => c.id === kingdom.rulerId);
    if (current?.alive) continue;
    const heirs = current?.childIds.map(id => world.characters.find(c => c.id === id)).filter((c): c is Character => Boolean(c?.alive && c.age >= 16)) ?? [];
    const nobles = world.characters.filter(c => c.alive && c.kingdomId === kingdom.id && c.age >= 18).sort((a, b) => b.renown - a.renown);
    const successor = heirs[0] ?? nobles[0];
    if (!successor) continue;
    successor.titles.push(kingdom.species === 'orc' ? 'High Chieftain' : 'Sovereign'); successor.renown = Math.max(65, successor.renown); kingdom.rulerId = successor.id;
    kingdom.stability = Math.max(20, kingdom.stability - (heirs.length ? rng.int(3, 10) : rng.int(12, 28)));
    successor.biography.push(`Became ruler of ${kingdom.name} in ${world.year}.`);
    addEvent(world, { kind: 'politics', title: `${successor.name} took the throne of ${kingdom.name}`, description: heirs.length ? `The succession followed the bloodline, though rivals watched closely.` : `With no clear heir, the strongest court faction raised ${successor.name} to power.`, entityRefs: [{ kind: 'character', id: successor.id }, { kind: 'kingdom', id: kingdom.id }], importance: 5 });
  }
}

export function advanceWorld(source: WorldState, months = 1): WorldState {
  const world = structuredClone(source);
  for (let step = 0; step < months; step += 1) {
    world.month += 1;
    if (world.month > 12) { world.month = 1; world.year += 1; }
    const rng = new RNG(`${world.config.seed}:${world.year}:${world.month}`);
    advancePopulation(world, rng);
    startWars(world, rng);
    moveArmies(world, rng);
    recoverArmies(world);
    monsterActions(world, rng);
    succession(world, rng);
  }
  return world;
}
