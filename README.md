# i miss dojo

Every Wednesday at 8am UK time, a GitHub Action sends `prompt.md` to the OpenAI API, saves the reply to `posts/YYYY-MM-DD.md`, and publishes the site.

## Files you edit

- `prompt.md`: the prompt (ask for Markdown output)
- `site.config.json`: site title and tagline
- `scripts/styles.css`: the look

## Setup

1. **Settings → Secrets and variables → Actions → New repository secret**: `OPENAI_API_KEY`
2. Optional: under **Variables**, add `OPENAI_MODEL` to override the default model (`gpt-6-astra`)
3. **Settings → Pages → Source**: GitHub Actions
4. To test: **Actions → Generate and publish → Run workflow**, then tick "Generate a new post now"

## Custom domain (later)

**Settings → Pages → Custom domain**, then add the DNS record GitHub shows you in Cloudflare (set the proxy to "DNS only" until GitHub has issued the certificate).

## Local

```sh
npm install
OPENAI_API_KEY=sk-... FORCE=true npm run generate
npm run preview
```
