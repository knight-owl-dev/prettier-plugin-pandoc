# Code misreads

A tilde fence cannot interrupt a paragraph, so this is its text:
~~~
not code to Pandoc
~~~

In a block quote as well:

> Quoted text the fence follows,
> ~~~
> not code to Pandoc
> ~~~

A fence never closed is paragraph text too:

```
not code to Pandoc either

and *emphasis* is read.
