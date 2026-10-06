# Math environments

Pandoc reads its math environments as inline text, never a raw block.

\begin{equation}
x = y + z
\end{equation}

\begin{align}
a &= b + c \\
d &= e + f + g + h + i + j + k + l + m + n + o + p + q + r + s + t + u + v
\end{align}

Text before an equation, long enough to wrap
\begin{equation*}x = \frac{a}{b}\end{equation*} and after.

> \begin{math}
> x
> \end{math}

-   \begin{gather}
    a \\ b
    \end{gather}
