import type { CivilizationEraDefinition } from '../civilizationTypes';

export const CORE_ERAS: CivilizationEraDefinition[] = [
  {
    id: 'survival', name: 'Эпоха выживания', order: 0,
    description: 'Общины удерживают огонь, устную память и базовые способы добычи пищи.',
    entryTechnologyIds: ['controlled-fire', 'oral-tradition'], minimumPopulation: 0, minimumUrbanization: 0, minimumLiteracy: 0,
  },
  {
    id: 'settlement', name: 'Эпоха поселений', order: 1,
    description: 'Постоянные поселения опираются на земледелие, ремесло, хранение пищи и устойчивые хозяйства.',
    entryTechnologyIds: ['settled-agriculture', 'carpentry'], minimumPopulation: 40, minimumUrbanization: 8, minimumLiteracy: 0,
  },
  {
    id: 'urban', name: 'Эпоха городов', order: 2,
    description: 'Города требуют каменного строительства, письменного учёта, рынков и специализированных мастерских.',
    entryTechnologyIds: ['masonry', 'written-records'], minimumPopulation: 250, minimumUrbanization: 28, minimumLiteracy: 8,
  },
  {
    id: 'scholarship', name: 'Эпоха учёных сословий', order: 3,
    description: 'Гильдии, школы, архивы и систематическое знание ускоряют сложные ремёсла и медицину.',
    entryTechnologyIds: ['guild-organization', 'formal-medicine'], minimumPopulation: 700, minimumUrbanization: 46, minimumLiteracy: 24,
  },
  {
    id: 'arcane', name: 'Арканная эпоха', order: 4,
    description: 'Магия становится воспроизводимой дисциплиной с институтами, методами и проверяемыми рецептами.',
    entryTechnologyIds: ['arcane-method'], minimumPopulation: 900, minimumUrbanization: 54, minimumLiteracy: 38,
  },
];
