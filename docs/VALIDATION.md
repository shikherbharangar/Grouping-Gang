# Validation and release checklist

## Executed in this cloud environment

- Node.js 24.19.0; Vite 8.3.4; TypeScript 6.0.3; Vitest 5.0.4.
- Production build and strict type check completed.
- ESLint and Prettier checks completed.
- **88 Vitest tests**: assignment invariants for all ten slots, conflicts, explicit swaps, persistence, version migration, invalid storage, session-scoped identity, duplicate names, membership evidence, idempotent reconciliation, duplicate events, worker restart, captured-tab movement, collapse handling, multiple windows, pinned/private/extension tab rejection, failure recovery, missing-assignment retention, metadata recreation, explicit single-tab restoration, interrupted-operation journaling, concurrent recovery prevention, theme persistence, keyboard decisions, manifest and icon integrity.
- **22 Chromium-rendered UI checks**, with test-only mocked Chrome APIs: settings and switcher rendering, ten slots, number zero, missing/ambiguous states, assignment/reassignment, explicit destructive cancellation, recovery confirmation, correct command context, failure UI, arrows/Tab/Enter, Escape, manual/system appearance changes, reduced motion, transient browser-event refresh, long titles, popup dimensions, responsive settings, and no uncaught page errors.
- Screenshots of the actual built DOM/CSS inspected in light and dark themes; settings and recovery dialog also inspected. Fixed a long-title grid overflow found during review. Screenshots use clearly isolated test fixtures; production never supplies sample groups.

Commands:

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run test:browser
```

UI screenshots are generated under ignored `artifacts/`. The built extension is under ignored `dist/`. The dependency lockfile is supplied with the source. Installation was exercised with `npm ci` to verify lockfile repeatability.

## Real-browser limitation

The installed Chromium is **154.0.8037.57 on Linux**. Launching it with unpacked-extension flags produced no extension worker. A browser-level DevTools `Extensions.loadUnpacked` request returned:

> Loading of unpacked extensions is disabled by the administrator.

The restriction was not changed or bypassed. Brave/macOS is not installed. **No real Brave behavior is recorded as passed**, and no simulated API result is presented as proof of browser grouping or session restoration. Additional browser downloads were also blocked by network policy; they are not a dependency of the shipped extension.

The production artifacts are prepared for local installation. Release acceptance remains conditional on the following tests on a Brave installation that permits unpacked extensions.

## Brave/macOS manual acceptance

Use a disposable Brave profile with ordinary test webpages. Load `dist` through `brave://extensions`. Inspect the extension's error list and its service-worker console after each failing check. Record Brave/macOS versions, actual shortcut, observed result, and any exception.

| Check                    | Steps and expected result                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest and assets      | Load `dist`. No manifest/worker/CSP errors. Icons and Paper Mono display without network requests. Settings and toolbar popup open.                                                                                              |
| Shortcut                 | With a webpage active, press Command–Shift–Period. If unassigned, set a free combination at `brave://extensions/shortcuts`. The actual shortcut appears in settings and opens the popup.                                         |
| Empty registry           | All ten numbers are empty. Press 0 or another number: no tab/group changes, assignment guidance appears.                                                                                                                         |
| All ten numbers          | Create ten groups; assign 1–9 and 0. For each number, activate an ungrouped webpage, open the popup and press it. The same tab/URL appears in that exact group; popup closes after success. No extra tabs are created.           |
| Dismissal                | Open, press Escape, and repeat by clicking outside. No move. Keyboard focus returns to the previous browser context where Brave permits it.                                                                                      |
| Navigation               | Arrow Up from 1 reaches 0; Down wraps back. Enter moves to the focused row. Tab reaches settings; Enter there opens settings, not a move. Focus remains visible.                                                                 |
| Collapsed group          | Collapse an assigned group, move a page into it. The existing group is reused, expanded, and shows that page; no duplicate appears. Title/color stay unchanged.                                                                  |
| Multi-window             | Assign a group in another normal window. Move a tab. It joins that group, destination window focuses, URL is unchanged, source-window last-tab handling remains acceptable.                                                      |
| Pinned and stale source  | A pinned source produces an error and stays pinned. Change the active tab while a request is pending: another tab must never be substituted for the captured ID; stale contexts should be rejected.                              |
| Renaming and movement    | Rename/recolor/move an assigned group within a browser session. Number and UUID remain stable; settings update. Collapse/expand while settings is open: status updates without manual refresh.                                   |
| Missing group            | Close every tab in an assigned group. Its number remains reserved and shows Missing. Opening/dismissing the switcher does not recreate it.                                                                                       |
| Metadata recreation      | Select a missing number and confirm recreation with no closed tab. Popup: current tab is grouped under saved title/color. Settings: exactly one blank tab is created. Previous tabs remain closed.                               |
| Single-tab recovery      | Close a regular test webpage, open missing-destination recovery, explicitly select that individual tab and confirm. Only that tab reopens; it joins the recreated group. A closed window must never appear as a recovery choice. |
| Ambiguity                | Create duplicate-title/color groups, restart Brave, then open settings. Destinations need explicit confirmation rather than automatically choosing a match. Binding one group to two numbers is refused.                         |
| Browser restart / reload | Restart Brave or reload the extension. Numbers/preferences survive. Live group IDs are no longer trusted; confirm bindings. Verify a normal worker suspend/restart within the same browser session preserves trusted bindings.   |
| Operation failure        | Attempt a move while a tab/group disappears or is being dragged. Show an error, keep assignment, reconcile state, and allow a deliberate retry. No false success.                                                                |
| Interrupted recovery     | In a disposable profile, terminate the worker during recreation. A later request must block duplicate creation and provide a binding/forget path. Inspect existing groups before resolving.                                      |
| Assignment management    | Transfer a number to an occupied number: assignments swap. Forget/reset ask for confirmation. Cancel leaves data intact; confirm changes only registry/preferences, not browser tabs.                                            |
| Appearance               | Test light/dark/system in settings and popup, restart browser, change macOS appearance while system mode is active. No incorrect-theme flash; names/errors/focus remain readable.                                                |
| Motion and accessibility | Test macOS Reduce Motion, immediate number input during opening, long names, popup at reduced display height, all dialogs with Tab/Shift-Tab/Escape, and VoiceOver labels/status announcements.                                  |

A user-confirmed binding is required after browser-session identity expires; this is expected, not a promise of automatic saved-group matching. Do not mark the full release accepted until these real-browser checks are recorded.
