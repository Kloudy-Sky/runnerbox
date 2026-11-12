import { containerFlags, shellQuote } from "../launcher/docker-command.ts";
import type { RunnerType } from "../launcher/launcher-config.ts";

// The VM commands for one reproduce container. Each is fixed text with only names `up` made or
// checked in it. What comes from outside (the files, the command to run) reaches the container on
// stdin, as data, never as part of these strings.

export const REPRODUCE_ID = /^[0-9a-f]{8}$/;
const label = (install: string) => `runnerbox.reproduce=${install}`;

export const reproduceName = (install: string, id: string) => {
  if (!REPRODUCE_ID.test(id)) throw new Error(`not a reproduce id: ${id}`);
  return `${install}-repro-${id}`;
};

// A job's container without the job: the same runtime, limits and env, no mounts, nothing on
// stdin and no registration. It sleeps until `up` runs commands in it or removes it. A build
// context's tag is only ever local, so it's never pulled.
export function reproduceRunCommand(install: string, runner: RunnerType, id: string, image: string) {
  const name = shellQuote(reproduceName(install, id));
  return [
    `docker rm -f ${name} >/dev/null 2>&1; exec docker run -d --rm --name ${name} --label ${shellQuote(label(install))}`,
    ...containerFlags(runner),
    "-w /work",
    ...(typeof runner.image === "string" ? [] : ["--pull never"]),
    "--entrypoint sleep",
    shellQuote(image),
    "infinity",
  ].join(" ");
}

// `docker run -w` creates /work as root, and the image's own user (`runner` in image/) couldn't
// write to it, so it's handed to whichever user the image runs as.
export function workdirCommand(install: string, id: string) {
  const name = shellQuote(reproduceName(install, id));
  return `u=$(docker exec ${name} id -u) && g=$(docker exec ${name} id -g) && exec docker exec -u 0 ${name} chown "$u:$g" /work`;
}

// Unpacks a commit's tarball, read from stdin, into /work.
export const unpackCommand = (install: string, id: string) =>
  `exec docker exec -i -w /work ${shellQuote(reproduceName(install, id))} tar -xz --strip-components=1 -f -`;

// Runs the command text that arrives on stdin, with no stdin of its own, its output merged, and
// killed after `timeoutSec` inside the container, where killing SSH can't reach.
export function execCommand(install: string, id: string, timeoutSec: number) {
  if (!Number.isInteger(timeoutSec) || timeoutSec < 1) throw new Error(`not a timeout: ${timeoutSec}`);
  const script = `cat > /tmp/.runnerbox-command && exec timeout -k 5 ${timeoutSec} "$(command -v bash || echo sh)" /tmp/.runnerbox-command </dev/null 2>&1`;
  return `exec docker exec -i -w /work ${shellQuote(reproduceName(install, id))} sh -c ${shellQuote(script)}`;
}

// Cuts the container off the network, for a reproduce started with network only for setup.
export const networkOffCommand = (install: string, id: string) => `exec docker network disconnect bridge ${shellQuote(reproduceName(install, id))}`;

export const removeCommand = (install: string, id: string) => `docker rm -f ${shellQuote(reproduceName(install, id))} >/dev/null 2>&1; true`;

// Removes every reproduce container this install left, as when `up` stopped without cleaning up.
export const sweepCommand = (install: string) =>
  `docker ps -aq --filter ${shellQuote(`label=${label(install)}`)} | xargs -r docker rm -f >/dev/null; true`;

export const imageExistsCommand = (image: string) => `docker image inspect ${shellQuote(image)} >/dev/null 2>&1`;
