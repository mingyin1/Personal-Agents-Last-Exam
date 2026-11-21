"""Routing behavior and safety checks. No credentials or network access."""
import base64
import copy
import json
from pathlib import Path
import re
import unittest

from scripts import assign_proposal_reviewers as routing
from scripts.sync_proposals import APIError, domains_from_readme

ROOT = Path(__file__).resolve().parents[1]
RULES = json.loads((ROOT / ".github/review-policy.json").read_text())


def pr(number=1, kind="task", domain="Travel & commuting", author="contributor", **extra):
    row = {"number": number, "title": f"[{kind.title()} Proposal] [{domain}] Example",
           "head": {"sha": f"{number:040x}"}, "base": {"ref": "main"}, "user": {"login": author},
           "state": "open", "draft": False, "labels": [], "requested_reviewers": [], "requested_teams": []}
    row.update(extra)
    return row


class FakeAPI:
    repository = "example/repo"

    def __init__(self, pulls):
        self.pulls = {p["number"]: copy.deepcopy(p) for p in pulls}
        self.files, self.text, self.events, self.reviews = {}, {}, {}, {}
        self.unavailable, self.changed, self.posts, self.calls = set(), {}, [], []
        for p in pulls:
            n = p["number"]; match = routing.TITLE.match(p["title"])
            kind = match[1].lower() if match else "task"
            domain = (match[2] or "").split("+")[0].strip() if match else "Travel & commuting"
            path = f"proposals/{kind}/example-{n}.md"
            self.files[n] = [{"filename": path, "status": "added"}]
            self.text[path] = f"- **Primary domain (required):** {domain}\n- **Authors / GitHub handles (required):** @{p['user']['login']}\n"
            self.events[n], self.reviews[n] = [], []

    def pages(self, path, **params):
        self.calls.append((path, params))
        if path.endswith("/pulls"):
            return copy.deepcopy(list(self.pulls.values()))
        number = int(re.search(r"/(?:pulls|issues)/(\d+)/", path)[1])
        if path.endswith("/files"): return copy.deepcopy(self.files[number])
        if path.endswith("/timeline"): return copy.deepcopy(self.events[number])
        if path.endswith("/reviews"): return copy.deepcopy(self.reviews[number])
        raise AssertionError(path)

    def contents(self, path, ref):
        self.calls.append((path, ref))
        text = self.text[path]
        return {"encoding": "base64", "size": len(text.encode()), "content": base64.b64encode(text.encode()).decode()}

    def request(self, path, method="GET", data=None):
        self.calls.append((path, method, data))
        if "/collaborators/" in path:
            if path.rsplit("/", 1)[1] in self.unavailable: raise APIError(404, "Not available")
            return None
        n = int(re.search(r"/pulls/(\d+)", path)[1])
        if method == "GET": return copy.deepcopy(self.changed.get(n, self.pulls[n]))
        assert method == "POST" and path.endswith("/requested_reviewers"), (path, method)
        self.posts.append((n, data))
        if set(data["reviewers"]) & self.unavailable:
            raise APIError(422, "Review request rejected")
        self.pulls[n]["requested_reviewers"] += [{"login": u} for u in data["reviewers"]]
        return copy.deepcopy(self.pulls[n])


def event(user, action="review_requested", number=1):
    return {"id": number, "event": action, "requested_reviewer": {"login": user}}


