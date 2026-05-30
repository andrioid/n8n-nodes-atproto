# Implementation Plan

Everything decided, nothing ambiguous. Pick up from any section.

## Decisions Log

All design ambiguities were resolved. Reference these if anything feels unclear during implementation.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | `$type` field handling | Auto-inject always from collection NSID | User never thinks about it |
| 2 | Repo scope for Get/List | Optional repo field, defaults to authenticated user's DID | Supports reading others' public records |
| 3 | List pagination | One page per execution + cursor | Standard n8n pattern; user chains/loops |
| 4 | Put semantics | Full replace + optional `swapRecord` CID | Matches protocol; concurrency safety |
| 5 | Lexicon resolution failure | Warning + fallback to raw JSON | Non-blocking; user can always proceed |
| 6 | Session management | Cache + refresh tokens across executions | Avoids `createSession` on every run |
| 7 | Nested `ref` types | Recursive resolution for typed sub-fields | Better UX for complex records |
| 8 | Testing | Mocks (vitest + msw) + manual Bluesky testing | Docker integration deferred to post-Phase 1 |
| 9 | `createdAt` | Auto-inject if schema requires it; user can override | Same pattern as `$type` but schema-conditional |

## Tooling

| Purpose | Tool | Notes |
|---------|------|-------|
| Dev server | `n8n-node dev` | Hot reload. Edit → save → auto-rebuild → refresh browser. |
| Build | `n8n-node build` | Handles TypeScript + icon copying. No custom scripts. |
| Lint | `oxlint` + `@n8n/eslint-plugin-community-nodes` via jsPlugins | Rust-native speed. n8n rules for pre-publish. |
| Format | `oxfmt` | Ships with oxlint. Single config file. |
| Test | `vitest` + `msw` | ESM-native. Mock XRPC server. |
| Publish | `n8n-node release` | Builds, lints, tags, publishes to npm with provenance. |

## Dependencies

### Runtime (2 packages)

```
@atproto/api          — CredentialSession, Agent, XRPC, DID resolution
@atproto/lexicon-resolver — DNS-based lexicon resolution (fallback for Phase 2)
```

They share 5 transitive deps (`@atproto/xrpc`, `@atproto/lexicon`, `@atproto/syntax`, `multiformats`, `@atproto/identity`). Marginal cost of the second package is just `@atproto/repo` + `@atproto-labs/fetch-node`.

### Peer (1 package)

```
n8n-workflow           — provided by n8n at runtime
```

### Dev (5 packages)

```
typescript             — compiler
@n8n/node-cli          — build + npm provenance
oxlint                 — lint + format (includes oxfmt)
@n8n/eslint-plugin-community-nodes — n8n rules via jsPlugins
vitest                 — test runner
msw                    — mock XRPC server
```

---

## Dev Loop

The fast feedback loop for verifying changes against a real n8n instance:

```
Terminal:  npm run dev          # starts n8n on localhost:5678 with hot reload
Browser:   http://localhost:5678  # n8n editor — add the AT Protocol node, test it
Edit:      save any file in src/  # auto-rebuild → n8n hot reloads → refresh browser
```

`n8n-node dev` handles everything: builds TypeScript, copies icons, links the node into n8n's custom nodes directory (`~/.n8n-node-cli/.n8n/custom`), watches for changes, and restarts n8n when files change.

This is the primary way to verify the node works. Unit tests (vitest) run separately for fast logic checks without spinning up n8n.

### Troubleshooting the dev loop

```bash
# Clear cached node state if hot reload gets stuck
rm -rf ~/.n8n-node-cli/.n8n/custom
npm run dev

# Use external n8n if you already have one running
n8n-node dev --external-n8n
```

---

## Phase 0 — Project Scaffolding

Set up from scratch with `@n8n/node-cli` conventions. Files live under `src/` so `n8n-node dev` can watch them.

### 0.1 — Initialize project

```
n8n-nodes-atproto/
├── src/
│   ├── nodes/
│   │   └── Atproto/
│   │       ├── Atproto.node.ts
│   │       ├── operations.ts
│   │       ├── tid.ts
│   │       └── atproto.svg
│   └── credentials/
│       └── AtprotoApi.credentials.ts
├── tests/
│   ├── tid.test.ts
│   └── setup.ts
├── package.json
├── tsconfig.json
├── oxlint.json
├── vitest.config.ts
├── README.md
├── DESIGN.md
├── TODO.md
└── PLAN.md
```

