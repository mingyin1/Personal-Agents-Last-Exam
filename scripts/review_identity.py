"""Identity exceptions loaded only from the trusted default-branch policy."""


def can_self_review(login, user_id, rules):
    # Both values come from GitHub API identity fields, never PR text, labels,
    # commit author metadata or contributor-supplied policy files.
    return isinstance(user_id, int) and not isinstance(user_id, bool) and any(
        row.get("id") == user_id
        and row.get("login", "").casefold() == (login or "").casefold()
        for row in rules.get("self_review_maintainers", [])
    )
