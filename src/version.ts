declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.1.1';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Жители внутри зданий и расовая демография';
export const APP_RELEASE_NOTES = 'Жители больше не выталкиваются за стены школ, домов и таверн; государства получили основную расу, редкие смешанные поселения и корректное наследование вида детьми.';