### 0.2 — package.json

```jsonc
{
  "name": "n8n-nodes-atproto",
  "version": "0.1.0",
  "description": "Generic AT Protocol node for n8n — CRUD any record in any lexicon",
  "keywords": ["n8n-community-node-package"],
  "license": "MIT",
  "main": "dist/index.js",
  "scripts": {
    "dev": "n8n-node dev",
    "build": "n8n-node build",
    "lint": "oxlint src/",
    "format": "oxfmt --write src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "release": "n8n-node release"
  },
  "files": ["dist"],
  "n8n": {
    "n8nNodesApiVersion": 1,
    "credentials": ["dist/credentials/AtprotoApi.credentials.js"],
    "nodes": ["dist/nodes/Atproto/Atproto.node.js"]
  },
  "dependencies": {
    "@atproto/api": "^0.19.0",
    "@atproto/lexicon-resolver": "^0.2.0"
  },
  "peerDependencies": {
    "n8n-workflow": "*"
  },
  "devDependencies": {
    "@n8n/node-cli": "^0.30.0",
    "@n8n/eslint-plugin-community-nodes": "latest",
    "oxlint": "latest",
    "vitest": "latest",
    "msw": "^2.0.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

### 0.3 — tsconfig.json

Extend n8n conventions: `target: ES2022`, `module: commonjs` (n8n requires CJS), strict mode, `outDir: dist`, `rootDir: src`, include `src/`.

### 0.4 — oxlint.json

```jsonc
{
  "jsPlugins": ["@n8n/eslint-plugin-community-nodes"],
  // n8n community node rules enabled for pre-publish checks
}
```

### 0.5 — Icon

Use the AT Protocol logo (`@` butterfly mark) as `src/nodes/Atproto/atproto.svg`. Source from official AT Protocol branding assets.

### 0.6 — Verify scaffold

- `npm install` succeeds
- `npm run build` produces `dist/` with compiled JS + icon
- `npm run dev` starts n8n on localhost:5678 and the node appears in the palette
- `npm run lint` runs without errors on empty project
- `npm test` runs (no tests yet, should pass vacuously)

---

## Phase 1 — Credentials + Generic CRUD

### 1.1 — Credential definition

**File:** `credentials/AtprotoApi.credentials.ts`

Three fields:
- `identifier` (string) — handle or DID (e.g. `you.bsky.social`)
- `appPassword` (string, password type) — app password from bsky.app/settings
- `serviceUrl` (string, default `https://bsky.social`) — PDS endpoint

Include a `test` block that calls `com.atproto.server.createSession` to validate credentials. Return clear error messages for invalid credentials.

**How to test:** Manual — enter real credentials in n8n, verify green checkmark.

### 1.2 — TID generation

**File:** `src/nodes/Atproto/tid.ts`

Implement the TID spec:
- 13-char base32-sortable string
- Top bit 0 | 53 bits microsecond Unix epoch | 10 bits random clock ID
- Use `234567abcdefghijklmnopqrstuvwxyz` as the base32 alphabet

Export: `generateTid(): string`

**Tests:** `tests/tid.test.ts`
- Format: 13 chars, valid base32 alphabet
- Uniqueness: 1000 sequential TIDs are all unique
- Sortability: sequential TIDs sort lexicographically in time order
- Top bit: first char is always in `[2-7a-b]` (top bit 0)

### 1.3 — Node description

**File:** `src/nodes/Atproto/Atproto.node.ts`

Define the `INodeType` description:
- `displayName`: "AT Protocol"
- `name`: "atproto"
- `icon`: "file:atproto.svg"
- `group`: ["transform"]
- `version`: 1
- `description`: "CRUD records in any AT Protocol collection"
- `defaults`: `{ name: "AT Protocol" }`
- `inputs`: `["main"]`
- `outputs`: `["main"]`
- `credentials`: `[{ name: "atprotoApi", required: true }]`

