# Pipe table alignment

A table no line of which passes the column width aligns its columns:

| Right | Left | Center | Default |
| ----: | :--- | :----: | ------- |
|     1 | one  |  _x_   | a       |
|    22 | two  | `a|b`  | b \| c  |

Table: A caption, spaced loosely.

A table without its outer pipes:

| Key | Value |
| --- | ----- |
| a   | 1     |

A table whose cells drop text Pandoc ignores keeps it:

| a | b |
|---|---|
| c | d | e |
