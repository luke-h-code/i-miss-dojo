import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, beforeEach, afterEach } from "node:test";
import { respond, MODEL, EFFORT } from "../scripts/claude.mjs";

let directory, original;
beforeEach(async () => {
  original = { ...process.env };
  directory = await mkdtemp(join(tmpdir(), "dojo-claude-test-"));
  const executable = join(directory, "claude");
  await writeFile(executable, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({args,input,apiKey:process.env.ANTHROPIC_API_KEY}));
if (args.includes('--allowedTools') && process.env.FAKE_MODE !== 'no-search') {
  console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'WebSearch',id:'search-1'}]}}));
}
const result = {type:'result',subtype:'success',result:'# Finished issue',usage:{input_tokens:100,output_tokens:10}};
if (args.includes('--json-schema') && process.env.FAKE_MODE !== 'no-schema') result.structured_output={photos:[{id:'p1',score:8,reason:'Good',alt:'Museum room'}]};
if (process.env.FAKE_MODE === 'error') result.is_error=true;
console.log(JSON.stringify(result));
`, { mode: 0o755 });
  process.env.CLAUDE_CODE_BIN = executable;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-subscription-token";
  process.env.FAKE_CAPTURE = join(directory, "capture.json");
  delete process.env.FAKE_MODE;
});
afterEach(async () => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  await rm(directory, { recursive: true, force: true });
});

const capture = async () => JSON.parse(await readFile(process.env.FAKE_CAPTURE, "utf8"));

test("writer uses Sonnet 5.5 xhigh, subscription auth and live-search tools", async () => {
  process.env.ANTHROPIC_API_KEY = "must-not-use-this-key";
  assert.equal(await respond({ prompt: "Original newsletter prompt", research: true }), "# Finished issue");
  const sent = await capture();
  assert.equal(sent.args[sent.args.indexOf("--model") + 1], MODEL);
  assert.equal(MODEL, "claude-sonnet-5-5");
  assert.equal(sent.args[sent.args.indexOf("--effort") + 1], EFFORT);
  assert.equal(EFFORT, "xhigh");
  assert.equal(sent.args[sent.args.indexOf("--allowedTools") + 1], "WebSearch,WebFetch");
  assert.equal(sent.input.message.content[0].text, "Original newsletter prompt");
  assert.equal(sent.apiKey, "");
});

test("photo scoring sends actual image blocks and returns validated structured data", async () => {
  const content = [{ type: "text", text: "Score the photo" },
    { type: "image", source: { type: "base64", media_type: "image/webp", data: "image-bytes" } }];
  const schema = { type: "object", properties: { photos: { type: "array" } }, required: ["photos"] };
  const result = JSON.parse(await respond({ content, schema }));
  assert.equal(result.photos[0].score, 8);
  const sent = await capture();
  assert.deepEqual(sent.input.message.content, content);
  assert.deepEqual(JSON.parse(sent.args[sent.args.indexOf("--json-schema") + 1]), schema);
});

test("missing subscription token fails before launching Claude", async () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  await assert.rejects(respond({ prompt: "test" }), /CLAUDE_CODE_OAUTH_TOKEN is not set/);
});

test("research without a web search is rejected", async () => {
  process.env.FAKE_MODE = "no-search";
  await assert.rejects(respond({ prompt: "Research", research: true }), /did not use web search/);
});

test("failed Claude result is rejected rather than published", async () => {
  process.env.FAKE_MODE = "error";
  await assert.rejects(respond({ prompt: "test" }), /Claude Code failed/);
});

test("photo scoring cannot silently fall back to unstructured text", async () => {
  process.env.FAKE_MODE = "no-schema";
  await assert.rejects(respond({ prompt: "test", schema: { type: "object" } }), /no structured output/);
});
