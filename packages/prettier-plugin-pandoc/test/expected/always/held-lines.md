# Lines an inline construct holds

A comment runs past blank lines, and the paragraph with it <!-- a note

- not a list

\begin{x}
not raw TeX
\end{x} --> goes on after it.

Two blank lines in a comment are its own <!-- a note


- not a list
--> as well.

A tag does too: <span

class="x">text</span> after it, and raw TeX on the next line ends it.
\begin{center}
centered
\end{center}

Indented raw TeX on the line after one ends it <!-- a

note --> here.
\begin{center}
  centered
  \end{center}

A code span holds a fence: `one
```
two
``` three` after it.

So does inline math: $x +
```
y
``` z$ after it.

::: note
A comment holds a div's closer <!-- here
:::
--> and the div goes on.
:::

A comment closed on its line keeps nothing: <!-- short --> and a quote follows.

> quoted
