# Lazy lines of a block quote

A lazy line drops its indentation.

> quoted
>
> lazy, not code

In a list item, a list ends a quote's lazy lines, and opens straight after a quoted line.

- an item

  > quoted
  - a list after the quote

- an item

  > quoted
  > - a list in the quote

A tilde fence is lazy text.

> quoted
> ~~~
> lazy text
> ~~~

A backtick fence ends the quote, though its close comes past a blank line.

> quoted

```

code after the quote
```

```
