# Lazy container lines

Pandoc collects a container's lines before parsing them, so these unprefixed
lines belong to the quote or item above.

> ``` code a lazy line holds

```

> # A heading in a quote
lazy text Pandoc keeps inside the quote

> ::: note
text of a div continued lazily
:::

- An item whose fence closes unindented:

```

code ``` still the item

> A paragraph continued lazily, which CommonMark agrees with.

-   An item whose next line opens with a definition marker, which ends the item
    Term

: so this is a paragraph to Pandoc, long enough that the formatter wraps it.

-   Another item

: with a definition marker straight after it, a paragraph's first line here 1)
and no fancy list, long enough that the formatter would join and wrap it.

> -   An item in a quote
> ~ ended the same way by a tilde marker, long enough that the formatter wraps.
