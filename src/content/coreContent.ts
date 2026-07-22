import type { CivilizationContentPack } from '../civilizationTypes';
import { buildContentCatalog } from './catalog';
import { CORE_ERAS } from './coreEras';
import { CORE_RECIPES } from './coreRecipes';
import { CORE_RESOURCES } from './coreResources';
import { CORE_TECHNOLOGIES } from './coreTechnologies';

export const CORE_CONTENT_PACK: CivilizationContentPack = {
  id: 'eldervale-core',
  version: 1,
  eras: CORE_ERAS,
  technologies: CORE_TECHNOLOGIES,
  resources: CORE_RESOURCES,
  recipes: CORE_RECIPES,
};

export const CIVILIZATION_CONTENT = buildContentCatalog([CORE_CONTENT_PACK]);
