# Stretches beside a div

An indented line after raw TeX is paragraph text to Pandoc and code to CommonMark, so it prints as written. The div after it keeps its fences.

\begin{x}y\end{x}
    an indented line

::: d
A div body, long enough that the formatter would wrap it past the print width.
:::
Text right after the closing fence, long enough that the formatter would wrap it.

\begin{x}y\end{x}
    an indented line

::: d
    an indented body line
:::
Text right after the closing fence.

::: d
\begin{x}y\end{x}
    an indented line
:::
Text after a div whose body ends in the stretch, long enough that the formatter wraps it.

::: d
\begin{x}y\end{x}
    an indented line

::: e
A nested div body.
:::
:::
Text after both closing fences.

\newpage
    - an item whose lazy lines hold raw TeX and a div
\begin{x}y\end{x} ::: note
body
:::
A lazy line after the closing fence, still in the item.

::: chapter
A paragraph in an enclosing div, long enough that the formatter would wrap it past the width.

\begin{x}y\end{x}
    an indented line

Another paragraph in it, long enough that the formatter would wrap it past the print width.
:::
