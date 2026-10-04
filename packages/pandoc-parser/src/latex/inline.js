// Inline commands of the LaTeX reader, by kind.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Readers.LaTeX.Inline`: its term
// commands so far.

import * as B from '../ast/builder.js';
import { translateTerm } from '../translations.js';

/** @typedef {import('../ast/builder.js').Inlines} Inlines */

/**
 * A term in the document's language.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.doTerm
 * @param {import('../translations.js').Term} term
 */
const doTerm = (term) => (ctx, start) =>
  B.str(translateTerm(ctx.common, term), start, ctx.state.at);

/**
 * `\proofname` and its kin.
 *
 * @see Text.Pandoc.Readers.LaTeX.Inline.nameCommands
 * @type {Map<string, (ctx: object, start: number) => Inlines>}
 */
export const nameCommands = new Map([
  ['figurename', doTerm('Figure')],
  ['prefacename', doTerm('Preface')],
  ['refname', doTerm('References')],
  ['bibname', doTerm('Bibliography')],
  ['chaptername', doTerm('Chapter')],
  ['partname', doTerm('Part')],
  ['contentsname', doTerm('Contents')],
  ['listfigurename', doTerm('ListOfFigures')],
  ['listtablename', doTerm('ListOfTables')],
  ['indexname', doTerm('Index')],
  ['abstractname', doTerm('Abstract')],
  ['tablename', doTerm('Table')],
  ['enclname', doTerm('Encl')],
  ['ccname', doTerm('Cc')],
  ['headtoname', doTerm('To')],
  ['pagename', doTerm('Page')],
  ['seename', doTerm('See')],
  ['seealsoname', doTerm('SeeAlso')],
  ['proofname', doTerm('Proof')],
  ['glossaryname', doTerm('Glossary')],
  ['lstlistingname', doTerm('Listing')],
]);
