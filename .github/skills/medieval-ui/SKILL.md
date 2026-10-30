---
name: medieval-ui
description: "Use when designing or implementing the medieval visual system, responsive game screens, character/princess SVGs, hearts, virtual keyboard, accessibility, reduced-motion behavior, or game animations."
---

# Medieval interface and visual system

## When to use

Use for visual design, component styling, character selection, room/match UI, medieval SVG illustration, heart/life indicators, animation, accessibility, or mobile behavior.

## Visual direction

- Extend the existing dark forest-green, charcoal, parchment, and muted-gold palette in `styles/`; retain contrast and avoid making ornament compete with instructions.
- Use readable system-safe serif display typography with a legible body face. Do not add remote fonts or libraries without approval.
- Keep screens modular and semantic: page landmarks, headings in order, labeled controls, visible focus, and clear loading/error/connection states.
- Reuse local SVG assets. Set a `viewBox`, explicit dimensions, accessible title/description when meaningful, and `aria-hidden="true"` for decoration. Avoid external SVG references and scripts.

## Game components

1. Character selection must announce the selected character and provide keyboard-operable choices.
2. Normal rounds show six individually understandable life indicators; Deathmatch shows one. Do not rely on color or animation alone to communicate remaining life.
3. A virtual keyboard must expose disabled/used/correct/incorrect states accessibly, support keyboard navigation, and announce results without flooding a live region.
4. Show the opponent's allowed progress and connection status only from server-provided public state. Never render hidden word text in DOM or client state.
5. Damage, victory, defeat, and finale animations must have a static/reduced-motion alternative and must not block input or status announcements.
6. The victory finale can show the authorized winner character, a local princess SVG, and a heart motif; do not imply a real person or external copyrighted character.

## Procedure

1. Read the current HTML/CSS and preserve existing behavior and palette where possible.
2. Consult `multiplayer-engine` before rendering event-driven match state; treat server snapshots as the authority.
3. Implement semantic structure and mobile layout first; add decorative CSS/SVG after content and interactions remain understandable without them.
4. Verify contrast, focus visibility/order, accessible names, live-region restraint, 320px+ layouts, zoom/reflow, and reduced-motion behavior.
5. Check SVGs for local-only references, accessibility metadata, and absence of scripts, external resources, or embedded secrets.
6. Report tested browsers/viewports and any unavailable accessibility tooling honestly.

## Quality checks

- All actions are usable by keyboard, controls have accessible names, focus remains visible, and status is not color-only.
- Layout remains usable on small screens and at increased zoom.
- Reduced-motion mode removes nonessential movement without hiding outcomes.
- No answer data is present in hidden HTML, attributes, or frontend state.
