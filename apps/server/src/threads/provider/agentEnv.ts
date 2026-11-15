// What an agent CLI needs from the server's environment to find its login and reach the network,
// and nothing else: no API key, cloud-provider switch or unrelated secret. Each driver adds its
// own few names, and the account's key, as that CLI expects them.
const PASSED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
]);

export function passedEnv(from: Record<string, string | undefined>, also: ReadonlySet<string> = new Set()) {
  const passed = Object.entries(from).filter((entry): entry is [string, string] => entry[1] !== undefined && (PASSED.has(entry[0]) || also.has(entry[0]) || entry[0].startsWith("LC_")));
  return Object.fromEntries(passed);
}