class RoutingTests(unittest.TestCase):
    def run_router(self, api, apply=False, rules=None):
        return routing.Router(api, rules or RULES).run(apply)

    def test_owner_pr_does_not_request_another_reviewer(self):
        api = FakeAPI([pr(author="DavidZWZ", user={"login": "DavidZWZ", "id": 57624585})])
        self.assertEqual(self.run_router(api, True)[0]["status"], "self-managed")
        self.assertFalse(api.posts)

    def test_owner_name_in_text_or_wrong_id_does_not_bypass_routing(self):
        for user in [{"login": "DavidZWZ", "id": 17}, {"login": "contributor", "id": 57624585}]:
            api = FakeAPI([pr(user=user)])
            api.text[api.files[1][0]["filename"]] += '\nOwner: @DavidZWZ\n'
            self.assertEqual(self.run_router(api)[0]["status"], "would-request")

    def test_owner_can_still_request_optional_manual_reviews(self):
        api = FakeAPI([pr(user={"login": "DavidZWZ", "id": 57624585}, requested_reviewers=[{"login":"Jasonya"}])])
        self.assertEqual(self.run_router(api, True)[0]["status"], "preserved")
        self.assertFalse(api.posts)

    def test_domain_map_covers_both_tracks_and_all_canonical_domains(self):
        domains = domains_from_readme((ROOT / "README.md").read_text())
        routing.validate_policy(RULES, domains)
        for kind, owners in RULES["routing"]["domain_owners"].items():
            for domain, owner in owners.items():
                with self.subTest(kind=kind, domain=domain):
                    rows = self.run_router(FakeAPI([pr(kind=kind, domain=domain)]))
                    self.assertEqual(rows[0]["reviewer"], owner)
        bad = copy.deepcopy(RULES); del bad["routing"]["domain_owners"]["task"]["Travel & commuting"]
        with self.assertRaises(ValueError): routing.validate_policy(bad, domains)

    def test_dry_run_is_read_only_and_apply_is_idempotent(self):
        api = FakeAPI([pr()])
        self.assertEqual(self.run_router(api)[0]["status"], "would-request")
        self.assertFalse(api.posts)
        self.assertEqual(self.run_router(api, True)[0]["status"], "requested")
        self.assertEqual(self.run_router(api, True)[0]["status"], "preserved")
        self.assertEqual(api.posts, [(1, {"reviewers": ["haolun-wu"]})])

    def test_existing_manual_user_or_team_assignment_is_preserved(self):
        for extra in [{"requested_reviewers": [{"login": "external-maintainer"}]}, {"requested_teams": [{"slug": "experts"}]}]:
            api = FakeAPI([pr(**extra)]);self.run_router(api, True)
            self.assertFalse(api.posts)

    def test_drafts_are_held_and_ready_transition_assigns(self):
        api = FakeAPI([pr(draft=True)])
        self.assertEqual(self.run_router(api, True)[0]["status"], "draft")
        self.assertFalse(api.posts)
        api.pulls[1]["draft"] = False
        self.assertEqual(self.run_router(api, True)[0]["status"], "requested")

    def test_closed_wrong_base_maintenance_and_manual_label_do_not_write(self):
        cases = [pr(state="closed"), pr(base={"ref": "release"}), pr(title="Fix task examples"),
                 pr(labels=[{"name": "review-routing:manual"}])]
        for p in cases:
            api = FakeAPI([p]);self.run_router(api, True);self.assertFalse(api.posts)

    def test_inconsistent_title_and_track_are_not_guessed(self):
        api = FakeAPI([pr(labels=[{"name": "track:environment"}])])
        self.assertEqual(self.run_router(api, True)[0]["status"], "invalid")
        self.assertFalse(api.posts)

    def test_file_domain_is_authoritative_and_read_at_exact_commit(self):
        api = FakeAPI([pr()]);path = api.files[1][0]["filename"]
        api.text[path] = api.text[path].replace("Travel & commuting", "Health & care")
        rows = self.run_router(api)
        self.assertEqual(rows[0]["reviewer"], "Yeechin-is-here")
        self.assertIn((path, pr()["head"]["sha"]), api.calls)

    def test_invalid_or_ambiguous_metadata_waits_for_correction(self):
        for mode in ["unknown-domain", "missing-authors", "two-proposals", "wrong-track", "worked-example", "oversize"]:
            api = FakeAPI([pr()]);path = api.files[1][0]["filename"]
            if mode == "unknown-domain": api.text[path] = api.text[path].replace("Travel & commuting", "Anything")
            if mode == "missing-authors": api.text[path] = "- **Primary domain:** Travel & commuting"
            if mode == "two-proposals": api.files[1].append({"filename": "proposals/task/second.md", "status": "added"})
            if mode == "wrong-track": api.files[1][0]["filename"] = "proposals/environment/other.md"
            if mode == "worked-example": api.files[1][0]["filename"] = "proposals/task/lena-spring-gathering.md"
            if mode == "oversize": api.text[path] += "x" * 200_001
            with self.subTest(mode=mode):
                self.assertEqual(self.run_router(api, True)[0]["status"], "invalid");self.assertFalse(api.posts)

    def test_a_pr_cannot_change_its_own_routing_policy(self):
        api = FakeAPI([pr()]);api.files[1].append({"filename": ".github/review-policy.json", "status": "modified"})
        api.text[".github/review-policy.json"] = '{"reviewers": ["attacker"]}'
        self.assertEqual(self.run_router(api)[0]["reviewer"], "haolun-wu")
        self.assertFalse(any(c[0] == ".github/review-policy.json" for c in api.calls))

    def test_prior_review_or_manual_removal_is_never_re_requested(self):
        for mode in ["removed", "reviewed", "requested-then-reviewed"]:
            api = FakeAPI([pr()])
            if mode != "reviewed": api.events[1] = [event("haolun-wu")]
            if mode == "removed": api.events[1].append(event("haolun-wu", "review_request_removed", 2))
            else: api.reviews[1] = [{"user": {"login": "haolun-wu"}, "state": "APPROVED"}]
            self.assertEqual(self.run_router(api, True)[0]["status"], "preserved");self.assertFalse(api.posts)

    def test_same_author_domain_reuses_previous_nondefault_reviewer(self):
        api = FakeAPI([pr(1, requested_reviewers=[{"login": "TianyuCodings"}]), pr(2)])
        rows = self.run_router(api)
        self.assertEqual(rows[1]["reviewer"], "TianyuCodings")
        self.assertIn("#1", rows[1]["reason"])

    def test_completed_review_and_closed_pr_keep_author_continuity(self):
        api = FakeAPI([pr(1, state="closed"), pr(2)])
        api.events[1] = [event("Yeechin-is-here")]
        api.reviews[1] = [{"user": {"login": "Yeechin-is-here"}, "state": "APPROVED"}]
        self.assertEqual(self.run_router(api)[0]["reviewer"], "Yeechin-is-here")

    def test_explicit_removal_does_not_supply_history_affinity(self):
        api = FakeAPI([pr(1, state="closed"), pr(2)])
        api.events[1] = [event("TianyuCodings"), event("TianyuCodings", "review_request_removed", 2)]
        api.reviews[1] = [{"user": {"login": "TianyuCodings"}, "state": "APPROVED"}]
        self.assertEqual(self.run_router(api)[0]["reviewer"], "haolun-wu")

    def test_affinity_does_not_cross_author_domain_or_track(self):
        for extra in [{"author": "different"}, {"domain": "Health & care"}, {"kind": "environment"}]:
            api = FakeAPI([pr(1, requested_reviewers=[{"login": "Yeechin-is-here"}], **extra), pr(2)])
            self.assertEqual(self.run_router(api)[1]["reviewer"], "haolun-wu")

    def test_author_conflict_uses_same_track_load_and_avoids_coauthors(self):
        api = FakeAPI([pr(1, author="other", requested_reviewers=[{"login": "TianyuCodings"}]), pr(2, author="HAOLUN-WU")])
        self.assertEqual(self.run_router(api)[1]["reviewer"], "Yeechin-is-here")
        path = api.files[2][0]["filename"]
        api.text[path] += "\n"
        api.text[path] = api.text[path].replace("@HAOLUN-WU", "@HAOLUN-WU, https://github.com/Yeechin-is-here")
        self.assertEqual(self.run_router(api)[1]["reviewer"], "TianyuCodings")

    def test_all_reviewers_are_coauthors_requires_manual_decision(self):
        api = FakeAPI([pr(author="haolun-wu")]);path=api.files[1][0]["filename"]
        api.text[path] = api.text[path].replace("@haolun-wu", "@haolun-wu, @TianyuCodings, @Yeechin-is-here")
        self.assertEqual(self.run_router(api, True)[0]["status"], "invalid");self.assertFalse(api.posts)

    def test_rejected_reviewer_is_not_silently_replaced(self):
        api = FakeAPI([pr()]);api.unavailable.add("haolun-wu")
        self.assertEqual(self.run_router(api, True)[0]["status"], "rejected")
        self.assertEqual(api.posts, [(1, {"reviewers": ["haolun-wu"]})])

    def test_routing_does_not_require_collaborator_visibility(self):
        api = FakeAPI([pr()])
        self.assertEqual(self.run_router(api, True)[0]["status"], "requested")
        self.assertFalse(any("/collaborators/" in c[0] for c in api.calls))

    def test_explicit_paired_app_override_is_retained(self):
        api = FakeAPI([pr(64, kind="environment", domain="Money & insurance")])
        self.assertEqual(self.run_router(api)[0]["reviewer"], "Jasonya")

    def test_fresh_metadata_or_reviewer_change_prevents_stale_write(self):
        for changes in [{"draft": True}, {"state": "closed"}, {"head": {"sha": "f" * 40}},
                        {"title": "Changed"}, {"requested_reviewers": [{"login": "maintainer"}]},
                        {"labels": [{"name": "review-routing:manual"}]}]:
            api=FakeAPI([pr()]);api.changed[1]={**api.pulls[1], **changes}
            self.assertEqual(self.run_router(api, True)[0]["status"], "deferred");self.assertFalse(api.posts)

    def test_report_counts_pending_requests_not_drafts_or_dry_run_plans(self):
        api=FakeAPI([pr(),pr(2,draft=True),pr(3,requested_reviewers=[{"login":"TianyuCodings"}])])
        text=routing.summary(self.run_router(api),RULES)
        self.assertIn("| Task | TianyuCodings | 1 |",text)
        self.assertIn("| Task | haolun-wu | 0 |",text)
        self.assertIn("would-request",text)


if __name__ == "__main__":
    unittest.main()
