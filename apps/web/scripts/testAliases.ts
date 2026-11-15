// The web app's import aliases for `node --test`, as tsconfig.json and vite.config.ts map them, so
// tests can reach code copied from T3 Code, whose imports use `~/` and `@t3tools/*` and leave off
// file extensions. Tests only: Vite resolves these in the app.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^~\/(.*)$/, `${src}$1`],
  [/^@t3tools\/contracts(\/settings)?$/, `${src}lib/t3codeContracts.ts`],
  [/^@t3tools\/shared\/(.*)$/, `${src}t3tools/shared/$1`],
  [/^@t3tools\/client-runtime\/composer-model-mentions$/, `${src}t3tools/client-runtime/composerModelMentions.ts`],
  [/^@t3tools\/client-runtime\/(.*)$/, `${src}t3tools/client-runtime/$1`],
];

// A path as written, or with `.ts` added, the way the bundler finds an extensionless import.
const existing = (path: string) => [path, `${path}.ts`].find((candidate) => existsSync(candidate) && !candidate.endsWith("/"));

registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [pattern, target] of ALIASES) {
      if (!pattern.test(specifier)) continue;
      const path = existing(specifier.replace(pattern, target));
      if (path) return nextResolve(pathToFileURL(path).href, context);
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith(pathToFileURL(src).href)) {
      const path = existing(fileURLToPath(new URL(specifier, context.parentURL)));
      if (path) return nextResolve(pathToFileURL(path).href, context);
    }
    return nextResolve(specifier, context);
  },
});
