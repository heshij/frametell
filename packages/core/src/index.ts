export { Studio, type MaterialFile, type OpenFile, type StudioOptions } from './studio.js';
export { DATA_DIR, PROJECTS_DIR, configFile, withDefaults, type Config, type ConfigContext, type ConfigStore } from './config.js';
export type * from './types.js';
export type { Renderer } from '@frametell/agent';
/** a file written into a project through the checked helper (never through a link) */
export { writeIn, readIn, listIn } from '@frametell/agent';
export { tr, locale, systemLocale } from './i18n.js';
/** the sample shipped with a built-in voice (no key needed to hear it) */
export { bundledSample as voiceSample } from '@frametell/voice';
export { COVER_IMAGE } from './runner.js';
