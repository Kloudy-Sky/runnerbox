import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat.ts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";

// A message's time, as T3 Code's message rows show it: the day only when it isn't today, and the
// full date and time on hover.
export function RowTime({ at }: { at: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<p className="text-muted-foreground text-xs tabular-nums" />}>{formatDayAwareTimestamp(at, "locale")}</TooltipTrigger>
      <TooltipPopup>{formatChatTimestampTooltip(at, "locale")}</TooltipPopup>
    </Tooltip>
  );
}
