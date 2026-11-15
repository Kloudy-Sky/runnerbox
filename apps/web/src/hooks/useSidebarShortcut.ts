import { useEffect } from "react";
import { useSidebar } from "../components/ui/sidebar.tsx";

// Cmd+B, or Ctrl+B, toggles the sidebar from anywhere, as T3 Code binds `sidebar.toggle`. Like T3
// Code, the composer keeps it while text is selected there, where it means bold.
export function useSidebarShortcut() {
  const { toggleSidebar } = useSidebar();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && event.target instanceof HTMLElement && event.target.closest('[data-composer-rich-text="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [toggleSidebar]);
}
