# Raw TeX interrupting a paragraph

Pandoc reads a paragraph a raw block interrupts as plain text, with no blank
line after it,
\begin{x}y\end{x}

and one a blank line before a raw block as a paragraph, long enough that the
formatter wraps it.

\begin{x}y\end{x}

A command a block on its own ends one too, long enough that the formatter would
wrap the text.
\section{A section}

So does an environment over several lines, in a paragraph long enough that the
formatter wraps.
\begin{x}
y
\end{x}

\begin{x}y\end{x}

Text between two raw blocks is plain, long enough that the formatter would wrap
the paragraph.
\begin{x}y\end{x}

A paragraph before two raw blocks, one after the other, long enough that the
formatter wraps it.
\begin{x}y\end{x}
\begin{x}y\end{x}

> A quote whose paragraph a raw block interrupts, long enough that the formatter
> would wrap it.
> \begin{x}y\end{x}

-   A list item whose paragraph a raw block interrupts, long enough that the
    formatter wraps it.
    \begin{x}y\end{x}

::: d
A div whose paragraph a raw block interrupts, long enough that the formatter
would wrap it.
\begin{x}y\end{x}
:::

A note.[^1]

[^1]: A footnote whose paragraph a raw block interrupts, long enough that the
    formatter wraps.
    \begin{x}y\end{x}

Two spaces ending a paragraph a raw block interrupts are a hard break, long
enough to wrap.  
\begin{x}y\end{x}

> So are they in a quote, in a paragraph long enough that the formatter would
> wrap it.  
> \begin{x}y\end{x}

A tab ending one is a hard break where it spans two columns, in a paragraph long
enough.  
\begin{x}y\end{x}

Spaces after a bare command are the command's, in a paragraph long enough to
wrap, \relax  
\begin{x}y\end{x}
