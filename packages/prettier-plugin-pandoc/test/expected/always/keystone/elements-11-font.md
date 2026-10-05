# Font Handler Test

This paragraph is in the default font.

## Font Family Blocks

::: {.font family="libertine"}
This paragraph is in Linux Libertine.
:::

::: {.font family="dejavu-sans"}
This paragraph is in DejaVu Sans.
:::

::: {.font family="dejavu-serif"}
This paragraph is in DejaVu Serif.
:::

::: {.font family="dejavu-mono"}
This paragraph is in DejaVu Sans Mono.
:::

::: {.font family="noto-mono"}
This paragraph is in Noto Sans Mono.
:::

::: {.font family="source-code-pro"}
This paragraph is in Source Code Pro.
:::

::: {.font family="biolinum"}
This paragraph is in Linux Biolinum.
:::

::: {.font family="tex-gyre-pagella"}
This paragraph is in TeX Gyre Pagella.
:::

::: {.font family="tex-gyre-termes"}
This paragraph is in TeX Gyre Termes.
:::

::: {.font family="tex-gyre-heros"}
This paragraph is in TeX Gyre Heros.
:::

::: {.font family="tex-gyre-schola"}
This paragraph is in TeX Gyre Schola.
:::

::: {.font family="tex-gyre-bonum"}
This paragraph is in TeX Gyre Bonum.
:::

::: {.font family="tex-gyre-adventor"}
This paragraph is in TeX Gyre Adventor.
:::

::: {.font family="tex-gyre-cursor"}
This paragraph is in TeX Gyre Cursor.
:::

::: {.font family="eb-garamond"}
This paragraph is in EB Garamond.
:::

::: {.font family="latin-modern"}
This paragraph is in Latin Modern Roman.
:::

## Ornamental Font Families

These exercise the single-variant ornament fonts. Only the ornament glyphs are
wrapped in `.font` — the prose stays in the document font. The wrapped
characters are slots each OTF actually populates (see the
[ornamental-fonts glyph reference](https://keystone.knight-owl.dev/writing/ornaments/));
the glyphs below should render as ornaments, not boxes.

This paragraph shows a fourier fleuron [❦]{.font family="fourier-ornaments"} and
an aldine leaf pair [G H]{.font family="fourier-ornaments"} inline.

Square foliate blocks from `imfell-flowers-1` (the `A B C` glyphs only):

::: {.font family="imfell-flowers-1"}
A B C
:::

Floral header and manicules from `imfell-flowers-2` (the `E 1 2` glyphs only):

::: {.font family="imfell-flowers-2"}
E 1 2
:::

## Symbol Fallback

The `sym` shortcut renders math symbols a body font may lack. It is the only
path to `latin-modern-math` here, so these assertions exercise `sym` itself —
not the underlying `.font`: [≫]{.sym} [⩽]{.sym} [∀]{.sym} in a sentence.

::: sym
Block form via sym: ≫ ⩽ ∀
:::

## Font Size Blocks

::: {.font size="small"}
This paragraph is rendered in small text.
:::

::: {.font size="large"}
This paragraph is rendered in large text.
:::

::: {.font size="footnotesize"}
This paragraph is rendered in footnotesize text.
:::

::: {.font size="huge"}
This paragraph is rendered in huge text.
:::

## Inline Font Family Spans

This has [Libertine text]{.font family="libertine"} in the middle.

This has [DejaVu Sans text]{.font family="dejavu-sans"} in the middle.

This has [monospace text]{.font family="dejavu-mono"} in the middle.

## Inline Font Size Spans

This has [small text]{.font size="small"} in the middle of a sentence.

This has [large text]{.font size="large"} in the middle of a sentence.

This has [tiny text]{.font size="tiny"} and [huge text]{.font size="huge"} on
the same line.

## Combined Font Family and Size

::: {.font family="libertine" size="small"}
This paragraph is in Linux Libertine at a smaller size.
:::

::: {.font family="dejavu-sans" size="large"}
This paragraph is in DejaVu Sans at a larger size.
:::

Combined inline: [small Libertine]{.font family="libertine" size="small"} and
[large DejaVu Sans]{.font family="dejavu-sans" size="large"} in the same
sentence.

## Font Style Blocks

::: {.font style="italic"}
This paragraph should render in italic text.
:::

::: {.font style="bold"}
This paragraph should render in bold text.
:::

::: {.font style="bold-italic"}
This paragraph should render in bold italic text.
:::

## Inline Font Style Spans

This has [italic text]{.font style="italic"} in the middle.

This has [bold text]{.font style="bold"} in the middle.

This has [bold italic text]{.font style="bold-italic"} in the middle.

## Combined Font Family and Style

::: {.font family="libertine" style="italic"}
This paragraph is in italic Linux Libertine.
:::

Combined inline: [italic Libertine]{.font family="libertine" style="italic"} in
a sentence.

## Combined Font Style and Size

::: {.font style="italic" size="small"}
This paragraph is in italic small text.
:::

Combined inline: [bold large text]{.font style="bold" size="large"} in a
sentence.

## Full Combination (Family + Style + Size)

::: {.font family="libertine" style="italic" size="small"}
This paragraph is in italic Linux Libertine at a smaller size.
:::

Combined inline: [bold large Libertine]{.font family="libertine" style="bold"
size="large"} in a sentence.
