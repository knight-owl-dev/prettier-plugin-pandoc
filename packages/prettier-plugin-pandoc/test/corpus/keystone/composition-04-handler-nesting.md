# Handler nesting

## Font inside align

::: {.align style="center"}
::: {.font family="dejavu-sans"}
Centered, in DejaVu Sans — a font handler nested inside align.
:::
:::

## Font inside aside

::: {.aside type="note"}
::: {.font family="dejavu-sans"}
A note aside wrapping a nested DejaVu Sans font handler.
:::
:::

## Align inside font (reverse nesting)

::: {.font family="dejavu-sans"}
::: {.align style="center"}
DejaVu Sans wrapping a centered align — the reverse serialization path.
:::
:::
