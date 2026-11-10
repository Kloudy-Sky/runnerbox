// Every IPC channel between the preload and main. Both sides import these names from here.
export const CHANNELS = {
  catalogList: "runnerbox:catalog:list",
  catalogSave: "runnerbox:catalog:save",
  catalogRemove: "runnerbox:catalog:remove",
} as const;
