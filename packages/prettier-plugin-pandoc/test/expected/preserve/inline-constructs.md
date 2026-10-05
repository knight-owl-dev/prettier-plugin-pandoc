# Inline constructs {#inline .unnumbered}

A bracketed span in [small caps]{.smallcaps} and [a styled one]{style="color: red"} inside a paragraph long enough to wrap.

An inline note^[with _emphasis_ inside, long enough that the formatter has to wrap it] and a footnote reference[^note].

[^note]: The footnote's text, long enough that a formatter wrapping at forty columns has to break it.

Citations: [@smith2023, p. 5], [see @doe2020; @roe2021], and @smith2023 in text, with a suppressed author [-@smith2023].

Superscript 2^10^, subscript H~2~O, ~~struck~~ text, and `raw`{=latex} inline, plus ![a figure](img.png){width=50% #fig:one}.

A [link](http://example.com){.external} with attributes, and an [empty span]{} too.

Math inline $e = mc^2$ and display:

$$
\int_0^1 x \, dx
$$
