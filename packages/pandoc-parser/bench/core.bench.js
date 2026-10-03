// The core's cost per character on a 380KB document, the size of today's
// `blocks()` baseline: a floor, a tokenizer mixing alternatives, Unicode
// predicates and backtracking, and a lookahead on every character.
//
//   node packages/pandoc-parser/bench/core.bench.js

import {
  alt,
  anyChar,
  attempt,
  char,
  FAIL,
  letter,
  lookAhead,
  many,
  many1,
  newline,
  notFollowedBy,
  oneOf,
  parse,
  skipMany,
  string,
} from '../src/index.js';

const line =
  'Paragraph with **strong** text, a [link](u) and `code` that runs on, ';
const text = `${line}\n`.repeat(Math.ceil(380_000 / (line.length + 1)));

const twoStars = string('**');
const peekStars = lookAhead(twoStars);
const notTick = notFollowedBy(char('`'));

const PARSERS = {
  'skipMany anyChar': skipMany(anyChar),
  tokens: many(
    alt(
      many1(letter),
      many1(oneOf(' \t')),
      newline,
      attempt(string('**s')),
      anyChar,
    ),
  ),
  'lookahead per char': skipMany(
    alt(
      (ctx) => (peekStars(ctx) === FAIL ? FAIL : twoStars(ctx)),
      (ctx) => (notTick(ctx) === FAIL ? FAIL : anyChar(ctx)),
      char('`'),
    ),
  ),
};

const RUNS = 7;
for (const [name, p] of Object.entries(PARSERS)) {
  parse(p, text);
  const times = [];
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    parse(p, text);
    times.push(performance.now() - start);
  }
  const ms = times.sort((a, b) => a - b)[RUNS >> 1];
  const ns = ((ms * 1e6) / text.length).toFixed(1);
  console.log(`${name}: ${ms.toFixed(1)}ms, ${ns}ns/char (${text.length} chars)`);
}
