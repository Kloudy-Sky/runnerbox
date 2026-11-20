import { Fragment, type ReactNode } from "react";
import { PaletteButton } from "./PaletteButton.tsx";
import { SidebarToggle } from "./SidebarToggle.tsx";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator } from "./WorkspaceBreadcrumb.tsx";
import { WorkspacePageHeader } from "./WorkspacePageHeader.tsx";

// Every page's top bar, as T3 Code's pages have it: the sidebar toggle, the page's name after what
// it sits in, then its controls, `children`, and the palette's button on the right. A page split in
// two, such as the Inbox, has one bar over both halves.
export function PageBar({ title, trail = [], children }: { title: ReactNode; trail?: ReadonlyArray<string>; children?: ReactNode }) {
  return (
    <WorkspacePageHeader>
      <SidebarToggle />
      <WorkspaceBreadcrumb ariaLabel="Breadcrumb" className="overflow-hidden">
        {trail.map((crumb) => (
          <Fragment key={crumb}>
            <WorkspaceBreadcrumbItem>{crumb}</WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
          </Fragment>
        ))}
        <WorkspaceBreadcrumbItem current>
          <h1 className="truncate">{title}</h1>
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      <div className="min-w-0 flex-1" />
      {children ? <div className="flex min-w-0 shrink-0 items-center gap-1.5">{children}</div> : null}
      <PaletteButton />
    </WorkspacePageHeader>
  );
}