Properties:
1. **Operation** (options): Create Record, Get Record, Put Record, Delete Record, List Records
2. **Collection** (string): NSID input, shown for all operations
3. **Repo** (string, optional): DID or handle, shown for Get/List, defaults to self
4. **Record Key** (string): shown for Get/Put/Delete. For Create, a dropdown: "Auto (TID)" or "Custom"
5. **Record Data** (json): shown for Create/Put — raw JSON input for Phase 1
6. **Swap Record** (string, optional): CID, shown for Put only
7. **Limit** (number, default 50): shown for List only
8. **Cursor** (string, optional): shown for List only

### 1.4 — Operations

**File:** `src/nodes/Atproto/operations.ts`

Export one function per operation. Each receives the authenticated `Agent` and the node parameters.

```typescript
export async function createRecord(agent: Agent, params: {
  collection: string;
  rkey?: string;
  record: Record<string, unknown>;
}): Promise<{ uri: string; cid: string }>
```

All functions:

| Function | XRPC call | Notes |
|----------|-----------|-------|
| `createRecord` | `com.atproto.repo.createRecord` | Auto-generate TID if no rkey. Auto-inject `$type`. Auto-inject `createdAt` if schema requires it (Phase 1: always inject as ISO string). |
| `getRecord` | `com.atproto.repo.getRecord` | Accept optional `repo` param. |
| `putRecord` | `com.atproto.repo.putRecord` | Full replace. Optional `swapRecord`. Auto-inject `$type`. |
| `deleteRecord` | `com.atproto.repo.deleteRecord` | Straightforward. |
| `listRecords` | `com.atproto.repo.listRecords` | Return `{ records: [...], cursor?: string }`. Accept optional `repo`. |

### 1.5 — Execute method

In `Atproto.node.ts`, implement `execute()`:

1. Get credentials from `this.getCredentials('atprotoApi')`
2. Create `CredentialSession` with service URL
3. Login with identifier + app password
4. Create `Agent` from session
5. Loop over input items
6. Switch on operation, call the corresponding function from `operations.ts`
7. Return output items with `{ json: result }`

Session caching: use `this.getCredentials()` to retrieve cached tokens. On first run, call `createSession`. On subsequent runs, use cached `accessJwt`/`refreshJwt` via `CredentialSession.resumeSession()`. The agent handles refresh automatically.

### 1.6 — Error handling

Wrap each operation in try/catch. Map XRPC errors to n8n-friendly messages:

| XRPC error | n8n behavior |
|------------|--------------|
| `InvalidToken` / 401 | "Authentication failed — check your app password" |
| `AccountTakedown` | "Account is suspended" |
| `RecordNotFound` | "Record not found at {collection}/{rkey}" |
| `InvalidRecord` | "Record validation failed: {message}" — surface the PDS validation error |
| `RateLimitExceeded` / 429 | "Rate limited — retry after {seconds}s" |
| Network error | "Could not reach PDS at {url}" |

Use `continueOnFail` pattern so one failed item doesn't stop the batch.

### 1.7 — Phase 1 tests

**Files:**
- `tests/tid.test.ts` — see 1.2
- `tests/operations.test.ts` — mock XRPC server with msw, test each operation
- `tests/type-injection.test.ts` — verify `$type` is set correctly, not clobbered

Mock server setup in `tests/setup.ts`:
- Intercept `POST /xrpc/com.atproto.server.createSession` → return fake tokens
- Intercept `POST /xrpc/com.atproto.repo.createRecord` → validate body shape, return `{ uri, cid }`
- etc. for all 5 operations

### 1.8 — Phase 1 manual validation

Test against real Bluesky:
1. Create a `app.bsky.feed.post` with text + createdAt
2. Get it back by URI
3. List posts in `app.bsky.feed.post`
4. Delete the post
5. Verify each operation returns expected output in n8n

---

## Phase 2 — Dynamic Field Mapping

### 2.1 — Lexicon resolution

**File:** `src/nodes/Atproto/lexicon.ts`

```typescript
export async function resolveLexiconSchema(
  agent: Agent,
  nsid: string
): Promise<LexiconSchema | null>
```

Resolution chain:
1. Try `agent.com.atproto.lexicon.resolveLexicon({ nsid })`
2. If that fails (404, not implemented), try `@atproto/lexicon-resolver`'s `resolveLexicon(nsid)`
3. If both fail, return `null` (triggers JSON fallback)

