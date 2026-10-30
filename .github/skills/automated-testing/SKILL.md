---
name: automated-testing
description: "Use when planning or executing unit, integration, end-to-end, browser, security, concurrency, multiplayer reconnection, or word-data tests and writing evidence-based test reports."
---

# Automated testing workflow

## When to use

Use for test strategy, test implementation, regression validation, CI checks, browser flows, security cases, load/concurrency simulation, or failure reports.

## Procedure

1. Inspect the existing test runner, project scripts, and test fixtures. Prefer configured tooling and the smallest test command covering the change.
2. Classify each requirement as unit, integration, end-to-end, security, accessibility, or data-validation coverage. Mark planned tests separately from executed tests.
3. Keep tests deterministic: inject clocks/randomness, isolate storage, use synthetic accounts, and mock provider endpoints. Never use production data or live secrets.
4. For multiplayer, model at least two authenticated clients and test room capacity, ordering, concurrent events, duplicate IDs, stale connections, reconnect, and sanitized per-player snapshots.
5. For game rules, cover lives, all occurrences, duplicate letters, normal-round failures, simultaneous outcomes, first-to-three scoring, 2–2 Deathmatch transition, continued Deathmatch, and exhaustion.
6. For security, cover forged identities, non-member commands, replay, invalid phase, message validation/rates, secret leakage, OAuth state/PKCE, cookies, CSRF, linking, and logout as implemented.
7. For browser flows, verify keyboard/focus behavior, responsive layouts, reduced motion, error states, and that hidden markup/state never contains secret answers.
8. Run targeted tests; capture exit status and concise sanitized evidence. If a tool/dependency is absent, report the block rather than installing packages without authorization.
9. For failures, provide exact reproducible steps, expected versus actual behavior, environment, and relevant sanitized logs. Do not suppress flaky tests or relax assertions to force green.

## Quality checks

- Each assertion tests a stated behavior and can fail for a meaningful regression.
- Concurrency and tie cases use controlled ordering/batches, not sleeps or client timestamps.
- Fixtures contain no credentials, personal data, or undiscovered words in client-visible snapshots.
- Report command, result, tests not run, environment assumptions, and remaining gaps.
