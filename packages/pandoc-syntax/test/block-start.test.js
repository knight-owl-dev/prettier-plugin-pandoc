// Where a fence opens a div, checked against Pandoc rather than asserted.
//
// Each case puts `::: note` on the line straight after a block, with no blank
// between. Pandoc decides whether that opens a div; the recognizer must agree.
// The verdict is asked at test time, so a Pandoc that changes its mind fails
// here instead of drifting from what an assertion once recorded.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { blocks } from '../src/index.js';

const FENCE = '::: note\ntext\n:::\n';

function pandocOpens(before) {
  const run = spawnSync('pandoc', ['-f', 'markdown', '-t', 'json'], {
    input: `${before}\n${FENCE}`,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`pandoc failed: ${run.stderr}`);
  return JSON.stringify(JSON.parse(run.stdout).blocks).includes('["note"]');
}

function recognizerOpens(before) {
  const text = `${before}\n${FENCE}`;
  const at = before.length + 1;
  return blocks(text).some(
    (block) => block.type === 'div' && block.open.start === at,
  );
}

const CASES = {
  paragraph: 'prose',
  'ATX heading': '# H',
  'setext heading': 'H\n=',
  'setext heading, level 2': 'H\n--',
  'thematic break': '***',
  'thematic break of dashes': 'x\n\n---',
  'one-line HTML comment': '<!-- c -->',
  'multi-line HTML comment': '<!--\nc\n-->',
  'HTML block': '<div>\nx\n</div>',
  'one-line HTML block': '<div>x</div>',
  'raw TeX environment': '\\begin{center}\nx\n\\end{center}',
  'raw TeX command': '\\newpage',
  'raw TeX macro definition': '\\newcommand{\\foo}{bar}',
  'inline TeX opening a paragraph': '\\emph{x} and prose',
  'fenced code': '```\nx\n```',
  'indented code': '\n    code',
  'code indented by spaces then a tab': '\n  \tcode',
  'pipe table': '| a | b |\n|---|---|\n| 1 | 2 |',
  'block quote': '> quoted',
  'bullet list': '- item',
  'ordered list': '1. item',
  'line block': '| verse',
  'definition list': 'Term\n\n:   Definition',
  'footnote definition': '[^1]: note',
  'link reference definition': '[a]: http://example.com',
  'YAML metadata': '---\ntitle: x\n---',
  'closed div': '::: a\nx\n:::',
  'lone image': '![caption](img.png)',
  'table caption': '| a |\n|---|\n| 1 |\n\nTable: caption',
  'heading after a paragraph line': 'prose\n# H',
  'thematic break after a paragraph line': 'prose\n***',
  'fenced code after a paragraph line': 'prose\n```\nx\n```',
  'HTML comment after a paragraph line': 'prose\n<!-- c -->',
  'raw TeX environment after a paragraph line':
    'prose\n\\begin{center}\nx\n\\end{center}',
  'line block after a paragraph line': 'prose\n| verse',
  'raw TeX command after a paragraph line': 'prose\n\\newpage',
  'HTML block tag after a paragraph line': 'prose\n<div>',
  'indented text after a paragraph line': 'prose\n    indented',
  'setext underline after two paragraph lines': 'one\ntwo\n---',
  'pipe table after a paragraph line': 'prose\n| a |\n|---|\n| 1 |',
};

for (const [name, before] of Object.entries(CASES)) {
  test(`after ${name}, the recognizer and Pandoc agree`, () => {
    assert.equal(recognizerOpens(before), pandocOpens(before));
  });
}
