// The state a reader shares with the rest of Pandoc's run, apart from the
// parser's own: backtracking leaves it as it is. It holds the IO its host
// allows, as `PandocMonad` abstracts IO: Pandoc's CLI reads the disk, its
// pure monad nothing.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Class.CommonState`, the fields
// readers use, set up as `Text.Pandoc.App` sets them.

import { lang, parseLang } from './collate/lang.js';

/**
 * The IO a reader may do. Each hook is synchronous, as the parser is.
 *
 * @see Text.Pandoc.Class.PandocMonad.PandocMonad
 * @typedef {object} Host
 * @property {(path: string) => string | null} readFile A file's text, null
 *   where it cannot be read.
 * @property {(path: string) => boolean} fileExists
 * @property {() => Date} now
 * @property {(name: string) => string | undefined} env An environment
 *   variable.
 */

/** @type {Host} No file exists, as in Pandoc's pure monad. */
const NO_FILES = {
  readFile: () => null,
  fileExists: () => false,
  now: () => new Date(),
  env: () => undefined,
};

/**
 * @see Text.Pandoc.Class.CommonState.CommonState
 * @typedef {object} CommonState
 * @property {import('./translations.js').TranslationState} translations
 * @property {Host} host
 * @property {string[]} resourcePath Where resources such as images are
 *   looked for.
 */

/**
 * A run's common state: translations in the language `lang` names, as
 * `-M lang=…` gives it, American English by default, none where it is no
 * BCP 47 tag; the IO `host` allows, by default none.
 *
 * @see Text.Pandoc.App.convertWithOpts'
 * @param {{lang?: string, host?: Partial<Host>}} [options]
 * @returns {CommonState}
 */
export function commonState({ lang: tag = '', host = {} } = {}) {
  // Pandoc warns of a tag it cannot parse (`InvalidLang`).
  const l = tag === '' ? lang('en', { region: 'US' }) : parseLang(tag);
  return {
    translations: l === null ? null : { lang: l, terms: null },
    host: { ...NO_FILES, ...host },
    resourcePath: ['.'],
  };
}
