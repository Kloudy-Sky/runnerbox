import { shellQuote } from "../launcher/docker-command.ts";

// The tools a job is most likely to call, in the order the UI shows them. The same list for every
// project, so a project names nothing here. Node is also looked for in the tool cache, where the
// base image keeps it off PATH for actions/setup-node.
const PROBE_SCRIPT = `
v() { l=$1; shift; printf '%s\\t%s\\n' "$l" "$("$@" 2>/dev/null | head -n 1)"; }
. /etc/os-release 2>/dev/null; printf 'os\\t%s\\nosversion\\t%s\\n' "\${NAME:-}" "\${VERSION_ID:-}"
if command -v node >/dev/null 2>&1; then v node node --version; else printf 'node\\t%s\\n' "$(ls /opt/hostedtoolcache/node 2>/dev/null | sort -V | tail -n 1)"; fi
v gh gh --version
v git git --version
v docker docker --version
v python python3 --version
v aws aws --version
v runner /home/runner/bin/Runner.Listener --version
`;

const TOOLS = ["node", "gh", "git", "docker", "python", "aws", "runner"] as const;

export type Tool = { name: string; version: string | null };

// One SSH command: when the image was built, then the probe in a throwaway container with no
// network, mounts, registration or token, so the image can only report on itself.
export const probeCommand = (tag: string) =>
  [
    `docker image inspect -f '{{.Created}}' ${shellQuote(tag)}`,
    `docker run --rm --network none --memory 256m --pids-limit 64 --entrypoint /bin/sh ${shellQuote(tag)} -c ${shellQuote(PROBE_SCRIPT)}`,
  ].join(" && ");

const version = (text: string) => /\d+(?:\.\d+)+/.exec(text)?.[0].slice(0, 40) ?? null;

// Reads what `probeCommand` printed. The image wrote all of it, so every field is cut short and
// only the known tools are kept. The OS comes first, named as the image names it.
export function parseProbe(output: string) {
  const [created = "", ...lines] = output.split("\n");
  const at = Date.parse(created.trim().replace(/(\.\d{3})\d+/, "$1"));
  const fields = new Map(lines.map((line) => line.split("\t", 2)).filter((pair): pair is [string, string] => pair.length === 2));
  const osName = (fields.get("os") ?? "").trim().slice(0, 40);
  const osVersion = /^[\d.]{1,20}$/.exec((fields.get("osversion") ?? "").trim())?.[0] ?? null;
  return {
    builtAt: Number.isNaN(at) ? null : new Date(at).toISOString(),
    tools: [
      ...(osName ? [{ name: osName, version: osVersion } satisfies Tool] : []),
      ...TOOLS.map((name) => ({ name, version: version(fields.get(name) ?? "") })),
    ],
  };
}
