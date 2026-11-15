import { Avatar } from "@base-ui/react/avatar";
import { UserRound } from "lucide-react";
import { initials } from "../lib/initials.ts";
import { cn } from "../lib/utils.ts";

export type AvatarUser = { readonly name?: string | undefined; readonly imageUrl?: string | undefined };

// Who is signed in to Runnerbox Connect: their image, else their initials, else a neutral figure.
// An image that fails to load falls back the same way. Connect has no profile to show yet, so
// today every caller passes no user and gets the figure.
export function UserAvatar({ user, className }: { user?: AvatarUser | null | undefined; className?: string }) {
  const letters = user?.name ? initials(user.name) : "";
  return (
    <Avatar.Root className={cn("inline-flex size-6 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-foreground/10 font-semibold text-[10px] text-foreground", className)}>
      {user?.imageUrl ? <Avatar.Image src={user.imageUrl} alt="" className="size-full object-cover" /> : null}
      <Avatar.Fallback className="flex size-full items-center justify-center">{letters || <UserRound className="size-3.5 text-muted-foreground" />}</Avatar.Fallback>
    </Avatar.Root>
  );
}
