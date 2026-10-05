\documentclass{article}
% \begin{document} in a comment does not end the preamble
\newcommand{\x}{\begin{document}}
\usepackage{x}

* a list Pandoc holds raw
* in the preamble

\begin{document}
Text in the document.
\end{document}

A paragraph after it, long enough that the formatter would wrap it past the print width.
