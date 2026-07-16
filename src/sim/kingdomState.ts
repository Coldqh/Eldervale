import type { Settlement, WorldState } from '../types';

export function controlledCapital(world: WorldState, kingdomId: number): Settlement | undefined {
  const kingdom = world.kingdoms.find(item => item.id === kingdomId);
  if (!kingdom) return undefined;
  const current = world.settlements.find(item => item.id === kingdom.capitalId && item.kingdomId === kingdomId);
  if (current) return current;
  return world.settlements
    .filter(item => item.kingdomId === kingdomId)
    .sort((a, b) => Number(b.type === 'city' || b.type === 'fortress') - Number(a.type === 'city' || a.type === 'fortress') || b.population - a.population || b.defense - a.defense || a.id - b.id)[0];
}

export function normalizeKingdomCapitals(world: WorldState): void {
  for (const kingdom of world.kingdoms) {
    const previous = world.settlements.find(item => item.id === kingdom.capitalId);
    const capital = controlledCapital(world, kingdom.id);
    if (!capital || capital.id === kingdom.capitalId) continue;
    kingdom.capitalId = capital.id;
    capital.history.push(`В ${world.year} году поселение стало столицей государства ${kingdom.name}${previous ? ` после утраты ${previous.name}` : ''}.`);
    for (const army of world.armies.filter(item => item.kingdomId === kingdom.id && (item.status === 'garrison' || item.status === 'recovering'))) {
      army.x = capital.x;
      army.y = capital.y;
    }
  }
}
