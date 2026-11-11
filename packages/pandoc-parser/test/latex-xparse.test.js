// cspell:disable
// LaTeX3's document commands and their kin, read as Pandoc reads them: the
// inputs of Pandoc's own tests of them, `test/command/latex3-*.md`.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLaTeX, withoutSpans } from '../src/index.js';
import { pandocLaTeXAst } from './helpers/oracle.js';
import { assertNested } from './helpers/spans.js';

const VARIANTS = ['', '+raw_tex', '-latex_macros'];

const CASES = {
  '`o` specifier and `\\IfNoValueTF`':
    '\\NewDocumentCommand{\\name}{o m}{\\IfNoValueTF{#1}{#2}{#1: #2}}\n\\name{Alice}\n\n\\name[Dr]{Bob}\n',
  '`O` specifier with default':
    '\\NewDocumentCommand\\greet{O{Hello} m}{#1, #2!}\n\\greet{world}\n\n\\greet[Hi]{there}\n',
  '`s` specifier and `\\IfBooleanTF`':
    '\\NewDocumentCommand\\maybeemph{s m}{\\IfBooleanTF{#1}{\\emph{#2}}{#2}}\n\\maybeemph{plain} and \\maybeemph*{starred}\n',
  '`t` specifier':
    '\\NewDocumentCommand\\q{t+ m}{\\IfBooleanTF{#1}{plus #2}{noplus #2}}\n\\q+{a} \\q{b}\n',
  '`d` specifier with custom delimiters':
    '\\NewDocumentCommand\\point{d()}{\\IfNoValueTF{#1}{origin}{(#1)}}\n\\point, \\point(3,4)\n',
  '`r` specifier (required, custom delimiters)':
    '\\NewDocumentCommand\\req{r()}{req #1}\n\\req(ok)\n',
  '`\\DeclareDocumentCommand` redefines silently':
    '\\DeclareDocumentCommand\\x{m}{first: #1}\n\\DeclareDocumentCommand\\x{m}{second: #1}\n\\x{y}\n',
  '`\\ProvideDocumentCommand` does not redefine':
    '\\NewDocumentCommand\\y{m}{first: #1}\n\\ProvideDocumentCommand\\y{m}{second: #1}\n\\y{z}\n',
  'A `-NoValue-` marker that leaks into the document is printed like in xparse':
    '\\NewDocumentCommand\\val{o}{value: #1}\n\\val\n',
  'Nested brackets in optional arguments':
    '\\NewDocumentCommand\\opt{o}{got #1}\n\\opt[a[b]c]\n',
  '`\\IfValueT`':
    '\\NewDocumentCommand\\test{o}{\\IfValueT{#1}{seen #1}}\n\\test[x] \\test\n',
  '`\\NewDocumentEnvironment`: arguments are available in the end code, too':
    '\\NewDocumentEnvironment{titled}{m}{start #1.}{end #1.}\n\\begin{titled}{T}\nmiddle\n\\end{titled}\n',
  'Environments with arguments nest properly':
    '\\NewDocumentEnvironment{wrap}{m}{[#1 }{ #1]}\n\\begin{wrap}{a}\none\n\\begin{wrap}{b}\ntwo\n\\end{wrap}\nthree\n\\end{wrap}\n',
  'Environment wrapping another environment, with optional argument':
    '\\NewDocumentEnvironment{myquote}{o}\n  {\\begin{quote}\\IfValueT{#1}{\\textbf{#1}: }}\n  {\\end{quote}}\n\\begin{myquote}[Note]\nHello.\n\\end{myquote}\n',
  '`O` specifier with default in environments':
    '\\NewDocumentEnvironment{sec}{O{A} m}{(#1/#2 }{ #2)}\n\\begin{sec}[B]{t}\nbody\n\\end{sec}\n\n\\begin{sec}{u}\nmore\n\\end{sec}\n',
  '`b` specifier grabs the environment body, trimming surrounding spaces':
    '\\NewDocumentEnvironment{titledb}{m b}{Title: #1. Body: #2.}{}\n\\begin{titledb}{T}\nsome text\n\\end{titledb}\n',
  '`\\DeclareDocumentEnvironment` redefines silently':
    '\\DeclareDocumentEnvironment{z}{}{one}{}\n\\DeclareDocumentEnvironment{z}{}{two}{}\n\\begin{z}x\\end{z}\n',
  '`\\ProvideDocumentEnvironment` does not redefine':
    '\\NewDocumentEnvironment{p}{}{one}{}\n\\ProvideDocumentEnvironment{p}{}{two}{}\n\\begin{p}x\\end{p}\n',
  '`v` specifier (verbatim), with `\\verb`-style delimiters or braces; special characters are not reinterpreted':
    '\\NewDocumentCommand\\showv{v}{[#1]}\n\\showv|a_b&\\foo|\n\n\\showv{xy}\n',
  '`e` specifier (embellishments), matched in any order':
    '\\NewDocumentCommand\\x{e{^_}}{sup=#1, sub=#2.}\n\\x^{up}_{down}\n\n\\x_{down}^{up}\n\n\\x_{d}\n',
  '`e` specifier with `\\IfNoValueTF` and single-token argument':
    '\\NewDocumentCommand\\z{e{^}}{\\IfNoValueTF{#1}{none}{got #1}}\n\\z^2 \\z\n',
  '`E` specifier (embellishments with defaults)':
    '\\NewDocumentCommand\\y{E{^_}{{U}{D}}}{#1/#2}\n\\y^{a}\n\n\\y\n',
  '`\\TrimSpaces` argument processor':
    '\\NewDocumentCommand\\trim{>{\\TrimSpaces}m}{[#1]}\n\\trim{  hi  }\n',
  '`\\ReverseBoolean` argument processor':
    '\\NewDocumentCommand\\rs{>{\\ReverseBoolean}s}{\\IfBooleanTF{#1}{T}{F}}\n\\rs* \\rs\n',
  '`\\SplitArgument` processor: splits into braced groups, trims spaces, pads with `-NoValue-`':
    '\\NewDocumentCommand\\three{mmm}{1=#1, 2=#2, 3=#3.}\n\\NewDocumentCommand\\splt{>{\\SplitArgument{2}{;}}m}{\\three#1}\n\\splt{a; b ;c}\n\n\\splt{a;b}\n',
  '`\\SplitList` processor':
    '\\NewDocumentCommand\\lst{>{\\SplitList{,}}m}{items: #1}\n\\lst{x, y ,z}\n',
  'Multiple processors are applied starting from the one nearest the argument specifier':
    '\\NewDocumentCommand\\two{mm}{(#1)(#2)}\n\\NewDocumentCommand\\c{>{\\SplitArgument{1}{;}}>{\\TrimSpaces}m}{\\two#1}\n\\c{ a;b }\n',
  'Unknown processors are skipped, keeping the argument':
    '\\NewDocumentCommand\\u{>{\\SomeUnknownProc}m}{[#1]}\n\\u{ok}\n',
  '`\\NewCommandCopy` snapshots the definition (like `\\let`)':
    '\\NewDocumentCommand\\old{m}{orig: #1}\n\\NewCommandCopy\\new\\old\n\\RenewDocumentCommand\\old{m}{changed: #1}\n\\new{a} \\old{b}\n',
  '`\\NewEnvironmentCopy`, copying a built-in environment':
    '\\NewEnvironmentCopy{myquote}{quote}\n\\begin{myquote}\nHello.\n\\end{myquote}\n',
  '`\\MakeTitlecase` uppercases the first character':
    '\\MakeTitlecase{hello world} \\MakeTitlecase{\\emph{foo bar}}\n',
  'Code between `\\ExplSyntaxOn` and `\\ExplSyntaxOff` is tokenized with `:` and `_` as letters, so it can be skipped cleanly':
    '\\ExplSyntaxOn\n\\tl_new:N \\l_my_tl\n\\tl_set:Nn \\l_my_tl {stuff}\n\\ExplSyntaxOff\nText after.\n',
  '`\\ShowCommand` and the key–value commands are parsed and ignored':
    '\\NewDocumentCommand\\foo{m}{x#1}\n\\ShowCommand\\foo\n\\DeclareKeys[fam]{key .store = \\myval}\n\\SetKeys[fam]{key=5}\n\\ProcessKeyOptions[fam]\nDone.\n',
  '`\\inteval`: `+ - * /` with division rounding to nearest (ties away from zero, as in eTeX)':
    '\\inteval{2+3*4}, \\inteval{7/2}, \\inteval{-7/2}, \\inteval{(1+2)*3}\n',
  'Macros in the evaluator argument are expanded':
    '\\NewDocumentCommand\\n{}{4}\n\\inteval{\\n + 1}\n',
  '`\\fpeval`: floating point expressions; results are rounded to 16 significant digits as in l3fp':
    '\\fpeval{2^10/8}, \\fpeval{0.1 + 0.2}, \\fpeval{2**3}, \\fpeval{1e3*2}, \\fpeval{1/3}\n',
  'Expressions that cannot be evaluated are passed through as text':
    '\\fpeval{foo(1)}, \\fpeval{1/0}, \\inteval{1/0}\n',
  '`\\dimeval` and `\\skipeval` substitute their (unevaluated) expression':
    '\\dimeval{2pt+3pt}, \\skipeval{1em plus 2pt}\n',
  '§2.2: the `\\chapter`-like example with `s o m`':
    '\\NewDocumentCommand\\mychapter{s o m}\n  {\\IfBooleanTF{#1}{star: #3}{normal: \\IfNoValueTF{#2}{#3}{#2} / #3}\\par}\n\\mychapter{One}\n\\mychapter*{Two}\n\\mychapter[Short]{Long}\n',
  '§2.3: spaces around the environment name are ignored':
    '\\NewDocumentEnvironment{ foo }{}{[}{]}\n\\begin{foo}x\\end{foo}\n',
  '§2.5: optional arguments may safely be nested':
    '\\NewDocumentCommand\\foo{om}{I grabbed (#1) and (#2)}\n\\NewDocumentCommand\\baz{o}{#1-#1}\n\\foo[\\baz[stuff]]{more stuff}\n',
  '§2.5: the default for `O` can be the result of grabbing another argument':
    '\\NewDocumentCommand\\foo{O{#2} m}{opt=#1, mand=#2.}\n\\foo{A}\n\n\\foo[B]{A}\n',
  '§2.6: spaces before optional arguments are allowed by default, but not with the `!` modifier':
    '\\NewDocumentCommand\\foobar{m o}{(#1|#2)}\n\\NewDocumentCommand\\foobang{m !o}{(#1|#2)}\n\\foobar{arg1} [arg2]\n\n\\foobang{arg1} [arg2]\n',
  '§2.8: `\\IfNoValueTF`':
    '\\NewDocumentCommand\\foo{o m}\n  {%\n    \\IfNoValueTF {#1}%\n      {just #2}%\n      {both #1 and #2}}\n\\foo{m}, \\foo[o]{m}\n',
  '§2.8: the `\\IfBlankTF` example, including the effect of `!` on the last `\\foo`':
    '\\NewDocumentCommand\\foo{m!o}{\\par #1:\n  \\IfNoValueTF{#2}\n    {No optional}%\n    {%\n       \\IfBlankTF{#2}\n         {Blanks in or empty}%\n         {Real content in}%\n    }%\n  \\space argument!}\n\\foo{1}[bar] \\foo{2}[ ] \\foo{3}[] \\foo{4}[\\space] \\foo{5} [x]\n',
  '§2.8: `\\IfBooleanTF`':
    '\\NewDocumentCommand\\foo{sm}\n  {%\n    \\IfBooleanTF {#1}%\n      {with star: #2}%\n      {without star: #2}}\n\\foo{a}, \\foo*{b}\n',
  '§2.9: the `=` modifier (key–value interface for an argument) is accepted':
    '\\DeclareDocumentCommand\\mycaption{s ={short-text} +O{#3} +m}{[#2|#3]}\n\\mycaption{Text}\n\\mycaption[Short]{Long}\n',
  '§2.10: `\\SplitArgument` splits into a fixed number of parts, trimming spaces, padding with `-NoValue-`':
    '\\NewDocumentCommand\\InternalFunctionOfThreeArguments{mmm}{1=#1, 2=#2, 3=#3.}\n\\NewDocumentCommand\\foo{>{\\SplitArgument{2}{;}} m}\n  {\\InternalFunctionOfThreeArguments#1}\n\\foo{a ; b ; c}\n\n\\foo{a;b}\n',
  '§2.10: a processor applied to an `e`-type argument applies to all of its arguments':
    '\\NewDocumentCommand\\foo{ >{\\TrimSpaces} e{_^} }\n  { [#1](#2) }\n\\foo_{ a }^{ b }\n',
  '§2.10: `\\SplitList` and `\\ProcessList`':
    '\\NewDocumentCommand\\SomeDocumentCommand{m}{<#1>}\n\\NewDocumentCommand\\foo{>{\\SplitList{;}} m}\n  {\\ProcessList{#1}{\\SomeDocumentCommand}}\n\\foo{a; b ;c}\n',
  '§2.10: `\\ProcessList` with arbitrary tokens expecting one argument':
    '\\NewDocumentCommand\\SomeDocumentCommand{m}{<#1>}\n\\NewDocumentCommand\\foo{>{\\SplitList{;}} m}\n  {\\ProcessList{#1}{Abc \\SomeDocumentCommand}}\n\\foo{a;b}\n',
  '§2.10: `\\ReverseBoolean`':
    '\\NewDocumentCommand\\foo{>{\\ReverseBoolean} s m}\n  {%\n    \\IfBooleanTF#1%\n      {without star: #2}%\n      {with star: #2}}\n\\foo{a}, \\foo*{b}\n',
  '§2.10: `\\TrimSpaces`':
    '\\NewDocumentCommand\\foo{>{\\TrimSpaces} m}{[#1]}\n\\foo{ hello world }\n',
  '§2.11: the `b` argument type grabs the body of the environment; spaces are trimmed at both ends':
    '\\NewDocumentEnvironment{twice}{O{\\ttfamily} +b}\n  {#2#1#2} {}\n\\begin{twice}[\\itshape]\n  Hello world!\n\\end{twice}\n',
  '§2.12–2.13: `\\NewExpandableDocumentCommand`, wrapping `\\multicolumn` in a tabular cell':
    '\\NewExpandableDocumentCommand\\MyMultiCol{m}{\\multicolumn{3}{c}{#1}}\n\\begin{tabular}{lcr}\na & b & c \\\\\n\\MyMultiCol{stuff} \\\\\n\\end{tabular}\n',
  '§2.16: the `c` argument type grabs the body of the environment verbatim; it is typeset with spaces as visible spaces (U+2423)':
    '\\NewDocumentEnvironment{MyVerbatim}{!O{\\ttfamily} c}\n  {\\begin{center} #1 #2\\end{center}} {}\n\\begin{MyVerbatim}[\\ttfamily\\itshape]\n  % Some code is shown here\n  $y = mx + c$\n\\end{MyVerbatim}\n',
  '§3: `\\NewCommandCopy` copies a definition, so the original can be redefined in terms of the copy':
    '\\NewDocumentCommand\\hi{}{Hello!}\n\\NewCommandCopy\\hiorig\\hi\n\\RenewDocumentCommand\\hi{}{\\hiorig{} And again: \\hiorig}\n\\hi\n',
  '§4: `\\UseName` turns a string into a csname and executes it':
    '\\NewDocumentCommand\\hello{}{Hello!}\n\\UseName{hello}\n',
  '§4: `\\ExpandArgs{c}` constructs a command name for `\\NewDocumentCommand`':
    '\\NewDocumentCommand\\newnoter{m}\n  {\\ExpandArgs{c}\\NewDocumentCommand{#1}{m}{#1 note: ##1.}}\n\\newnoter{todo}\n\\todo{fix this}\n',
  '§4: `\\ExpandArgs{cc}` with `\\NewCommandCopy`, copying a command by string name':
    '\\NewDocumentCommand\\savebyname{m}\n  {\\ExpandArgs{cc}\\NewCommandCopy{saved#1}{#1}}\n\\NewDocumentCommand\\greeting{}{Hello!}\n\\savebyname{greeting}\n\\RenewDocumentCommand\\greeting{}{Goodbye!}\n\\greeting{} \\UseName{savedgreeting}\n',
  '§4: `\\ExpandArgs{Nc}`':
    '\\NewDocumentCommand\\target{}{found}\n\\ExpandArgs{Nc}\\NewCommandCopy\\mycopy{target}\n\\mycopy\n',
  '§5: the `\\fpeval` example':
    '\\LaTeX{} can now compute: $\\fpeval{sin(3.5)/2 + 2e-3}$.\n',
  '§5: assorted `\\fpeval` operations':
    '\\fpeval{pi}, \\fpeval{sqrt 2}, \\fpeval{exp(0)}, \\fpeval{max(1,2,3)},\n\\fpeval{fact(5)}, \\fpeval{abs(-4)}, \\fpeval{round(2.345,2)},\n\\fpeval{floor(2.7)}, \\fpeval{ceil(2.2)}, \\fpeval{trunc(-2.7)}\n',
  '§5: the `\\inteval` example':
    '\\LaTeX{} can now compute: The sum of the numbers is $\\inteval{1 + 2 + 3}$.\n',
  '§7: `\\MakeUppercase`, `\\MakeLowercase`, `\\MakeTitlecase`':
    '\\MakeUppercase{hello WORLD ßüé}\n\n\\MakeLowercase{hello WORLD ßüé}\n\n\\MakeTitlecase{hello WORLD ßüé}\n',
  '§7: the `words` option of `\\MakeTitlecase`':
    '\\MakeTitlecase[words = first]{some words}\n\\MakeTitlecase[words = all]{some words}\n',
  '§7: mathematical content is excluded from case changing, and `\\NoCaseChange` excludes its argument':
    '\\MakeUppercase{Some text $y = mx + c$}\n\n\\MakeUppercase{\\NoCaseChange{iPhone}}\n',
  '§7: `\\DeclareTitlecaseExclusions`':
    '\\DeclareTitlecaseExclusions{a,an,and,on,of,the}\n\\MakeTitlecase[words = all]{Of mice and men}\n\n\\MakeTitlecase[words = all]{The mill on the floss}\n\n\\MakeTitlecase[words = all]{The comedy of errors}\n',
  '§7: `\\DeclareUppercaseMapping` etc. are parsed and ignored':
    '\\DeclareUppercaseMapping{"01F0}{\\v{J}}\n\\DeclareLowercaseMapping[xx]{"0049}{\\i}\nDone.\n',
  '§8: `\\textsubscript` and `\\textsuperscript`':
    'A\\textsubscript{low} and B\\textsuperscript{high}.\n',
  '§9: `\\listfiles` is parsed and ignored': '\\listfiles[hashes]\nDone.\n',
};

for (const [name, text] of Object.entries(CASES)) {
  for (const ext of VARIANTS) {
    test(`${name}: Pandoc's AST (latex${ext})`, () => {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      assert.deepEqual(
        withoutSpans(readLaTeX(text, { extensions })),
        pandocLaTeXAst(text, ext),
      );
    });
  }
  test(`${name}: spans in order, each within its parent's`, () => {
    for (const ext of VARIANTS) {
      const extensions = ext.match(/[+-][a-z_]+/g) ?? [];
      const { blocks } = readLaTeX(text, { extensions });
      assertNested(blocks, 0, text.length, `latex${ext}`);
    }
  });
}
