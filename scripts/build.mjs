// Renders posts/*.md into a static site in _site/.
//   _site/index.html              latest post + archive
//   _site/posts/YYYY-MM-DD/       one page per post

import { readdir, readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { marked } from "marked";

const OUT = "_site";
const config = JSON.parse(await readFile("site.config.json", "utf8"));

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

function page({ title, body, root }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(config.description)}">
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
  <a href="${root}#archive">Archive</a>
  <p class="disclaimer">This content is AI-generated.</p>
</footer>
</body>
</html>
`;
}

function article(post) {
  return `<article>
  <time datetime="${post.date}">${prettyDate(post.date)}</time>
  <div class="content">
${marked.parse(post.markdown)}
  </div>
</article>`;
}

function archive(posts) {
  if (posts.length === 0) return "";
  const items = posts
    .map((p) => `<li><a href="posts/${p.date}/">${prettyDate(p.date)}</a></li>`)
    .join("\n    ");
  return `<section id="archive" class="archive">
  <h2>Archive</h2>
  <ul>
    ${items}
  </ul>
</section>`;
}

const files = (await readdir("posts")).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
const posts = await Promise.all(
  files.map(async (f) => ({
    date: f.slice(0, 10),
    markdown: await readFile(`posts/${f}`, "utf8"),
  })),
);
posts.sort((a, b) => b.date.localeCompare(a.date));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyFile("scripts/styles.css", `${OUT}/styles.css`);

for (const post of posts) {
  await mkdir(`${OUT}/posts/${post.date}`, { recursive: true });
  await writeFile(
    `${OUT}/posts/${post.date}/index.html`,
    page({ title: `${prettyDate(post.date)} · ${config.title}`, body: article(post), root: "../../" }),
  );
}

const [latest] = posts;
const home = latest
  ? article(latest) + "\n" + archive(posts)
  : `<p class="empty">Nothing here yet — the first one lands on Wednesday at 8am.</p>`;
await writeFile(`${OUT}/index.html`, page({ title: config.title, body: home, root: "" }));

console.log(`Built ${posts.length} post(s) into ${OUT}/`);
