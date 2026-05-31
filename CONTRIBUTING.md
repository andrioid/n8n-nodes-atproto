# Contributing

## Prerequisites

- Node.js ≥ 22
- npm

## Setup

```bash
git clone https://github.com/YOUR_USER/n8n-nodes-atproto.git
cd n8n-nodes-atproto
npm install
```

## Dev server

```bash
npm run dev
```

Starts n8n on **http://localhost:5678** with the node linked and hot-reload enabled. Edit any file in `src/` → save → n8n rebuilds and restarts automatically. Refresh the browser to pick up changes.

In the n8n editor: **Add node** → search "AT Protocol" → add credentials (handle + [app password](https://bsky.app/settings/app-passwords)) → test.

### Troubleshooting

```bash
# Clear cached node state if hot reload gets stuck
rm -rf ~/.n8n-node-cli/.n8n/custom
npm run dev

# Use your own running n8n instance instead
npx n8n-node dev --external-n8n
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start n8n with hot reload |
| `npm run build` | Compile TypeScript + copy assets to `dist/` |
| `npm run lint` | Lint with oxlint |
| `npm run format` | Format with oxfmt |
| `npm test` | Run all tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |

## Tests

```bash
npm test            # 125 tests, runs in ~1s
npm run test:watch  # re-runs on file changes
```

Tests use [vitest](https://vitest.dev) + [msw](https://mswjs.io) to mock the XRPC server — no real PDS needed.

## Architecture

```
src/nodes/Atproto/
├── Atproto.node.ts     — Node description, collection picker, execute flow
├── operations.ts       — CRUD wrappers (createRecord, getRecord, etc.)
├── lexicon.ts          — Lexicon schema resolution (PDS + DNS fallback)
├── fieldMapping.ts     — Lexicon types → n8n ResourceMapperFields
├── typeInjection.ts    — Nested $type injection + hex color expansion
├── validation.ts       — Pre-submission schema validation
├── blob.ts             — Binary upload for blob-typed fields
└── tid.ts              — TID (timestamp ID) generation
```

### How it works

**Editor-time:** When the user picks a collection (via searchable dropdown or typed NSID), the `resourceMapperMethod` resolves the lexicon schema from the network, maps each property to an n8n field type, and presents a typed form. Refs are recursively flattened into dotted-path fields (e.g. `reply.root.uri`). Single-ref unions and type-only lexicons are resolved through cross-document fragment lookup. RGB color objects are collapsed into hex string fields.

**Execution-time:** The execute method builds a record from the mapped fields, un-flattens dotted keys back into nested objects, uploads any blob-typed fields via `com.atproto.repo.uploadBlob`, injects `$type` on nested ref/union objects, expands hex colors to `{r,g,b}`, validates the record against the schema, auto-injects top-level `$type` and `createdAt`, and makes the XRPC call.

### Key conventions

- **`$type` is always auto-injected** from the collection NSID. Users never set it.
- **`createdAt` is auto-injected** as an ISO timestamp when the schema requires it. Users can override.
- **Lexicon resolution** tries the PDS endpoint first, falls back to DNS-based `@atproto/lexicon-resolver`, and falls back to raw JSON mode if both fail.
- **Session management** — login per execution via `CredentialSession`. No cross-execution token caching.
- **Blob upload** — top-level blob fields only. The field value in the UI is a binary property name; at execution time, the binary data is read from the input item and uploaded to the PDS.
- **Hex colors** — RGB color objects (from lexicons like `site.standard.theme.color#rgb`) are shown as single hex fields in the UI and expanded to `{ $type, r, g, b }` at execution time.
- **Nested `$type` injection** — `injectNestedTypes` walks the record and adds `$type` discriminators to nested objects from refs and single-ref unions.
- **Schema validation** — `validateRecord` checks required fields, types, `$type` discriminators, and blob references before the PDS call. Errors are surfaced as bullet-point lists in n8n's error UI.
- **Literal record keys** — for lexicons with `key: literal:self` (like `app.bsky.actor.profile`), the rkey auto-resolves when left empty.

## Design docs

- [DESIGN.md](DESIGN.md) — original design rationale
- [PLAN.md](PLAN.md) — implementation plan with phase status, decisions log, and deviations
