# Implementation decisions and API research

Checked 13 October 2026 against official Chromium API schemas and the published Chrome extension reference. The documentation and Paper domains were initially blocked, then became reachable after being added to the environment draft. The current implementation does not need either domain at runtime.

## Surface and shortcut

Use the toolbar action popup: it already supports keyboard input, browser-managed focus and dismissal, and the reserved `_execute_action` command. A dedicated extension window would add window/focus management without improving this ten-row selector. A content-script overlay would require website access and would not work uniformly on privileged pages.

[Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands): `Period`, `Command`, and `Shift` are valid key tokens. `_execute_action` invokes the popup directly and does not emit `commands.onCommand`. `commands.getAll()` includes it in Chromium 110+. OS-global commands have a different scope and more restrictive suggested keys; this action is deliberately browser-scoped. Minimum Chromium version is 120.

## Group identity and movement

[Tab Groups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups): IDs are unique **within a browser session**, not permanent. `query`, `get`, `update`, and `move` are supported; there is no persistent custom identifier or saved-group recovery method. A collapsed group has hidden tabs. Events are `onCreated`, `onUpdated`, `onMoved`, and `onRemoved`.

[Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs): `tabs.group({ tabIds, groupId })` adds tabs to an existing group; omitting `groupId` creates a new group. A nonempty tab list is required. Cross-window moves use `tabs.move(tabId, { windowId, index: -1 })` before grouping. `tabs.get` verifies final membership. Normal window restrictions are checked. The extension rejects pinned tabs before calling grouping rather than depending on undocumented unpinning behavior. Actual Brave behavior is still unverified.

[Windows API](https://developer.chrome.com/docs/extensions/reference/api/windows): `get` checks the window type/incognito state; `update(windowId, { focused: true })` focuses the destination after activation. No claim is made about native macOS focus restoration until manual testing.

## Recovery scope

[Sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions): `getRecentlyClosed({ maxResults: 25 })` returns `Session` objects containing either a tab or a window. `restore(sessionId)` restores that tab or window. There is no exposed group session object, reliable saved-group identifier, or complete group-membership snapshot. Omitting the session ID would restore the most recent session, which is unsafe here; the implementation always supplies the exact user-selected ID and rechecks it against individual tab entries.

No URL fingerprint or title heuristic is strong enough to justify silently restoring a window or claiming original-group identity. Therefore the UI offers metadata recreation and optional explicit single-tab recovery, never automatic full-group restoration. The original live group can be reused if it returns with a trusted session binding. After identity uncertainty, the user confirms the exact group.

## Persistence

[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage): `storage.local` persists configuration; `storage.session` survives worker suspension but is cleared on browser restart or extension disable/reload/update. The latter is the identity trust boundary. Session clearing causes cautious rebinding, not loss of number assignments. Local writes use one validated registry object. `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` limits access to trusted extension contexts.

API schemas were also inspected in the official [Chromium source](https://github.com/chromium/chromium/tree/main/chrome/common/extensions/api). Browser APIs are wrapped in `src/browser/gateway.ts` so failures and policy differences remain visible to the application.

## Visual reference

Inspected a browser-rendered Paper landing page and its HTML/CSS. It uses warm near-white surfaces, fine rules, generous typography with restrained weights, quiet secondary text, and compact controls. These traits informed the utility's type scale, separators, numeric alignment, and surfaces. Paper's illustration, logo, canvas composition, and marketing layout are not reused. Remote assets unavailable to that browser session were not taken as evidence of Paper's motion behavior.

[Paper Mono](https://github.com/paper-design/paper-mono) permits bundling under SIL OFL 1.1. `PaperMono-Regular.woff2` is copied without modification. Both `LICENSE.txt` (Paper/Geist attribution) and `OFL.txt` (project authors notice) ship with the build. Ordinary copy uses the native system sans-serif; numbers, shortcuts, and the wordmark use Paper Mono.
