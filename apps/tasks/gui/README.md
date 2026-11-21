# Tasks Web App

`index.html` and `src/app.js` own this App's business interface, action labels, forms and record presentation. Shared public `runtime/web/client.js` provides form/connection primitives; `runtime/web/server.cjs` serves the App and forwards only permitted Agent MCP tools. `src/view.js` remains the compatible reviewer renderer.

From the repository root:

```sh
node runtime/web/server.cjs --app tasks --run web-demo --profile sandbox
```

Open the access link printed by the Host. The CLI initializes new synthetic state; starting against existing state never resets it or changes its policy. For a read-restricted example use a fresh run with `--profile scenario`. Seed/reset/events stay in a separate Infra MCP process. The business page has no such routes.

The optional `pale.web` GUI extension describes the public business page independently of the legacy reviewer-renderer profile, so older validators can still validate business packages unchanged. A Host that ignores the extension does not provide a browser interface. No business data/tool schema is changed by this UI.

The same run, registry and state directory let MCP clients and this page observe the same backend. Use Refresh to observe independent changes; reopening the page preserves committed data. Real user-simulator or model-agent sessions are separate consumers; browser tests demonstrate controls and state consistency. This Host is loopback-only, with a per-start access link/session; it is not a production remote authentication deployment.

## Product interface

List/status navigation, completion checkboxes, due dates, priority labels and a details pane. Checkbox changes use the same versioned Tasks transition tool; blocked or denied changes report the backend error.

The controller owns these views. Shared UI code provides session handling, discovery, forms, version checks and safe text rendering. No business schema or MCP response changes are required. Only committed data comes from MCP; navigation and unfinished form text are transient UI state.
