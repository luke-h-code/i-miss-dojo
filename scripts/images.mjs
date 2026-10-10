// Picks a handful of photos for a finished issue.
//
// 1. Finds each pick (a ### heading) and the pages it links to.
// 2. Collects candidate photos from those pages: the share image first, then
//    other images on the page.
// 3. Drops obvious junk without AI: too small, odd shapes, logos, duplicates,
//    files that won't load.
// 4. Shows the rest to the AI with image-criteria.md and keeps photos that
//    score MIN_SCORE or more, at most one per pick.
// 5. Goes back for more candidates until it has TARGET photos or runs out of
//    rounds. If nothing has passed by then, it tries a few extra rounds before
//    giving up and leaving the issue without photos.
//
// Chosen photos are saved to posts/images/ and placed under their pick's
// heading, linking to the page they came from.
//
// Run on an existing post:  npm run images -- posts/YYYY-MM-DD.md

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { respond } from "./openai.mjs";

const TARGET = 4; // photos per issue, at most
const MIN_SCORE = 7; // out of 10
const ROUNDS = 3; // rounds spent trying to reach TARGET
const EXTRA_ROUNDS = 2; // further rounds if nothing has passed yet
const PER_ROUND = [1, 2, 2, 3, 3]; // new candidates per pick, by round
const PAGES_PER_PICK = 3;
const CANDIDATES_PER_PICK = 10;
const MIN_WIDTH = 800;
const ASPECT = [0.6, 2.2]; // width / height
const MAX_BYTES = 3_000_000;
const BATCH = 6; // photos per AI call
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT = "Mozilla/5.0 (compatible; i-miss-dojo/1.0; +https://github.com/luke-h-code/i-miss-dojo)";
const SKIP_URL = /^data:|\.(svg|gif|ico)(\?|$)|logo|icon|sprite|favicon|avatar|placeholder|spacer|pixel|badge/i;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "score", "reason", "alt"],
        properties: {
          id: { type: "string" },
          score: { type: "integer" },
          reason: { type: "string" },
          alt: { type: "string" },
        },
      },
    },
  },
};

export async function addImages(markdown, date, judge = judgeWithAI) {
  const lines = markdown.split("\n");
  const picks = findPicks(lines);
  if (picks.length === 0) {
    console.log("Photos: no picks with links, skipping.");
    return markdown;
  }

  console.log(`Photos: collecting candidates for ${picks.length} picks…`);
  const seenUrls = new Set();
  const pages = await Promise.all(picks.map((pick) => Promise.all(pick.pages.map(fetchPage))));
  picks.forEach((pick, i) => {
    const found = pages[i];
    pick.queue = [];
    const all = [
      ...found.flatMap((p, j) => p.share.map((url) => ({ url, page: pick.pages[j] }))),
      ...found.flatMap((p, j) => p.inline.map((url) => ({ url, page: pick.pages[j] }))),
    ];
    for (const candidate of all) {
      if (pick.queue.length === CANDIDATES_PER_PICK) break;
      if (seenUrls.has(candidate.url)) continue;
      seenUrls.add(candidate.url);
      pick.queue.push(candidate);
    }
  });

  const seenHashes = new Set();
  const winners = new Map();
  let nextId = 1;
  for (let round = 0; round < ROUNDS + EXTRA_ROUNDS; round++) {
    if (winners.size >= TARGET || (round >= ROUNDS && winners.size > 0)) break;

    const waiting = picks.filter((pick) => !winners.has(pick));
    const batch = (await Promise.all(waiting.map((pick) => nextPhotos(pick, PER_ROUND[round], seenHashes)))).flat();
    if (batch.length === 0) break;
    for (const photo of batch) photo.id = `p${nextId++}`;

    console.log(`Photos round ${round + 1}: judging ${batch.length}…`);
    const verdicts = await judge(batch);
    for (const photo of batch) {
      const v = verdicts.get(photo.id);
      const score = Math.max(0, Math.min(10, v?.score ?? 0));
      const pass = score >= MIN_SCORE;
      console.log(`  ${pass ? "✓" : "✗"} ${score}/10 ${photo.pick.heading}: ${v?.reason ?? "no verdict"} (${photo.url})`);
      if (pass && score > (winners.get(photo.pick)?.score ?? -1)) {
        winners.set(photo.pick, { ...photo, score, alt: v.alt });
      }
    }
  }

  const chosen = choose([...winners.values()]);
  if (chosen.length === 0) {
    console.log("Photos: nothing good enough this week, moving on.");
    return markdown;
  }

  await mkdir("posts/images", { recursive: true });
  for (const [n, photo] of chosen.entries()) {
    const file = `${date}-${n + 1}.${photo.ext}`;
    await writeFile(`posts/images/${file}`, photo.bytes);
    const alt = photo.alt.replace(/[[\]\n]/g, " ").trim();
    photo.markdown = `[![${alt}](images/${file})](${photo.page})`;
  }
  // Insert from the bottom up so earlier line numbers stay valid.
  for (const photo of [...chosen].reverse()) {
    lines.splice(insertAt(lines, photo.pick), 0, "", photo.markdown);
  }
  console.log(`Photos: added ${chosen.length}.`);
  return lines.join("\n");
}

