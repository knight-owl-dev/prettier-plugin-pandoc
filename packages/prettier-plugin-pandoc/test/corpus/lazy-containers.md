# Lazy container lines

Pandoc collects a container's lines before parsing them, so these unprefixed lines belong to the quote or item above.

> ```
code a lazy line holds
```

> # A heading in a quote
lazy text Pandoc keeps inside the quote

> ::: note
text of a div continued lazily
:::

- An item whose fence closes unindented:

  ```
  code
```
  still the item

> A paragraph continued
lazily, which CommonMark agrees with.
