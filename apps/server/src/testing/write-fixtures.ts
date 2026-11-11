// Writes fixture logs for running the server and app by hand:
//   node apps/server/src/testing/write-fixtures.ts <dir>
// then start the server with XDG_STATE_HOME=<dir>. The logs land in <dir>/runnerbox.
import { join, resolve } from "node:path";
import { writeFixtures } from "./fixtures.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node apps/server/src/testing/write-fixtures.ts <dir>");
  process.exit(2);
}
const dir = join(resolve(target), "runnerbox");
await writeFixtures(dir, Date.now());
console.log(`Wrote fixtures to ${dir}. Run the server with XDG_STATE_HOME=${resolve(target)}.`);
