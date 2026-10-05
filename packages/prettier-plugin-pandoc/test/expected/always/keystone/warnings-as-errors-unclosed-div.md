# Chapter One

A normal paragraph before the mistake.

::: {.commentary}
This div is opened but the closing fence is missing. Pandoc closes it implicitly
at end of input and emits a reader-level warning — which never reaches our
errors-lib sink. The class is neutral, so no handler fires and Pandoc's own
warning is the only signal.

A second paragraph the author intended to sit outside the div.
