# Handler Nesting Test

## Font inside Align

The text below should be centered and rendered in DejaVu Sans. This tests
alignment-only wrapping (block list) with a nested font handler that emits
RawBlocks.

::: {.align style="center"}
::: {.font family="dejavu-sans"}
This paragraph is centered in DejaVu Sans.
:::
:::

## Font inside Aside

The text below should appear inside a note-style aside box, rendered in
DejaVu Sans. This tests the `latex_write.blocks()` serialization path
with RawBlocks from the inner font handler.

::: {.aside type="note"}
::: {.font family="dejavu-sans"}
This paragraph is inside an aside in DejaVu Sans.
:::
:::

## Font inside Multicol

The text below should appear in a two-column layout, rendered in DejaVu
Sans. This tests the `latex_write.blocks()` path in a different container.

::: {.multicol cols="2"}
::: {.font family="dejavu-sans"}
This paragraph is in a two-column layout in DejaVu Sans. Adding enough
text to fill both columns so the layout is visible in the output.
:::
:::

## Align inside Font

The text below should be rendered in DejaVu Sans and centered. This tests
reverse nesting: the font handler produces RawBlocks, and the align handler
returns a block list wrapping them.

::: {.font family="dejavu-sans"}
::: {.align style="center"}
This paragraph is in DejaVu Sans and centered.
:::
:::
