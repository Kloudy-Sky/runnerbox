import { useRender } from "@base-ui/react/use-render";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// One row of the Inbox list, after T3 Code's sidebar thread row: its status, then the title, then
// the machine or repository with what it costs. `render` is the link it opens. A row that needs
// nothing from the owner yet stays dim. `children` sit under it, such as a draft.
export function InboxRow(props: {
  status: { readonly label: string; readonly tone: string };
  title: string;
  meta: string;
  active: boolean;
  dim?: boolean;
  render: useRender.RenderProp;
  children?: ReactNode;
}) {
  const row = useRender({
    defaultTagName: "a",
    render: props.render,
    props: {
      "aria-current": props.active ? "page" : undefined,
      className: cn("flex min-w-0 flex-col rounded-md px-2.5 py-2 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", props.active && "bg-accent", props.dim && "opacity-55"),
      children: (
        <>
          <span className={cn("font-medium text-xs", props.status.tone)}>{props.status.label}</span>
          <span className="truncate font-medium">{props.title}</span>
          <span className="truncate text-muted-foreground text-xs">{props.meta}</span>
          {props.children}
        </>
      ),
    },
  });
  return <li className="list-none">{row}</li>;
}
