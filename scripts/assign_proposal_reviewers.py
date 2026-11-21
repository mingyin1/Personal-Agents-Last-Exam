#!/usr/bin/env python3
"""Route proposal reviews using trusted policy and GitHub metadata only."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys

try:
    from .review_identity import can_self_review
    from .sync_proposals import APIError, GitHub, PROPOSAL_PATH, TITLE, decode_file, domains_from_readme, field, labels, track
except ImportError:
    from review_identity import can_self_review
    from sync_proposals import APIError, GitHub, PROPOSAL_PATH, TITLE, decode_file, domains_from_readme, field, labels, track

ROOT = Path(__file__).resolve().parents[1]


def validate_policy(rules, domains):
    for kind in ("environment", "task"):
        pool = rules["reviewers"][kind]
        owners = rules["routing"]["domain_owners"][kind]
        if len(pool) != len(set(pool)) or set(owners) != domains or not set(owners.values()) <= set(pool):
            raise ValueError("Routing must cover every canonical domain with a reviewer from its Track")
    for number, override in rules["routing"].get("overrides", {}).items():
        if not number.isdigit() or not override.get("reason"):
            raise ValueError("Overrides need a PR number and an explanation")
        if override["reviewer"] not in sum(rules["reviewers"].values(), []):
            raise ValueError("Override reviewer is outside the configured pools")


def named_track(pr):
    match = TITLE.match(pr.get("title", ""))
    if not match:
        return None
    kind = match[1].lower()
    tagged = labels(pr) & {"track:environment", "track:task"}
    if tagged and tagged != {"track:" + kind}:
        return None
    return kind


def fingerprint(pr):
    return (pr["head"]["sha"], pr["title"], tuple(sorted(labels(pr))), pr["base"]["ref"], pr["user"]["login"])


def authors(pr, text, pool):
    result = {pr["user"]["login"].casefold()}
    declared = field(text, "Authors / GitHub handles")
    for person in pool:
        if re.search(r"(?<![\w-])" + re.escape(person) + r"(?![\w-])", declared, re.I):
            result.add(person.casefold())
    return result


def requested(pr):
    return [u["login"] for u in pr.get("requested_reviewers", [])]


def history_owners(pr, events, reviews, pool):
    """Keep ownership after a submitted review, but honor explicit removal."""
    active, removed = set(), set()
    for event in sorted(events, key=lambda e: e.get("id", 0)):
        user = (event.get("requested_reviewer") or {}).get("login")
        if user not in pool:
            continue
        if event.get("event") == "review_requested":
            active.add(user); removed.discard(user)
        elif event.get("event") == "review_request_removed":
            active.discard(user); removed.add(user)
    for review in reviews:
        user = (review.get("user") or {}).get("login")
        if user in pool and user not in removed and review.get("state") in {"APPROVED", "CHANGES_REQUESTED", "COMMENTED"}:
            active.add(user)
    active.update(set(requested(pr)) & set(pool))
    return [u for u in pool if u in active]


class Router:
    def __init__(self, api, rules, branch="main"):
        self.api, self.rules, self.branch = api, rules, branch
        self.base = "/repos/" + api.repository
        self.meta_cache, self.history_cache = {}, {}

    def metadata(self, pr):
        key = (pr["number"], pr["head"]["sha"])
        if key in self.meta_cache:
            return self.meta_cache[key]
        kind = named_track(pr)
        if not kind:
            raise ValueError("Use a valid proposal title with a consistent Track")
        files = list(self.api.pages(f"{self.base}/pulls/{pr['number']}/files"))
        if len(files) >= 3000:
            raise ValueError("PR file limit reached; refusing partial routing")
        paths = [f["filename"] for f in files if f.get("status") != "removed" and PROPOSAL_PATH.fullmatch(f["filename"])]
        if len(paths) != 1 or paths[0].split("/")[1] != kind:
            raise ValueError("Exactly one proposal file must match the Track")
        if paths[0] in self.rules.get("documentation_examples", []):
            raise ValueError("Worked-example maintenance is not a new proposal")
        data = self.api.contents(paths[0], pr["head"]["sha"])
        if not data:
            raise ValueError("Proposal is unavailable at the current commit")
        text = decode_file(data, 200_000)
        domain = field(text, "Primary domain")
        if domain not in self.rules["routing"]["domain_owners"][kind]:
            raise ValueError("Choose a canonical primary domain in the proposal file")
        if not field(text, "Authors / GitHub handles"):
            raise ValueError("Fill in the proposal's authors and GitHub handles")
        result = {"track": kind, "domain": domain, "path": paths[0],
                  "authors": authors(pr, text, self.rules["reviewers"][kind])}
        self.meta_cache[key] = result
        return result

    def history(self, pr, refresh=False):
        n = pr["number"]
        if refresh or n not in self.history_cache:
            events = list(self.api.pages(f"{self.base}/issues/{n}/timeline"))
            reviews = list(self.api.pages(f"{self.base}/pulls/{n}/reviews"))
            self.history_cache[n] = (events, reviews)
        return self.history_cache[n]

    def established(self, pr, refresh=False):
        if requested(pr) or pr.get("requested_teams"):
            return True
        events, reviews = self.history(pr, refresh)
        # Even a manually removed request is deliberate. Do not restore it.
        if any(e.get("event") in {"review_requested", "review_request_removed"} for e in events):
            return True
        pool = self.rules["reviewers"][named_track(pr)]
        return bool(history_owners(pr, events, reviews, pool))

    def choose(self, pr, meta, all_prs, loads):
        pool = self.rules["reviewers"][meta["track"]]
        override = self.rules["routing"].get("overrides", {}).get(str(pr["number"]))
        if override:
            if override["reviewer"] not in pool or override["reviewer"].casefold() in meta["authors"]:
                raise ValueError("Override conflicts with Track or authorship; maintainer decision needed")
            return override["reviewer"], "Explicit policy override: " + override["reason"]
        # Only earlier PRs establish continuity; newest matching history wins.
        peers = [p for p in all_prs if p["number"] < pr["number"] and named_track(p) == meta["track"]
                 and p["user"]["login"].casefold() == pr["user"]["login"].casefold() and not p.get("draft")
                 and p["base"]["ref"] == self.branch]
        for peer in sorted(peers, key=lambda p: p["number"], reverse=True):
            try:
                peer_meta = self.metadata(peer)
            except (ValueError, UnicodeError):
                continue
            if peer_meta["domain"] != meta["domain"]:
                continue
            events, reviews = self.history(peer)
            previous = [u for u in history_owners(peer, events, reviews, pool) if u.casefold() not in meta["authors"]]
            if len(previous) == 1:
                return previous[0], f"Same author, Track and primary domain as #{peer['number']}"
        owner = self.rules["routing"]["domain_owners"][meta["track"]][meta["domain"]]
        if owner.casefold() not in meta["authors"]:
            return owner, "Primary-domain owner"
        eligible = [u for u in pool if u.casefold() not in meta["authors"]]
        if not eligible:
            raise ValueError("No non-author reviewer is available in this Track")
        return min(eligible, key=lambda u: (loads[u], pool.index(u))), "Author conflict: least-loaded non-author reviewer in the same Track"

    def run(self, apply=False):
        all_prs = list(self.api.pages(f"{self.base}/pulls", state="all", base=self.branch, sort="created", direction="asc"))
        opened = sorted([p for p in all_prs if p["state"] == "open" and track(p)], key=lambda p: p["number"])
        loads = Counter(u for p in opened if not p.get("draft") for u in requested(p))
        rows = []
        for pr in opened:
            row = {"number": pr["number"], "track": track(pr), "author": pr["user"]["login"],
                   "draft": bool(pr.get("draft")), "requested_reviewers": requested(pr),
                   "status": "preserved", "reason": "Existing review assignment"}
            rows.append(row)
            if pr["base"]["ref"] != self.branch:
                row.update(status="manual", reason="Proposal does not target the default branch"); continue
            if requested(pr) or pr.get("requested_teams"):
                continue
            if can_self_review(pr["user"]["login"], pr["user"].get("id"), self.rules):
                row.update(status="self-managed", reason="Owner reviews and accepts their own changes; no automatic reviewer request")
                continue
            try:
                meta = self.metadata(pr)
                row.update(domain=meta["domain"])
                if pr.get("draft"):
                    row.update(status="draft", reason="Wait for Ready for review"); continue
                if self.rules["routing"]["manual_label"] in labels(pr):
                    row.update(status="manual", reason="Manual routing label"); continue
                if self.established(pr):
                    row.update(reason="Prior review or explicit reviewer change; preserve human routing"); continue
                reviewer, reason = self.choose(pr, meta, all_prs, loads)
                row.update(reviewer=reviewer, reason=reason)
                if apply:
                    current = self.api.request(f"{self.base}/pulls/{pr['number']}")
                    if (current["state"] != "open" or current.get("draft") or fingerprint(current) != fingerprint(pr)
                            or self.established(current, refresh=True)):
                        row.update(status="deferred", reason="PR or review assignment changed during routing"); continue
                    # Collaborator visibility differs between an owner's PAT and
                    # GITHUB_TOKEN. The review-request API is authoritative for
                    # eligibility; a hidden collaborator lookup is not evidence
                    # that a configured reviewer lacks access.
                    try:
                        response = self.api.request(f"{self.base}/pulls/{pr['number']}/requested_reviewers", "POST", {"reviewers": [reviewer]})
                    except APIError as error:
                        if error.status != 422:
                            raise
                        row.update(status="rejected", reason="GitHub rejected the review request; check reviewer eligibility and PR state. No substitute was selected.")
                        continue
                    if reviewer not in requested(response):
                        raise RuntimeError("Review request was not confirmed by GitHub")
                    row.update(status="requested", requested_reviewers=requested(response))
                    print(f"Requested {reviewer} on #{pr['number']}: {reason}", flush=True)
                else:
                    row["status"] = "would-request"
                # Simulate successful assignments in dry runs for stable batch routing.
                pr["requested_reviewers"] = [{"login": reviewer}]
                loads[reviewer] += 1
            except (ValueError, UnicodeError) as error:
                row.update(status="invalid", reason=str(error))
        return rows


def summary(rows, rules):
    lines = ["## Proposal review routing", "", "Open proposal PRs only. Drafts are not sent for review.", "",
             "| Track | Reviewer | Pending review requests |", "| :--- | :--- | ---: |"]
    for kind, pool in rules["reviewers"].items():
        for user in pool:
            count = sum(user in r["requested_reviewers"] for r in rows if r["track"] == kind and not r["draft"])
            lines.append(f"| {kind.title()} | {user} | {count} |")
    counts = Counter(r["status"] for r in rows)
    lines += ["", "; ".join(f"{key}: {value}" for key, value in sorted(counts.items())), "",
              "| PR | Routing outcome | Reviewer | Reason |", "| :--- | :--- | :--- | :--- |"]
    for r in rows:
        if r["status"] == "preserved":
            continue
        reason = r["reason"].replace("|", "/").replace("\n", " ")
        lines.append(f"| #{r['number']} | {r['status']} | {r.get('reviewer', '')} | {reason} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", "MatrAIx-ai/Personal-Agents-Last-Exam"))
    parser.add_argument("--apply", action="store_true", help="Request reviews; the default is read-only")
    parser.add_argument("--output", type=Path, default=Path("/tmp/proposal-review-routing.json"))
    args = parser.parse_args()
    rules = json.loads((ROOT / ".github/review-policy.json").read_text())
    validate_policy(rules, domains_from_readme((ROOT / "README.md").read_text()))
    api = GitHub(args.repository, os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
    branch = api.request(f"/repos/{api.repository}")["default_branch"]
    rows = Router(api, rules, branch).run(args.apply)
    result = {"as_of": datetime.now(timezone.utc).isoformat(), "applied": args.apply, "rows": rows}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    report = summary(rows, rules)
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(report)
    if any(r["status"] == "rejected" for r in rows):
        raise RuntimeError("Some review requests were rejected; see the routing summary")


if __name__ == "__main__":
    try:
        main()
    except (APIError, ValueError, RuntimeError) as error:
        print(f"Reviewer routing failed: {error}", file=sys.stderr)
        sys.exit(1)
