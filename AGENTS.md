# AGENTS.md — Wardrobe iOS UI

## Scope
- Applies to everything inside `Wardrobe-ios-ui`.
- Keep changes limited to this area unless explicitly asked for cross-layer work.

## Principles
- Prefer minimal, surgical edits that follow existing Ionic/Angular patterns in `src/`.
- Use the existing environment sync flow (`scripts/sync-environment.js`) instead of hand-editing environment constants.
- Preserve existing routing/module/service structure; avoid creating parallel implementations.

## Quick setup and validation
- Install dependencies: `npm install`
- Start app: `npm start`
- Compile: `npm run build`
- Lint: `npm run lint`
- Unit tests: `npm run test`

## Working rules
- Do not commit secrets; keep credentials in environment/runtime configuration only.
- Do not change provisioning/certificate files or native iOS signing assets unless requested.
- If making UI/API contract changes, keep payload shapes aligned with the API and update only the affected request/response paths.

## Completion expectation for code changes
- Before handing off a change, ensure the relevant command for the touched files runs and passes (usually `npm run lint` and at least a targeted `npm run test`).

