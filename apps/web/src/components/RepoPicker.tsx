import { Link } from "@tanstack/react-router";
import { useRepo } from "../hooks/useRepo.ts";
import type { RootSearch } from "../lib/search.ts";

export function RepoPicker() {
  const { repo, repos } = useRepo();
  if (repos.length < 2) return <span>{repo}</span>;
  return (
    <span className="flex gap-3">
      {repos.map((name) => (
        <Link key={name} to="." search={(previous: RootSearch) => ({ ...previous, repo: name })} className={name === repo ? "text-fg" : "text-dim hover:text-fg"}>
          {name}
        </Link>
      ))}
    </span>
  );
}
