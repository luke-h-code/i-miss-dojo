# i miss dojo

In 2019 Dojo shut down and a huge part of my life went away.

[Dojo](https://www.businessinsider.com/dojo-app-raises-800k-funding-2015-1) started as an app, then became a website and newsletter, and it gave the best what-to-do advice in London. It gave me some of the best weekend and date ideas I've ever had. Even when everything else sucked, I knew I'd at least have a great weekend.

It's been gone for years, and [nothing has really filled its shoes](https://www.reddit.com/r/london/comments/cseq3z/any_alternatives_to_dojo/). With AI around now, I figured I could at least partly bring back that advice. I took 20+ of the newsletters I'd received, converted them to text, and had AI write a job description for the journalist who'd write them, covering tone, format and everything else. That became the prompt. Every Wednesday morning a new newsletter is generated and published.

It'll never be the same, but it's something.

## How it works

Every Wednesday at 8am UK time, a GitHub Action sends `prompt.md` to the OpenAI API, saves the reply to `posts/YYYY-MM-DD.md`, and publishes the site to GitHub Pages.

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

## License

[MIT](LICENSE)

Not affiliated with the original Dojo. Posts are AI-generated, so check details before you go.
