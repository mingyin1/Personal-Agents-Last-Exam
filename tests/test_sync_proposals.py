"""Behavioral checks for PR discovery, lifecycle updates and safe index writes."""
import base64
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import sync_proposals as sync

ROOT = Path(__file__).resolve().parents[1]


def encoded(text, sha="file-sha"):
    return {"type": "file", "encoding": "base64", "size": len(text.encode()),
            "content": base64.b64encode(text.encode()).decode(), "sha": sha}


def pr(number=42, kind="Task", **overrides):
    result = {"number": number, "title": f"[{kind} Proposal] [Travel & commuting] Airport pickup",
              "body": "", "labels": [], "user": {"login": "contributor"},
              "state": "open", "draft": False, "created_at": "2026-11-15T12:01:02Z",
              "merged_at": None, "requested_reviewers": [], "requested_teams": []}
    result.update(overrides)
    return result


def review(state, number, user="reviewer"):
    return {"id": number, "state": state, "submitted_at": f"2026-11-15T13:{number:02}:00Z",
            "user": {"login": user}}


class FakeAPI:
    repository = "example/benchmark"

    def __init__(self, proposal, text, reviews=()):
        self.pr = proposal
        self.text = text
        self.reviews = reviews
        self.kind = sync.track(proposal)
        self.path = f"proposals/{self.kind}/airport-pickup.md"
        self.calls = []

    def pages(self, path, **params):
        self.calls.append((path, params))
        if path.endswith("/pulls"):
            return [self.pr, pr(99, title="Fix a typo")]
        if path.endswith("/files"):
            return [{"filename": self.path, "status": "added"}]
        if path.endswith("/reviews"):
            return self.reviews
        if path.endswith("/comments"):
            return []
        raise AssertionError(path)

    def request(self, path):
        self.calls.append(path)
        if path.endswith(f"/pulls/{self.pr['number']}"):
            return self.pr
        raise AssertionError(path)

    def contents(self, path, ref):
        self.calls.append((path, ref))
        if path != self.path:
            raise AssertionError(path)
        return encoded(self.text)


