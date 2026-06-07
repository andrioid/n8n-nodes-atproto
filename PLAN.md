# Implementation Plan

Historical record of design decisions and shipped milestones. Detailed
phase-by-phase walkthroughs from the initial build have been compacted —
the code is the spec now. See [DESIGN.md](DESIGN.md) for architecture
intent and [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop.

## Status

| Milestone | State | Notes |
|---|---|---|
| Phase 0 — Scaffolding | ✅ | `d9c7329` |
| Phase 1 — Generic CRUD | ✅ | `d9c7329`, 35 tests |
| Phase 2 — Dynamic field mapping | ✅ | `31140d5`, `34a5e16` (review fixes), 57 tests |
| Phase 3 — Blob support (lexicon-driven) | ✅ | `8f468d7`, 11 tests |
| Distribution — Bundling | ✅ | `00a4933`, `976ee7e` |
| Phase 4 — Deep resolution & UX | ✅ | `85beddc`…`b156743`, 22 tests |
| Phase 5 — Schema constraints | ✅ | 35 tests |
| Distribution — Publish (v0.1.0–0.1.2) | ✅ | release-please |
| Bluesky convenience node | ✅ | Post / Reply / Quote / Like / Repost / Follow |
| Generic blob ops (Upload / Download / List) | ✅ | `3ce0eb7` |
| Blob ops UX polish | ✅ | `0b5a912` (smart input, friendly errors, flat outputs) |
| Return All pagination + README recipes | ✅ | `55d14fc` |
| Source layout migration (`src/` → root) | ✅ | re-enabled `no-credential-reuse` + `n8n-nodes-base/*` rules |

**Current totals:** 216 tests passing, lint clean (full n8n verified ruleset),
tsc clean, build clean (Vite, ~110ms).

## Decisions Log

Numbered in the order they were resolved during implementation; entries
10–14 surfaced during Phase 2/3, entries 22–30 during Phase 5.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | `$type` field handling | Auto-inject always from collection NSID | User never thinks about it |
| 2 | Repo scope for Get/List | Optional repo field, defaults to authenticated user's DID | Supports reading others' public records |
| 3 | List pagination | One page per execution + cursor | Standard n8n pattern; user chains/loops |
| 4 | Put semantics | Full replace + optional `swapRecord` CID | Matches protocol; concurrency safety |
| 5 | Lexicon resolution failure | Warning + fallback to raw JSON | Non-blocking; user can always proceed |
| 6 | Session management | Login per execution; `CredentialSession` auto-refreshes within execution | `getWorkflowStaticData` is unreliable and doesn't work in manual test mode; login overhead is negligible for app passwords |
| 7 | Nested `ref` types | Recursive resolution for typed sub-fields | Better UX for complex records |
| 8 | Testing | Mocks (vitest + msw) + manual Bluesky testing | Docker integration deferred to post-Phase 1 |
| 9 | `createdAt` | Auto-inject if schema requires it; user can override | Same pattern as `$type` but schema-conditional |
| 10 | `@atproto/api` XRPC validation rejects `record` type in `resolveLexicon` response | Call the typed client anyway; on `XRPCInvalidResponseError`, extract `responseBody.schema` and parse it. Future: replace with raw `fetch()` if upstream issue persists | The validation throws on a valid response. Catching the error and using its `responseBody` is pragmatic; the response data is still well-formed |
| 11 | Dotted-key un-flattening | `buildRecordFromNodeParams` runs `unflattenDottedKeys` over the resourceMapper value before sending to the PDS. Empty values are dropped | Refs and inline objects flatten to keys like `reply.root`, `reply.parent` for the UI; the PDS expects nested objects |
| 12 | Ref sub-field required propagation | `resolveRefProperties` returns `{ properties, required }`. A flattened sub-field is required iff the parent ref is required AND the resolved schema lists it as required | Otherwise optional refs would mark their sub-fields as required, confusing the user |
| 13 | Zero runtime dependencies | Bundle `@atproto/api` and `@atproto/lexicon-resolver` into `dist/` with Vite. Published package has empty `dependencies`. Only `n8n-workflow` is externalized. | n8n verification guidelines require no runtime deps. Also fixes `n8n-node dev` crash — the dev symlink exposes `node_modules` and n8n's glob picks up `uint8arrays/*.node.js` files |
| 14 | `uint8arrays` `.node.js` files | `postinstall` script patches `uint8arrays`' conditional exports to redirect `"node"` → `"import"` targets, then deletes the `.node.js` files | These platform-specific files (Buffer vs Uint8Array) crash n8n's node loader during dev. The ESM fallbacks are functionally identical |
| 15 | Single-ref unions | Treat as resolvable refs via `getResolvableRef()` helper | Common ATProto pattern (`type: "union", refs: ["one.ref"]`); user sees flattened fields instead of raw JSON |
| 16 | Type-only lexicons (no main record) | Return defs-only schema `{ properties: {}, rawDefs }` | Enables fragment resolution for cross-document refs like `site.standard.theme.color#rgb` |
| 17 | ~~RGB color objects~~ | ~~Collapse to single hex string field~~ → **Removed**: no site-specific handling. Refs flatten generically; depth limit (1) prevents field explosion | Generic approach works for all AT Protocol lexicons, not just Standard.site |
| 18 | Nested `$type` injection | Walk record + schema at execution time; inject before PDS call | Users shouldn't need to know about AT Protocol discriminators |
| 19 | Collection picker | `resourceLocator` with `describeRepo` list + free-text NSID mode | Users shouldn't need to memorize NSIDs |
| 20 | Literal record keys | Auto-resolve from schema when rkey is empty | `app.bsky.actor.profile` always uses `self`; users shouldn't need to know |
| 21 | Pre-submission validation | Validate against schema before PDS call; bullet-point errors | PDS errors are opaque (`InvalidRecord`); ours say which field is wrong |
| 22 | `enum` → n8n control | Map to `type: 'options'` with `options[]` array | `ResourceMapperField` natively supports this; gives users a dropdown instead of guesswork |
| 23 | `knownValues` → n8n control | Show values in `displayName` hint, keep `type: 'string'` | Open set — user can type anything, but sees common values at a glance |
| 24 | `const` handling | `readOnly: true` + `defaultValue` in field mapping; auto-inject at execution if missing | Users see the value but can't break it; execution is defensive |
| 25 | `maxGraphemes` counting | Use `Intl.Segmenter` (Node 16+) | The spec requires Unicode Grapheme Cluster counting; `Intl.Segmenter` is the standard API for this in JavaScript |
| 26 | `nullable` handling | Stop stripping `null` in `unflattenDottedKeys`; only strip `undefined` and `''` | Preserves explicit nulls for nullable fields while still cleaning up empty optional fields |
| 27 | Constraint displayName hints | Append `[max N chars]` / `[≥min, ≤max]` after description | Users see limits at a glance without needing to look up the lexicon |
| 28 | Blob `accept`/`maxSize` | Validate before upload, not after | Saves bandwidth + gives immediate clear error instead of deferred PDS rejection |
| 29 | Ref flattening depth | `MAX_REF_DEPTH = 1` for UI field generation; sub-refs become single `object` fields with JSON template defaults. Execution-time `$type` injection and validation keep their own depth=3 | Prevents field explosion (e.g. theme₀ 4 colors × 3 channels = 12+ fields). Sub-refs show expected structure via `buildDefaultTemplate()` |
| 30 | n8n `FieldType` mapping | `array` for arrays (not `object` — `tryToParseObject` rejects `[]`). `string` for `uri`/`at-uri` formats (not `url` — doesn't render editable input in ResourceMapper). `object` only for actual JSON objects | Discovered via n8n source: `type-validation.js` shows each type's parse/validation rules |
| 31 | Bluesky convenience node naming | Internal `name` is `atprotoBluesky` (camelCase), package-prefixed to avoid collision with other community Bluesky nodes; class `AtprotoBluesky`; displayName stays `Bluesky` | Previous iterations (`bluesky` → `atproto-bluesky` → `atprotoBluesky`) were driven by the conflict-avoidance discussion and the `n8n-nodes-base/node-class-description-name-miscased` rule's camelCase requirement |
| 32 | Generic blob ops grouped under `Blob` resource | Resource selector splits `Record` / `Blob` to satisfy `@n8n/community-nodes/resource-operation-pattern` (>5 ops) while keeping operation values stable (`createRecord`, `uploadBlob`, etc.) | Backwards compatible: existing workflows that stored only an `operation` value default `resource` to `record` and still work |
| 33 | Blob input parsing (Download Blob) | Accept bare CID, BlobRef JSON `{$link, ref.$link, …}`, or bsky CDN URL `…/plain/<did>/<cid>` in a single `Blob Reference` field. CDN URLs auto-extract the DID, making the Repo field optional in that case | One field handles every shape a user would reasonably paste; parsing lives in `nodes/Atproto/blobInput.ts` and is unit-tested |
| 34 | List op output shape | `List Blobs` emits one item per CID (n8n list-op convention); `List Records` keeps the legacy `{ records, cursor }` single-item shape for backwards compatibility. `Return All` toggle paginates internally for both, capped by `MAX_PAGES` | New op gets the better shape; existing op keeps its contract |
| 35 | `usableAsTool` on the trigger | Set `true` to satisfy both the `@n8n/community-nodes/node-usable-as-tool` lint rule (requires the property) and the `n8n-workflow` type (rejects `false`) | Triggers can't actually be invoked as tools — n8n core treats the property as irrelevant for trigger-type nodes, so the value is harmless metadata |
| 36 | Source layout (`src/` → root) | Move all source files (`credentials/`, `nodes/`, `index.ts`) to the repo root, matching the layout n8n's verification lints expect | Re-enables `@n8n/community-nodes/no-credential-reuse` and the `n8n-nodes-base/*` ruleset (file-path-globbed). The rule's path resolution (`dist/X.js` → `X.ts`) couldn't see source under `src/`, producing a false-positive security error. Layout move was simpler and more correct than disabling the rule |
