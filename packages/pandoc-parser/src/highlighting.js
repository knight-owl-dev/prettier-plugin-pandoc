// Skylighting's language names beside the listings package's, both ways.
//
// Ported from Pandoc 3.11's `Text.Pandoc.Highlighting`: its language map.

// cspell:disable

/** @see Text.Pandoc.Highlighting.langsList */
const LANGS = [
  ['abap', 'ABAP'],
  ['acm', 'ACM'],
  ['acmscript', 'ACMscript'],
  ['acsl', 'ACSL'],
  ['ada', 'Ada'],
  ['algol', 'Algol'],
  ['ant', 'Ant'],
  ['assembler', 'Assembler'],
  ['gnuassembler', 'Assembler'],
  ['awk', 'Awk'],
  ['bash', 'bash'],
  ['monobasic', 'Basic'],
  ['purebasic', 'Basic'],
  ['c', 'C'],
  ['cs', 'C'],
  ['objectivec', 'C'],
  ['cpp', 'C++'],
  ['c++', 'C++'],
  ['ocaml', 'Caml'],
  ['cil', 'CIL'],
  ['clean', 'Clean'],
  ['cobol', 'Cobol'],
  ['comal80', 'Comal80'],
  ['command.com', 'command.com'],
  ['comsol', 'Comsol'],
  ['csh', 'csh'],
  ['delphi', 'Delphi'],
  ['eiffel', 'Eiffel'],
  ['elan', 'Elan'],
  ['elisp', 'elisp'],
  ['erlang', 'erlang'],
  ['euphoria', 'Euphoria'],
  ['fortran', 'Fortran'],
  ['gap', 'GAP'],
  ['gcl', 'GCL'],
  ['gnuplot', 'Gnuplot'],
  ['go', 'Go'],
  ['hansl', 'hansl'],
  ['haskell', 'Haskell'],
  ['html', 'HTML'],
  ['idl', 'IDL'],
  ['inform', 'inform'],
  ['java', 'Java'],
  ['jvmis', 'JVMIS'],
  ['ksh', 'ksh'],
  ['lingo', 'Lingo'],
  ['lisp', 'Lisp'],
  ['commonlisp', 'Lisp'],
  ['llvm', 'LLVM'],
  ['logo', 'Logo'],
  ['lua', 'Lua'],
  ['make', 'make'],
  ['makefile', 'make'],
  ['mathematica', 'Mathematica'],
  ['matlab', 'Matlab'],
  ['mercury', 'Mercury'],
  ['metapost', 'MetaPost'],
  ['miranda', 'Miranda'],
  ['mizar', 'Mizar'],
  ['ml', 'ML'],
  ['modula2', 'Modula-2'],
  ['mupad', 'MuPAD'],
  ['nastran', 'NASTRAN'],
  ['oberon2', 'Oberon-2'],
  ['ocl', 'OCL'],
  ['octave', 'Octave'],
  ['oorexx', 'OORexx'],
  ['oz', 'Oz'],
  ['pascal', 'Pascal'],
  ['perl', 'Perl'],
  ['php', 'PHP'],
  ['pli', 'PL/I'],
  ['plasm', 'Plasm'],
  ['postscript', 'PostScript'],
  ['pov', 'POV'],
  ['prolog', 'Prolog'],
  ['promela', 'Promela'],
  ['pstricks', 'PSTricks'],
  ['python', 'Python'],
  ['r', 'R'],
  ['reduce', 'Reduce'],
  ['rexx', 'Rexx'],
  ['rsl', 'RSL'],
  ['ruby', 'Ruby'],
  ['s', 'S'],
  ['sas', 'SAS'],
  ['scala', 'Scala'],
  ['scilab', 'Scilab'],
  ['sh', 'sh'],
  ['shelxl', 'SHELXL'],
  ['simula', 'Simula'],
  ['sparql', 'SPARQL'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['tcl', 'tcl'],
  ['tex', 'TeX'],
  ['latex', 'TeX'],
  ['vbscript', 'VBScript'],
  ['verilog', 'Verilog'],
  ['vhdl', 'VHDL'],
  ['vrml', 'VRML'],
  ['xml', 'XML'],
  ['xslt', 'XSLT'],
];

// cspell:enable

const LANG_TO_LISTINGS = new Map(LANGS);
const LISTINGS_TO_LANG = new Map(LANGS.map(([a, b]) => [b, a]));

/**
 * The listings language of a skylighting language name.
 *
 * @see Text.Pandoc.Highlighting.toListingsLanguage
 * @param {string} lang
 */
export const toListingsLanguage = (lang) =>
  LANG_TO_LISTINGS.get(lang.toLowerCase()) ?? null;

/**
 * The skylighting language name of a listings language.
 *
 * @see Text.Pandoc.Highlighting.fromListingsLanguage
 * @param {string} lang
 */
export const fromListingsLanguage = (lang) =>
  LISTINGS_TO_LANG.get(lang) ?? null;