Parse the response to extract:
- `defs.main.record.properties` — the field definitions
- `defs.main.record.required` — required field names
- `defs.main.key` — record key strategy (tid, any, literal:self)

Cache results in a module-level `Map<string, LexiconSchema>` keyed by NSID. The `resourceMapperMethod` runs in the editor, not during execution, so a simple in-memory cache is sufficient.

### 2.2 — Field mapping

**File:** `src/nodes/Atproto/fieldMapping.ts`

```typescript
export function lexiconToResourceMapperFields(
  schema: LexiconSchema
): ResourceMapperField[]
```

Walk `schema.properties`, map each to a `ResourceMapperField` using the type mapping table from DESIGN.md.

For `ref` types: recursively resolve the referenced schema and flatten its properties with a dotted prefix (e.g. `reply.root.uri`, `reply.root.cid`). Cap recursion depth at 3 to avoid infinite loops.

For `createdAt` fields marked as required: set `defaultMatch: true` and provide a default value expression that evaluates to the current ISO timestamp.

### 2.3 — Wire up resourceMapping

In `Atproto.node.ts`, add a `resourceMapping` property to the node description for the Record Data field:

```typescript
{
  displayName: 'Record Data',
  name: 'recordData',
  type: 'resourceMapper',
  default: { mappingMode: 'defineBelow', value: null },
  required: true,
  typeOptions: {
    resourceMapper: {
      resourceMapperMethod: 'getRecordFields',
      mode: 'add',
      fieldWords: { singular: 'field', plural: 'fields' },
    },
  },
  displayOptions: {
    show: { operation: ['createRecord', 'putRecord'] },
  },
}
```

Implement `methods.resourceMapper.getRecordFields`:
1. Read the collection NSID from the current node parameters
2. Call `resolveLexiconSchema(agent, nsid)`
3. If null → return empty fields array (n8n falls back to raw mode)
4. Map through `lexiconToResourceMapperFields(schema)`
5. Return the fields

### 2.4 — Build record from mapped fields

In the execute method, when `resourceMapping` is active, read mapped fields from `this.getNodeParameter('recordData.value')` and construct the record object. Auto-inject `$type` and `createdAt` as before.

### 2.5 — Fallback UX

When lexicon resolution fails:
- Log a warning: `this.logger.warn('Could not resolve lexicon for ${nsid}, falling back to JSON input')`
- Return empty `ResourceMapperField[]` so n8n shows the raw JSON editor
- The user can still proceed with manual JSON

### 2.6 — Phase 2 tests

- `tests/fieldMapping.test.ts` — test type mapping for every lexicon type
- `tests/lexicon.test.ts` — test resolution chain (PDS success, PDS fail + resolver success, both fail)
- `tests/recursiveRef.test.ts` — test ref resolution with depth limit
- Mock a realistic lexicon (e.g. `app.bsky.feed.post`) and verify the generated fields match expected output

---

## Phase 3 — Blob Support

### 3.1 — Blob upload

When a field has type `blob` in the lexicon:
1. The field renders as a string input (binary property name)
2. During execution, read the binary data from the input item using `this.helpers.getBinaryDataBuffer()`
3. Call `agent.com.atproto.repo.uploadBlob(data, { encoding: mimeType })`
4. Replace the field value with the blob reference: `{ $type: 'blob', ref: { $link: cid }, mimeType, size }`

### 3.2 — Phase 3 tests

- Mock `uploadBlob` endpoint
- Verify blob reference format in the constructed record
- Test with missing binary property (should error clearly)

---

## Distribution Checklist

Before publishing:

- [ ] `npm run lint` passes (oxlint + n8n community rules)
- [ ] `npm test` passes (all vitest suites)
- [ ] `npm run build` produces clean `dist/`
- [ ] Manual test: full CRUD lifecycle against Bluesky
- [ ] Manual test: field mapping with `app.bsky.feed.post` (Phase 2)
- [ ] README has install instructions for community nodes panel
- [ ] `package.json` has correct `repository.url`, `author`, `description`
- [ ] Icon displays correctly in n8n node palette
- [ ] Publish with `npm publish --provenance` (requires `@n8n/node-cli` ≥0.23.0)
- [ ] Submit for n8n community node verification
