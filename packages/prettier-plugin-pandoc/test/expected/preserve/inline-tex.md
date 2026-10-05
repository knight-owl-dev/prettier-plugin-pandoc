# Inline raw TeX

A sentence with a footnote long enough to wrap\footnote{Via the XeLaTeX engine with full Unicode support, which a wrap must not break.} and more prose after it.

Markdown inside the braces stays raw: \footnote{see *this* one, and a_b, which prettier would otherwise rewrite}.

A command with no argument, \LaTeX, and one with an optional argument, \cite[p. 5]{key}, in a paragraph long enough to wrap.

A command split over two lines \textbf
{bold} and a starred one \vspace*{1em} inside prose.

Opaque neighbors: `\code{x}` in a code span, $\frac{a}{b}$ in math, and a price of $5 and $6.

## A heading holding \label{sec:held} a command

Emphasis _around \emph{a command}_ and **strong \textbf{too}**, and a
[link holding \emph{one}](https://example.com).

Touching commands \foo \emph{x} and \noindent\textbf{bold} print as written, in a paragraph long enough to wrap.
