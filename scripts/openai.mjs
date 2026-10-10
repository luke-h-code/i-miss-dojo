// Minimal OpenAI Responses API client shared by the writer and the picture
// editor.
//
// Env:
//   OPENAI_API_KEY  required
//   OPENAI_MODEL    optional, defaults to DEFAULT_MODEL

export const DEFAULT_MODEL = "gpt-6-astra";
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 40 * 60_000;

export const model = () => process.env.OPENAI_MODEL || DEFAULT_MODEL;

async function openai(path, init = {}) {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`OpenAI API ${res.status}: ${body.error?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

// Sends a Responses API request and returns the reply text. Runs in
// background mode and polls, because web research can take longer than a
// single HTTP request will stay open.
export async function respond(request) {
  let response = await openai("/responses", {
    method: "POST",
    body: JSON.stringify({ model: model(), ...request, background: true }),
  });

  const started = Date.now();
  while (response.status === "queued" || response.status === "in_progress") {
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`Timed out waiting for ${response.id}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    response = await openai(`/responses/${response.id}`);
    console.log(`  ${response.status} (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  if (response.status !== "completed") {
    throw new Error(`Response ${response.id} ${response.status}: ${JSON.stringify(response.error ?? response.incomplete_details)}`);
  }

  const text = response.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("\n\n")
    .trim();
  if (!text) throw new Error(`OpenAI returned no text: ${JSON.stringify(response)}`);
  return text;
}
