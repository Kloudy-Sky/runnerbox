import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Runs one virsh command against the host's system libvirt and returns its stdout. `xml` is for
// commands that define something from a file: it's written to a private file whose path becomes the
// last argument, because virsh can't read a definition from a pipe. There's no timeout, because
// copying a disk takes minutes.
export async function virsh(args: string[], xml?: string, binary = "virsh") {
  const dir = xml === undefined ? null : await mkdtemp(join(tmpdir(), "runnerbox-virsh-"));
  try {
    const file = dir ? [join(dir, "definition.xml")] : [];
    if (file[0] && xml !== undefined) await writeFile(file[0], xml, { mode: 0o600 });
    const { stdout } = await promisify(execFile)(binary, ["--connect", "qemu:///system", ...args, ...file], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr).trim().split("\n")[0] : "";
    throw new Error(`virsh ${args[0]} failed: ${stderr || (error instanceof Error ? error.message : error)}`);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

export type Virsh = (args: string[], xml?: string) => Promise<string>;
