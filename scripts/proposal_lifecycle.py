#!/usr/bin/env python3
"""Trusted PR lifecycle commands and a fail-closed, commit-bound merge gate.

Only run this program from the default branch with a write token. PR files are
read as data; contributor code, workflows and artifacts are never executed.
"""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timedelta, timezone
import html
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlparse

try:
    from .review_identity import can_self_review
    from .sync_proposals import APIError, GitHub, PROPOSAL_PATH, decode_file, field, track
except ImportError:
    from review_identity import can_self_review
    from sync_proposals import APIError, GitHub, PROPOSAL_PATH, decode_file, field, track

ROOT = Path(__file__).resolve().parents[1]
MARKER = "<!-- pale-lifecycle:v1\n"
COMMAND = re.compile(r"^/(approve-plan|start-implementation|submit-implementation|accept-implementation|extend-deadline|revoke-plan)(?:\s+(.*))?$", re.S)
SHA = re.compile(r"^[0-9a-f]{40}$")
LABELS = {
    "plan-approved": ("0E8A16", "Design approved; implementation and validation still required"),
    "plan-needs-review": ("D93F0B", "Approved proposal content changed or approval was revoked"),
    "in-progress": ("1D76DB", "Implementing the approved plan in this PR"),
    "validation": ("5319E7", "Implementation and evidence submitted for review"),
    "ready-to-merge": ("0E8A16", "Maintainer acceptance recorded for the current commit; checks still apply"),
    "v1-overdue": ("D93F0B", "Environment first-version submission is past its recorded deadline"),
}


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value):
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def policy():
    return json.loads((ROOT / ".github/review-policy.json").read_text())


def trusted_comment(comment):
    return ((comment.get("user") or {}).get("login") == "github-actions[bot]"
            and (comment.get("performed_via_github_app") or {}).get("id") == 15368)


def load_state(comments, number):
    found = []
    for comment in comments:
        body = comment.get("body") or ""
        if not trusted_comment(comment) or not body.startswith(MARKER):
            continue
        try:
            state = json.loads(body[len(MARKER):].split("\n-->", 1)[0])
        except (ValueError, TypeError):
            raise ValueError("Malformed trusted lifecycle record; maintainer intervention required")
        if state.get("version") != 1 or state.get("number") != number:
            raise ValueError("Lifecycle record identity mismatch")
        found.append((state, comment["id"]))
    if len(found) > 1:
        raise ValueError("Multiple trusted lifecycle records; refusing to choose one")
    return found[0] if found else ({"version": 1, "number": number, "processed": []}, None)


def due_status(state, now):
    due = state.get("environment_v1_due_at")
    if not due:
        return "Not started"
    submission = state.get("first_submission")
    if submission:
        when = timestamp(submission["at"])
        return "Submitted on time; subject to review" if when <= timestamp(due) else "Submitted late; subject to review"
    return "Overdue" if now > timestamp(due) else "Awaiting v1"


def render_state(state, now):
    lines = [MARKER + json.dumps(state, sort_keys=True) + "\n-->",
             "### Contribution progress", "",
             "This record tracks design approval and delivery. It does not merge this PR.", ""]
    approval = state.get("approval")
    if approval:
        lines += [f"- **Plan approved by:** @{approval['by']} at {approval['at']}",
                  f"- **Approved commit:** `{approval['head_sha']}`",
                  f"- **Scope:** the complete proposal at `{approval['path']}` in that commit."]
    else:
        lines += ["- **Plan:** awaiting design approval."]
    if state.get("environment_v1_due_at"):
        lines += [f"- **Environment v1 deadline (UTC):** {state['environment_v1_due_at']}",
                  f"- **Delivery:** {due_status(state, now)}. A submitted version is not yet an accepted contribution."]
    for key, label in [("submission", "Implementation submission"), ("acceptance", "Maintainer acceptance")]:
        record = state.get(key)
        if record:
            lines += [f"- **{label}:** @{record['by']} at {record['at']}, commit `{record['head_sha']}`",
                      f"  Evidence: <{html.escape(record['evidence'], quote=True)}>"]
    if state.get("extensions"):
        lines += ["", "**Deadline extensions:**"]
        for item in state["extensions"]:
            reason = html.escape(item["reason"]).replace("\n", " ")
            lines += [f"- {item['at']}: @{item['by']} set {item['due_at']}. {reason}"]
    lines += ["", "Continue implementation and validation in this same PR. Only a final maintainer merge is acceptance.",
              "[Commands and delivery rules](https://github.com/" + state.get("repository", "MatrAIx-ai/Personal-Agents-Last-Exam")
              + "/blob/main/docs/review/proposal-lifecycle.md)"]
    return "\n".join(lines)


