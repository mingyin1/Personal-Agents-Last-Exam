# Personal Apps: executable integration

From the repository root, run `node examples/workflows/personal-apps/run.cjs`. It uses temporary state and real public MCP processes, no model API, installed packages or private host. It prints a reproducible report and cleans up after itself. `npm run test:personal-apps` also runs isolated business tests and the public verifier for all five packages.

The workflows exercise:

1. Every App: tool discovery, scenario write denial, sandbox write, stale version, idempotent retry, reset, persistence and run isolation.
2. Contacts → Tasks: resolve a stable person ID, assign a real task, complete and explicitly reopen it.
3. Files → Mail → Notes: preserve original bytes/hash across authorized business operations; inspect actual destination records and attachment bytes.
4. Order notifier → Messages: use the receiver-owned `channel.chat` contract, bound account/conversation, explicit delivery grant and attachment import. Verify successful receipt, missing producer time, retry, conflicting retry, spoofed source, unknown account, missing grant and rejected conversation. A received notification retains its publishing App provenance and cannot be edited as local authored content, even when both accounts have the same owner.
5. Messages account A → account B: build the outgoing event from actual source state and verify separate receiver state, message history and bytes. Advancing the source clock and marking the outgoing message read must preserve its event identity/time; publishing it again must return a duplicate receipt without another receiving record.

Workflows 2 and 3 explicitly coordinate ordinary App tools over MCP. Workflows 4 and 5 use Messaging for event delivery. The Router does not automatically orchestrate arbitrary business operations or choose recipients.

`publisher/` is an isolated send-only example like the existing Delivery example. It is not a replacement shopping service. Its wire schema is a pinned copy of Messages' receive contract and is compared in the test. `notification-config.json` and `messages-config.json` are trusted local run configuration; production credentials do not belong in these files.

New Apps should reuse the receiving App's published contract. A publisher supplies its real business data; the receiving App owns validation and state updates. Identity, recipient grants, version checks and receipts use existing Core/Messaging behavior. `channel.chat` here is a proposed Messages contract, not an assertion that Kinthread (#85) already supports it.
