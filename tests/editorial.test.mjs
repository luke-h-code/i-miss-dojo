import test from "node:test";
import assert from "node:assert/strict";
import { featuredPicks, tidyMarkdown } from "../scripts/editorial.mjs";

test("recent-pick context keeps numbered names and venue details, not features or blurbs", () => {
  const picks = featuredPicks(`### 1. Chocolate fair\n**Fidelio Cafe, Farringdon**\n\nA long blurb.\n### 2. 3 Evenings, Wapping\nBlurb.\n\n**Saturday 17, 6pm.** Wapping Hydraulic Power Station. £25.\n## Dating 101\n### A gallery date\nAdvice.\n`);
  assert.deepEqual(picks, ["Chocolate fair — Fidelio Cafe, Farringdon", "3 Evenings, Wapping — Saturday 17, 6pm. Wapping Hydraulic Power Station. £25."]);
});

test("cleanup removes citation clutter and tracking while preserving CTA query and fragment", () => {
  assert.equal(tidyMarkdown("A gag.\n\n# The Tip\n\nA blurb. ([venue.org](https://venue.org/event?utm_source=openai))\n\n[Book](https://venue.org/event?id=123&utm_source=openai#tickets)"),
    "*A gag.*\n\n# The Tip\n\nA blurb.\n\n[Book](https://venue.org/event?id=123#tickets)");
});

test("cleanup leaves linked images, other queries, and existing italic preheaders intact", () => {
  const text = "*Already italic.*\n\n# the tip\n\n[![Photo](images/photo.webp)](https://venue.org/CaseSensitive?id=1)";
  assert.equal(tidyMarkdown(text), text);
});
