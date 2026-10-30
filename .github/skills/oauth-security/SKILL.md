---
name: oauth-security
description: "Use when designing or implementing Google/GitHub OAuth or OIDC login, provider linking, identity validation, cookies, sessions, logout, callbacks, room authorization, or authentication threat reviews."
---

# OAuth and session security

## When to use

Use for sign-in, OAuth/OIDC callbacks, account linking, session creation/renewal/logout, provider configuration, or authorization of private game rooms.

## Procedure

1. **Select the protocol by provider.** Use Google's documented OpenID Connect flow and validate the ID token. GitHub's normal web sign-in is OAuth; obtain identity server-side from the official GitHub API using the access token and bind by immutable provider user ID, not mutable username or email alone.
2. **Protect the authorization request.** Generate cryptographically random, single-use `state`; bind it to the initiating browser/session and expire it quickly. Use PKCE with S256 where supported/appropriate, and validate the exact redirect URI and issuer/audience.
3. **Validate the callback.** Compare and consume `state` once, reject replay/expired requests, exchange codes only on the server, validate OIDC signature/issuer/audience/expiry/nonce as applicable, and handle provider errors without leaking tokens.
4. **Establish identity safely.** Store provider name plus stable provider subject in a unique mapping. Do not silently merge accounts by matching email. Require an authenticated existing account and an explicit, recent reauthentication/confirmation to link another provider; handle already-linked identities safely.
5. **Create an opaque session.** Generate a high-entropy random session ID, store only a protected/hash representation server-side where practical, and issue a cookie with `HttpOnly`, `Secure` in HTTPS, `SameSite` chosen for the callback flow, `Path=/`, and no broad `Domain`. Rotate after login/account linking; enforce expiry and revocation.
6. **Prevent request forgery.** For cookie-authenticated mutations, enforce an appropriate CSRF defense (SameSite plus origin checks and/or anti-CSRF token). Validate `Origin`/`Host` on WebSocket upgrades and do not place bearer/session secrets in URLs.
7. **Authorize each action.** Resolve the user from the server-side session on every HTTP/room action. Check room membership and role server-side; never trust a user ID supplied in a message.
8. **Logout and revoke.** Revoke/delete the server-side session and expire the cookie with matching attributes. Define account unlinking and provider token retention explicitly; retain the minimum provider data required.
9. **Protect secrets and observability.** Configure Client Secrets only through protected environment secret stores. Redact authorization codes, access/ID tokens, cookies, and session IDs from logs, errors, tests, and chat.

## Quality checks

- Test valid, invalid, expired, mismatched, replayed, and cross-session `state`; PKCE verifier mismatch; invalid issuer/audience/nonce/signature; and provider API errors.
- Test cookie attributes, session rotation/revocation, CSRF defenses, callback redirect validation, and logout.
- Test duplicate provider identity, no implicit email merge, explicit linking, and room access by non-members.
- Use fake providers and synthetic users in tests. Never use live credentials in fixtures.
- Verify current provider documentation and callback requirements before changing production settings.
