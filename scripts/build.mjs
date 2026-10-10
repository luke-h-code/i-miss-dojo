// Renders posts/*.md into a static site in _site/.
//   _site/index.html              latest post + archive
//   _site/posts/YYYY-MM-DD/       one page per post
//   _site/posts/images/           photos from posts/images/, plus a JPEG share
//                                 card per post for link previews
//   _site/about/                  about.md
//   _site/404.html                not found page
//   _site/feed.xml                RSS feed
//   _site/sitemap.xml, robots.txt for search engines

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir, rm, copyFile, cp } from "node:fs/promises";
import { marked } from "marked";
import sharp from "sharp";

const OUT = "_site";
const FEED_ITEMS = 20;
const CARD = { width: 1200, height: 630 }; // the size link previews expect
const config = JSON.parse(await readFile("site.config.json", "utf8"));
const SITE = config.url.replace(/\/$/, "");

const escape = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const prettyDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// Markdown to a single line of plain text, for descriptions.
const plain = (md) =>
  md
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "") // ([source.com](…)) citations
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Search engines show about 155 characters of a description.
function truncate(text, max = 155) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.–—-]+$/, "") + "…";
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const WEEKEND = new RegExp(`(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\\s+)?\\d{1,2}\\b.*?\\b(?:${MONTHS})\\s+\\d{4}`);

