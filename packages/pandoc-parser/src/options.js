// The reader options the port reads: Pandoc's defaults for its `markdown`
// format, as `pandoc -f markdown-latex_macros` sets them.

import { ABBREVIATIONS } from './abbreviations.js';

// `pandoc --list-extensions=markdown`, those on, `latex_macros` left out: its
// expansion rewrites raw TeX and math, which the port keeps as written.
const EXTENSIONS = [
  'all_symbols_escapable',
  'auto_identifiers',
  'backtick_code_blocks',
  'blank_before_blockquote',
  'blank_before_header',
  'bracketed_spans',
  'citations',
  'definition_lists',
  'escaped_line_breaks',
  'example_lists',
  'fancy_lists',
  'fenced_code_attributes',
  'fenced_code_blocks',
  'fenced_divs',
  'footnotes',
  'grid_tables',
  'header_attributes',
  'implicit_figures',
  'implicit_header_references',
  'inline_code_attributes',
  'inline_notes',
  'intraword_underscores',
  'line_blocks',
  'link_attributes',
  'markdown_in_html_blocks',
  'multiline_tables',
  'native_divs',
  'native_spans',
  'pandoc_title_block',
  'pipe_tables',
  'raw_attribute',
  'raw_html',
  'raw_tex',
  'shortcut_reference_links',
  'simple_tables',
  'smart',
  'space_in_atx_header',
  'startnum',
  'strikeout',
  'subscript',
  'superscript',
  'table_attributes',
  'table_captions',
  'task_lists',
  'tex_math_dollars',
  'yaml_metadata_block',
];

/**
 * @typedef {object} ReaderOptions
 * @property {number} tabStop
 * @property {number} columns The text's width, which tables' columns are
 *   fractions of: the CLI's `--columns`, 72.
 * @property {ReadonlySet<string>} extensions
 * @property {ReadonlySet<string>} abbreviations
 */

// `pandoc --list-extensions=latex`, those on.
const LATEX_EXTENSIONS = ['auto_identifiers', 'latex_macros', 'smart'];

const FORMATS = { markdown: EXTENSIONS, latex: LATEX_EXTENSIONS };

/**
 * Pandoc's reader options for a format, `markdown` or `latex`, its
 * default extensions changed as `+name` and `-name` in `extensions` say.
 *
 * @see Text.Pandoc.Options.ReaderOptions
 * @param {{tabStop?: number, format?: 'markdown' | 'latex', extensions?: string[]}} [options]
 * @returns {ReaderOptions}
 */
export function readerOptions({
  tabStop = 4,
  format = 'markdown',
  extensions = [],
} = {}) {
  const on = new Set(FORMATS[format]);
  for (const change of extensions) {
    if (change.startsWith('-')) on.delete(change.slice(1));
    else on.add(change.replace(/^\+/, ''));
  }
  return { tabStop, columns: 72, extensions: on, abbreviations: ABBREVIATIONS };
}
