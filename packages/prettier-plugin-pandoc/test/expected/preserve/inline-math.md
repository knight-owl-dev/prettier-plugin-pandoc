# Inline math

A formula keeps its spaces and line breaks, $a + b + c + d + e + f + g + h + i + j$, however long the line it sits on runs.

A formula across lines $x
y$ keeps the break.

A formula's emphasis marks are its own: $a*b*c$ stays.

A balanced group holds a dollar: $\text{for all $x$ in } S$ is one formula.

A plain group holds none: $a + b + c {$ closes the formula there.

A price is no formula: it costs $5, and $x$ after it is one.

$$ opens no display math when a formula $a$ follows on its line.

A link's text holds a formula, [as $x + y$ here](https://ex.com/), but its
destination and title hold none: [link](https://ex.com/$a$/b "title $a+b$"),
nor raw TeX: [link](https://ex.com/\foo).

Liquid tags {{ $x *y*$ }} and wiki links [[ $x *y*$ ]] print as written too.

A reference definition is no formula, and neither is its label: see [$a$].

[$a$]: https://ex.com/$a+b$/c

> A quote holding $x
>   y$ a formula too.

<div>
Raw HTML keeps its formulas $a + b$ and commands \foo as written, and those
across lines too: $x
y$ and \foo{a
b} c.
</div>

1.  An item with a footnote \footnote{one
    two} across its lines.
