import { opensInBrowser } from "@runnerbox/client-runtime";
import { createElement, type ReactNode } from "react";
import type { Components, Options } from "react-markdown";
import remarkGfm from "remark-gfm";

// What a message's Markdown may do. The agent's text is untrusted input, so nothing in a message
// reaches past what the app allows: raw HTML is dropped, an image shows as its description and is
// never fetched, and a link is a link only where the app would open it (a GitHub page, in the
// system browser); any other shows as text, with its address when the text doesn't already.

const asText = (href: string | undefined, children: ReactNode) =>
  createElement("span", null, children, href !== undefined && children !== href ? ` (${href})` : null);

const components: Components = {
  a: ({ href, children }) =>
    href !== undefined && opensInBrowser(href)
      ? createElement("a", { href, target: "_blank", rel: "noreferrer noopener", className: "underline underline-offset-4" }, children)
      : asText(href, children),
  img: ({ alt }) => (alt ? createElement("span", null, `[${alt}]`) : null),
};

export const markdownOptions = { remarkPlugins: [remarkGfm], skipHtml: true, components } satisfies Options;
