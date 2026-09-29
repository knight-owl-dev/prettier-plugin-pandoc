# Dialog Test

OPENING-PROSE anchors the first vertical-gap measurement, before the dialog block opens.

::: dialog

- **Anna** said hello & waved — 100% sure
- *Ben* asked "why #1?" with % emphasis

:::

INTERVENING-PROSE sits between two dialog blocks; book/indent-on must visibly separate it from the surrounding dialog lines, not glue them together.

::: dialog

- Anna replied softly, in a long winding sentence that meanders through several clauses about the weather, the price of tea, and the way the morning light fell across the kitchen tiles, just to make sure the typesetter has to wrap this line onto a second visual row for continuation parity
- Ben nodded

:::

TRAILING-PROSE anchors the after-block measurement; it should sit a full medskip below the last dialog line.

HANGING-PREAMBLE-LINE introduces the hanging-style dialog block below.

::: {.dialog style=hanging}

- HANGING-FIRST starts the hanging-style turn with another deliberately long sentence so that its wrap exercises the hanging continuation, where the second visual row should sit indented under the speech rather than flush with the body margin
- HANGING-LAST closes the hanging-style turn

:::

HANGING-TAIL-LINE follows the hanging-style block.
