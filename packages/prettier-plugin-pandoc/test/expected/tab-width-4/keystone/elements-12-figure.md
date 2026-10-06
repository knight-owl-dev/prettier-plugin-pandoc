# Figure Handler Test

## Centered (shortcut)

The figure below should be centered via the figure-center shortcut. The width
attribute routes through the shortcut's interface to the inner figure handler.

::: {.figure-center width=50%}
![Centered figure](assets/test-image.jpg)
:::

## Left-aligned (shortcut)

The figure below should be left-aligned via the figure-left shortcut.

::: {.figure-left width=50%}
![Left figure](assets/test-image.jpg)
:::

## Right-aligned (shortcut)

The figure below should be right-aligned via the figure-right shortcut.

::: {.figure-right width=50%}
![Right figure](assets/test-image.jpg)
:::

## No alignment (bare figure)

The figure below uses bare ::: figure with no alignment wrapper.

::: {.figure width=50%}
![Bare figure](assets/test-image.jpg)
:::

## No width (natural size)

::: figure
![Natural size](assets/test-image.jpg)
:::

## Undersized asset (60x40)

The checkerboard below is far narrower than 80% of the text column and must
still fill it. Checked by eye, not by assertion: coarse blocks mean the asset
scaled up, a 60 px thumbnail means `width=` was dropped.

::: {.figure width=80%}
![Undersized checkerboard filling 80% of the column](assets/undersized-image.png)
:::

## With id for cross-referencing

::: {.figure width=50% id=fig-test}
![Labeled figure](assets/test-image.jpg)
:::

## Standalone image (no div)

![Standalone caption](assets/test-image.jpg)

<!-- markdownlint-disable MD045 — intentionally empty alt text to test no-caption behavior -->

## No caption (empty alt text)

::: {.figure width=25%}
![](assets/test-image.jpg)
:::

## Wide caption (escape hatch)

The caption below should span the full text width even though the image is
narrow, because `caption-width=full` opts out of caption constraining.

::: {.figure width=25% caption-width=full}
![Wide caption under narrow image](assets/test-image.jpg)
:::
