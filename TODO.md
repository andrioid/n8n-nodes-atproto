# TODO

## ✅ Phase 0–4 — Complete

Project scaffolding, generic CRUD node (5 operations), dynamic field mapping
with lexicon resolution, blob upload support, deep schema resolution & UX
polish. 125 tests passing. See git history for details.

## ✅ Testing (CRUD)

- [x] 125 tests passing (TID, operations, errors, lexicon, field mapping, refs, validation)
- [ ] Manual testing against real Bluesky PDS during development
- [ ] Docker-based integration tests deferred

## Distribution

- [ ] Lint with oxlint + `@n8n/eslint-plugin-community-nodes` via jsPlugins
- [ ] Publish to npm as a community node package
- [ ] Add install-from-community-nodes instructions to README
- [ ] Submit for n8n community node verification

## Phase 5 — Jetstream Trigger

Subscribe to the AT Protocol firehose via [Jetstream](https://github.com/bluesky-social/jetstream)
and trigger n8n workflows on matching events. Zero new dependencies — uses
Node 22+ built-in `WebSocket` and `node:zlib` zstd (with Jetstream's custom dictionary).

### Files

Colocated in `src/nodes/Atproto/`:

- `AtprotoJetstream.trigger.ts` — trigger node class
- `jetstream.ts` — WebSocket client, reconnection, types
- `zstd_dictionary` — static binary asset (110KB, from Jetstream repo)

Build changes: new entry in `vite.config.build.ts`, copy dictionary in `writeBundle`,
add to `package.json` `n8n.nodes[]`, barrel export in `index.ts`.

### Node Description

- **displayName**: AT Protocol Jetstream Trigger
- **name**: `atprotoJetstreamTrigger`
- **group**: `['trigger']`
- **icon**: `file:atproto.svg` (shared with CRUD node)
- **credentials**: `atprotoApi` (required — powers the collection RLC)

### Parameters

| # | Parameter | Type | Notes |
|---|-----------|------|-------|
| 1 | Jetstream Endpoint | `options` | 4 public instances + Custom (conditional string) |
| 2 | Collections | `fixedCollection` of `resourceLocator` | "Add Collection" button. Reuses `searchCollections`. Empty = all |
| 3 | Wanted DIDs | `fixedCollection` of `string` | "Add DID" button. Optional |
| 4 | Event Kinds | `multiOptions` | Commits ✓, Identity, Account. Default: commits only |
| 5 | Operations | `multiOptions` | Create ✓, Update ✓, Delete ✓. Shown when Commits selected |
| 6 | Compression | `boolean` | Default: true. Lazy-loads zstd dictionary on first use |
| 7 | Max Message Size | `number` (in Options collection) | Optional, default 0 (no limit) |

### Output Format (flattened)

Raw Jetstream JSON is restructured for n8n ergonomics:

```jsonc
// Commit events:
{ "did": "did:plc:...", "timeUs": 1725911162329308, "kind": "commit",
  "operation": "create", "collection": "app.bsky.feed.post", "rkey": "3l3qo...",
  "rev": "3l3qo2vutsw2b", "cid": "bafyrei...",
  "record": { "$type": "app.bsky.feed.post", "text": "...", ... } }

// Identity events:
{ "did": "did:plc:...", "timeUs": ..., "kind": "identity",
  "handle": "user.bsky.social", "seq": 1409752997, "time": "..." }

// Account events:
{ "did": "did:plc:...", "timeUs": ..., "kind": "account",
  "active": true, "status": "active", "seq": ..., "time": "..." }
```

### WebSocket Client (`jetstream.ts`)

- Module-level lazy-loaded zstd dictionary (cached forever after first load)
- Reconnection: exponential backoff (1s → 2s → 4s … cap 30s)
- Cursor rewind 3s on reconnect for gapless playback
- `stopped` flag respected by reconnection loop (set by `closeFunction`)
- Internal types for all 3 event kinds (no external type deps)

### Trigger Lifecycle

1. Read parameters (endpoint, collections, DIDs, kinds, operations, compress)
2. Load persisted cursor from `getWorkflowStaticData('node')`
3. If compress=true, lazy-load zstd dictionary
4. Build WebSocket URL with query params
5. Connect + listen → decompress → parse → filter by kind/operation → `this.emit()`
6. `closeFunction`: set stopped, close WS, persist cursor to static data
7. `manualTriggerFunction`: connect, wait up to ~30s for first matching event, disconnect

### Tasks

- [x] Copy `zstd_dictionary` from Jetstream repo
- [x] Implement `jetstream.ts` (WS client, types, reconnection, decompression)
- [x] Implement `AtprotoJetstream.trigger.ts` (node class, parameters, trigger lifecycle)
- [x] Update `vite.config.build.ts` (entry point + dictionary copy)
- [x] Update `package.json` (`n8n.nodes[]`)
- [x] Update `src/index.ts` (barrel export)
- [x] Tests: URL construction, event parsing, filtering, cursor tracking, zstd round-trip
- [x] Manual test against live Jetstream instance
