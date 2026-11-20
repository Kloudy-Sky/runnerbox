import { SidebarTrigger } from "./ui/sidebar.tsx";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip.tsx";

// What starts every page's bar: folds the sidebar to its rail and back.
export const SidebarToggle = () => (
  <Tooltip>
    <TooltipTrigger render={<SidebarTrigger className="-ms-1.5 shrink-0" aria-label="Toggle sidebar" />} />
    <TooltipPopup side="bottom">Toggle sidebar (⌘B)</TooltipPopup>
  </Tooltip>
);
