# Grouping Gang 1.1.1

This patch fixes the narrow toolbar popup in V1.1. The document and launcher request 560 px width with a 520 px minimum. The search field, destination rows, fixed number column, status labels and action controls stay within the launcher. Shorter viewports can scroll vertically. Tab movement, assignments, search, recovery and Undo logic are unchanged.

## Downloads and installation on macOS

The export branch `export/grouping-gang-v1.1.1` contains these files under `exports/grouping-gang-v1.1.1/`:

- `grouping-gang-v1.1.1-install.zip`: production extension, including local fonts and licences.
- `grouping-gang-v1.1.1-source.zip`: complete committed source, tests, configuration, documentation and lockfile.
- `SHA256SUMS.txt`: SHA-256 digests of both archives.

Download all three into the same directory and verify them in Terminal:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Extract the installation ZIP into a permanent location. The extracted `grouping-gang/` folder contains `manifest.json` directly inside it. Open `brave://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder. For an existing unpacked installation, replace its files in the original installation folder and click **Reload** to retain the same extension path. Keep the installation folder after loading.

To reproduce the build, extract the source ZIP, enter `grouping-gang-source/`, use Node.js 24, then run:

```sh
npm ci
npm run build
npm run test
npm run test:browser
npm run typecheck
npm run lint
npm run format:check
```

`dist/` is the resulting unpacked extension. Browser checks require Chromium; see the README for `CHROMIUM_PATH`.

## Validation and remaining limitations

The release preparation passed all six commands above: 141 automated tests and 41 Chromium-rendered UI checks. The popup geometry regression starts at a 40 px viewport before navigation; the document and launcher measure 560 px, search approximately 440 px, and results 528 px. Ten destinations retain aligned 28 px numbers and readable title columns. At normal and 300 px viewport heights there is no unexpected horizontal overflow. Both themes and loading, empty, error, Undo and onboarding states were inspected.

The Chromium UI runner renders production HTML/CSS with mocked Chrome APIs. It cannot prove native toolbar-popup auto-sizing, Brave/macOS behavior, shortcut dispatch, native grouping or notification delivery. Cloud Chromium blocks unpacked extensions by administrator policy. Native Brave verification remains required using [the acceptance checklist](VALIDATION.md).

The archives exclude Git history, dependencies, browser profiles, environment files and generated development artifacts. Publication and downloaded-file checksum verification are reported separately after the export branch is accessible remotely.
