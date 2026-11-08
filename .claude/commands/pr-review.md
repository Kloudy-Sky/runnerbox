---
description: Review a pull request for bugs and against AGENTS.md
argument-hint: <pr-number>
allowed-tools: Read, Grep, Glob, Bash(gh pr view:*), Bash(gh pr diff:*)
---

Review pull request #$ARGUMENTS. You are this repo's only reviewer, so you look for bugs and check the PR against AGENTS.md.

1. Read the PR: `gh pr view $ARGUMENTS` for the title and body, then `gh pr diff $ARGUMENTS`. Read the code around each hunk, and anything it calls or that calls it, whenever the diff alone can't settle a question.
2. Find **bugs**: input or state that makes the changed code do the wrong thing, crash, leave half-done state, or weaken isolation between a job and the host, the VM or other jobs. Each one needs a concrete failure scenario, the steps that lead to the wrong result. A worry without a scenario is no finding.
3. Judge the PR against every rule in AGENTS.md, in its order: each principle, each code rule, and the pull request rules.
4. In CI, post one inline comment per finding, on the line that causes it: the bug and its failure scenario, or the rule in AGENTS.md's words and what would satisfy it. Then write the summary into your Claude comment on the PR: the bugs found, and one line per AGENTS.md rule with its verdict, pointing to its inline comment when broken. A clean PR gets the summary and no inline comments. A local run has neither tool, so give the findings and the summary in the session.

Done when every AGENTS.md rule has its line in the summary and every bug has a failure scenario.
