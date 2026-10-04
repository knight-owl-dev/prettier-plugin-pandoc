// Terms such as "Proof" and "Figure" in the document's language, from
// Pandoc's translation data.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Translations` and
// `Text.Pandoc.Translations.Types`. The data is `translations-table.js`;
// the language and what was loaded live in a reader's common state.

import { renderLang } from './collate/lang.js';
import { TRANSLATIONS } from './translations-table.js';

/** @typedef {import('./collate/lang.js').Lang} Lang */

/**
 * A term's name, as the data's keys give it.
 *
 * @see Text.Pandoc.Translations.Types.Term
 * @typedef {'Abstract' | 'Appendix' | 'Bibliography' | 'Cc' | 'Chapter' | 'Contents' | 'Encl' | 'Figure' | 'Glossary' | 'Index' | 'Listing' | 'ListOfFigures' | 'ListOfTables' | 'Page' | 'Part' | 'Preface' | 'Proof' | 'References' | 'See' | 'SeeAlso' | 'Table' | 'To'} Term
 */

/**
 * A language's terms.
 *
 * @see Text.Pandoc.Translations.Types.Translations
 * @typedef {Partial<Record<Term, string>>} Translations
 */

/**
 * The language set for translations, and its terms once loaded: Pandoc's
 * `stTranslations`; null for none.
 *
 * @typedef {{lang: Lang, terms: Translations | null} | null} TranslationState
 */

/**
 * @see Text.Pandoc.Translations.Types.lookupTerm
 * @param {Term} term
 * @param {Translations} translations
 * @returns {string | undefined}
 */
export const lookupTerm = (term, translations) =>
  Object.hasOwn(translations, term) ? translations[term] : undefined;

/**
 * Select the language `translateTerm` uses; its terms load on first use.
 *
 * @see Text.Pandoc.Translations.setTranslations
 * @param {{translations: TranslationState}} common
 * @param {Lang} lang
 */
export function setTranslations(common, lang) {
  common.translations = { lang, terms: null };
}

/**
 * The language's terms: from the data for its full tag, then its language
 * and script, then its language. None where no language is set, or no data
 * holds it, which clears the language.
 *
 * @see Text.Pandoc.Translations.getTranslations
 * @param {{translations: TranslationState}} common
 * @returns {Translations}
 */
export function getTranslations(common) {
  const current = common.translations;
  if (current === null) return {};
  if (current.terms !== null) return current.terms;
  const { lang } = current;
  const names = [
    renderLang(lang),
    lang.language + (lang.script === null ? '' : `-${lang.script}`),
    lang.language,
  ];
  for (const name of new Set(names)) {
    const terms = TRANSLATIONS.get(name);
    if (terms !== undefined) {
      common.translations = { lang, terms };
      return terms;
    }
  }
  // Pandoc warns it could not load them (`CouldNotLoadTranslations`).
  common.translations = null;
  return {};
}

/**
 * A term in the current language; empty where it has none.
 *
 * @see Text.Pandoc.Translations.translateTerm
 * @param {{translations: TranslationState}} common
 * @param {Term} term
 */
export function translateTerm(common, term) {
  // Pandoc warns of a term with no translation (`NoTranslation`).
  return lookupTerm(term, getTranslations(common)) ?? '';
}
