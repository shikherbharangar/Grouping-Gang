# Grouping Gang

A local, keyboard-first destination launcher for Brave on macOS. Open it, press a number or type a group name, and keep working in the same tab.

**V1.1 development status:** production build, strict type checking, lint, formatting, 141 automated tests, and 35 browser-rendered UI checks pass. Real Brave shortcut dispatch, native focus, notification delivery, grouping and Undo still require the [manual acceptance checklist](docs/VALIDATION.md). This cloud browser blocks unpacked extensions by administrator policy. Mocked tests do not prove Brave API behavior.

## Install or update

Use **Node.js 24 LTS** and Brave based on **Chromium 127 or later**. From this repository:

```sh
npm ci
npm run build
```

Open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select **`dist`**. In the cloud checkout, the build is `/workspace/Grouping-Gang/dist`.

To update an existing unpacked installation, keep the same installation folder/extension ID, replace its built contents, and reload that extension. Do not remove the existing installation or load a different folder if you want its local assignments retained. V1.1 adds the `notifications` permission for Undo banners; Brave or macOS may require notification approval. A disabled banner does not prevent movement or launcher-based Undo.

The default shortcut is **Command + Shift + .** on Mac, **Ctrl + Shift + .** elsewhere. Check its actual registration in Settings, and change it at `brave://extensions/shortcuts` if necessary. OS/browser/other-extension shortcuts can override suggestions. Command–Shift–Period is also Finder's hidden-file shortcut, which is confined to Finder.

V1.1 uses a named **Open Grouping Gang** command so the worker captures the webpage **before** calling `action.openPopup()`. The legacy `_execute_action` remains supported for existing customized shortcuts, and toolbar access works as before. Those paths use the action popup's unchanged active-tab context; they never create/focus an extension tab or window. Upgrades can leave the new suggested combination unavailable, so check Settings rather than assuming it registered. The shortcut is browser-scoped, not an OS-wide hotkey.

## First use: review once

If no registry exists, the launcher proposes a mapping of live groups to `1 2 3 4 5 6 7 8 9 0`. Ordering is deterministic:

1. Groups in the source window, by the minimum **actual tab index** of each group.
2. Other normal windows, by numeric window ID, then actual group tab position.
3. Group ID breaks an exact tie. At most ten groups are proposed.

Review and accept in one action. Change any select before accepting; choosing an already proposed group swaps its former number, so duplicates are avoided. Duplicate names include window/group IDs for disambiguation. No destinations are invented. With no groups, start with empty numbers and optionally enable future assignment.

**Existing V1 registries skip setup**, including intentionally empty registries. Numbers, UUIDs, appearance and interrupted recovery data migrate without renumbering. Auto-assignment defaults **off for upgrades**, and **on in the new-user proposal** with an editable checkbox.

## Daily use

- **Empty search:** press 1–9 or 0 to invoke that exact slot. Empty numbers explain how to assign them; they never choose another group. Only assigned destinations fill the results list.
- **Search:** type a name. Matching is local and case-insensitive: exact, title prefix, word prefix, then substring. Equal ranks retain number order. Missing destinations remain searchable. No fuzzy library, network request, or debounce.
- **Numbers while searching:** ordinary text. For example, type `project 2` without moving to number 2.
- **Arrows / Enter:** navigate and activate filtered results while search keeps focus. Selection stays valid after filtering. Mouse clicks work too. Enter repeats and concurrent activations cannot trigger duplicate actions.
- **Escape:** clear a nonempty query; press again to dismiss. With an empty query, dismiss immediately. Opening/dismissing never moves tabs.
- **Live group:** verify source and destination, move the captured tab, verify the result, focus the destination window and dismiss. No new tab or navigation.
- **Collapsed group:** reuse and deliberately expand it so the active page stays visible. No manual expansion or duplicate group.
- **Missing group:** deliberately selecting it is enough authorization to recreate with its saved title/color and current tab. No extra confirmation. Previous tabs stay closed, and the banner states that recreation happened.
- **Ambiguous / interrupted:** no guess or recreation. Use **Resolve in settings** to bind the exact live group or explicitly forget the assignment.
- **Safeguards:** pinned tabs are never unpinned automatically. Private windows and extension pages are excluded. Closed or stale sources produce an error; another active tab is never substituted.

The retained toolbar popup is a compact 560 px search-first launcher with a scrollable results region. It uses native popup focus/dismissal and is anchored to the toolbar. It is **not a centred native macOS overlay**. A dedicated window was evaluated against the available APIs, but its shortcut, frame, focus and position behavior could not be tested under this machine's policy; it is not shipped as an unverified replacement. See [surface research](docs/RESEARCH.md).

## Automatic new groups

Enable **Automatically assign new groups to free numbers** in Settings. Newly observed groups use the next free number in display order, without changing any existing assignment. The worker seeds session observation state before enabling this behavior; it does not claim all pre-existing unassigned groups on an upgrade, toggle or browser restart.

Missing numbers remain reserved. A plausible returning group is left for identity confirmation, not assigned a fresh number. Full registries leave new groups unassigned and available in Settings. Automatic assignments produce a small dismissible banner with Undo, and an **Undo assignment** launcher control remains available for 30 seconds. Undo will not remove an assignment whose number or binding has since changed. Duplicate events and worker restarts do not repeatedly assign the same group.

## Undo last move

