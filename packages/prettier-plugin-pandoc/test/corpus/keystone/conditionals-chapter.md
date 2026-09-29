# Conditional Inclusion Test

ALWAYSHERE baseline paragraph so we know the document rendered.

::: {.ifdef symbol="secret"}
IFDEFSECRETSHOWN
:::

::: {.ifdef symbol="unset-symbol"}
IFDEFUNSETHIDDEN
:::

::: {.ifndef symbol="secret"}
IFNDEFSECRETHIDDEN
:::

::: {.ifndef symbol="other-symbol"}
IFNDEFOTHERSHOWN
:::

Inline gating: [SPANSECRETSHOWN]{.ifdef symbol="secret"} stays, [SPANUNSETHIDDEN]{.ifdef symbol="unset-symbol"} goes.

Format targeting: [FMTLATEX]{.ifdef symbol="latex"} [FMTEPUB]{.ifdef symbol="epub"}
