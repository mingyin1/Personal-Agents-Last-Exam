"""Adversarial and lifecycle checks; no repository credentials or mutations."""
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from scripts import proposal_lifecycle as life
from scripts import sync_proposals as sync

HEAD = "a" * 40
NEXT = "b" * 40
BLOB = "c" * 40
NOW = datetime(2026, 11, 18, 22, tzinfo=timezone.utc)
PATH = "proposals/environment/example.md"
RULES = life.policy()


def pr(**overrides):
    value = {"number": 123, "state": "open", "draft": False, "base": {"ref": "main"},
             "head": {"sha": HEAD}, "user": {"login": "author"}, "body": "", "labels": [],
             "title": "[Environment Proposal] [Home & utilities] Example", "requested_reviewers": [{"login": "Jasonya"}]}
    value.update(overrides)
    return value


def files(implementation=False):
    rows = [{"filename": PATH, "status": "added"}]
    if implementation:
        rows += [{"filename": "apps/example/src/index.cjs", "status": "added"},
                 {"filename": "apps/example/tests/flow.test.cjs", "status": "added"}]
    return rows


def apply(state, command="approve-plan", args=HEAD, **overrides):
    kwargs = {"actor": "Jasonya", "maintainer": False, "assigned": True, "author": False, "coauthor": False,
              "pr": pr(), "kind": "environment", "path": PATH, "blob": BLOB,
              "files": files(), "rules": RULES, "now": NOW, "comment_id": 1}
    kwargs.update(overrides)
    return life.apply_command(state, command, args, **kwargs)


def initial():
    return {"version": 1, "number": 123, "processed": []}


def approved():
    return apply(initial())[0]


def submitted():
    return apply(approved(), "submit-implementation", HEAD + " https://example.org/evidence", actor="author", assigned=False,
                 author=True, coauthor=True, files=files(True), comment_id=2)[0]


def accepted():
    return apply(submitted(), "accept-implementation", HEAD + " https://example.org/reproduction", actor="maintainer",
                 assigned=False, maintainer=True, files=files(True), comment_id=3)[0]


def checks():
    return [{"id": i + 1, "head_sha": HEAD, "name": name, "status": "completed", "conclusion": "success",
             "app": {"id": 15368}} for i, name in enumerate(RULES["environment_checks"])]


def gate(state, **overrides):
    data = {"pr": pr(), "files": files(True), "state": state, "kind": "environment", "path": PATH,
            "blob": BLOB, "issue": "", "rules": RULES, "checks": checks()}
    data.update(overrides)
    return life.gate(**data)


def bot_comment(state, **overrides):
    value = {"id": 50, "user": {"login": "github-actions[bot]"}, "performed_via_github_app": {"id": 15368},
             "body": life.render_state(state, NOW)}
    value.update(overrides)
    return value


