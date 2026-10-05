# Fenced divs

A paragraph long enough that the formatter has to wrap it somewhere, so the prose around each div is exercised as well as the div itself.

::: {.aside type="note"}
::: {.font family="dejavu-sans"}
A note aside wrapping a nested font div, with _emphasis_ the formatter restyles and a sentence long enough to wrap.
:::
:::

::: pagebreak
:::

<!-- a comment ends its block, so the fence below opens a div -->

::: {.appendix numbering="upper-roman"}
:::

prose that a paragraph continues
::: not-a-div
:::

```markdown
::: sample
text
:::
```

::: epigraph
Closed by the end of the document, the way Pandoc reads an unclosed div.
