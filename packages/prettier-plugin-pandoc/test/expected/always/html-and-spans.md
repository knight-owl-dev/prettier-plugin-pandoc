# Raw HTML and inline spans

Where raw HTML ends is read from the text as written: a formula holding a
closing tag does not hide it.

<pre>
$a </pre> b$

Later \foo{a *b* c} text keeps its raw TeX as written.

A tag inside raw TeX opens nothing either.

p \foo{a
<pre>
b} q

r \foo{a *b* c} s, and $x *y*$ after it.

Nor does one a formula holds: Words $x
<div>$ and \foo{p *q* r} end.

Raw TeX the two parsers cannot settle on prints as written: See [a](\foo{*x* y})
and more words here to wrap.

- An item holding a formula $p *q*$ r
<script>

p \foo{a *b* c} q
