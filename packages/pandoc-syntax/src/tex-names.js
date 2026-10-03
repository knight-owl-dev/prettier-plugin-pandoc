// The names of Pandoc's LaTeX commands, by how its reader takes each.

// cspell:disable
// Pandoc 3.11's block commands: its LaTeX reader's `blockCommands` and
// `treatAsBlock`. Each reads its arguments by its own rule:
// `tex-arguments.js`.
export const BLOCK_COMMANDS = new Set([
  'addbibresource',
  'addcontentsline',
  'address',
  'addtocontents',
  'addtocounter',
  'author',
  'bibliography',
  'bibliographystyle',
  'blockcquote',
  'blockquote',
  'caption',
  'centerline',
  'chapter',
  'clearpage',
  'closing',
  'date',
  'dedication',
  'documentclass',
  'endinput',
  'epigraph',
  'extratitle',
  'fancybreak',
  'foreignblockcquote',
  'foreignblockquote',
  'framesubtitle',
  'frametitle',
  'frontispiece',
  'graphicspath',
  'hrule',
  'hspace',
  'hyperdef',
  'hypertarget',
  'hyphenblockcquote',
  'hyphenblockquote',
  'iftoggle',
  'ignore',
  'include',
  'input',
  'inputminted',
  'item',
  'listoffigures',
  'listoftables',
  'lowertitleback',
  'lstinputlisting',
  'makeglossary',
  'makeindex',
  'maketitle',
  'markboth',
  'markleft',
  'markright',
  'minisec',
  'newpage',
  'newtheorem',
  'newtoggle',
  'opening',
  'PackageError',
  'pagebreak',
  'par',
  'paragraph',
  'parbox',
  'part',
  'pdfannot',
  'pdfstringdef',
  'pfbreak',
  'plainbreak',
  'plainfancybreak',
  'publishers',
  'raggedright',
  'rule',
  'section',
  'setdefaultlanguage',
  'setmainlanguage',
  'signature',
  'special',
  'strut',
  'subfile',
  'subject',
  'subparagraph',
  'subsection',
  'subsubsection',
  'subtitle',
  'theoremstyle',
  'title',
  'titleformat',
  'titlehead',
  'togglefalse',
  'toggletrue',
  'uppertitleback',
  'usepackage',
  'vspace',
  'write',
]);

// Block commands Pandoc reads inline in paragraph text: its `treatAsInline`,
// and those in its inline map.
export const ALSO_INLINE = new Set([
  'clearpage',
  'hspace',
  'hypertarget',
  'iftoggle',
  'input',
  'newpage',
  'newtoggle',
  'pagebreak',
  'togglefalse',
  'toggletrue',
  'vspace',
]);

// Pandoc 3.11's inline environments, its math ones: never a raw block, inline
// text wherever they sit.
export const INLINE_ENVIRONMENTS = new Set(
  [
    'align',
    'alignat',
    'darray',
    'dgroup',
    'displaymath',
    'dmath',
    'eqnarray',
    'equation',
    'flalign',
    'gather',
    'math',
    'multline',
    'subequations',
  ].flatMap((name) =>
    name === 'displaymath' || name === 'math' || name === 'subequations'
      ? [name]
      : [name, `${name}*`],
  ),
);

// Inline commands with an argument Pandoc reads raw, by the kind of each of
// their first arguments: `r` raw, `i` inlines, `e` inlines that hold an
// environment. Every other inline command reads its arguments as inlines; a
// block in one fails the command.
export const INLINE_ARGUMENTS = new Map([
  ...[
    'Ac',
    'Acf',
    'Acfp',
    'Acl',
    'Aclp',
    'Acp',
    'Acrfull',
    'Acrlong',
    'Acrshort',
    'Acs',
    'Acsp',
    'GLSdesc',
    'GLSdescplural',
    'Gls',
    'Glsdesc',
    'Glsdescplural',
    'Glspl',
    'Verb',
    'ac',
    'acf',
    'acfp',
    'acl',
    'aclp',
    'acp',
    'acrfull',
    'acrlong',
    'acrshort',
    'acs',
    'acsp',
    'ang',
    'bibstring',
    'ensuremath',
    'footnote',
    'footnotetext',
    'gls',
    'glsdesc',
    'glsdescplural',
    'glspl',
    'includegraphics',
    'includesvg',
    'lstinline',
    'nolinkurl',
    'num',
    'numlist',
    'thanks',
    'url',
    'verb',
  ].map((name) => [name, 'r']),
  ...[
    'SI',
    'SIlist',
    'colorbox',
    'foreignlanguage',
    'foreignquote',
    'href',
    'hyperlink',
    'hyphenquote',
    'qty',
    'qtylist',
    'textcolor',
  ].map((name) => [name, 'ri']),
  ...['mintinline', 'numrange'].map((name) => [name, 'er']),
  ...['SIrange', 'qtyrange'].map((name) => [name, 'eri']),
  ['hyperref', 'iir'],
]);

// Inline commands Pandoc reads as a block where their last group is no inline
// text.
export const COLORED = new Set(['colorbox', 'textcolor']);

