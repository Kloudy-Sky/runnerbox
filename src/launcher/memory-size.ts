const UNIT_MIB = { b: 1 / 1024 ** 2, k: 1 / 1024, m: 1, g: 1024 } as const;

// A docker memory size, such as `3600m`, in MiB.
export const memoryMiB = (size: string) => Math.ceil(Number(size.slice(0, -1)) * UNIT_MIB[size.at(-1) as keyof typeof UNIT_MIB]);
