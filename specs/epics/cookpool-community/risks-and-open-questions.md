# cookpool-community — risks and open questions

## CM-A — Privacy leaks from a household app (RISK)

Cookpool holds money, groups and who ate what. Posts carry only the stats the poster chose, computed by the server from a whitelist: size, time, how many ate, and steps. Public names come only from the profile, so nothing derived from the email reaches strangers. Tests pin that no post or profile read contains a price, a group id or a member list.

## CM-B — Abuse with no moderation console (ACCEPTED)

V1 relies on a few things:
- post authors removing comments;
- blocks and mutes;
- reports that are stored and audited;
- three reports from different people hiding a target from Discover.

A moderation console is a later epic. Rate limits cap follows, comments and searches.

## CM-C — Handle squatting and impersonation (RISK)

`cookpool…` and system words are reserved, and a handle changes once a month. Verified badges are out of scope.

## CM-D — Discover with few users (ACCEPTED)

With little content, Discover shows Cookpool's own recipes as recipe cards beside public posts. The ordering is plain (newest, with a small Yum boost) so it stays predictable.

## CM-E — Photos need R2 (RISK)

The Cloudflare connection has no R2 permission. CM-4 waits for the owner to widen the token, and posts and profiles are designed to look complete without photos.

## CM-F — Private profiles and public posts (SETTLED)

A private author's "Public" post reaches followers only. The composer says so when the profile is private ("Your profile is private · followers only").

## CM-G — Fan-out cost (ACCEPTED)

The Following feed is a pull query: posts whose author is in your accepted follows, newest first, with an index on `(author_id, created_at)`. That's fine at this scale. Fan-out on write can come later.

## CM-H — Notification noise (RISK)

Yum pushes are grouped, at most one per post per hour. Every social kind is opt-in for push and off for email.
