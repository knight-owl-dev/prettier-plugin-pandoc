# Pullquote Test

## Plain with Source

The following pullquote uses the default plain style with attribution. The text
should appear centered, large, and italic with em-dash attribution.

::: {.pullquote source="John F. Kennedy"}
We choose to go to the moon in this decade and do the other things, not because
they are easy, but because they are hard.
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Plain without Source

The following pullquote has body text only — no source attribute. It should
render as centered, large, italic text with no attribution.

::: pullquote
In the middle of difficulty lies opportunity.
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Ruled with Source

The following pullquote uses the ruled style with horizontal rules above and
below. The attribution should appear right-aligned beneath the quote.

::: {.pullquote style=ruled source="Franklin D. Roosevelt"}
The only thing we have to fear is fear itself.
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Ruled without Source

The following pullquote uses the ruled style but has no attribution. Horizontal
rules should appear above and below the quote text.

::: {.pullquote style=ruled}
Not everything that counts can be counted, and not everything that can be
counted counts.
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Source with Special Characters

The following pullquote has a source containing a comma and year. The handler
should render it as plain text after the em-dash.

::: {.pullquote source="Arthur C. Clarke, 1973"}
Any sufficiently advanced technology is indistinguishable from magic.
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Composed with Font (Nested Divs)

The following pullquote nests a font div to render the body in EB Garamond. The
source attribute stays on the outer pullquote.

::: {.pullquote source="Steve Jobs"}
::: {.font family="eb-garamond"}
Design is not just what it looks like and feels like. Design is how it works.
:::
:::

This paragraph should appear as normal body text, not part of the pullquote.

## Composed with Font (Chaining Shortcut)

The following uses a user-defined shortcut that chains pullquote and overrides
the font family via the exposed font-family interface.

::: {.garamond-pullquote style=ruled source="Alan Kay"}
The best way to predict the future is to invent it.
:::

This paragraph should appear as normal body text, not part of the pullquote.
