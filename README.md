# i miss dojo

in 2019 dojo shut down, and london felt a little harder to find.

it had a knack for turning an empty saturday into a weekend you remembered. a gallery you would never have walked into, dinner down a street you barely knew, a date with somewhere to go after the first drink. even when the week had been rubbish, there was that small promise of something good ahead.

i miss opening it without a plan and coming away with one. i miss being nudged out of the flat, and feeling like the city still had things up its sleeve. nothing since has quite filled that space.

this is a small attempt to keep that feeling going, with an ai-written london weekend newsletter every wednesday morning.

it will never be the same. but perhaps there is still a good saturday in it.

(not affiliated with the original dojo. check dates, prices, and booking details before you go.)

## Generation setup

The Wednesday workflow runs **Claude Code with Sonnet 5.5 at extra-high (`xhigh`) effort**, authenticated by the repository secret **`CLAUDE_CODE_OAUTH_TOKEN`** from `claude setup-token`. It uses your Claude subscription allowance, with no OpenAI or Anthropic API-key fallback.

`prompt.md` remains the newsletter brief. The writer uses live WebSearch/WebFetch, and the existing photo pipeline sends image batches to Claude with `image-criteria.md` and a structured scoring schema. Both stages use Sonnet 5.5 at `xhigh`.

The publishing schedule and manual **generate** / **photos** options are unchanged. Pushing code builds the existing posts; it does not generate a new newsletter. To generate locally, install Claude Code (`npm install --global @anthropic-ai/claude-code`), set `CLAUDE_CODE_OAUTH_TOKEN`, then run `FORCE=true npm run generate`. Existing posts for that date are not overwritten.

`npm test` uses a fake CLI and makes no model requests. `npm run build` builds the static site. Runtime token usage appears in Actions logs. The old `OPENAI_API_KEY` secret and `OPENAI_MODEL` variable are no longer used.
