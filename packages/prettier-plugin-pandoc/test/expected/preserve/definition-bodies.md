# Definition bodies

A definition goes on past a blank line at its own content column.

Narrow
: the definition

  goes on here.

Wider
:  the definition

   goes on here too.

A later term may be any line.

First
: one

# Second
: two

- Third
: three

A definition holds blocks.

Term

:   \begin{center}
    centered
    \end{center}

    > quoted

    - an item
    - another

A block on the line after a loose definition ends it, the definition's text
plain.

Loose

: the definition
- a list after it

Loose

: the definition
```
code after it
```

A fence Pandoc refuses is the definition's text.

Term
: lazy text
  ```{.x} trailing
  more text

```

A fence after a definition's first line ends it.

Term
: lazy text
```

code after the list
```