After a verified successful move, a silent native notification offers **Undo** and clears after about **five seconds**. Clicking its body also requests Undo. OS/browser settings control whether that banner is displayed. Reopen the launcher for **Undo last move**, available for **30 seconds**, even when banners are suppressed.

Only the most recent move is retained, in `storage.session`, with tab/group/window IDs, original index, destination UUID and expiry. No URLs, page titles or browsing history are recorded for Undo. A worker restart in the same browser session can retain it; a browser restart/reload invalidates it. Expired metadata is ignored/pruned on read and is cleared with session storage.

Undo verifies that the same eligible tab is still in the expected destination, that its original window exists, and that its original group still exists in that window when applicable. It returns the tab to that group or to an ungrouped state, restores the original window and approximate position, verifies membership, then focuses it. Chromium may place a regrouped tab at the group's edge; membership takes priority over exact index.

Undo does not invent a closed original group/window or close unrelated tabs. If moving the last tab closed the source window/group, reversal is unavailable. Ungrouping the only tab from a recreated destination can naturally remove that now-empty Chromium group; its numbered assignment remains. Explicitly recovered tabs stay open. Undo consumes its intent before mutations, so a partial failure cannot be replayed blindly. Errors explain that the tab must be inspected manually. A no-op destination selection preserves the previous meaningful Undo.

## Recovery limits

Chromium exposes recent **tabs and windows**, not a restorable saved-group identity. The normal missing-group action recreates metadata with the source tab and never reopens previous tabs or whole windows automatically. Settings retains the optional, explicit **single closed-tab recovery** dialog; only the selected individual session ID is restored. It is not full original-group restoration.

Browser group IDs are trusted only in the session that issued them. After browser restart or extension reload/update, confirm uncertain live bindings; UUIDs and numbers stay intact. Similar titles/colors are suggestions, never proof. A durable recovery journal blocks blind duplicate creation if a worker stops during recovery.

## Develop and verify

```sh
npm ci
npm run dev          # Vite extension build watcher; reload Brave after rebuilding
npm run build
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run test:browser
```

There is no backend or development website server. Reload the extension after worker/manifest changes, and reopen pages after UI changes.

`test:browser` requires a Chromium executable, defaults to `/usr/bin/chromium`, and accepts `CHROMIUM_PATH`, for example:

```sh
CHROMIUM_PATH='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' npm run test:browser
```

Build first. The runner uses an isolated temporary profile and internal local server to exercise the **actual built UI with an explicit Chrome API test double**. It writes ignored screenshots to `artifacts/` and cleans up its profile/server. Test groups never enter production. These checks cover DOM/CSS/keyboard behavior, not real extension APIs, macOS shortcuts, or OS notification delivery.

No dependencies were added for V1.1. Everything in `package.json` is development-only. The lockfile pins installation; all runtime fonts/icons/assets are local.

## Architecture and storage

The existing TypeScript/Vite/MV3 architecture remains:

- **Background worker:** sole owner of browser mutations, serialized requests, event coalescing, native notifications and pre-open source handoff.
- **Application:** `engine.ts` coordinates operations; `launcher.ts` handles capture/opening; `undo.ts` validates and reverses the latest move.
- **Domain:** pure assignment, identity, deterministic proposal/order and search rules.
- **Browser gateway:** Chromium API wrappers, actual tab positions, grouping, movement, ungrouping and activation.
- **Storage:** validated local registry, durable recovery journal, and validated ephemeral session operation state.
- **Switcher/settings:** native DOM, accessible search/list selection, preferences, confirmations for destructive management actions, and shared themes.

Schema **3** adds `setupCompleted` and `autoAssign` to schema 2. Schema 1 first gains its empty recovery journal, then migrates to 3. Existing assignments/preferences are retained; corrupted/newer data is preserved and rejected. Reset keeps one local registry backup and does not close browser tabs. The existing UUID remains separate from browser IDs. There is no polling and no history system.

## Permissions and privacy

| Permission      | Purpose                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `tabGroups`     | Read/update live groups and create metadata for recreated destinations.                                        |
| `tabs`          | Show the source title, reject extension-page sources, inspect tab positions/membership, move and ungroup tabs. |
| `storage`       | Local settings/registry, recovery intent, session identity, temporary source handoff and Undo.                 |
| `sessions`      | Optional explicit recovery of one selected closed tab from Settings.                                           |
| `notifications` | Temporary, actionable Undo banners after the launcher closes, without website injection.                       |

No host permissions, content scripts, page-content access, remote fonts, backend, analytics, accounts or cloud sync. Current/recent tab titles are transient UI data. Source title handoff expires after two seconds and is consumed once. Group metadata and numeric IDs support assignments. DOM theme caching mirrors only appearance. Storage access is restricted to trusted extension contexts; titles use `textContent`.

## Design and licences

The Paper-inspired warm/charcoal surfaces, fine rules, local Paper Mono numbers and native system text are retained. Alfred informs the command-palette interaction described in the specification; its website was blocked in this environment, so no live Alfred inspection is claimed. No proprietary branding, artwork or exact styling was copied. See [research](docs/RESEARCH.md) and [validation](docs/VALIDATION.md).

Original code/icons: [MIT](LICENSE). Paper Mono remains unmodified under SIL OFL 1.1; both upstream notices ship in `dist/licences/`, and `dist/LICENSE.txt` includes the application licence.
