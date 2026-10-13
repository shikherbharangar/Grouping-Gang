# Grouping Gang

A small, local, keyboard-first utility for Brave on macOS. Give your tab groups steady numbers, open the switcher, and send the current tab where it belongs.

**Status:** implemented and built; automated domain, operation, and rendered UI checks pass. Real Brave installation, shortcut dispatch, tab API behavior, and native focus restoration still need the [manual acceptance checks](docs/VALIDATION.md). This cloud machine blocks unpacked extensions by administrator policy. Mocked tests are not evidence of real Brave behavior.

## Install in Brave

1. Use **Node.js 24 LTS** (`nvm use` if you use nvm).
2. From this repository, run:

   ```sh
   npm ci
   npm run build
   ```

3. Open `brave://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the **`dist` directory**. In this cloud checkout it is `/workspace/Grouping-Gang/dist`.
4. Pin Grouping Gang if you want toolbar access. Open its popup and choose **Edit destinations**.
5. Create groups in Brave, then assign them to numbers. No groups are assigned automatically.
6. While viewing a webpage, press **Command + Shift + .**, then **1–9 or 0**. If Brave did not register that combination, set another at `brave://extensions/shortcuts`.

The shortcut uses Chromium's `_execute_action` command. It works while Brave is focused, not as an OS-wide hotkey while another app is active. Command–Shift–Period avoids common Brave navigation commands; it is also Finder's hidden-file shortcut, which is confined to Finder. Browser, OS, keyboard-layout, and other-extension conflicts can still override a suggestion. The settings page displays the **actual registered shortcut**.

The toolbar popup is anchored to the extension action; it is not a freely positioned macOS overlay. Opening/dismissing it makes no browser mutations. Number keys work immediately, including a number typed while state loads. Arrow keys navigate, Enter/Space activate the focused control, Tab reaches settings, and Escape cancels. Browser focus determines popup dismissal.

## Behavior

- **Ten stable assignments:** `1 2 3 4 5 6 7 8 9 0`. Missing destinations keep their number. Changing to an occupied number swaps the two assignments.
- **Live groups:** move the captured tab, preserve its URL, title and color, verify its new group/window, then activate it. No extra tab is created.
- **Collapsed groups:** use the existing group and deliberately expand it so the current page remains visible. Chromium defines collapsed groups as having hidden tabs; keeping both the active page visible and its group collapsed is not promised.
- **Other windows:** move the same tab into the destination window, group it, then focus that window. A partial API failure can leave a tab moved but ungrouped; the UI reports failure and refreshes state, without destructive rollback.
- **Pinned tabs:** reject the move with an explanation; never unpin them automatically. Private windows and extension pages are excluded from the source workflow.
- **Missing destinations:** ask before recreating. In the popup, recreate with the captured tab; in settings, create one blank tab. Chromium groups cannot be truly empty. Previous tabs are not reopened by this action.
- **Closed-tab recovery:** the user may explicitly select **one individual recently closed tab** and confirm recovery. It is restored with `sessions.restore(sessionId)` and placed in a recreated destination. Entire closed windows are excluded. This is **not full original-group/session restoration**.
- **Ambiguity:** never infer identity from matching names or colors. After browser restart, extension reload/update, or uncertain identity, use **Edit → Confirm binding**. The persistent UUID and number survive; browser IDs are only trusted in the session that issued them. This conservative rebinding is deliberate.
- **Interrupted recovery:** a durable intent is written before restoration or recreation. If an operation stops halfway through, automatic recreation is blocked. Inspect your groups, then bind the resulting group or explicitly forget that assignment. The extension never blindly repeats recovery.
- **Appearance:** system, warm light, and charcoal dark; locally bundled Paper Mono; visible focus; reduced-motion support. System mode responds to OS changes without reloading.

## Develop and verify

