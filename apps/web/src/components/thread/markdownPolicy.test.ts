import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { markdownOptions } from "./markdownPolicy.ts";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, markdownOptions, text));

test("a message can't load anything, run anything or link anywhere the app wouldn't open", () => {
  const html = render(
    [
      "Rerun it [on GitHub](https://github.com/owner/name/actions/runs/5217).",
      "Or [here](https://example.com/steal) or [this](javascript:alert(1)).",
      "![VM memory](https://example.com/track.png)",
      '<img src="https://example.com/x.png" onerror="alert(1)"><script>alert(1)</script>',
    ].join("\n\n"),
  );
  assert.match(html, /<a href="https:\/\/github.com\/owner\/name\/actions\/runs\/5217" target="_blank" rel="noreferrer noopener"/);
  assert.equal((html.match(/<a /g) ?? []).length, 1, "only the GitHub link is a link");
  assert.match(html, /here \(https:\/\/example.com\/steal\)/);
  assert.ok(!/<img|<script|onerror/.test(html), "no image or raw HTML survives");
  assert.match(html, /\[VM memory\]/);
  // A link with nothing worth showing gets no address: a blanked unsafe one, a footnote, `www.` text.
  assert.ok(!html.includes("this ("), html);
  const extras = render("Note[^1] and www.example.com.\n\n[^1]: a run");
  assert.ok(!/\(#|\(http:\/\/www/.test(extras), extras);
});

test("what the composer writes renders: bold, code, lists, strikethrough and tasks", () => {
  const html = render("Is it the **VM** or `ci / test`?\n\n- memory\n- ~~retry~~\n- [ ] check");
  for (const piece of ["<strong>VM</strong>", "<code>ci / test</code>", "<li>memory</li>", "<del>retry</del>", 'type="checkbox"']) assert.ok(html.includes(piece), piece);
});
