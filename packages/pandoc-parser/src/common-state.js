// The state a reader shares with the rest of Pandoc's run, apart from the
// parser's own: backtracking leaves it as it is.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Class.CommonState`, the fields
// readers use, set up as `Text.Pandoc.App` sets them.

import { lang, parseLang } from './collate/lang.js';

/**
 * @see Text.Pandoc.Class.CommonState.CommonState
 * @typedef {object} CommonState
 * @property {import('./translations.js').TranslationState} translations
 */

/**
 * A run's common state: translations in the language `lang` names, as
 * `-M lang=…` gives it, American English by default; none where it is
 * no BCP 47 tag.
 *
 * @see Text.Pandoc.App.convertWithOpts'
 * @param {{lang?: string}} [options]
 * @returns {CommonState}
 */
export function commonState({ lang: tag = '' } = {}) {
  // Pandoc warns of a tag it cannot parse (`InvalidLang`).
  const l = tag === '' ? lang('en', { region: 'US' }) : parseLang(tag);
  return { translations: l === null ? null : { lang: l, terms: null } };
}
