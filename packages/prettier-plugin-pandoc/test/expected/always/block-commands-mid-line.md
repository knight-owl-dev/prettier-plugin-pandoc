# Block commands in paragraph text

A block command Pandoc does not read inline ends the paragraph where it opens, \section{Here} and the text after it is a paragraph of its own, long enough to wrap.

A line ending with one \section{Ends}
and the next line goes on in a paragraph after it.

A paragraph line, long enough that the formatter would join the next one onto it,
\section{Starts} a line in it and splits the paragraph there.

A paragraph line before an inline command,
\newpage \section{S} text after the command, as Pandoc reads it.

Inline commands stay in the paragraph: \newpage, \vspace{1em}, \hspace{2em} and
\input{x}, so this one wraps as prose.

A run follows it \section{s} \label{l}
after the run, a paragraph.

- An item holding \section{x} in its text, then more of the item's prose to wrap.

> A quote holding \subsection{y} mid-line, then more of the quote's prose to wrap.

Emphasis *around \section{x} one* is no emphasis, the paragraph split inside it.

# A heading holding \section{x} is a paragraph

Brackets [hold \section{x}] it, and so does link text
[with \section{x}](https://example.com), so this stays one paragraph.

Code `\section{x}` and math $\section{x}$ hold it, and so does an escape,
\\section{x}.

Too few groups keep one in the paragraph: \section alone, \section[o] with
options only, and \epigraph{one group}, so this wraps as prose.

# A heading holding a bare \section stays a heading

An HTML tag holds one too, <span title="\section{x}">here</span>, so this
paragraph wraps as prose.

Before a quote \section{x} > the quote opening after it, long enough to wrap,
> going on here.
