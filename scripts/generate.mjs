// Sends prompt.md to the OpenAI API and saves the reply as posts/YYYY-MM-DD.md.
//
// Runs from GitHub Actions on Wednesdays. GitHub cron only speaks UTC, so the
// workflow fires at both 07:00 and 08:00 UTC and this script decides whether
// it's actually Wednesday 8am (or later) in London — that covers GMT and BST.
//
// Env:
//   OPENAI_API_KEY  required
//   OPENAI_MODEL    optional, defaults to DEFAULT_MODEL
//   FORCE=true      skip the day/time check (manual runs)

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const DEFAULT_MODEL = "gpt-5";
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

async function askOpenAI(prompt, model) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: prompt }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${body.error?.message ?? JSON.stringify(body)}`);
  }
  const text = body.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n\n")
    .trim();
  if (!text) throw new Error(`OpenAI returned no text: ${JSON.stringify(body)}`);
  return text;
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

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  console.log(`Generating ${file} with ${model}…`);
  const text = await askOpenAI(await loadPrompt(), model);

  await mkdir("posts", { recursive: true });
  await writeFile(file, text + "\n");
  console.log(`Wrote ${file}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
