import type {
  CivilizationContentPack, CivilizationEraDefinition, RecipeDefinition, ResourceDefinition, TechnologyDefinition,
} from '../civilizationTypes';

export interface CivilizationContentCatalog {
  packs: readonly CivilizationContentPack[];
  eras: readonly CivilizationEraDefinition[];
  technologies: readonly TechnologyDefinition[];
  resources: readonly ResourceDefinition[];
  recipes: readonly RecipeDefinition[];
  eraById: ReadonlyMap<string, CivilizationEraDefinition>;
  technologyById: ReadonlyMap<string, TechnologyDefinition>;
  resourceById: ReadonlyMap<string, ResourceDefinition>;
  recipeByKey: ReadonlyMap<string, RecipeDefinition>;
}

function duplicateIds<T>(items: readonly T[], key: (item: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function technologyCycles(technologies: readonly TechnologyDefinition[]): string[] {
  const byId = new Map(technologies.map(item => [item.id, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      cycles.add([...path, id].join(' -> '));
      return;
    }
    if (visited.has(id)) return;
    const technology = byId.get(id);
    if (!technology) return;
    visiting.add(id);
    for (const prerequisite of technology.prerequisites) visit(prerequisite, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const technology of technologies) visit(technology.id, []);
  return [...cycles];
}

export function validateContentPacks(packs: readonly CivilizationContentPack[]): string[] {
  const eras = packs.flatMap(pack => pack.eras);
  const technologies = packs.flatMap(pack => pack.technologies);
  const resources = packs.flatMap(pack => pack.resources);
  const recipes = packs.flatMap(pack => pack.recipes);
  const errors: string[] = [];

  for (const packId of duplicateIds(packs, pack => pack.id)) errors.push(`Каталог: повторяется пакет «${packId}».`);
  for (const [label, values] of [
    ['эпоха', duplicateIds(eras, item => item.id)],
    ['технология', duplicateIds(technologies, item => item.id)],
    ['ресурс', duplicateIds(resources, item => item.id)],
    ['рецепт', duplicateIds(recipes, item => item.key)],
  ] as const) for (const value of values) errors.push(`Каталог: повторяется ${label} «${value}».`);

  const eraIds = new Set(eras.map(item => item.id));
  const technologyIds = new Set(technologies.map(item => item.id));
  const resourceIds = new Set(resources.map(item => item.id));

  for (const technology of technologies) {
    if (!eraIds.has(technology.eraId)) errors.push(`Технология «${technology.id}» ссылается на отсутствующую эпоху «${technology.eraId}».`);
    for (const prerequisite of technology.prerequisites) if (!technologyIds.has(prerequisite)) errors.push(`Технология «${technology.id}» требует отсутствующую технологию «${prerequisite}».`);
    for (const resourceId of technology.requirements?.requiredResourceIds ?? []) if (!resourceIds.has(resourceId)) errors.push(`Технология «${technology.id}» требует отсутствующий ресурс «${resourceId}».`);
  }
  for (const era of eras) for (const technologyId of era.entryTechnologyIds) if (!technologyIds.has(technologyId)) errors.push(`Эпоха «${era.id}» требует отсутствующую технологию «${technologyId}».`);
  for (const resource of resources) if (resource.requiredTechnologyId && !technologyIds.has(resource.requiredTechnologyId)) errors.push(`Ресурс «${resource.id}» требует отсутствующую технологию «${resource.requiredTechnologyId}».`);
  for (const recipe of recipes) {
    if (recipe.requiredTechnologyId && !technologyIds.has(recipe.requiredTechnologyId)) errors.push(`Рецепт «${recipe.key}» требует отсутствующую технологию «${recipe.requiredTechnologyId}».`);
    for (const material of [...recipe.inputs, ...recipe.outputs]) if (!resourceIds.has(material.templateId)) errors.push(`Рецепт «${recipe.key}» использует отсутствующий ресурс «${material.templateId}».`);
    if (recipe.fuelTemplateId && !resourceIds.has(recipe.fuelTemplateId)) errors.push(`Рецепт «${recipe.key}» использует отсутствующее топливо «${recipe.fuelTemplateId}».`);
  }
  errors.push(...technologyCycles(technologies).map(cycle => `Каталог технологий содержит цикл: ${cycle}.`));
  return [...new Set(errors)];
}

export function buildContentCatalog(packs: readonly CivilizationContentPack[]): CivilizationContentCatalog {
  const errors = validateContentPacks(packs);
  if (errors.length) throw new Error(errors.join('\n'));
  const eras = packs.flatMap(pack => pack.eras).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const technologies = packs.flatMap(pack => pack.technologies);
  const resources = packs.flatMap(pack => pack.resources);
  const recipes = packs.flatMap(pack => pack.recipes);
  return {
    packs,
    eras,
    technologies,
    resources,
    recipes,
    eraById: new Map(eras.map(item => [item.id, item])),
    technologyById: new Map(technologies.map(item => [item.id, item])),
    resourceById: new Map(resources.map(item => [item.id, item])),
    recipeByKey: new Map(recipes.map(item => [item.key, item])),
  };
}
