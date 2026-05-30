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
npm test            # 103 tests, runs in ~1s
npm run test:watch  # re-runs on file changes
```

Tests use [vitest](https://vitest.dev) + [msw](https://mswjs.io) to mock the XRPC server — no real PDS needed.

## Architecture

```
src/nodes/Atproto/
├── Atproto.node.ts   — Node description + execute method
├── operations.ts     — CRUD wrappers (createRecord, getRecord, etc.)
├── lexicon.ts        — Lexicon schema resolution (PDS + DNS fallback)
├── fieldMapping.ts   — Lexicon types → n8n ResourceMapperFields
├── blob.ts           — Binary upload for blob-typed fields
└── tid.ts            — TID (timestamp ID) generation
```

### How it works

**Editor-time:** When the user enters a collection NSID (e.g. `app.bsky.feed.post`), the `resourceMapperMethod` resolves the lexicon schema from the network, maps each property to an n8n field type, and presents a typed form. Ref types are recursively flattened into dotted-path fields (e.g. `reply.root.uri`).

**Execution-time:** The execute method builds a record from the mapped fields, un-flattens dotted keys back into nested objects, uploads any blob-typed fields via `com.atproto.repo.uploadBlob`, auto-injects `$type` and `createdAt`, and makes the XRPC call.

### Key conventions

- **`$type` is always auto-injected** from the collection NSID. Users never set it.
- **`createdAt` is auto-injected** as an ISO timestamp when the schema requires it. Users can override.
- **Lexicon resolution** tries the PDS endpoint first, falls back to DNS-based `@atproto/lexicon-resolver`, and falls back to raw JSON mode if both fail.
- **Session management** — login per execution via `CredentialSession`. No cross-execution token caching.
- **Blob upload** — top-level blob fields only. The field value in the UI is a binary property name; at execution time, the binary data is read from the input item and uploaded to the PDS.

## Design docs

- [DESIGN.md](DESIGN.md) — original design rationale
- [PLAN.md](PLAN.md) — implementation plan with phase status, decisions log, and deviations