class ProposalSyncTests(unittest.TestCase):
    def test_owner_proposal_is_not_external_reviewer_backlog(self):
        api = FakeAPI(pr(user={"login": "DavidZWZ", "id": 57624585}), self.task)
        records = sync.collect(api, self.domains, "main")
        self.assertEqual(records[0]["review"], "Owner review; no external reviewer required")
        self.assertIn("0 awaiting initial review", sync.render(records, api.repository))
        api.pr["user"]["id"] = 17
        self.assertEqual(sync.collect(api, self.domains, "main")[0]["review"], "Awaiting review")

    def setUp(self):
        self.domains = sync.domains_from_readme((ROOT / "README.md").read_text())
        template = (ROOT / "proposals/templates/task-proposal.md").read_text()
        self.task = template.replace("`[Fill in: a concise task title]`", "Airport pickup")
        self.task = self.task.replace("`[Fill in: one domain from the table below]`", "Travel & commuting")
        self.task = self.task.replace("`[Fill in: other relevant domains, or None]`", "Money & insurance")
        self.task = self.task.replace(
            "`[Fill in: 1–2 sentences on why the right action depends on this person's history, boundaries or relationships rather than the surface request alone]`",
            "Resolve a changed arrival time against the user's mobility needs.",
        )

    def test_real_templates_and_domains_are_readable(self):
        self.assertEqual(len(self.domains), 15)
        self.assertEqual(sync.field(self.task, "Primary domain"), "Travel & commuting")
        self.assertTrue(sync.answer(self.task, "What makes this distinct and personal").startswith("Resolve"))
        legacy = "## 4. What makes this distinct and personal\n\n**✍️ Your answer (required):** Legacy summary.\n\nDetails."
        self.assertEqual(sync.answer(legacy, "What makes this distinct and personal"), "Legacy summary.")
        example = (ROOT / "proposals/task/lena-spring-gathering.md").read_text()
        self.assertTrue(sync.answer(example, "What makes this distinct and personal").startswith("When an earlier cutoff"))
        empty = (ROOT / "proposals/templates/task-proposal.md").read_text()
        self.assertEqual(sync.field(empty, "Short task title"), "")
        self.assertEqual(sync.answer(empty, "What makes this distinct and personal"), "")
        with self.assertRaises(ValueError):
            sync.domains_from_readme("Missing domain section")

    def test_tracks_from_title_label_and_checkbox(self):
        self.assertEqual(sync.track(pr()), "task")
        self.assertEqual(sync.track(pr(title="Calendar", labels=[{"name": "track:environment"}])), "environment")
        self.assertEqual(sync.track(pr(title="New proposal", body="- [x] Task Track\n- [ ] Environment Track")), "task")
        self.assertIsNone(sync.track(pr(title="Fix docs")))

    def test_comments_do_not_clear_change_requests(self):
        reviews = [review("CHANGES_REQUESTED", 1), review("COMMENTED", 2)]
        self.assertEqual(sync.review_state(reviews, pr()), ("Changes requested (1)", True))
        reviews.append(review("APPROVED", 3))
        self.assertEqual(sync.review_state(reviews, pr()), ("Approved (1)", False))
        reviews.append(review("DISMISSED", 4))
        self.assertEqual(sync.review_state(reviews, pr()), ("Commented", False))

    def test_review_requests_and_multiple_reviewers(self):
        self.assertEqual(sync.review_state([], pr(requested_teams=[{"slug": "reviewers"}]))[0], "Review requested")
        reviews = [review("APPROVED", 1), review("CHANGES_REQUESTED", 2, "second"),
                   review("APPROVED", 3, "contributor")]
        self.assertEqual(sync.review_state(reviews, pr()), ("Changes requested (1)", True))

    def test_lifecycle_and_acceptance_are_distinct(self):
        proposal = pr(labels=[{"name": "plan-approved"}])
        self.assertEqual(sync.progress(proposal, False), "Plan approved")
        self.assertEqual(sync.progress(proposal, True), "Changes requested")
        proposal["labels"].append({"name": "in-progress"})
        self.assertEqual(sync.progress(proposal, False), "Implementation")
        proposal["labels"].append({"name": "validation"})
        self.assertEqual(sync.progress(proposal, False), "Validation")
        proposal["draft"] = True
        self.assertEqual(sync.progress(proposal, False), "Draft")
        proposal["state"] = "closed"
        self.assertEqual(sync.progress(proposal, False), "Closed")
        proposal["merged_at"] = "2026-11-16T18:00:00Z"
        self.assertEqual(sync.progress(proposal, True), "Accepted")

    def test_collects_unmerged_file_through_base_pull_ref(self):
        api = FakeAPI(pr(), self.task, [review("APPROVED", 1)])
        records = sync.collect(api, self.domains, "main")
        self.assertEqual(len(records), 1)
        item = records[0]
        self.assertEqual(item["title"], "Airport pickup")
        self.assertEqual(item["primary"], "Travel & commuting")
        self.assertEqual(item["secondary"], "Money & insurance")
        self.assertEqual(item["status"], "Design review")
        self.assertEqual(item["review"], "Approved (1)")
        self.assertIn((api.path, "refs/pull/42/head"), api.calls)
        output = sync.render(records, api.repository)
        self.assertIn("2026-11-15 12:01:02", output)
        self.assertIn("https://github.com/example/benchmark/pull/42", output)
        self.assertEqual(output, sync.render(records, api.repository))

    def test_environment_summary_uses_app_and_connections(self):
        template = (ROOT / "proposals/templates/environment-proposal.md").read_text()
        replacements = {
            "app or website name and reference URL": "Calendar https://example.com",
            "one domain from the table below": "Work & business",
            "the workflows you plan to build and their value": "Schedule and reschedule meetings.",
            "personal apps and what could be read or updated, or None / TBD": "Mail: read invitations",
            "services and potential shared workflows, or None / TBD": "Travel: check arrival times",
        }
        for placeholder, value in replacements.items():
            template = template.replace(f"`[Fill in: {placeholder}]`", value)
        records = sync.collect(FakeAPI(pr(kind="Environment"), template), self.domains, "main")
        self.assertEqual(records[0]["primary"], "Work & business")
        self.assertIn("Mail: read invitations", records[0]["synopsis"])
        self.assertIn("Travel: check arrival times", records[0]["synopsis"])
        self.assertEqual(records[0]["title"], "Calendar https://example.com")

    def test_closed_and_merged_records_remain_visible(self):
        for merged, state in [(None, "Closed"), ("2026-11-16T18:00:00Z", "Accepted")]:
            api = FakeAPI(pr(state="closed", merged_at=merged), self.task)
            item = sync.collect(api, self.domains, "main")[0]
            self.assertEqual(item["status"], state)
            self.assertEqual(item["merged_at"], merged)

    def test_invalid_domain_and_missing_proposal_are_visible(self):
        api = FakeAPI(pr(), self.task.replace("Travel & commuting", "Unknown domain"))
        self.assertEqual(sync.collect(api, self.domains, "main")[0]["primary"], "Needs a valid primary domain")
        with patch.object(api, "contents", return_value=None):
            item = sync.collect(api, self.domains, "main")[0]
        self.assertEqual(item["issue"], "Proposal file is unavailable")
        self.assertEqual(item["primary"], "Travel & commuting")  # Title fallback.

    def test_merged_file_falls_back_to_merge_commit(self):
        api = FakeAPI(pr(merged_at="2026-11-16T18:00:00Z", merge_commit_sha="abc123"), self.task)
        with patch.object(api, "contents", side_effect=[None, encoded(self.task)]) as read:
            text, path, issue = sync.proposal_text(api, api.pr, "task")
        self.assertEqual(text, self.task)
        self.assertEqual(issue, "")
        self.assertEqual(read.call_args_list[1].args, (path, "abc123"))

    def test_api_failure_aborts_instead_of_silently_dropping_proposals(self):
        api = FakeAPI(pr(), self.task)
        with patch.object(api, "contents", side_effect=sync.APIError(403, "Rate limit")):
            with self.assertRaises(sync.APIError):
                sync.collect(api, self.domains, "main")

    def test_unsafe_markup_and_multiline_text_cannot_add_table_rows(self):
        api = FakeAPI(pr(), self.task)
        records = sync.collect(api, self.domains, "main")
        records[0]["synopsis"] = '<script>alert(1)</script> | evil\n| [click](javascript:bad) ![img](https://bad)'
        rendered = sync.render(records, api.repository)
        self.assertNotIn("<script>", rendered)
        self.assertIn("&lt;script&gt;", rendered)
        self.assertIn(r"\| evil", rendered)
        self.assertIn(r"\[click\]", rendered)
        self.assertNotIn("\n| [click]", rendered)

    def test_contents_only_treats_not_found_as_absence(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "request", side_effect=sync.APIError(404, "Missing")):
            self.assertIsNone(api.contents("file.md", "main"))
        with patch.object(api, "request", side_effect=sync.APIError(500, "Unavailable")):
            with self.assertRaises(sync.APIError):
                api.contents("file.md", "main")

    def test_pagination_fetches_every_page(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "request", side_effect=[list(range(100)), [100]]) as request:
            self.assertEqual(list(api.pages("/repos/example/benchmark/pulls", state="all")), list(range(101)))
        self.assertIn("page=2", request.call_args_list[1].args[0])

    def test_publish_is_idempotent_and_updates_only_index(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "contents", return_value=encoded("current")), patch.object(api, "request") as request:
            self.assertFalse(sync.publish(api, sync.INDEX_BRANCH, "current"))
            request.assert_not_called()
            self.assertTrue(sync.publish(api, sync.INDEX_BRANCH, "changed"))
            endpoint, method, data = request.call_args.args
            self.assertEqual(endpoint, "/repos/example/benchmark/contents/proposals/proposal-list.md")
            self.assertEqual(method, "PUT")
            self.assertEqual(data["branch"], sync.INDEX_BRANCH)
            self.assertEqual(data["sha"], "file-sha")
            self.assertEqual(base64.b64decode(data["content"]).decode(), "changed")

    def test_publish_retries_conflict_with_fresh_file_sha(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "contents", side_effect=[encoded("old", "a"), encoded("other", "b")]), \
                patch.object(api, "request", side_effect=[sync.APIError(409, "Conflict"), {}]) as request:
            self.assertTrue(sync.publish(api, sync.INDEX_BRANCH, "new"))
        self.assertEqual(request.call_args.args[2]["sha"], "b")

    def test_generated_index_cannot_write_main(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "request") as request:
            with self.assertRaises(ValueError):
                sync.publish(api, "main", "generated data")
            request.assert_not_called()

    def test_index_branch_bootstrap_only_creates_dedicated_ref(self):
        api = sync.GitHub("example/benchmark", None)
        with patch.object(api, "request", side_effect=[sync.APIError(404, "Missing"), {"object": {"sha": "base"}}, {}]) as request:
            sync.ensure_index_branch(api, "main")
        self.assertEqual(request.call_args.args[2], {"ref": "refs/heads/proposal-index", "sha": "base"})

    def test_oversized_proposal_is_not_parsed(self):
        api = FakeAPI(pr(), "x" * (sync.MAX_PROPOSAL_BYTES + 1))
        text, _, issue = sync.proposal_text(api, api.pr, "task")
        self.assertEqual(text, "")
        self.assertIn("200 KB", issue)

    def test_workload_counts_only_pending_open_non_draft_requests(self):
        api = FakeAPI(pr(requested_reviewers=[{"login": "haolun-wu"}]), self.task)
        active = sync.collect(api, self.domains, "main")[0]
        records = [active, {**active, "number": 43, "status": "Draft"},
                   {**active, "number": 44, "status": "Accepted"},
                   {**active, "number": 45, "status": "Closed"},
                   {**active, "number": 46, "reviewers": [], "review": "Approved (1)"},
                   {**active, "number": 47, "reviewers": [], "review": "Awaiting review"}]
        rendered = sync.render(records, api.repository)
        self.assertIn("3 open non-draft proposals · 1 awaiting initial review · 1 drafts", rendered)
        line = next(x for x in rendered.splitlines() if x.startswith("| Task | [haolun-wu]"))
        self.assertTrue(line.endswith("| 1 |"), line)


if __name__ == "__main__":
    unittest.main()
