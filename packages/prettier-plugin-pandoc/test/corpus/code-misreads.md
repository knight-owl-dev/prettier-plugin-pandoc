# Code misreads

A tilde fence cannot interrupt a paragraph, so this is its text:
~~~
not code to Pandoc
~~~

A paragraph runs on past a fence Pandoc reads as its text:
~~~
not code
~~~
and this line is the same paragraph.

At a wide tab stop, Pandoc closes a fence deeper than CommonMark does:

```
code
    ```
after *the* fence
```

In a block quote as well:

> Quoted text the fence follows,
> ~~~
> not code to Pandoc
> ~~~

A fence never closed is paragraph text too:

```
not code to Pandoc either

and *emphasis* is read.