// Each ### heading that links somewhere is a pick. A pick runs until the next
// heading or horizontal rule.
function findPicks(lines) {
  const picks = [];
  let section = "";
  let pick = null;
  const close = () => {
    if (pick?.pages.length) picks.push(pick);
    pick = null;
  };

  lines.forEach((line, i) => {
    if (/^##\s/.test(line)) {
      close();
      section = line.replace(/^##\s+/, "").trim();
    } else if (/^###\s/.test(line)) {
      close();
      pick = { heading: line.replace(/^###\s+/, "").trim(), section, line: i, text: "", pages: [] };
    } else if (/^#\s|^---\s*$/.test(line)) {
      close();
    } else if (pick) {
      pick.text += line + " ";
      for (const [, url] of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
        const clean = cleanUrl(url);
        if (clean && !pick.pages.includes(clean) && pick.pages.length < PAGES_PER_PICK) pick.pages.push(clean);
      }
    }
  });
  close();
  return picks;
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return { share: [], inline: [] };
    return pageImages(await res.text(), res.url);
  } catch {
    return { share: [], inline: [] };
  }
}

// The share image (og:image / twitter:image) is the one the venue picked to
// represent the page, so it goes first. Other <img>s are the fallback.
function pageImages(html, base) {
  const resolve = (src) => {
    try {
      const url = new URL(src.trim(), base).toString();
      return SKIP_URL.test(url) ? [] : [url];
    } catch {
      return [];
    }
  };

  const share = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(tag, "property") ?? attr(tag, "name") ?? "";
    const content = attr(tag, "content");
    if (content && /^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/i.test(key)) share.push(...resolve(content));
  }

  const inline = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = largest(attr(tag, "srcset") ?? attr(tag, "data-srcset")) ?? attr(tag, "data-src") ?? attr(tag, "src");
    if (src) inline.push(...resolve(src));
  }

  return { share: [...new Set(share)], inline: [...new Set(inline)] };
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, "&").replace(/&#0?38;/g, "&");
}

// Picks the widest entry from a srcset like "a.jpg 400w, b.jpg 1200w".
function largest(srcset) {
  if (!srcset) return null;
  let best = null;
  for (const [, url, w] of srcset.matchAll(/(\S+)\s+(\d+)w/g)) {
    if (!best || Number(w) > best.w) best = { url: url.replace(/^,/, ""), w: Number(w) };
  }
  return best?.url ?? null;
}

// Pulls candidates off a pick's queue until `count` have passed the checks.
async function nextPhotos(pick, count, seenHashes) {
  const passed = [];
  while (passed.length < count && pick.queue.length > 0) {
    const { url, page } = pick.queue.shift();
    const photo = await download(url);
    if (photo.reject) {
      console.log(`  skip ${photo.reject}: ${url}`);
    } else if (seenHashes.has(photo.hash)) {
      console.log(`  skip duplicate: ${url}`);
    } else {
      seenHashes.add(photo.hash);
      passed.push({ ...photo, url, page, pick });
    }
  }
  return passed;
}

