---
name: multiplayer-engine
description: "Use when designing or implementing authoritative multiplayer rooms, WebSocket contracts, state transitions, idempotency, reconnection, simultaneous rounds, scoring, match completion, or Deathmatch."
---

# Multiplayer engine workflow

## When to use

Use for private 1v1 rooms, WebSocket protocol, Durable Object state, word-game actions, duplicate commands, concurrent events, disconnects, score, or Deathmatch.

## Authority and state

- One Durable Object owns each room's authoritative state and serializes state-changing commands.
- Derive player identity from the authenticated server-side connection. Reject non-members, third active players, stale phase actions, invalid letters, and commands not allowed for the current player.
- Keep full words, unused answers, scoring decisions, and tie-break seed server-side. Send each player only their own masked word and the opponent data explicitly designated public.
- Use durable persistence/checkpoint strategy for active-room state and define recovery behavior before relying on in-memory state.

## Event contract

Version every message and give client commands a unique idempotency key. A minimal envelope is:

```json
{"version":1,"eventId":"opaque-client-id","type":"round.guess","payload":{"letter":"a"}}
```

Treat all fields as untrusted. The actor is the authenticated connection, not a payload field. Define and validate a narrow allowlist, length limits, phase, room membership, and message rate.

Suggested client commands: `room.join`, `player.character`, `player.ready`, `round.guess`, `room.leave`, `match.reconnect`.

Suggested server events: `room.snapshot`, `player.updated`, `round.started`, `guess.accepted`, `player.progress`, `round.completed`, `match.completed`, `room.error`.

Document payload visibility per recipient. `room.snapshot` after reconnect must be freshly derived and must not contain answer keys or another player's hidden letters.

## Deterministic processing

1. Validate membership, phase, event id, and action before mutation.
2. Serialize accepted commands in the Durable Object and assign a monotonically increasing server sequence.
3. Store idempotency outcomes for the match's required replay window. Repeated event IDs return the prior outcome and never consume another life.
4. Normalize guesses consistently (Unicode normalization and accent/case policy); a repeated valid letter is acknowledged without additional damage.
5. Apply all occurrences for a correct letter; a wrong letter removes exactly one life in a normal round and eliminates immediately in Deathmatch.
6. Resolve simultaneous terminal outcomes from a server-defined atomic adjudication batch using a precommitted server tie-break value, not client timestamps, socket iteration order, or fastest packet. Persist the tie-break input before play and document the deterministic rule.
7. For events not adjudicated in the same batch, use the serialized server sequence. Do not claim network latency can be eliminated; do not use latency as the tie-break rule.

## Match rules

- Normal round: distinct words with comparable validated difficulty, six lives each, simultaneous independent play. First completed word wins; if one player fails while the other remains active, the active player wins. If both fail in one adjudication, start a fresh round with new unused words and no score. If both complete in one adjudication, use the persisted tie-break; if one completes while the other fails in that batch, the completing player wins.
- First to three round wins takes the match. At 2–2, start Deathmatch instead of a fifth normal round.
- Deathmatch: one life each, distinct equivalent words, exactly one initial revealed position per player, and one error eliminates. Completing a word assigns a new unused word without restoring life or ending the mode.
- If simultaneous Deathmatch elimination is adjudicated, apply the persisted tie-break policy consistently; never compare client clocks.

## Disconnect and abandonment

- Bind reconnect to the same authenticated account and room membership; rotate connection credentials and prevent a stale socket from issuing actions.
- Pause the room on disconnect and start the documented server-side grace timer (proposed default: 60 seconds). Reconnect restores only the authorized current snapshot.
- On expiry, a single absent player forfeits the match. If both players remain absent at expiry, cancel the room without awarding a winner. Make the timer and outcome auditable and testable.
- Do not accept client-supplied elapsed time to extend a grace period.

## Quality checks

Test room capacity, authorization, ordering, duplicate IDs, wrong/repeated/correct guesses, concurrent terminal events, score threshold, 2–2 transition, unlimited Deathmatch word rotation, exhaustion, disconnect, reconnect, stale sockets, and sanitized snapshots with deterministic clocks/seeds.
