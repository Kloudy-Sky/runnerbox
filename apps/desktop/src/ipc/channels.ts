// Every IPC channel between the preload and main. Both sides import these names from here.
export const CHANNELS = {
  catalogList: "runnerbox:catalog:list",
  catalogSave: "runnerbox:catalog:save",
  catalogRemove: "runnerbox:catalog:remove",
  sshOpenTunnel: "runnerbox:ssh:open-tunnel",
  sshCloseTunnel: "runnerbox:ssh:close-tunnel",
  sshFetchPairingCode: "runnerbox:ssh:fetch-pairing-code",
  connectStatus: "runnerbox:connect:status",
  connectSignIn: "runnerbox:connect:sign-in",
  connectSignOut: "runnerbox:connect:sign-out",
  connectEnvironments: "runnerbox:connect:environments",
  connectRequestCredential: "runnerbox:connect:request-credential",
} as const;
