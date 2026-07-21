declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.2.3';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Глубокие интерьеры и назначенные места';
export const APP_RELEASE_NOTES = 'Дома получают кровати для каждого жильца, школы — классы и личные парты, рабочие здания — отдельные рабочие места. NPC ночью занимают свои кровати, ученики сидят за назначенными партами, а замки, таверны, храмы и мастерские получают материалы, комнаты и узнаваемую обстановку.';
