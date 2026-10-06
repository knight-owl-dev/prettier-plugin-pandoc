# Strong emphasis

Text in **_bold italic_**, which Pandoc reads as strong around emphasis.

Underscores too: **_bold italic_**, and the unambiguous forms **_strong
emphasis_** and _**emphasized strong**_ stay as prettier prints them.

A run split at one end: _**strong** then emphasis_, **_emphasis_ then strong**,
_emphasis then **strong**_, and inside a word: foo**_bar_**baz.

Inside other emphasis, the inner emphasis takes `*` and touches strong: _a
***b*** c_.