def classify(pr, files, state, documentation_examples=()):
    # Only the trusted default-branch policy can identify existing worked
    # examples. New files, deletions and renames still receive contribution
    # classification, including a rename into an allowlisted example path.
    examples = set(documentation_examples)
    proposal_files = [f for f in files if not (
        f["filename"] in examples and f.get("status") == "modified"
        and not f.get("previous_filename"))]
    paths = [f["filename"] for f in proposal_files if f.get("status") != "removed" and PROPOSAL_PATH.fullmatch(f["filename"])]
    touched = any(PROPOSAL_PATH.fullmatch(f.get(k, "")) for f in proposal_files for k in ("filename", "previous_filename"))
    implementation = any(f["filename"].startswith(("apps/", "tasks/")) for f in files)
    candidate = bool(track(pr) or touched or implementation or state.get("track"))
    if not candidate:
        return None, None, ""
    if len(paths) != 1:
        return "unknown", None, "Exactly one completed proposal file is required"
    kind = paths[0].split("/")[1]
    if track(pr) and track(pr) != kind:
        return kind, paths[0], "PR track and proposal directory disagree"
    if state.get("track") and state["track"] != kind:
        return kind, paths[0], "Track changed after lifecycle review began"
    return kind, paths[0], ""


def has_implementation(files, kind, rules):
    roots = tuple(rules["implementation_roots"][kind])
    excluded = {".md", ".rst", ".txt", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp", ".pdf"}
    return any(f.get("status") != "removed" and f["filename"].startswith(roots)
               and Path(f["filename"]).suffix.lower() not in excluded
               and Path(f["filename"]).name not in {".gitkeep", ".DS_Store"} for f in files)


def approval_valid(state, path, blob):
    approval = state.get("approval") or {}
    return bool(path and blob and approval.get("path") == path and approval.get("blob_sha") == blob)


def parse_command(body):
    match = COMMAND.fullmatch((body or "").strip())
    return (match[1], (match[2] or "").strip()) if match else None


def checked_sha(args, head, evidence=False):
    parts = args.split()
    expected = 2 if evidence else 1
    if len(parts) != expected or not SHA.fullmatch(parts[0]) or parts[0] != head:
        raise ValueError("Use the full current 40-character PR commit SHA" + (" followed by one HTTPS evidence URL" if evidence else ""))
    if evidence:
        url = urlparse(parts[1])
        if url.scheme != "https" or not url.netloc or url.username or url.password or re.search(r"[<>\"`]", parts[1]):
            raise ValueError("Evidence must be an HTTPS URL without credentials or markup")
    return parts


def apply_command(state, command, args, *, actor, maintainer, assigned, author, coauthor,
                  pr, kind, path, blob, files, rules, now, comment_id, actor_id=None):
    state = copy.deepcopy(state)
    if comment_id in state.get("processed", []):
        return state, False
    if not kind or kind == "unknown":
        raise ValueError("Lifecycle commands require one completed Environment or Task proposal")
    if pr["state"] != "open" or pr["base"]["ref"] != "main":
        raise ValueError("Commands apply only to open PRs targeting main")
    self_review = maintainer and can_self_review(actor, actor_id, rules)
    reviewer = (maintainer or assigned) and (self_review or not (author or coauthor))
    participant = author or reviewer
    head = pr["head"]["sha"]
    valid = approval_valid(state, path, blob)
    if command == "approve-plan":
        if not reviewer:
            raise ValueError("Only an assigned Track reviewer or maintainer may approve; authors and coauthors cannot self-approve")
        checked_sha(args, head)
        if pr["draft"]:
            raise ValueError("Mark this proposal Ready for review before approving")
        state["track"] = kind
        state["approval"] = {"by": actor, "at": iso(now), "head_sha": head, "path": path, "blob_sha": blob}
        state.setdefault("first_approved_at", iso(now))
        if kind == "environment":
            state.setdefault("environment_v1_due_at", iso(timestamp(state["first_approved_at"]) + timedelta(days=rules["environment_v1_days"])))
        state.pop("acceptance", None)
        state.pop("submission", None)
        state["stage"] = "plan-approved"
    elif command == "revoke-plan":
        if not reviewer or not args:
            raise ValueError("An assigned reviewer or maintainer must provide a reason to revoke the plan")
        for key in ("approval", "acceptance", "submission"):
            state.pop(key, None)
        state["stage"] = "plan-needs-review"
    elif command == "extend-deadline":
        if not maintainer or ((author or coauthor) and not self_review) or kind != "environment" or not state.get("environment_v1_due_at"):
            raise ValueError("A non-author maintainer must extend an approved Environment deadline")
        parts = args.split(maxsplit=1)
        if len(parts) != 2 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", parts[0]):
            raise ValueError("Use /extend-deadline YYYY-MM-DD reason (end of day UTC)")
        due = timestamp(parts[0] + "T23:59:59Z")
        if due <= timestamp(state["environment_v1_due_at"]) or due <= now:
            raise ValueError("The extended deadline must be later than both the current deadline and now")
        state["environment_v1_due_at"] = iso(due)
        state.setdefault("extensions", []).append({"by": actor, "at": iso(now), "due_at": iso(due), "reason": parts[1]})
    else:
        if not valid:
            raise ValueError("The current proposal needs /approve-plan before implementation commands")
        if command == "start-implementation":
            if not participant or args:
                raise ValueError("The author or reviewer can use /start-implementation without arguments")
            state["stage"] = "in-progress"
            state.pop("acceptance", None)
        elif command in {"submit-implementation", "accept-implementation"}:
            if command == "accept-implementation":
                if not maintainer or ((author or coauthor) and not self_review):
                    raise ValueError("Only a non-author maintainer with write access can accept implementation")
            elif not participant:
                raise ValueError("Only the author or reviewer can submit implementation")
            _, evidence = checked_sha(args, head, evidence=True)
            if pr["draft"] or not has_implementation(files, kind, rules):
                raise ValueError("A ready PR must include implementation changes under " + ", ".join(rules["implementation_roots"][kind]))
            record = {"by": actor, "at": iso(now), "head_sha": head, "evidence": evidence}
            if command == "submit-implementation":
                state["submission"] = record
                state.setdefault("first_submission", record)
                state.pop("acceptance", None)
                state["stage"] = "validation"
            else:
                if (state.get("submission") or {}).get("head_sha") != head:
                    raise ValueError("Submit implementation and evidence for this commit before acceptance")
                state["acceptance"] = record
                state["stage"] = "ready-to-merge"
    state.setdefault("processed", []).append(comment_id)
    state["updated_at"] = iso(now)
    return state, True


def gate(pr, files, state, kind, path, blob, issue, rules, checks):
    if pr["draft"]:
        return "pending", "Draft PR: final review has not started"
    if not kind:
        return "success", "Maintenance PR: normal branch review requirements still apply"
    if issue:
        return "pending", issue
    if not approval_valid(state, path, blob):
        return "pending", "Design approval is missing or the approved proposal changed"
    head = pr["head"]["sha"]
    if not has_implementation(files, kind, rules):
        return "pending", "Proposal only: implementation and validation are required"
    if (state.get("submission") or {}).get("head_sha") != head:
        return "pending", "Submit implementation and evidence for the current commit"
    if (state.get("acceptance") or {}).get("head_sha") != head:
        return "pending", "A maintainer must accept implementation for the current commit"
    required = rules["environment_checks"] if kind == "environment" else []
    for name in required:
        candidates = [x for x in checks if x.get("name") == name and x.get("head_sha") == head
                      and (x.get("app") or {}).get("id") == rules["actions_app_id"]]
        latest = max(candidates, key=lambda x: x["id"], default={})
        if latest.get("conclusion") != "success" or latest.get("status") != "completed":
            return "pending", "Waiting for successful validation: " + name
    return "success", "Implementation accepted for this commit; final review and manual merge remain required"


class Lifecycle:
    def __init__(self, api, rules, now=None):
        self.api, self.rules = api, rules
        self.now = now or datetime.now(timezone.utc)
        self.base = f"/repos/{api.repository}"

    def context(self, pr):
        number = pr["number"]
        files = list(self.api.pages(f"{self.base}/pulls/{number}/files"))
        if len(files) >= 3000:
            raise ValueError("PR file cap reached; refusing partial classification")
        comments = list(self.api.pages(f"{self.base}/issues/{number}/comments"))
        state, comment_id = load_state(comments, number)
        kind, path, issue = classify(pr, files, state, self.rules.get("documentation_examples", []))
        blob, text = None, ""
        if path:
            data = self.api.contents(path, pr["head"]["sha"])
            if data:
                blob, text = data["sha"], decode_file(data, 200_000)
            else:
                issue = "Proposal file cannot be read at the current commit"
        return {"pr": pr, "files": files, "comments": comments, "state": state, "comment_id": comment_id,
                "kind": kind, "path": path, "blob": blob, "text": text, "issue": issue}

    def access(self, actor):
        try:
            # Permission lookup is authoritative. A separate collaborator-list
            # membership probe may be hidden from the built-in Actions token.
            data = self.api.request(f"{self.base}/collaborators/{quote(actor, safe='')}/permission")
        except APIError as error:
            if error.status == 404:
                return False, False
            raise
        permission = data.get("permission")
        return permission in {"read", "triage", "write", "maintain", "admin"}, permission in {"write", "maintain", "admin"}

    def is_assigned(self, pr, actor, kind):
        if actor.casefold() not in {u.casefold() for u in self.rules["reviewers"].get(kind, [])}:
            return False
        # A submitted review removes the pending request. Preserve assignment by
        # replaying GitHub's authoritative request/removal events, not review text.
        assigned = False
        for event in self.api.pages(f"{self.base}/issues/{pr['number']}/timeline"):
            user = (event.get("requested_reviewer") or {}).get("login", "")
            if user.casefold() == actor.casefold():
                if event.get("event") == "review_requested":
                    assigned = True
                elif event.get("event") == "review_request_removed":
                    assigned = False
        return assigned or any(u["login"].casefold() == actor.casefold() for u in pr.get("requested_reviewers", []))

    def write_state(self, context, state):
        state["repository"] = self.api.repository
        body = render_state(state, self.now)
        if len(body.encode()) > 60_000:
            raise ValueError("Lifecycle audit record is full; maintainer intervention required")
        if context["comment_id"]:
            existing = next(x for x in context["comments"] if x["id"] == context["comment_id"])
            if existing["body"] != body:
                self.api.request(f"{self.base}/issues/comments/{context['comment_id']}", "PATCH", {"body": body})
        else:
            self.api.request(f"{self.base}/issues/{state['number']}/comments", "POST", {"body": body})

    def update_labels(self, context):
        state, pr = context["state"], context["pr"]
        if not state.get("track"):
            return
        wanted = set()
        if approval_valid(state, context["path"], context["blob"]):
            wanted.add("plan-approved")
            stage = state.get("stage")
            if stage in {"in-progress", "validation", "ready-to-merge"}:
                wanted.add(stage)
        else:
            wanted.add("plan-needs-review")
        if (state.get("acceptance") or {}).get("head_sha") != pr["head"]["sha"]:
            wanted.discard("ready-to-merge")
        if due_status(state, self.now) == "Overdue":
            wanted.add("v1-overdue")
        current = {x["name"] for x in pr.get("labels", [])}
        for name in wanted - current:
            color, description = LABELS[name]
            try:
                self.api.request(f"{self.base}/labels/{quote(name, safe='')}")
            except APIError as error:
                if error.status != 404:
                    raise
                self.api.request(f"{self.base}/labels", "POST", {"name": name, "color": color, "description": description})
            self.api.request(f"{self.base}/issues/{pr['number']}/labels", "POST", {"labels": [name]})
        for name in (current & LABELS.keys()) - wanted:
            self.api.request(f"{self.base}/issues/{pr['number']}/labels/{quote(name, safe='')}", "DELETE")

    def command(self, event):
        number = event["issue"]["number"]
        comment = self.api.request(f"{self.base}/issues/comments/{event['comment']['id']}")
        # Ignore edits/replays with changed text or identity. Commands are immutable
        # requests; corrections must be posted as a new comment.
        if (comment.get("body") != event["comment"].get("body")
                or comment.get("user", {}).get("login") != event["comment"].get("user", {}).get("login")
                or comment.get("updated_at") != comment.get("created_at")
                or timestamp(comment["created_at"]) < timestamp(self.rules["commands_enabled_after"])):
            return
        parsed = parse_command(comment.get("body"))
        if not parsed:
            return
        pr = self.api.request(f"{self.base}/pulls/{number}")
        context = self.context(pr)
        result_marker = f"<!-- pale-command-result:{comment['id']} -->"
        if comment["id"] in context["state"].get("processed", []) or any(
                trusted_comment(c) and (c.get("body") or "").startswith(result_marker) for c in context["comments"]):
            return
        actor = comment["user"]["login"]
        collaborator, maintainer = self.access(actor)
        authors = field(context["text"], "Authors / GitHub handles")
        coauthor = bool(re.search(r"(?i)(?<![\w-])@?" + re.escape(actor) + r"(?![\w-])", authors))
        try:
            if context["issue"]:
                raise ValueError(context["issue"])
            state, changed = apply_command(context["state"], *parsed, actor=actor, maintainer=maintainer,
                actor_id=comment["user"].get("id"),
                assigned=collaborator and self.is_assigned(pr, actor, context["kind"]),
                author=pr["user"]["login"].casefold() == actor.casefold(), coauthor=coauthor,
                pr=pr, kind=context["kind"], path=context["path"], blob=context["blob"],
                files=context["files"], rules=self.rules, now=self.now, comment_id=comment["id"])
            if changed:
                # Re-read head immediately before persisting authority over a commit.
                if self.api.request(f"{self.base}/pulls/{number}")["head"]["sha"] != pr["head"]["sha"]:
                    raise ValueError("The PR changed during processing; review the new commit and post a new command")
                self.write_state(context, state)
                context["state"] = state
                self.update_labels(context)
        except ValueError as error:
            marker = f"<!-- pale-command-result:{comment['id']} -->"
            if not any(trusted_comment(c) and (c.get("body") or "").startswith(marker) for c in context["comments"]):
                self.api.request(f"{self.base}/issues/{number}/comments", "POST", {
                    "body": marker + "\nCommand not applied: " + html.escape(str(error))
                    + "\n\nSee [lifecycle commands](https://github.com/" + self.api.repository
                    + "/blob/main/docs/review/proposal-lifecycle.md)."})

    def reconcile(self, numbers=None):
        # Check every PR sharing a head: GitHub statuses belong to commits, not PRs.
        opened = list(self.api.pages(f"{self.base}/pulls", state="open", base="main"))
        heads = {p["head"]["sha"] for p in opened if numbers is None or p["number"] in numbers}
        groups = {}
        for pr in opened:
            if pr["head"]["sha"] not in heads:
                continue
            context = self.context(pr)
            # GitHub may coalesce pending workflow runs. Commands remain in the
            # PR comment history and are recovered by full/hourly reconciliation.
            recovered = False
            for comment in context["comments"]:
                if (parse_command(comment.get("body")) and comment.get("created_at") == comment.get("updated_at")
                        and timestamp(comment["created_at"]) >= timestamp(self.rules["commands_enabled_after"])
                        and comment["id"] not in context["state"].get("processed", [])
                        and not any(trusted_comment(c) and (c.get("body") or "").startswith(
                            f"<!-- pale-command-result:{comment['id']} -->") for c in context["comments"])):
                    self.command({"issue": {"number": pr["number"]}, "comment": comment})
                    recovered = True
            if recovered:
                pr = self.api.request(f"{self.base}/pulls/{pr['number']}")
                context = self.context(pr)
            state = context["state"]
            self.update_labels(context)
            if context["comment_id"]:
                self.write_state(context, state)
            checks = []
            if state.get("acceptance") and context["kind"] == "environment":
                for page in range(1, 101):
                    result = self.api.request(f"{self.base}/commits/{pr['head']['sha']}/check-runs?filter=latest&per_page=100&page={page}")
                    checks += result["check_runs"]
                    if len(result["check_runs"]) < 100:
                        break
                else:
                    raise ValueError("Check-run pagination exceeded limit")
            outcome, description = gate(pr, context["files"], state, context["kind"], context["path"],
                                         context["blob"], context["issue"], self.rules, checks)
            groups.setdefault(pr["head"]["sha"], []).append((pr["number"], outcome, description))
        for head, rows in groups.items():
            blocked = [r for r in rows if r[1] != "success"]
            number, status, description = blocked[0] if blocked else rows[0]
            description = (f"#{number}: " + description)[:140]
            # A workflow job named contribution-ready must not impersonate this
            # authority. Publish a commit status as well: when a status and check
            # share a required name GitHub requires both. Fork jobs cannot write
            # commit statuses with their read-only token.
            combined = self.api.request(f"{self.base}/commits/{head}/status")
            previous_status = next((x for x in combined["statuses"] if x["context"] == self.rules["gate_name"]), {})
            if previous_status.get("state") != status or previous_status.get("description") != description:
                self.api.request(f"{self.base}/statuses/{head}", "POST", {
                    "context": self.rules["gate_name"], "state": status, "description": description,
                    "target_url": f"https://github.com/{self.api.repository}/pull/{number}"})
            # Update one durable check per head, rather than accumulating pending
            # checks after repeated label, review and schedule events.
            external = "pale-contribution-ready:" + head
            existing = []
            for page in range(1, 101):
                result = self.api.request(f"{self.base}/commits/{head}/check-runs?check_name={self.rules['gate_name']}&filter=all&per_page=100&page={page}")
                existing += [x for x in result["check_runs"] if x.get("external_id") == external
                             and (x.get("app") or {}).get("id") == self.rules["actions_app_id"]]
                if len(result["check_runs"]) < 100:
                    break
            else:
                raise ValueError("Gate check pagination exceeded limit")
            payload = {
                "name": self.rules["gate_name"], "head_sha": head,
                "external_id": external,
                # GitHub retains a completed check's old conclusion when only
                # status is changed. Always replace the conclusion explicitly.
                "status": "completed",
                "conclusion": "success" if status == "success" else "action_required",
                "details_url": f"https://github.com/{self.api.repository}/pull/{number}",
                "output": {"title": description, "summary": "\n".join(f"PR #{n}: {d}" for n, _, d in rows)}}
            if existing:
                previous = max(existing, key=lambda x: x["id"])
                if (previous.get("status") == payload["status"]
                        and previous.get("conclusion") == payload.get("conclusion")
                        and (previous.get("output") or {}).get("title") == description):
                    continue
                payload.pop("head_sha")
                self.api.request(f"{self.base}/check-runs/{previous['id']}", "PATCH", payload)
            else:
                self.api.request(f"{self.base}/check-runs", "POST", payload)
            print(f"{head[:10]}: {status}: {description}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", "MatrAIx-ai/Personal-Agents-Last-Exam"))
    args = parser.parse_args()
    api = GitHub(args.repository, os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"))
    lifecycle = Lifecycle(api, policy())
    event_name = os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text()) if os.environ.get("GITHUB_EVENT_PATH") else {}
    numbers = None
    if event_name == "issue_comment":
        if event.get("action") != "created" or not event.get("issue", {}).get("pull_request") or not parse_command(event.get("comment", {}).get("body")):
            return
        lifecycle.command(event)
        numbers = {event["issue"]["number"]}
    elif event_name == "pull_request_target":
        numbers = {event["pull_request"]["number"]}
    elif event_name == "workflow_run":
        run = event["workflow_run"]
        # Re-fetch run metadata; never consume uploaded artifacts or execute head code.
        trusted_run = api.request(f"/repos/{args.repository}/actions/runs/{run['id']}")
        numbers = {x["number"] for x in trusted_run.get("pull_requests", [])}
        if not numbers:
            opened = list(api.pages(f"/repos/{args.repository}/pulls", state="open", base="main"))
            numbers = {p["number"] for p in opened if p["head"]["sha"] == trusted_run["head_sha"]}
    lifecycle.reconcile(numbers)


if __name__ == "__main__":
    try:
        main()
    except (APIError, ValueError, RuntimeError) as error:
        print(f"Lifecycle failed: {error}", file=sys.stderr)
        sys.exit(1)
