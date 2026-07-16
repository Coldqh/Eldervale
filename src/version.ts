declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.8.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Память, знания и слухи';
export const APP_RELEASE_NOTES = 'Личная память NPC, ограниченные знания, мнения, слухи и их искажение, письма, гонцы, донесения, задержка информации между поселениями, торговцы как переносчики новостей и решения правителей только после подтверждённых сведений.';
