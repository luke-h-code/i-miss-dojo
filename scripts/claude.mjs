// Claude Code CLI client. Uses the subscription OAuth token, not an API key.
import { spawn } from "node:child_process";

export const MODEL = "claude-sonnet-5-5";
export const EFFORT = "xhigh";
const TIMEOUT_MS = 40 * 60_000;

export async function respond({ prompt, content, schema, research = false }) {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error("CLAUDE_CODE_OAUTH_TOKEN is not set");
  const args = ["-p", "--model", MODEL, "--effort", EFFORT,
    "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
  if (research) args.push("--allowedTools", "WebSearch,WebFetch");
  if (schema) args.push("--json-schema", JSON.stringify(schema));
  const input = { type: "user", message: { role: "user", content: content ?? [{ type: "text", text: prompt }] } };

  return new Promise((resolve, reject) => {
    const child = spawn(process.env.CLAUDE_CODE_BIN || "claude", args, {
      env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", () => {}); // Early CLI exit is reported by close/error.
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      try {
        if (timedOut) throw new Error("Claude Code timed out");
        const messages = stdout.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
        const result = messages.findLast((message) => message.type === "result");
        if (code !== 0 || result?.subtype !== "success" || result.is_error) {
          throw new Error(`Claude Code failed: ${result?.result || stderr.trim() || `exit ${code}`}`);
        }
        if (research && !messages.some((message) => message.message?.content?.some?.(
          (block) => block.type === "tool_use" && block.name === "WebSearch"))) {
          throw new Error("Claude did not use web search for this issue");
        }
        console.log(`Claude ${MODEL} (${EFFORT}) usage: ${JSON.stringify(result.usage ?? {})}`);
        if (schema) {
          if (!result.structured_output) throw new Error("Claude returned no structured output");
          resolve(JSON.stringify(result.structured_output));
        } else {
          const text = result.result?.trim();
          if (!text) throw new Error("Claude returned no text");
          resolve(text);
        }
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(input) + "\n");
  });
}
