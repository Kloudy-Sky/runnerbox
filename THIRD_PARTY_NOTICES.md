# Third-party notices

Parts of `apps/` and `packages/` follow, or are adapted from, [T3 Code](https://github.com/pingdotgg/t3code): the environment, pairing and scoped-session model, the RPC scope middleware, the WebSocket ticket flow, the MCP endpoint's authentication, the SSH port-forward route, and Runnerbox Connect's relay protocol (signed link, mint and health proofs, DPoP-bound credentials, managed tunnel allocations and their generation claims, and the loopback and device-grant sign-in), the isolation that keeps agent threads' Claude Code process away from the user's own settings, MCP servers and hooks, the provider list's drivers and their accounts (after T3 Code's provider instances) and their settings page, laid out as its provider instance card in list and editor mode, the desktop app's updater (`apps/desktop/src/updates`), the server's supervisor and its updates, with a trial start and a return to the previous version (`apps/server/src/update`, after T3 Code's service launcher), the release workflow's nightly and stable channels and their versioning, and the web app's theme, primitives and settings layout, the composer's rich text editor and the thread's timeline (copied or followed, listed below), its sidebar layout, its slot composition, and its usage chart's drawing (`components/usage/UsageProviderChart.tsx` at the commit below): the monotone curve maths in `apps/web/src/lib/curve.ts`, lifted as they are, and the hover crosshair and pointer-following tooltip in `apps/web/src/components/job/ResourceChart.tsx`. T3 Code is under the MIT license below.

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## T3 Code's theme, primitives and settings layout, copied

Copied from T3 Code at commit `4c8cb0445da6c84fa799edee057af355d1e992aa` (`main`, 2026-11-14). A later sync starts from that commit: diff upstream's `apps/web/src` from there and apply it to the files below.

Upstream path under `apps/web/src`, and where it is here (the same path unless noted):

- `components/WorkspaceBreadcrumb.tsx`
- `components/WorkspacePageContainer.tsx`
- `components/settings/SettingsGroup.tsx`
- `components/settings/settingsLayout.tsx`, with T3 Code's settings scopes cut, each cut marked `// runnerbox:`
- `components/settings/settingsSectionNavigation.ts`
- `components/ui/autocomplete.tsx`
- `components/ui/button.tsx`
- `components/ui/closing-positioner.tsx`
- `components/ui/collapsible.tsx`
- `components/ui/command.tsx`
- `components/ui/dialog-styles.ts`
- `components/ui/dialog.tsx`
- `components/ui/empty.tsx`
- `components/ui/input.tsx`
- `components/ui/kbd.tsx`
- `components/ui/menu.tsx`
- `components/ui/scroll-area.tsx`
- `components/ui/select.tsx`
- `components/ui/sheet.tsx`
- `components/ui/sidebar.tsx`
- `components/ui/sidebarState.ts`
- `components/ui/spinner.tsx`
- `components/ui/switch.tsx`
- `components/ui/textarea.tsx`
- `components/ui/toast.logic.ts`
- `components/ui/toast.tsx`
- `components/ui/toastHelpers.ts`
- `components/ui/tooltip.tsx`
- `hooks/useLocalStorage.ts`
- `hooks/useMediaQuery.ts`
- `hooks/useResizeDrag.ts`
- `hooks/useStableCallback.ts`
- `index.css` as `theme/t3code.css`
- `lib/accessibilityAnnouncements.ts`
- `lib/observeResize.ts`
- `lib/visibleAnimation.ts`
- `lib/windowControlsOverlay.ts`

Runnerbox's differences live in its own files, never in the copies, except the cuts marked `// runnerbox:` in `settingsLayout.tsx`. `apps/web/src/theme/runnerbox.css` overrides the theme. These stand in for T3 Code modules the copies import, with only what the copies use, each marked at its top as runnerbox's:

- `apps/web/src/env.ts`
- `apps/web/src/hooks/useCopyToClipboard.ts`
- `apps/web/src/hooks/useSettings.ts`
- `apps/web/src/hooks/useThreadRouteTarget.ts`
- `apps/web/src/lib/t3codeContracts.ts` (mapped to `@t3tools/contracts` and `@t3tools/contracts/settings`)
- `apps/web/src/lib/utils.ts`

## T3 Code's composer editor, copied

The composer's rich text editor, the thread's timeline parts, and what they import are copied unedited from T3 Code at the same commit as the theme, `4c8cb0445da6c84fa799edee057af355d1e992aa`. (They are also identical at `9db3cb10916c81830efa0d0d7be6601d2fe51158`, the commit the composer's design was drawn up against; the one commit between the two touches only T3 Code's mobile app.) A later sync diffs upstream from that commit and applies it to the files below.

From upstream's `apps/web/src`, at the same path here under `apps/web/src`:

- `components/ComposerPromptEditorTiptap.tsx`
- `components/ContextChip.tsx`
- `components/chat/ComposerControl.tsx`
- `components/chat/MessageCopyButton.tsx`
- `components/chat/TimelineOverlays.tsx`
- `components/chat/TimelineRowParts.tsx`
- `components/chat/TimelineSystemDivider.tsx`
- `components/chat/WorkLog.tsx`
- `components/chat/assistantCitationCommentDismissal.ts`
- `components/chat/pageScrollController.ts`
- `components/composerAttachmentInsertion.ts`
- `components/ui/anchoredCopyToast.ts`
- `components/composerContextActions.ts`
- `components/composerInlineTokenPaste.ts`
- `components/composerSelection.ts`
- `composer-code-block.ts`
- `composer-editor-mentions.ts`
- `composer-list-continuation.ts`
- `composer-logic.ts`
- `composer-markdown-source.ts`
- `composer-rich-text-doc.ts`
- `composer-rich-text.ts`
- `composer-text-direction.ts`
- `composer-undo-grouping.ts`
- `lib/composerContextReferences.ts`
- `textDirection.ts`
- `timestampFormat.ts`

From upstream's packages, under `apps/web/src/t3tools`, where tsconfig and Vite map `@t3tools/shared/*` and `@t3tools/client-runtime/*`:

- `packages/shared/src/<name>.ts` as `t3tools/shared/<name>.ts`, for `assistantCitations`, `composerContextClipboard`, `composerContextReferences`, `composerInlineTokens`, `composerTrigger`, `connectAuth`, `inlineSkills`, `remote`, `textDirection` and `threadLinks`
- `packages/contracts/src/<name>.ts` as `t3tools/contracts/<name>.ts`, for `assistantCitations`, `baseSchemas`, `composerContext` and `composerContextClipboard`, which `lib/t3codeContracts.ts` re-exports as `@t3tools/contracts`

These stand in for T3 Code modules the copies import, with only what the copies use, each marked at its top as runnerbox's. Most make a feature runnerbox doesn't have inert: skills, model mentions, citations, file mentions, keybindings, code highlighting.

- `apps/web/src/components/chat/AssistantCitationChip.tsx`
- `apps/web/src/components/chat/ComposerCodeBlockNodeView.tsx`
- `apps/web/src/components/chat/FileTagChip.tsx`
- `apps/web/src/components/chat/ModelMentionChip.tsx`
- `apps/web/src/components/chat/SkillInlineText.tsx`
- `apps/web/src/components/chat/WorkspaceEntryIcon.tsx`
- `apps/web/src/components/composerCodeBlockHighlight.ts`
- `apps/web/src/components/composerContextPresentation.tsx`
- `apps/web/src/keybindings.ts`
- `apps/web/src/lib/assistantTextSelection.ts`
- `apps/web/src/lib/diffRendering.ts`
- `apps/web/src/pierre-icons.ts`
- `apps/web/src/rpc/atomRegistry.ts`
- `apps/web/src/shortcuts/dispatcher.ts`
- `apps/web/src/state/entities.ts`
- `apps/web/src/state/server.ts`
- `apps/web/src/t3tools/atom-react.ts` (mapped to `@effect/atom-react`, which needs Effect 4.1; runnerbox is on 4.0)
- `apps/web/src/t3tools/client-runtime/composerModelMentions.ts`
- `apps/web/src/t3tools/client-runtime/providerSkills.ts`
- `apps/web/src/t3tools/client-runtime/state/threads.ts`
- `apps/web/src/t3tools/contracts/guestShare.ts`
- `apps/web/src/t3tools/shared/markdownMath.ts` (T3 Code finds math with remark; runnerbox doesn't take remark's packages for it)

`apps/web/src/composerDraftStore.ts` is runnerbox's own, not T3 Code's file of that name: it keeps the composer's drafts, and keeps the one export the copied toast reads.

## Inter

The web app bundles Inter Variable from [`@fontsource-variable/inter`](https://fontsource.org/fonts/inter), as T3 Code does. Inter is under the SIL Open Font License 1.1 below.

```
Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) Inter-Italic[opsz,wght].ttf: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
