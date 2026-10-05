# Shortcuts Test

This paragraph is in the default font.

## Basic Shortcut (Div)

::: garamond
This paragraph should render in EB Garamond via the garamond shortcut.
:::

## Basic Shortcut (Span)

This has [EB Garamond text]{.garamond} inline via the shortcut.

## Size Shortcut

::: small-text
This paragraph should render in small text via the small-text shortcut.
:::

## Chained Shortcut

::: small-garamond
This paragraph should render in EB Garamond at small size via the chained shortcut.
:::

Inline chained: [small EB Garamond]{.small-garamond} in a sentence.

## Cross-Handler Shortcut

Some poem text here. The poem-date shortcut combines right alignment with italic text via body injection — the align handler right-aligns the text, and an inner font slot provides the italic style.

::: poem-date
_Orem_ — January & February 2026
:::

## Body Injection (empty Div)

::: ornament
:::

## Body Injection (Div with content)

::: ornament
Author-provided content overrides shortcut body.
:::

## Nested Shortcut in Body

::: poem-date-nested
:::

## Container Shortcut (Div)

::: wrapper
This paragraph is inside a wrapper container shortcut.
:::

## Container Shortcut (Span)

This has [wrapper span text]{.wrapper} inline via the shortcut.

## Chained Container Shortcut

::: dated-wrapper
This paragraph chains through dated-wrapper to wrapper to container.
:::

## Body Injection into Container

::: poem-footer
:::
