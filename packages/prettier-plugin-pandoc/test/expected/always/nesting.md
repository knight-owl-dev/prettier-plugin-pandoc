# Constructs inside containers

- A list item holding a div, with prose long enough that a formatter wrapping at
  forty columns breaks it.

  ::: note
  Text inside the div inside the item, long enough to wrap at forty columns as
  well.
  :::

> ::: note
> A div inside a block quote, with prose long enough that the formatter has to
> wrap it.
> :::

> | A line block in a quote, long enough that wrapping it would break the verse.
> | Second verse line.

- An item holding verse:

  | First verse line of the item, long enough to wrap at forty columns.
  | Second.

- An item with a fancy sublist:

    a. First lettered item, long enough that the formatter wraps it at forty
       columns.
    b. Second.

- An item with raw TeX:

  \begin{center}
  Centered text inside a list item, long enough to wrap if prettier were allowed to.
  \end{center}

> \begin{center}
> Centered text inside a quote, long enough to wrap if prettier were allowed to.
> \end{center}

- An item holding a grid table:

  +---+---+
  | a | b |
  +===+===+
  | 1 | 2 |
  +---+---+

> > A nested quote with
> > \footnote{raw TeX with *markdown* inside, long enough that a wrap would land inside it}.

1. A plain ordered item, long enough that a formatter wrapping at forty columns
   breaks it somewhere.
2. Its second item.

::: dialog
- Who is there?
- Just the wind, in an item long enough that a formatter wrapping at forty
  columns breaks it.
- The wind does not knock.
:::

::: note
> A quote the div closes straight after.
:::

1. A fence deeper than the list item it sits in
   - is code to Pandoc
     - but indented code to CommonMark, whose items prettier re-indents

         ```
         code
         ```