// Pulls a title, description, and share image out of a post. The weekend
// comes from the first heading with a date in it, like
// "## London, Saturday 10–Sunday 11 October 2026", and the description from
// the first proper paragraph after it.
function postMeta(post) {
  const lines = post.markdown.split("\n");
  const at = lines.findIndex((line) => /^#{1,3}\s/.test(line) && WEEKEND.test(line));
  const weekend = at >= 0 ? lines[at].match(WEEKEND)[0] : null;

  const paragraphs = lines.slice(Math.max(at, 0)).join("\n").split(/\n\s*\n/);
  const intro = paragraphs
    .map((p) => p.trim())
    .filter((p) => !/^([#*_[!>|-]|\d+\.)/.test(p))
    .map(plain)
    .find((p) => p.length >= 80);

  const photo = post.markdown.match(/!\[[^\]]*\]\(images\/([^)\s]+)\)/)?.[1];
  const card = photo && `posts/images/${post.date}-share.jpg`;
  const title = `Things to do in London, ${weekend ?? `week of ${prettyDate(post.date)}`}`;
  return {
    title,
    label: weekend ?? prettyDate(post.date),
    description: truncate(intro ?? title),
    photo: photo && `posts/images/${photo}`,
    card,
    image: card ? `${SITE}/${card}` : null,
    path: `posts/${post.date}/`,
  };
}

const jsonLd = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

function page({ title, description, path, root, body, image, type = "website", schema, noindex = false }) {
  const url = `${SITE}/${path}`;
  const fullTitle = path === "" ? title : `${title} · ${config.title}`;
  const meta = [
    `<title>${escape(fullTitle)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
    noindex ? `<meta name="robots" content="noindex">` : `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" type="application/rss+xml" title="${escape(config.title)}" href="${SITE}/feed.xml">`,
    `<meta property="og:site_name" content="${escape(config.title)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escape(title)}">`,
    `<meta property="og:description" content="${escape(description)}">`,
    `<meta property="og:url" content="${url}">`,
    image && `<meta property="og:image" content="${image}">`,
    image && `<meta property="og:image:width" content="${CARD.width}">`,
    image && `<meta property="og:image:height" content="${CARD.height}">`,
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    schema && `<script type="application/ld+json">${jsonLd(schema)}</script>`,
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${meta.join("\n")}
<link rel="stylesheet" href="${root}styles.css">
</head>
<body>
<header class="site-header">
  <a class="site-title" href="${root}">${escape(config.title)}</a>
  <p class="site-tagline">${escape(config.description)}</p>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <a href="${root}about/">About</a> · <a href="${root}#archive">Archive</a> · <a href="${root}feed.xml">RSS</a>
  <p class="disclaimer">This content is AI-generated.</p>
</footer>
</body>
</html>
`;
}

// Posts refer to photos as images/… (relative to posts/, so they also show on
// GitHub). The homepage and post pages sit at different depths, so point
// those paths at the site root.
function render(markdown, root) {
  const fixed = markdown.replace(/(!\[[^\]]*\]\()images\//g, `$1${root}posts/images/`);
  return marked.parse(fixed).replace(/<img /g, '<img loading="lazy" decoding="async" ');
}

function article(post, root) {
  return `<article>
  <time datetime="${post.date}">${prettyDate(post.date)}</time>
  <div class="content">
${render(post.markdown, root)}
  </div>
</article>`;
}

function archive(posts) {
  if (posts.length === 0) return "";
  const items = posts
    .map((p) => `<li><a href="${p.meta.path}">${escape(p.meta.label)}</a></li>`)
    .join("\n    ");
  return `<section id="archive" class="archive">
  <h2>Archive</h2>
  <ul>
    ${items}
  </ul>
</section>`;
}

function articleSchema(post) {
  const site = { "@type": "Organization", name: config.title, url: `${SITE}/` };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.meta.title,
    description: post.meta.description,
    datePublished: post.date,
    dateModified: post.date,
    url: `${SITE}/${post.meta.path}`,
    inLanguage: "en-GB",
    ...(post.meta.image && { image: [post.meta.image] }),
    author: site,
    publisher: site,
  };
}

function feed(posts) {
  const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
  const items = posts.slice(0, FEED_ITEMS).map(
    (post) => `  <item>
    <title>${escape(post.meta.title)}</title>
    <link>${SITE}/${post.meta.path}</link>
    <guid isPermaLink="true">${SITE}/${post.meta.path}</guid>
    <pubDate>${new Date(`${post.date}T08:00:00Z`).toUTCString()}</pubDate>
    <description>${cdata(render(post.markdown, `${SITE}/`))}</description>
  </item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escape(config.title)}</title>
  <link>${SITE}/</link>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${escape(config.summary)}</description>
  <language>en-GB</language>
${items.join("\n")}
</channel>
</rss>
`;
}

function sitemap(posts) {
  const urls = [
    { path: "", lastmod: posts[0]?.date },
    { path: "about/" },
    ...posts.map((p) => ({ path: p.meta.path, lastmod: p.date })),
  ];
  const entries = urls.map(
    ({ path, lastmod }) => `  <url><loc>${SITE}/${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

const files = (await readdir("posts")).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
const posts = await Promise.all(
  files.map(async (f) => ({
    date: f.slice(0, 10),
    markdown: await readFile(`posts/${f}`, "utf8"),
  })),
);
posts.sort((a, b) => b.date.localeCompare(a.date));
for (const post of posts) post.meta = postMeta(post);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyFile("scripts/styles.css", `${OUT}/styles.css`);
if (existsSync("posts/images")) await cp("posts/images", `${OUT}/posts/images`, { recursive: true });

// Link previews (WhatsApp, iMessage, social) are most reliable with a JPEG
// at 1200×630, so make one from each post's first photo.
for (const { meta } of posts) {
  if (!meta.card) continue;
  await sharp(meta.photo)
    .resize({ ...CARD, fit: "cover" })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(`${OUT}/${meta.card}`);
}

for (const post of posts) {
  await mkdir(`${OUT}/${post.meta.path}`, { recursive: true });
  await writeFile(
    `${OUT}/${post.meta.path}index.html`,
    page({
      ...post.meta,
      root: "../../",
      type: "article",
      schema: articleSchema(post),
      body: article(post, "../../"),
    }),
  );
}

const [latest] = posts;
await writeFile(
  `${OUT}/index.html`,
  page({
    title: `${config.title}: things to do in London this weekend`,
    description: config.summary,
    path: "",
    root: "",
    image: latest?.meta.image,
    schema: { "@context": "https://schema.org", "@type": "WebSite", name: config.title, url: `${SITE}/`, description: config.summary },
    body: latest
      ? article(latest, "") + "\n" + archive(posts)
      : `<p class="empty">Nothing here yet — the first one lands on Wednesday at 8am.</p>`,
  }),
);

const about = await readFile("about.md", "utf8");
await mkdir(`${OUT}/about`, { recursive: true });
await writeFile(
  `${OUT}/about/index.html`,
  page({
    title: "About",
    description: truncate(plain(about.replace(/^#.*$/gm, ""))),
    path: "about/",
    root: "../",
    body: `<article>\n  <div class="content">\n${render(about, "../")}\n  </div>\n</article>`,
  }),
);

// GitHub Pages serves this for any missing URL, at any depth, so links are
// absolute.
await writeFile(
  `${OUT}/404.html`,
  page({
    title: "Page not found",
    description: config.summary,
    path: "404.html",
    root: "/",
    noindex: true,
    body: `<article>\n  <div class="content">\n<h1>Page not found</h1>\n<p>This page has gone the way of Dojo. <a href="/">Here's this week's issue instead.</a></p>\n  </div>\n</article>`,
  }),
);

await writeFile(`${OUT}/feed.xml`, feed(posts));
await writeFile(`${OUT}/sitemap.xml`, sitemap(posts));
await writeFile(`${OUT}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`Built ${posts.length} post(s) into ${OUT}/`);
