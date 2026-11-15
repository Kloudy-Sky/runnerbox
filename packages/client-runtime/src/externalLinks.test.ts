import assert from "node:assert/strict";
import { test } from "node:test";
import { opensInBrowser } from "./externalLinks.ts";

test("only https links to github.com leave the app for the browser", () => {
  assert.equal(opensInBrowser("https://github.com/owner/name/actions/runs/5217"), true);
  for (const url of ["http://github.com/owner/name", "https://github.com.example.net/x", "https://example.net/?github.com", "https://user@github.com/x", "file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
    assert.equal(opensInBrowser(url), false, url);
  }
});