async function download(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return { reject: `HTTP ${res.status}` };
    if (Number(res.headers.get("content-length")) > MAX_BYTES) return { reject: "too big" };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { reject: "too big" };
    const size = imageSize(bytes);
    if (!size) return { reject: "not a JPEG, PNG or WebP" };
    if (size.width < MIN_WIDTH) return { reject: `too small (${size.width}×${size.height})` };
    const ratio = size.width / size.height;
    if (ratio < ASPECT[0] || ratio > ASPECT[1]) return { reject: `odd shape (${size.width}×${size.height})` };
    return { ...size, bytes, hash: createHash("sha256").update(bytes).digest("hex") };
  } catch (err) {
    return { reject: err.name === "TimeoutError" ? "timed out" : "failed to load" };
  }
}

// Reads width and height from the file header, so no image library is needed.
function imageSize(b) {
  if (b.length < 30) return null;

  if (b.readUInt32BE(0) === 0x89504e47) {
    return { ext: "png", mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start-of-frame markers hold the dimensions. C4, C8 and CC are not frames.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { ext: "jpg", mime: "image/jpeg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }

  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const webp = (width, height) => ({ ext: "webp", mime: "image/webp", width, height });
    switch (b.toString("ascii", 12, 16)) {
      case "VP8 ":
        return webp(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
      case "VP8L": {
        const bits = b.readUInt32LE(21);
        return webp((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      case "VP8X":
        return webp(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
    }
  }
  return null;
}

async function judgeWithAI(photos) {
  const criteria = (await readFile("image-criteria.md", "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim();
  const verdicts = new Map();

  for (let i = 0; i < photos.length; i += BATCH) {
    const content = [
      {
        type: "input_text",
        text: `${criteria}\n\nPhotos scoring ${MIN_SCORE} or more get published. For every photo below, give its id, a score, a one-line reason, and short alt text describing the photo for screen readers.`,
      },
    ];
    for (const photo of photos.slice(i, i + BATCH)) {
      const excerpt = photo.pick.text.replace(/\]\([^)]*\)/g, "]").replace(/\s+/g, " ").trim().slice(0, 300);
      content.push(
        { type: "input_text", text: `Photo ${photo.id}, for "${photo.pick.heading}" in "${photo.pick.section}": ${excerpt}` },
        { type: "input_image", image_url: `data:${photo.mime};base64,${photo.bytes.toString("base64")}` },
      );
    }

    const reply = await respond({
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "photo_scores", strict: true, schema: SCHEMA } },
    });
    for (const v of JSON.parse(reply).photos) verdicts.set(v.id, v);
  }
  return verdicts;
}

// Best photos first, one per section before doubling up on any section.
function choose(winners) {
  const ranked = winners.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const w of ranked) {
    if (chosen.length < TARGET && !chosen.some((c) => c.pick.section === w.pick.section)) chosen.push(w);
  }
  for (const w of ranked) {
    if (chosen.length < TARGET && !chosen.includes(w)) chosen.push(w);
  }
  return chosen.sort((a, b) => a.pick.line - b.pick.line);
}

// Under the heading, or under the bold venue line if there is one.
function insertAt(lines, pick) {
  let i = pick.line + 1;
  while (i < lines.length && !lines[i].trim()) i++;
  return /^\*\*[^*].*\*\*\s*$/.test(lines[i] ?? "") ? i + 1 : pick.line + 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const date = basename(file ?? "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) {
    console.error("Usage: npm run images -- posts/YYYY-MM-DD.md");
    process.exit(1);
  }
  const markdown = await readFile(file, "utf8");
  if (/!\[[^\]]*\]\(images\//.test(markdown)) {
    console.log(`${file} already has photos.`);
  } else {
    await writeFile(file, (await addImages(markdown.trimEnd(), date)) + "\n");
  }
}
