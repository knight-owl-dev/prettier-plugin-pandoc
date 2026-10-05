# Inline commands on a line of their own

Pandoc reads a command it knows as inline in the paragraph, alone on its line or
not.

\noindent
A paragraph after an inline command on its own line, long enough that the
formatter wraps it.

\index{entry} Text after an index entry, long enough that the formatter would
join the lines and wrap them.

A paragraph line ending before one \noindent
and going on below it, long enough that the formatter would join the three
lines.

\noindent  
Trailing spaces after one, long enough that the formatter would join the lines
and wrap.

\foo\noindent
Touching commands ending in a bare one, long enough that the formatter would
join the lines.

> \noindent
> A quote opening with one, long enough that the formatter would join and wrap
> it.

- \noindent
  An item opening with one, long enough that the formatter would join and wrap
  it.

\noindent

A paragraph a blank line after one.

\textgerman{Ein Satz} and the text after a language command, long enough to wrap
past the print width.

\cite{key} followed by prose citing it, long enough that the formatter would
wrap the paragraph.

A paragraph whose last line is one: \noindent

\newpage \emph{emphasis} after a block command, the rest of the line a
paragraph.

\foo \emph{x} with a command of no known kind first, one paragraph.

\section{A section} \label{sec}

Text after a section and its label, long enough that the formatter would wrap
it.

\section{Another}

\label{another}

Text after a label a blank line below its section.
