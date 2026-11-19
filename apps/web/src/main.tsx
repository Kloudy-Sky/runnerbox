import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry.ts";
import { router } from "./router.tsx";
import { runtime } from "./runtime.ts";
// The bundled Inter, as T3 Code loads it: after the system font in its stack.
import "@fontsource-variable/inter";
import "./styles.css";

void runtime.load();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
    </AppAtomRegistryProvider>
  </StrictMode>,
);
