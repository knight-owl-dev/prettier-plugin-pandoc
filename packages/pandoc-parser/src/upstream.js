// The Pandoc release the port was last reviewed on, as `upstream.json`
// records it: a JSON import, so a bundler stamps it at build. A subpath of
// its own, so only what reads it needs Node's JSON modules.

import upstream from '../upstream.json' with { type: 'json' };

export const PANDOC_RELEASE = upstream.pandoc.release;
