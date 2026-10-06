# Blocks after raw TeX

Pandoc reads blocks again right after raw TeX, so a block may open mid-line.

\begin{center}
x
\end{center} > a block quote opening after the end of an environment, long
> enough to wrap, which goes on here.

A paragraph whose environment \begin{x}y\end{x} - opens a list item
- and another item after it

  with a paragraph of its own inside the second item.

\begin{x}y\end{x} ::: note
A div opening after an environment, its body _long_ enough that the formatter
would wrap it.
:::

\begin{x}y\end{x} # A heading after an environment

\newpage
    -   a list a line after a command, its indentation taken by the command

\newpage
        text that would be indented code, but is a paragraph after a command

> \begin{x}y\end{x} > a block quote inside a block quote, opened after an
> > environment.

\begin{x}y\end{x} | a | b |
|---|---|
| c | d |

\begin{x}y\end{x} A setext heading after an environment
=====

\begin{x}y\end{x} a paragraph after an environment that goes on to the next
line, long enough that the formatter would wrap it.

A term holding \begin{x}y\end{x} an environment

:   Its definition.

\begin{x}y\end{x} ```
code after an environment
```