class LifecycleTests(unittest.TestCase):
    def test_owner_can_review_and_accept_own_work_without_another_reviewer(self):
        owner = dict(actor="DavidZWZ", actor_id=57624585, maintainer=True,
                     assigned=False, author=True, coauthor=True, files=files(True))
        state, _ = apply(initial(), **owner)
        self.assertEqual(state["approval"]["by"], "DavidZWZ")
        self.assertEqual(gate(state)[0], "pending")
        state, _ = apply(state, "submit-implementation", HEAD + " https://example.org/evidence", comment_id=2, **owner)
        state, _ = apply(state, "accept-implementation", HEAD + " https://example.org/evidence", comment_id=3, **owner)
        self.assertEqual(state["acceptance"]["by"], "DavidZWZ")
        self.assertEqual(gate(state)[0], "success")
        self.assertEqual(gate(state, checks=[])[0], "pending")
        self.assertEqual(gate(state, pr=pr(head={"sha": NEXT}))[0], "pending")

    def test_owner_exception_needs_api_identity_and_current_write_access(self):
        for login, user_id, maintainer in [("DavidZWZ", 1, True), ("DavidZWZ", None, True),
                ("DavidZWZ-copy", 57624585, True), ("DavidZWZ", 57624585, False), ("another-admin", 2, True)]:
            with self.subTest(login=login, user_id=user_id, maintainer=maintainer), self.assertRaises(ValueError):
                apply(initial(), actor=login, actor_id=user_id, maintainer=maintainer,
                      assigned=False, author=True, coauthor=True)

    def test_owner_review_still_requires_current_scope_and_evidence(self):
        owner = dict(actor="DavidZWZ", actor_id=57624585, maintainer=True, assigned=False, author=True)
        for overrides in [{"args": NEXT}, {"pr": pr(draft=True)}, {"kind": "unknown"}]:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                apply(initial(), **owner, **overrides)
        with self.assertRaises(ValueError):
            apply(submitted(), "accept-implementation", HEAD + " file:///tmp/log", files=files(True), comment_id=3, **owner)

    def test_permission_endpoint_does_not_need_collaborator_list_visibility(self):
        for permission, expected in [("admin", (True, True)), ("write", (True, True)),
                                     ("read", (True, False)), ("none", (False, False))]:
            api = Mock(repository="example/repo")
            api.request.return_value = {"permission": permission}
            self.assertEqual(life.Lifecycle(api, RULES).access("DavidZWZ"), expected)
            api.request.assert_called_once_with("/repos/example/repo/collaborators/DavidZWZ/permission")

    def test_assignment_is_not_design_approval(self):
        self.assertEqual(gate(initial())[0], "pending")

    def test_plan_approval_is_not_merge_acceptance(self):
        state = approved()
        self.assertEqual(state["stage"], "plan-approved")
        self.assertNotIn("acceptance", state)
        self.assertEqual(gate(state, files=files())[0], "pending")
        self.assertEqual(state["environment_v1_due_at"], "2026-12-02T22:00:00Z")

    def test_authors_and_coauthors_cannot_self_approve_even_as_admin(self):
        for key in ["author", "coauthor"]:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "self-approve"):
                apply(initial(), maintainer=True, **{key: True})

    def test_unassigned_reviewer_cannot_approve(self):
        with self.assertRaisesRegex(ValueError, "assigned"):
            apply(initial(), assigned=False)

    def test_maintainer_can_approve_without_being_requested(self):
        self.assertEqual(apply(initial(), maintainer=True, assigned=False)[0]["stage"], "plan-approved")

    def test_explicit_current_sha_required(self):
        for arg in ["", HEAD[:7], NEXT, HEAD + " extra"]:
            with self.subTest(arg=arg), self.assertRaises(ValueError):
                apply(initial(), args=arg)

    def test_draft_closed_and_wrong_base_are_rejected(self):
        for overrides in [{"draft": True}, {"state": "closed"}, {"base": {"ref": "elsewhere"}}]:
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                apply(initial(), pr=pr(**overrides))

    def test_repeated_command_is_idempotent(self):
        state = approved()
        same, changed = apply(state, now=NOW + timedelta(days=3))
        self.assertFalse(changed)
        self.assertEqual(state, same)

    def test_reapproval_does_not_reset_deadline(self):
        state, _ = apply(approved(), now=NOW + timedelta(days=7), comment_id=2)
        self.assertEqual(state["environment_v1_due_at"], approved()["environment_v1_due_at"])

    def test_task_has_no_environment_deadline(self):
        state, _ = apply(initial(), kind="task", path="proposals/task/example.md")
        self.assertNotIn("environment_v1_due_at", state)

    def test_unapproved_plan_cannot_start_or_submit_implementation(self):
        for cmd, args in [("start-implementation", ""), ("submit-implementation", HEAD + " https://example.org/run")]:
            with self.subTest(cmd=cmd), self.assertRaisesRegex(ValueError, "approve-plan"):
                apply(initial(), cmd, args, files=files(True))

    def test_author_can_start_without_merge_authority(self):
        state, _ = apply(approved(), "start-implementation", "", author=True, coauthor=True, assigned=False, comment_id=2)
        self.assertEqual(state["stage"], "in-progress")
        self.assertEqual(gate(state)[0], "pending")

    def test_docs_images_and_gitkeep_are_not_implementation(self):
        for name in ["README.md", "screenshot.png", ".gitkeep"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "implementation changes"):
                apply(approved(), "submit-implementation", HEAD + " https://example.org/run", comment_id=2,
                      files=files() + [{"filename": "apps/example/" + name, "status": "added"}])

    def test_submission_is_not_acceptance(self):
        self.assertEqual(gate(submitted())[0], "pending")
        self.assertIn("subject to review", life.due_status(submitted(), NOW))

    def test_reviewer_read_permission_cannot_accept_final_implementation(self):
        with self.assertRaisesRegex(ValueError, "maintainer"):
            apply(submitted(), "accept-implementation", HEAD + " https://example.org/run", files=files(True), comment_id=3)

    def test_final_acceptance_requires_submission_of_exact_head(self):
        with self.assertRaisesRegex(ValueError, "Submit implementation"):
            apply(approved(), "accept-implementation", HEAD + " https://example.org/run", maintainer=True, files=files(True), comment_id=3)

    def test_acceptance_cannot_self_approve(self):
        with self.assertRaisesRegex(ValueError, "non-author"):
            apply(submitted(), "accept-implementation", HEAD + " https://example.org/run", maintainer=True,
                  author=True, files=files(True), comment_id=3)

    def test_invalid_evidence_is_rejected(self):
        for url in ["file:///tmp/evidence", "https://a:b@example.org/", "https://example.org/<script>"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                apply(approved(), "submit-implementation", HEAD + " " + url, comment_id=2, files=files(True))

    def test_accepted_implementation_still_needs_current_successful_ci(self):
        self.assertEqual(gate(accepted())[0], "success")
        for field, value in [("head_sha", NEXT), ("conclusion", "skipped"), ("conclusion", "failure"), ("status", "in_progress"), ("app", {"id": 1})]:
            bad = checks();bad[0][field] = value
            with self.subTest(field=field, value=value):
                self.assertEqual(gate(accepted(), checks=bad)[0], "pending")

    def test_latest_ci_rerun_supersedes_old_success(self):
        rows = checks();rows.append({**rows[0], "id": 100, "conclusion": "failure"})
        self.assertEqual(gate(accepted(), checks=rows)[0], "pending")

    def test_new_commit_invalidates_final_acceptance_but_preserves_plan(self):
        self.assertTrue(life.approval_valid(accepted(), PATH, BLOB))
        self.assertEqual(gate(accepted(), pr=pr(head={"sha": NEXT}))[0], "pending")

    def test_modified_proposal_invalidates_plan_and_gate(self):
        self.assertEqual(gate(accepted(), blob="new-proposal-blob")[0], "pending")

    def test_stage_labels_cannot_bypass_missing_approval_record(self):
        labels = [{"name": x} for x in ["plan-approved", "validation", "ready-to-merge"]]
        self.assertEqual(gate(initial(), pr=pr(labels=labels))[0], "pending")

    def test_renaming_title_cannot_turn_proposal_into_maintenance(self):
        kind, _, _ = life.classify(pr(title="Fix docs"), files(), initial())
        self.assertEqual(kind, "environment")

    def test_deleted_or_moved_proposal_and_bare_app_are_not_exempt(self):
        for rows in [[{"filename": PATH, "status": "removed"}],
                     [{"filename": "docs/plan.md", "previous_filename": PATH, "status": "renamed"}],
                     [{"filename": "apps/example/main.py", "status": "added"}]]:
            self.assertEqual(life.classify(pr(title="Fix docs"), rows, initial())[0], "unknown")

    def test_ordinary_maintenance_does_not_need_a_proposal(self):
        rows = [{"filename": "scripts/sync_proposals.py", "status": "modified"}]
        self.assertEqual(life.classify(pr(title="Fix tooling"), rows, initial()), (None, None, ""))
        self.assertEqual(gate(initial(), kind=None)[0], "success")

    def test_allowlisted_existing_example_is_documentation_maintenance(self):
        example = "proposals/task/lena-spring-gathering.md"
        rows = [{"filename": example, "status": "modified"},
                {"filename": "proposals/templates/task-proposal.md", "status": "modified"}]
        self.assertEqual(life.classify(pr(title="Improve the worked example"), rows, initial(), [example]), (None, None, ""))
        self.assertEqual(life.classify(pr(title="Improve the worked example"), rows, initial())[0], "task")

    def test_new_removed_or_renamed_examples_do_not_bypass_contribution_review(self):
        example = "proposals/task/lena-spring-gathering.md"
        for row in [{"filename": example, "status": "added"},
                    {"filename": example, "status": "removed"},
                    {"filename": example, "status": "renamed", "previous_filename": "proposals/task/new-task.md"},
                    {"filename": "docs/example.md", "status": "renamed", "previous_filename": example}]:
            with self.subTest(row=row):
                self.assertIsNotNone(life.classify(pr(title="Docs"), [row], initial(), [example])[0])

    def test_example_edit_does_not_hide_new_proposal_or_implementation(self):
        example = "proposals/task/lena-spring-gathering.md"
        rows = [{"filename": example, "status": "modified"}]
        for other in ["apps/demo/plugin.cjs", "tasks/demo/instruction.md", "proposals/task/another-task.md"]:
            with self.subTest(other=other):
                result = life.classify(pr(title="Docs"), rows + [{"filename": other, "status": "added"}], initial(), [example])
                self.assertIsNotNone(result[0])

    def test_explicit_track_and_recorded_lifecycle_cannot_become_example_maintenance(self):
        example = "proposals/task/lena-spring-gathering.md"
        rows = [{"filename": example, "status": "modified"}]
        for p, state in [(pr(title="[Task Proposal] [Food & dining] Example"), initial()),
                         (pr(title="Docs", labels=[{"name": "track:task"}]), initial()),
                         (pr(title="Docs", body="- [x] Task Track"), initial()),
                         (pr(title="Docs"), {**initial(), "track": "task"})]:
            self.assertIsNotNone(life.classify(p, rows, state, [example])[0])

    def test_context_uses_trusted_policy_for_example_maintenance(self):
        example = "proposals/task/lena-spring-gathering.md"
        api = Mock(repository="example/repo")
        api.pages.side_effect = lambda path, **kwargs: (
            [{"filename": example, "status": "modified"}] if path.endswith("/files") else [])
        context = life.Lifecycle(api, {**RULES, "documentation_examples": [example]}, NOW).context(pr(title="Docs"))
        self.assertIsNone(context["kind"])
        api.contents.assert_not_called()

    def test_spoofed_state_comment_is_ignored(self):
        for changes in [{"user": {"login": "author"}}, {"performed_via_github_app": None}]:
            self.assertIsNone(life.load_state([bot_comment(accepted(), **changes)], 123)[1])
        self.assertEqual(life.load_state([bot_comment(approved())], 123)[1], 50)

    def test_duplicate_or_wrong_identity_state_fails_closed(self):
        with self.assertRaises(ValueError):life.load_state([bot_comment(approved()), bot_comment(approved(), id=51)], 123)
        with self.assertRaises(ValueError):life.load_state([bot_comment(approved())], 124)

    def test_only_explicit_unquoted_commands_are_parsed(self):
        for value in ["> /approve-plan " + HEAD, "```\n/approve-plan " + HEAD + "\n```", "Please /approve-plan " + HEAD]:
            self.assertIsNone(life.parse_command(value))
        self.assertEqual(life.parse_command("/approve-plan " + HEAD), ("approve-plan", HEAD))

    def test_deadline_boundary_and_overdue_do_not_close_pr(self):
        state = approved();due = life.timestamp(state["environment_v1_due_at"])
        self.assertEqual(life.due_status(state, due), "Awaiting v1")
        self.assertEqual(life.due_status(state, due + timedelta(seconds=1)), "Overdue")
        self.assertNotIn("closed", state)

    def test_only_maintainer_can_extend_deadline_with_reason(self):
        for args in ["2026-12-10", "2026-11-19 too early"]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                apply(approved(), "extend-deadline", args, maintainer=True, comment_id=2)
        with self.assertRaises(ValueError):
            apply(approved(), "extend-deadline", "2026-12-10 dependency delay", comment_id=2)
        state, _ = apply(approved(), "extend-deadline", "2026-12-10 dependency delay", maintainer=True, comment_id=2)
        self.assertEqual(state["environment_v1_due_at"], "2026-12-10T23:59:59Z")
        self.assertEqual(state["extensions"][0]["reason"], "dependency delay")

    def test_revocation_removes_merge_authority_without_resetting_clock(self):
        state, _ = apply(accepted(), "revoke-plan", "Scope changed", comment_id=4)
        self.assertNotIn("approval", state)
        self.assertNotIn("acceptance", state)
        self.assertEqual(state["environment_v1_due_at"], approved()["environment_v1_due_at"])
        self.assertEqual(gate(state)[0], "pending")

    def test_owner_assignment_survives_submitted_review(self):
        api = Mock(repository="example/repo")
        api.pages.return_value = [{"event": "review_requested", "requested_reviewer": {"login": "Jasonya"}}]
        runner = life.Lifecycle(api, RULES)
        self.assertTrue(runner.is_assigned(pr(requested_reviewers=[]), "Jasonya", "environment"))
        api.pages.return_value += [{"event": "review_request_removed", "requested_reviewer": {"login": "Jasonya"}}]
        self.assertFalse(runner.is_assigned(pr(requested_reviewers=[]), "Jasonya", "environment"))
        self.assertFalse(runner.is_assigned(pr(), "Jasonya", "task"))

    def test_public_read_does_not_equal_collaborator(self):
        api = Mock(repository="example/repo")
        api.request.side_effect = sync.APIError(404, "Not a collaborator")
        self.assertEqual(life.Lifecycle(api, RULES).access("outsider"), (False, False))

    def test_workflow_never_checks_out_pr_head_or_runs_contributor_code(self):
        text = (life.ROOT / ".github/workflows/proposal-lifecycle.yml").read_text()
        self.assertIn("ref: ${{ github.event.repository.default_branch }}", text)
        self.assertNotIn("pull_request.head", text)
        self.assertNotIn("npm", text)
        self.assertNotIn("contents: write", text)
        self.assertIn("pull-requests: write", text)  # PR conversation comments

    def test_shared_commit_cannot_borrow_another_prs_success(self):
        api = Mock(repository="example/repo")
        maintenance = pr(number=124, title="Fix documentation")
        api.pages.return_value = [maintenance, pr()]
        def request(path, method="GET", data=None):
            if path.endswith("/status"):return {"statuses": []}
            if "/check-runs?" in path:return {"check_runs": []}
            return {}
        api.request.side_effect = request
        runner = life.Lifecycle(api, RULES, NOW)
        def context(p):
            is_proposal = p["number"] == 123
            return {"pr": p, "files": files() if is_proposal else [], "comments": [], "state": initial(),
                    "comment_id": None, "kind": "environment" if is_proposal else None,
                    "path": PATH if is_proposal else None, "blob": BLOB, "issue": ""}
        with patch.object(runner, "context", side_effect=context):runner.reconcile({124})
        writes = [c for c in api.request.call_args_list if len(c.args) >= 2 and c.args[1] == "POST"]
        status = next(c.args[2] for c in writes if "/statuses/" in c.args[0])
        self.assertEqual(status["state"], "pending")
        self.assertIn("#123", status["description"])

    def test_draft_transition_replaces_a_previous_successful_conclusion(self):
        api = Mock(repository="example/repo")
        draft = pr(title="Fix documentation", draft=True)
        api.pages.return_value = [draft]
        def request(path, method="GET", data=None):
            if path.endswith("/status"):return {"statuses": []}
            if "/check-runs?" in path:
                return {"check_runs": [{"id": 999, "external_id": "pale-contribution-ready:" + HEAD,
                    "app": {"id": 15368}, "status": "completed", "conclusion": "success"}]}
            return {}
        api.request.side_effect = request
        runner = life.Lifecycle(api, RULES, NOW)
        context = {"pr": draft, "files": [], "comments": [], "state": initial(),
                   "comment_id": None, "kind": None, "path": None, "blob": None, "issue": ""}
        with patch.object(runner, "context", return_value=context):runner.reconcile()
        update = next(c.args[2] for c in api.request.call_args_list
                      if len(c.args) >= 2 and c.args[1] == "PATCH" and c.args[0].endswith("/check-runs/999"))
        self.assertEqual(update["status"], "completed")
        self.assertEqual(update["conclusion"], "action_required")

    def test_plain_approval_creates_only_plan_label_and_never_merges(self):
        api = Mock(repository="example/repo")
        runner = life.Lifecycle(api, RULES, NOW)
        runner.update_labels({"state": approved(), "pr": pr(), "path": PATH, "blob": BLOB})
        writes = [c for c in api.request.call_args_list if len(c.args) >= 2 and c.args[1] == "POST"]
        self.assertEqual([c.args[2] for c in writes], [{"labels": ["plan-approved"]}])
        self.assertFalse(any("/merge" in c.args[0] for c in api.request.call_args_list))

    def test_changing_a_proposal_clears_ready_to_merge_label(self):
        api = Mock(repository="example/repo")
        runner = life.Lifecycle(api, RULES, NOW)
        p = pr(labels=[{"name": "ready-to-merge"}, {"name": "plan-approved"}])
        runner.update_labels({"state": accepted(), "pr": p, "path": PATH, "blob": "different"})
        deleted = [c.args[0] for c in api.request.call_args_list if len(c.args) > 1 and c.args[1] == "DELETE"]
        self.assertTrue(any(x.endswith("/ready-to-merge") for x in deleted))
        self.assertTrue(any(x.endswith("/plan-approved") for x in deleted))

    def test_comment_edit_does_not_execute_a_command(self):
        api = Mock(repository="example/repo")
        comment = {"id": 7, "body": "/approve-plan " + HEAD, "user": {"login": "Jasonya"},
                   "created_at": "2026-11-20T00:00:00Z", "updated_at": "2026-11-20T00:00:01Z"}
        api.request.return_value = comment
        runner = life.Lifecycle(api, RULES, NOW)
        runner.command({"issue": {"number": 123}, "comment": comment})
        self.assertEqual(api.request.call_count, 1)

    def test_request_text_cannot_replace_api_comment_identity(self):
        api = Mock(repository="example/repo")
        comment = {"id": 7, "body": "/approve-plan " + HEAD, "user": {"login": "outsider"},
                   "created_at": "2026-11-20T00:00:00Z", "updated_at": "2026-11-20T00:00:00Z"}
        api.request.return_value = comment
        runner = life.Lifecycle(api, RULES, NOW)
        runner.command({"issue": {"number": 123}, "comment": {**comment, "user": {"login": "Jasonya"}}})
        self.assertEqual(api.request.call_count, 1)

    def test_self_review_uses_fresh_comment_user_id_not_event_claim(self):
        api = Mock(repository="example/repo")
        comment = {"id": 7, "body": "/approve-plan " + HEAD,
                   "user": {"login": "DavidZWZ", "id": 17},
                   "created_at": "2026-11-20T00:00:00Z", "updated_at": "2026-11-20T00:00:00Z"}
        api.request.side_effect = [comment, pr()]
        runner = life.Lifecycle(api, RULES, NOW)
        context = {"pr": pr(), "files": files(), "comments": [], "state": initial(),
                   "kind": "environment", "path": PATH, "blob": BLOB, "text": "", "issue": ""}
        with patch.object(runner, "context", return_value=context), patch.object(runner, "access", return_value=(True, True)), \
                patch.object(life, "apply_command", return_value=(initial(), False)) as command:
            runner.command({"issue": {"number": 123}, "comment": {**comment, "user": {"login": "DavidZWZ", "id": 57624585}}})
        self.assertEqual(command.call_args.kwargs["actor_id"], 17)


if __name__ == "__main__":
    unittest.main()
