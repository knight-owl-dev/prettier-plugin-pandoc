# Block command arguments

Pandoc reads each block command's arguments by the command's own rule.

\section
{A title on the next line} b

\section
b

\section*
{A starred title} b

\section
[o]{A title after an option} b

\title
{A title}

\epigraph{An epigraph}
{its source} b

\epigraph{An epigraph and no source} b

\hrule{a group no rule takes} b

\section{x}{a second group} b

\address and the first character of a word after it.

\blockquote{A quote}. b

\clearpage .5em{a dimension without a leading digit, and a group

* that Pandoc holds raw
* list markers and all}
