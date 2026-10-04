// Tags written back as HTML.
//
// Ported from TagSoup 0.14.8's `Text.HTML.TagSoup.Render`.

/** @typedef {import('./parser.js').Tag} Tag */

/**
 * How to render: how to escape text, which tags to minimize when closed
 * at once (`<br />`), and which to write raw, their text unescaped.
 *
 * @see Text.HTML.TagSoup.Render.RenderOptions
 * @typedef {object} RenderOptions
 * @property {(text: string) => string} escape
 * @property {(name: string) => boolean} minimize
 * @property {(name: string) => boolean} rawTag
 */

const XML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['"', '&quot;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ["'", '&#39;'],
]);

/**
 * Text with `&`, `"`, `<`, `>` and `'` escaped.
 *
 * @see Text.HTML.TagSoup.Render.escapeHTML
 * @param {string} text
 */
export const escapeHTML = (text) =>
  text.replace(/[&"<>']/g, (c) => XML_ESCAPES.get(c));

/**
 * The default options: `<br>` minimized, `<script>` raw.
 *
 * @see Text.HTML.TagSoup.Render.renderOptions
 * @type {RenderOptions}
 */
export const renderOptions = {
  escape: escapeHTML,
  minimize: (name) => name === 'br',
  rawTag: (name) => name === 'script',
};

/**
 * `tags` as HTML, as `options` asks.
 *
 * @see Text.HTML.TagSoup.Render.renderTagsOptions
 * @param {RenderOptions} options
 * @param {Tag[]} tags
 */
export function renderTagsOptions(options, tags) {
  const txt = options.escape;
  const att = ([name, value]) => {
    if (name === '' && value === '') return ' ""';
    if (value === '') return ` ${name}`;
    if (name === '') return ` "${txt(value)}"`;
    return ` ${name}="${txt(value)}"`;
  };
  const open = (name, attrs, shut) =>
    `<${name}${attrs.map(att).join('')}${shut}>`;
  // A comment's text, `-->` in it broken as `-- >`.
  const com = (text) => text.replaceAll('-->', '-- >');
  const tag = (t) => {
    switch (t.t) {
      case 'TagOpen':
        return open(t.name, t.attrs, '');
      case 'TagClose':
        return `</${t.name}>`;
      case 'TagText':
        return txt(t.text);
      case 'TagComment':
        return `<!--${com(t.text)}-->`;
      default:
        return '';
    }
  };
  let out = '';
  for (let i = 0; i < tags.length; ) {
    const t = tags[i];
    const following = tags[i + 1];
    if (
      t.t === 'TagOpen' &&
      following?.t === 'TagClose' &&
      following.name === t.name &&
      options.minimize(t.name)
    ) {
      out += open(t.name, t.attrs, ' /');
      i += 2;
    } else if (t.t === 'TagOpen' && t.name.startsWith('?')) {
      out += open(t.name, t.attrs, ' ?');
      i++;
    } else if (t.t === 'TagOpen' && options.rawTag(t.name)) {
      // To its closing tag, its text unescaped.
      let j = i;
      while (
        j < tags.length &&
        !(tags[j].t === 'TagClose' && tags[j].name === t.name)
      ) {
        const x = tags[j];
        out += x.t === 'TagText' ? x.text : tag(x);
        j++;
      }
      i = j;
    } else {
      out += tag(t);
      i++;
    }
  }
  return out;
}
