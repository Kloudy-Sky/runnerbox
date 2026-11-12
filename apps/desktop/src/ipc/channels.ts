// Every IPC channel between the preload and main. Both sides import these names from here.
export const CHANNELS = {
  catalogList: "runnerbox:catalog:list",
  catalogSave: "runnerbox:catalog:save",
  catalogRemove: "runnerbox:catalog:remove",
  catalogCanSaveTokens: "runnerbox:catalog:can-save-tokens",
  sshOpenTunnel: "runnerbox:ssh:open-tunnel",
  sshCloseTunnel: "runnerbox:ssh:close-tunnel",
  sshFetchPairingCode: "runnerbox:ssh:fetch-pairing-code",
  connectStatus: "runnerbox:connect:status",
  connectSignIn: "runnerbox:connect:sign-in",
  connectSignOut: "runnerbox:connect:sign-out",
  connectEnvironments: "runnerbox:connect:environments",
  connectRequestCredential: "runnerbox:connect:request-credential",
  connectCreateProofKey: "runnerbox:connect:create-proof-key",
  connectProve: "runnerbox:connect:prove",
  updatesGetState: "runnerbox:updates:get-state",
  updatesSetChannel: "runnerbox:updates:set-channel",
  updatesCheck: "runnerbox:updates:check",
  updatesInstall: "runnerbox:updates:install",
  // Main to the page: the update state, whenever it changes.
  updatesState: "runnerbox:updates:state",
} as const;