// Inline commands Pandoc reads as one it does not know: every group after it
// raw.
export const RAW_INLINE = new Set([
  'Cref',
  'autoref',
  'cref',
  'eqref',
  'hbox',
  'index',
  'label',
  'lettrine',
  'mbox',
  'noindent',
  'ref',
  'vbox',
  'vref',
]);

// Definitions, which name what they define before their arguments.
export const DEFINITIONS = new Set([
  'DeclareMathOperator',
  'DeclareRobustCommand',
  'def',
  'edef',
  'gdef',
  'global',
  'let',
  'newcommand',
  'newenvironment',
  'newif',
  'providecommand',
  'provideenvironment',
  'renewcommand',
  'renewenvironment',
  'xdef',
]);

// Those whose parameters run up to the body's group.
export const DEFS = new Set(['def', 'edef', 'gdef', 'xdef']);

// Pandoc 3.11's inline commands, block commands and definitions aside: its
// LaTeX reader's `inlineCommands`, a `\text<lang>` for each polyglossia
// language among them, and `treatAsInline`. Pandoc reads each alone on a line
// as no raw block.
export const INLINE_COMMANDS = new Set(
  `
    AA AE Ac Acf Acfp Acl Aclp Acp Acrfull Acrlong Acrshort Acs Acsp Autocite
    Autocites Cite Cites Citeyear Citeyearpar Cref Footcite Footcites
    Footcitetext Footcitetexts G GLSdesc GLSdescplural Gls Glsdesc Glsdescplural
    Glspl H L LaTeX MakeLowercase MakeTextLowercase MakeTextUppercase
    MakeUppercase O OE P Parencite Parencites RN Rn S SI SIlist SIrange
    Smartcite Supercite Supercites TeX Textcite Textcites U Verb aa abstractname
    ac acf acfp acl aclp acp acrfull acrlong acrshort acs acsp addabbrvspace
    adddot adddotspace ae alert and ang autocap autocite autocites autoref b
    backslash bar bf bfseries bibname bibstring bshyp c ccname chaptername cite
    citeal citealp citealt citeauthor citep cites citet citetext citeyear
    citeyearpar colonhyp colorbox contentsname copyright cref d dothyp dots dq
    em emph enclname enquote ensuremath eqref euro expandafter f faCheck faClose
    figurename flq flqq footcite footcites footcitetext footcitetexts footnote
    footnotemark footnotetext foreignlanguage foreignquote frq frqq fshyp
    glossaryname glq glqq gls glsdesc glsdescplural glspl grq grqq guillemetleft
    guillemetright guillemotleft guillemotright guilsinglleft guilsinglright h
    hbox headtoname hl href hskip hyp hyperlink hyperref hyphen hyphenquote i
    ifdim includegraphics includesvg index indexname it itshape j k l label
    ldots lettrine listfigurename listtablename lowercase lq lstinline
    lstlistingname mbox mdots mintinline mkbibbold mkbibbrackets mkbibemph
    mkbibitalic mkbibparens mkbibquote mskip newline newtie nhttfamily nocite
    nohyphens noindent nolinkurl num numlist numrange o oe pagename
    pandocbounded parencite parencites partname passthrough pounds prefacename
    proofname ps qed qty qtylist qtyrange quotedblbase quotesinglbase r ref
    refname rm rq scshape seealsoname seename sep si sim sl slash slshape
    smartcite sout ss st supercite supercites t tablename texorpdfstring
    textafrikaans textalbanian textamharic textarabic textarmenian
    textasciicircum textasciitilde textassamese textasturian textbackslash
    textbaht textbasque textbengali textbf textbigcircle textblank textbreton
    textbrokenbar textbulgarian textbullet textcatalan textcentoldstyle
    textcircled textcite textcites textcolor textcoptic textcopyright
    textcroatian textczech textdagger textdanish textdegree textdivehi
    textdollar textdong textdutch textenglish textesperanto textestonian
    textethiopic textfarsi textfinnish textfrench textfriulan textgalician
    textgerman textgreater textgreek textgujarati texthebrew texthindi
    texticelandic textindonesian textinterlingua textirish textit textitalian
    textjapanese textkannada textkhmer textkorean textkurmanji textlao textlatin
    textlatvian textless textlira textlithuanian textlsorbian textmagyar
    textmalayalam textmarathi textmd textmongolian textmu textmusicalnote
    textnhtt textnko textnormal textnorsk textnynorsk textoccitan
    textogonekcentered textonehalf textonequarter textoriya textparagraph
    textpertenthousand textpeso textpiedmontese textpinyin textpolish
    textportuguese textpunjabi textquotedbl textquotedblleft textquotedblright
    textquoteleft textquoteright textquotesingle textregistered textrm
    textromanian textromansh textrussian textsamin textsanskrit textsc
    textscottish textsection textserbian textserbianc textsf textsl textslovak
    textslovenian textspanish textsterling textsubscript textsuperscript
    textswedish textsyriac texttamil texttelugu textthai textthreequarters
    textthreesuperior texttibetan texttt textturkish textturkmen texttwosuperior
    textukrainian textup texturdu textusorbian textvietnamese textwelsh textyen
    thanks today tt u ul uline underline unit uppercase url v vadjust vbox vdots
    verb vref vskip xspace
  `
    .trim()
    .split(/\s+/),
);
// cspell:enable
