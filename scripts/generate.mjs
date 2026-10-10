// Sends prompt.md to the OpenAI API and saves the reply as posts/YYYY-MM-DD.md,
// with a few photos picked by scripts/images.mjs.
//
// Runs from GitHub Actions on Wednesdays. GitHub cron only speaks UTC, so the
// workflow fires at both 07:00 and 08:00 UTC and this script decides whether
// it's actually Wednesday 8am (or later) in London — that covers GMT and BST.
//
// Env:
//   OPENAI_API_KEY  required
//   OPENAI_MODEL    optional, see scripts/openai.mjs
//   FORCE=true      skip the day/time check (manual runs)

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { model, respond } from "./openai.mjs";
import { addImages } from "./images.mjs";

const TZ = "Europe/London";

function londonNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    hour: Number(parts.hour),
  };
}

async function loadPrompt() {
  const raw = await readFile("prompt.md", "utf8");
  const prompt = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!prompt) throw new Error("prompt.md is empty");
  return prompt;
}

// Context the model can't know on its own: today's date, and that the reply
// goes straight onto the website.
function preamble(now) {
  return [
    `Today is ${now.weekday} ${now.date} (London time).`,
    "Your reply is published unedited on a website as Markdown. Output only the finished piece in Markdown, with no preamble, no questions, no notes to the editor.",
  ].join("\n");
}

async function main() {
  const force = process.env.FORCE === "true";
  const now = londonNow();
  const file = `posts/${now.date}.md`;

  if (!force && (now.weekday !== "Wednesday" || now.hour < 8)) {
    console.log(`Not time yet (${now.weekday} ${now.hour}:00 London). Skipping.`);
    return;
  }
  if (existsSync(file)) {
    console.log(`${file} already exists. Skipping.`);
    return;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");

  console.log(`Generating ${file} with ${model()}…`);
  let text = await respond({
    input: `${preamble(now)}\n\n${await loadPrompt()}`,
    tools: [{ type: "web_search" }],
  });

  // Photos are a bonus. If anything goes wrong, publish without them.
  try {
    text = await addImages(text, now.date);
  } catch (err) {
    console.error(`Skipping photos: ${err.message}`);
  }

  await mkdir("posts", { recursive: true });
  await writeFile(file, text + "\n");
  console.log(`Wrote ${file}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
