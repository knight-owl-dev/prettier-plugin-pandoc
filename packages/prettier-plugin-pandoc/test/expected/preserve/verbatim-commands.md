# Verbatim commands

A delimited body is raw: \verb|\section{x}| and \verb*+\begin{x}y\end{x}+ stay
inline, as do \Verb|\section{y}|, \lstinline[l]|\section{z}| and
\mintinline{c}|\section{w}|, and the paragraph goes on.

Some words \lstinline{long body here
with more words} and the tail of it: an `\lstinline` body runs across lines.

A space after a `\mintinline` language opens no body, aaa bbb \mintinline{c} |\section{x}| ccc ddd.

Options keep their braced values: Call \lstinline[morekeywords={__init__,self}]|x| here.

A verbatim command ending its line keeps the break, Text \verb
|ab| and more words that run on long enough to wrap.
