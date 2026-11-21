# Environment proposal review · human checklist

Use with the agent checklist (`agent.en.md`). The agent runs every check first; you judge only the points below. Copy everything under **Review comment** into a GitHub review on the proposal PR, tick what holds, and add a one-line reason under any box you leave empty.

## Review comment

### Environment proposal review · key checks

**Agent report:** Reject `<n>` · Human judge `<n>`

<details><summary>Agent report</summary>

<!-- Paste the agent's workflow traces, verdict table and recommendation here. -->

</details>

**H0 · Agent check is clean**
- [ ] H0.1 The agent report has no Reject, or each one has a reason you accept. (D1–D8)
- [ ] H0.2 You resolved scope-blocking clarifications and decided every check the agent marked Human judge.

**H1 · Are the main workflows worth building for personal-agent tasks?**

Template: §2 “Briefly describe the main workflows and why this environment would be useful for personal-agent tasks.”

- [ ] H1.1 Doing these workflows right depends on knowing the person: their history, preferences, household or other apps. (D1.1)
- [ ] H1.2 You can think of at least one task a task author would want to build on them. (D1.1, D1.2)

Notify authors of overlapping proposals and link the existing work. Approval is non-exclusive; parallel implementation is allowed. Assess added value against already merged implementations, and count acceptance only after validated merge. (D1.3)

**H2 · Do the app connections serve those workflows?**

Template: §3 “Name possible connections and briefly explain their purpose.”

- [ ] H2.1 Every connection is used by a §2 workflow; none is there just for show. (D5.3, D7.1)
- [ ] H2.2 The report lists the personal Apps each workflow needs and verifies the actual App/interface capability, including separate Agent tool use. Required connections have a feasible plan; missing capabilities have owners and fallbacks or a scope exclusion. A named App or proposed contract is not evidence that it exists. No messaging is valid when not needed; do not require Mail or Calendar by default. (D5.3, D7.1)

**H3 · Could the platform and task authors build on it?**

Template: §3 Integration details: Operations and access, State and lifecycle, Events and notifications, and Shared data and dependencies are all required.

- [ ] H3.1 A task author could set up a starting situation for a specific person and reset it afterwards. (D4.1, D4.3)
- [ ] H3.2 The actions and events cover what tasks on these workflows will need; nothing essential is missing. (D3.1, D5.1)
- [ ] H3.3 The App can run on its own: only its package, the shared runtime and its declared dependencies. (D7.1)

**H4 · Could you accept the finished work against this plan?**

Template: “The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.”

- [ ] H4.1 The total effort looks realistic for the scope, the people named and the calendar time. (D7.2, D7.3)
- [ ] H4.2 The planned checks are strong enough for acceptance at merge: actual receiver records/files and caller-visible business results, plus relevant failure/retry outcomes. Supplied message examples were compared with the receiver contract, or the compatibility gap is recorded. Delivery acknowledgement is not automatically a business decision or sender rollback. Promised evaluator records have a feasible path through App history, Core audit and supplied Agent execution records, with explicit correlation and counting rules. Missing fields in Core audit alone do not imply a required Core change. (D4.2, D8.1, D8.2, D8.3)
- [ ] H4.3 The scope boundary leaves out the right things for a first version; reference-host limits are distinguished from required future adapters. (D2.3)

**H5 · Are the data, assets and run-time dependencies safe to use?**

Template: §4 License and external dependencies: the license for code and assets, what is hosted instead of redistributed, and how run-time services are replayed or controlled.

- [ ] H5.1 Nothing in the data or assets looks risky to publish: sources, brand use and licenses all hold up. (D6.3)
- [ ] H5.2 The replay or stand-in plan for any outside service is believable, so runs will not depend on the live internet. (D7.1)

**Recommendation** (tick one; it does not approve or merge the PR)

- [ ] Ready for scope approval
- [ ] Needs design changes
- [ ] Insufficient evidence
