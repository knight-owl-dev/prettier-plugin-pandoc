# Inline environments

An environment written mid-line is raw TeX to Pandoc, which ends the paragraph around it: \begin{center}kept *as* written,
across its lines\end{center} and the text after it opens a paragraph of its own.

- An item \begin{x}y_z\end{x} with one inside.

# A heading \begin{x}holding one\end{x} is not a heading to Pandoc

One across a blank line: \begin{x}first

second *part*\end{x} after.

An environment ending inside what would be a quote reads through it raw: \begin{x} b

> c \end{x} d

Emphasis *around \begin{x} one

that splits \end{x} the paragraph*.

A fence inside one is its raw text: \begin{x} b
```
\end{x}

```
and the text after it a paragraph.

- An item whose environment \begin{x} holds

  - what would be a nested item \end{x} to the end.

Two on a line, \begin{x}one\end{x} then prose, \begin{x}and
two\end{x} each raw.

Text after one \begin{x}ends\end{x} underlined
===

Link text holds one [as _text_ \begin{x}y\end{x}](https://example.com) without
ending the paragraph, and so do [plain brackets \begin{x}y\end{x}] around it.
