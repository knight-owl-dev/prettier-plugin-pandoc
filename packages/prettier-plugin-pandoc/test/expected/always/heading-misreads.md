# Headings and rules only CommonMark reads

Pandoc wants a blank line before a heading or a rule, so these lines continue #
the paragraph above them, which goes on long enough that the formatter would
wrap it.

A bare hash continues one too, in a paragraph long enough that it would wrap #

So does a closed heading, in a paragraph long enough that the formatter wraps it
## closed ##

Asterisks continue a paragraph, which runs on long enough that it would wrap ***

And underscores, in a paragraph running on long enough that it would wrap ___

And spaced dashes, in a paragraph running on long enough that it would wrap - - -

An underline below two lines continues the paragraph, long enough that the
formatter would join and wrap it ===

A dashed one too, below two lines of a paragraph long enough that the formatter
would join and wrap it ---

> A quote's line, long enough that the formatter would join it and wrap it #
> continued in the quote

- A list item's line, long enough that the formatter would join it and wrap it
  ***

- Another item's line, long enough that the formatter would join it and wrap * * *

- ## An underlined item

## A setext heading

Is a heading to both, and so is the next.

# A heading

And a rule after a blank line:

---
