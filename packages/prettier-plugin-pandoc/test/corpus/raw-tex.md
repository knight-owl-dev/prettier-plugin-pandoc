# Raw TeX

::: latex-only
\begin{center}
\begin{tabular}{|c|c|}
  \hline
  Feature & Supported? \\
  \hline
\end{tabular}
\end{center}
:::

\begin{center}
A bare environment, which Pandoc reads as raw TeX all the same. % a comment
\end{center}

\newpage
\clearpage

A paragraph after the page breaks, long enough that the formatter must wrap it somewhere along the way.

\newpage % a comment Pandoc reads as a paragraph after the command

\begin{center}
x
\end{center} and text after the end, which Pandoc reads as a paragraph of its own.

\newpage \begin{center}
a run
\end{center} \vspace{1em} and text after the run, which Pandoc reads as a paragraph that the formatter may wrap.

\section*{Heading} text after a block command, a paragraph of its own.

\foo \newpage
\clearpage

\begin{x}

z
\end{x}
text
    lazy
- item
  \begin{x}a\end{x} b
