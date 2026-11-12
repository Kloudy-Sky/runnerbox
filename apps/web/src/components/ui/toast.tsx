import { Toast } from "@base-ui/react/toast";
import { X } from "lucide-react";
import type * as React from "react";
import { Button } from "./button.tsx";

// Ported from T3 Code (MIT), without its thread-specific parts. A toast slides in, waits its
// timeout, and slides out. Call `toast.add({ title, description })` from anywhere.
export const toast = Toast.createToastManager();

function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={toast} limit={3} timeout={5000}>
      {children}
      <Toasts />
    </Toast.Provider>
  );
}

function Toasts() {
  const { toasts } = Toast.useToastManager();
  return (
    <Toast.Portal>
      <Toast.Viewport className="fixed right-4 bottom-4 z-[150] flex w-80 flex-col gap-2" data-slot="toast-viewport">
        {toasts.map((item) => (
          <Toast.Root
            key={item.id}
            toast={item}
            className="relative rounded-lg bg-popover px-3 py-2.5 pr-9 text-foreground shadow-xl shadow-black/50 transition-[opacity,translate] duration-200 data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0"
            data-slot="toast"
          >
            <Toast.Title className="font-medium" />
            <Toast.Description className="text-muted-foreground" />
            <Toast.Close render={<Button variant="ghost-muted" size="icon-sm" className="absolute top-1.5 right-1.5" aria-label="Dismiss" />}>
              <X />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export { ToastProvider };
