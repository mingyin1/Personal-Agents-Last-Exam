# Public business Web Host

Seven Apps provide their own business pages/controllers in `gui/`: Mail, Calendar, Files, Messages, Notes, Tasks and Contacts. This shared Host serves those files and connects the page to a fixed **Agent** MCP process for one App/run. It contains no App-specific operation logic and exposes no management connection to the browser.

## Start an App

Node 18+ is sufficient to run the Host; no npm install is needed:

```sh
node runtime/web/server.cjs --app mail --run web-demo --profile sandbox
node runtime/web/server.cjs --app calendar --run web-demo --profile sandbox
# Other --app values: files, messages, notes, tasks, contacts
```

Open the access link printed by each process. A port is selected automatically; `--port 8780` is optional. `--state-dir` and `--registry` select the same state and package assembly as ordinary MCP clients. The provided `apps.registry.json` includes all seven Apps. Each App still has separate state and can run independently.

Only a **new** instance is initialized with the CLI-selected synthetic profile. `sandbox` enables declared business writes; use a fresh run with `--profile scenario` for restricted Task-like permissions. Starting a Host for existing state never resets that state or changes its policy. To load a real Task or inject a scenario, use the separate Infra MCP interface. There is no browser API for those operations.

The trusted Infra launcher passes `--initial-profile` to Core, which selects that policy in the transaction that first creates state. Concurrent Hosts reuse the winning initialization. The Web Host no longer uses `.web-init` directories: leftovers from an interrupted older Host do not block startup, and no lock needs to be deleted to restart it. This does not change Core's separate transaction-lock recovery or provide distributed locking across machines.

Agent and user-simulator clients can consume the business GUI or its MCP backend when configured by their own runtime. This package provides the interface and browser-test evidence, not a model adapter, remote deployment or user-simulator implementation.

## App versus Host ownership

| App package | Shared Host |
| --- | --- |
| `gui/index.html`: entry page | HTTP serving and local access session |
| `gui/src/app.js`: App action labels, forms, defaults, selection and record presentation | Fixed Agent MCP connection, live discovery and permission filtering |
| `src/`: business validation and state transitions | Public shared form/connection primitives and stylesheet |
| `contribution/gui.json`: optional `pale.web` extension | Existing Core commits, versions and resource authorization |

The legacy `gui/src/view.js` and reviewer-renderer declaration remain compatible with older reference validators. The additive **optional** `pale.web` version 1 extension identifies `page`, `controller`, business `audience`, `host`, `transport` and `status`. The new Host uses those package-local references. Older Hosts may ignore the extension and still operate the App through MCP; they do not thereby provide a GUI. No business seed/tool/event schema changes are required.

Forms use only live Agent-visible tool schemas. Writes retain the version observed when the form opens. A stale form shows the conflict rather than silently refreshing and overwriting. An unchanged form reuses its request ID after a lost response, so retry does not repeat a committed effect. Refresh reads backend state again; there is no browser-side business store. Attachments transfer actual bytes through authorized App tools. App text is rendered as text, never executable HTML.

Mail send and Messages send preserve their existing local semantics. A Sent record is not a downstream delivery receipt. Cross-App delivery remains the explicit Messaging workflow; the GUI does not invent an automatic route.

## Local access boundary

The listener binds only to `127.0.0.1`. A per-start access link establishes an HttpOnly SameSite session; the fragment is removed from browser history. Data APIs require that session. Writes additionally require a same-origin JSON request and session CSRF token. Host checks prevent DNS rebinding; static serving is an explicit file allowlist. There are no fixture/state/source downloads, arbitrary MCP methods, client-selected App/run/role, or Infra routes.

The temporary Infra initializer closes before the business listener starts. Existing Core checks still authorize every business call. Production HTTPS/OAuth, multi-user sessions, rate controls and remote service isolation require a deployment adapter; do not expose this loopback Host through a public tunnel as a production service.

## Reproduce GUI verification

```sh
npm ci
npx playwright install chromium
npm run test:web
npm run test:web:browser
```

The fixed Playwright dependency is only for browser tests; stdio and App-local tests still need no npm install. CI pins Ubuntu 24.04 and Node 22, installs Chromium and runs the same commands.

- Host tests: session/origin/CSRF, role forgery, direct management requests, hidden paths, version/retry, interrupted and concurrent startup, restart and restricted profile.
- Browser tests: real create/edit controls on every App, MCP state inspection, reload, scenario refresh, business denials/conflicts, original-byte upload/download, text escaping, responsive layout and JavaScript errors.
- Screenshots and a machine-readable report are written to `.artifacts/web/`. A browser test is not a model-agent evaluation.

## App-specific product views

The Apps use distinct interfaces: Mail inbox/reader, Calendar month/agenda, Files folder browser, Messages conversations/composer, Notes paper/editor, Tasks checkable lists, and Contacts address book. Each `gui/src/app.js` supplies its navigation, filters, row/detail rendering and interaction choices. The shared client supplies transport, accessible DOM primitives, versioned writes and attachment rendering; it does not implement App business transitions.

Folder names, conversation names and attachment filenames replace raw references where the authorized API provides those choices. New events without attachments remain valid. Person references without a directory lookup are readable labels derived from the reference, not independently resolved identity records. Refresh re-reads the App; it is not a background push subscription.

Browser acceptance also checks Reply prefills, authorized image preview, missing attachments, month navigation/date prefills, folder double-click navigation, in-thread sending, pinned notes, task checkboxes and contact groups. These workflow checks complement screenshot inspection; passing them does not certify a complete commercial product feature set.