```sh
npm ci
npm run dev          # builds dist and watches sources; no website server needed
npm run build        # strict type check and production build
npm run typecheck
npm run lint
npm run test         # Vitest domain, storage, manifest, and operation tests
npm run format:check
npm run test:browser # Chromium-rendered UI, with an isolated API test double
```

Reload the extension in `brave://extensions` after rebuilding worker or manifest changes. A reload clears the browser-session storage epoch, so confirm live bindings again if needed. Reopen popup/settings pages after UI changes.

`test:browser` requires a Chromium executable. It defaults to `/usr/bin/chromium`; override it with `CHROMIUM_PATH`, for example:

```sh
CHROMIUM_PATH='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' npm run test:browser
```

It launches an isolated temporary browser profile, serves the **built** UI on a local ephemeral port, injects a test-only Chrome API double, checks interactions, writes screenshots to ignored `artifacts/`, and removes its profile. Production sources contain no demo groups, API double, server, or remote assets. This command tests browser-rendered interface behavior, **not real extension APIs or OS shortcuts**. Run `npm run build` first. No user profile is opened.

Dependencies are development-only, with a committed npm lockfile for repeatable installation. No JavaScript framework or runtime package is shipped. Runtime JavaScript is about 29 KB before compression; Paper Mono is about 38 KB. See [validation](docs/VALIDATION.md) for precise evidence and remaining checks.

## Architecture

```text
switcher / settings   DOM, keyboard, theme, confirmations; send typed commands
        ↓
background            sole owner of mutations, event coalescing, UI invalidation
        ↓
application/engine    serialized operations, preflight checks, recovery journal
     ↙       ↘
domain        browser/gateway      pure identity/assignment rules; Chromium calls
     ↘       ↙
storage               validated, versioned local registry + session identity epoch
```

`src/shared/types.ts` defines the contract. The worker registers event listeners synchronously. Group/tab/window/session events reconcile live metadata; removed groups invalidate bindings without deleting assignments. Identical snapshots do not cause repeated writes. UI invalidation updates transient states such as collapse even when stored metadata stays the same. There is no polling.

All mutating requests share one small promise queue. Each request rereads and validates storage and browser state. A worker restart reconstructs state from local and session storage. Recovery intent is persisted before browser side effects, because an in-memory queue alone cannot protect against worker termination.

Schema version 2 stores destination UUID, slot, group title/color, last observation time, a session-scoped group/window/tab-ID association, theme, and at most one pending recovery. Version 1 records with the same assignment shape migrate by adding an empty recovery journal. Unknown versions, malformed records, or conflicting bindings are preserved and rejected rather than silently discarded. Explicit reset keeps one local `registryBackup`; it does not close tabs. Neither IDs nor title/color similarities prove identity across browser sessions.

## Permissions and privacy

| Permission  | Purpose                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `tabGroups` | Read live group state and update newly created group metadata/collapse.                               |
| `tabs`      | Show the captured tab's title and reject extension-page sources; inspect tab metadata for operations. |
| `storage`   | Save local assignments and preferences; keep a browser-session epoch.                                 |
| `sessions`  | List recent individual closed tabs and restore only an explicitly selected tab.                       |

No host permissions, content scripts, website-content access, backend, analytics, account, cloud sync, remote font, or runtime network dependency. Page titles from current/recent tabs are transient UI data, not saved browsing history. Only group metadata and transient numeric IDs are retained. Storage access is restricted to trusted extension contexts. Titles are rendered with `textContent`, never HTML interpolation.

## Design and licences

The rendered [Paper website](https://paper.design/) informed the warm surfaces, strong typographic hierarchy, fine separators, restrained controls, and whitespace. The numbered index and forest/charcoal palette are original to Grouping Gang; no Paper logo, artwork, or layout is copied. See [research notes](docs/RESEARCH.md).

Code and original icons: [MIT](LICENSE). Paper Mono is distributed unmodified under SIL OFL 1.1. Both upstream notices are kept in `assets/licences/` and copied into `dist/licences/` on every build. No font service is contacted at runtime.
