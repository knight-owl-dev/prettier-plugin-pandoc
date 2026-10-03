// Pandoc's attribute block: `{`, then identifiers, classes, key-value pairs
// and `-`, then `}`.

const NAME = '[A-Za-z][\\w:.-]*';
const ATTRIBUTE = `(?:[#.]${NAME}|${NAME}=(?:"[^"]*"|'[^']*'|[^\\s}]*)|-)`;
export const ATTRIBUTES = `\\{[ \\t]*(?:${ATTRIBUTE}[ \\t]*)*\\}`;
