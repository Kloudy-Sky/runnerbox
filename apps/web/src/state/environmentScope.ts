import { createContext } from "react";

// A machine picked for one part of a page, such as an inbox item's thread on the machine that
// reported it. Hooks under it read that machine instead of the switcher's.
export const EnvironmentScope = createContext<string | null>(null);
