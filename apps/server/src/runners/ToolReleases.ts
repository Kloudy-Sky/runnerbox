import type { ImageTool } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { createGitHubReader } from "../github/githubReader.ts";
import { QueueConfig } from "./QueueConfig.ts";

// The tools whose releases are looked up, by the name the image probe gives them, and the repo
// that publishes them. A fixed list in this code: nothing else is ever requested. Node is left out:
// its long-term-support lines make the newest release the wrong measure of a current one.
const TOOLS: Record<string, string> = { gh: "cli/cli", runner: "actions/runner" };
const DAY_MS = 86_400_000;
const VERSION = /^\d+(?:\.\d+){1,3}$/;

const Release = Schema.Struct({ tag_name: Schema.String, published_at: Schema.NullOr(Schema.String) });
type Known = { version: string; releasedAt: string } | null;

// When each tool's installed and newest versions were released, looked up on GitHub with the
// queue's token and kept for a day. It's filled only from the queue poll, so only while someone
// watches; until then a tool simply has no dates.
export class ToolReleases extends Context.Service<
  ToolReleases,
  {
    readonly refresh: (token: string, tools: ReadonlyArray<ImageTool>) => Effect.Effect<void>;
    // A function that gives tools the dates known for them now.
    readonly known: Effect.Effect<(tools: ReadonlyArray<ImageTool>) => ReadonlyArray<ImageTool>>;
  }
>()("runnerbox/server/ToolReleases") {}

const make = Effect.gen(function* () {
  const config = yield* QueueConfig;
  // Its own reader, so the queue's pruning never drops these few cached replies.
  const github = createGitHubReader(config.apiBase);
  const cache = yield* Ref.make(new Map<string, { at: number; value: Known }>());

  const release = (path: string, token: string) =>
    Effect.promise(() => github.get(path, token)).pipe(
      Effect.map((reply): Known => {
        if (reply.kind !== "ok") return null;
        return Option.match(Schema.decodeUnknownOption(Release)(reply.body), {
          onNone: () => null,
          onSome: ({ tag_name, published_at }) => (published_at && VERSION.test(tag_name.replace(/^v/, "")) ? { version: tag_name.replace(/^v/, ""), releasedAt: published_at } : null),
        });
      }),
    );

  // Looks up what's missing or a day old: one request for each tool's newest release, and one for
  // each installed version's own.
  const refresh = Effect.fn("ToolReleases.refresh")(function* (token: string, tools: ReadonlyArray<ImageTool>) {
    const now = yield* Clock.currentTimeMillis;
    const known = yield* Ref.get(cache);
    const wanted = tools.flatMap((tool) => {
      const repo = TOOLS[tool.name];
      if (!repo) return [];
      const latest = { key: `${repo}@latest`, path: `repos/${repo}/releases/latest` };
      const installed = tool.version && VERSION.test(tool.version) ? [{ key: `${repo}@${tool.version}`, path: `repos/${repo}/releases/tags/v${tool.version}` }] : [];
      return [latest, ...installed];
    });
    for (const { key, path } of new Map(wanted.map((each) => [each.key, each])).values()) {
      const entry = known.get(key);
      if (entry && now - entry.at < DAY_MS) continue;
      const value = yield* release(path, token);
      yield* Ref.update(cache, (map) => new Map(map).set(key, { at: now, value }));
    }
  });

  // The tools with the dates known for them. A tool off the list, or not looked up yet, is unchanged.
  const known = Ref.get(cache).pipe(
    Effect.map((cached) => (tools: ReadonlyArray<ImageTool>) =>
      tools.map((tool) => {
        const repo = TOOLS[tool.name];
        if (!repo || !tool.version) return tool;
        const newest = cached.get(`${repo}@latest`)?.value ?? null;
        const installed = cached.get(`${repo}@${tool.version}`)?.value ?? null;
        return newest || installed ? { ...tool, releasedAt: installed?.releasedAt ?? null, newest } : tool;
      }),
    ),
  );

  return ToolReleases.of({ refresh, known });
});

export const layer = Layer.effect(ToolReleases, make);
