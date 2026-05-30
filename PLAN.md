# Implementation Plan

## Status

| Phase | State | Tests | Commit |
|-------|-------|-------|--------|
| Phase 0 — Scaffolding | ✅ Done | n/a | `d9c7329` |
| Phase 1 — Generic CRUD | ✅ Done | 35 | `d9c7329` |
| Phase 2 — Dynamic field mapping | ✅ Done | 57 | `31140d5`, `34a5e16` (review fixes) |
| Phase 3 — Blob support | ✅ Done | 11 | `8f468d7` |
| Distribution — Bundling | ✅ Done | — | `00a4933`, `976ee7e` |
| Distribution — Publish | ⏳ Not started | — | — |

**Current totals:** 103 tests passing, lint clean, build clean (Vite, ~100ms).

## Decisions Log

All design ambiguities were resolved. Reference these if anything feels unclear during implementation. Entries 10–12 were added during Phase 2 implementation as new surprises emerged.

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
| 13 | Zero runtime dependencies | Bundle `@atproto/api` and `@atproto/lexicon-resolver` into `dist/` with Vite. Published package has empty `dependencies`. Only `n8n-workflow` is externalized. | n8n verification guidelines require no runtime deps. Also fixes `n8n-node dev` crash — the dev symlink exposes `node_modules` and n8n’s glob picks up `uint8arrays/*.node.js` files |
| 14 | `uint8arrays` `.node.js` files | `postinstall` script patches `uint8arrays`’ conditional exports to redirect `"node"` → `"import"` targets, then deletes the `.node.js` files | These platform-specific files (Buffer vs Uint8Array) crash n8n’s node loader during dev. The ESM fallbacks are functionally identical |

## Tooling

| Purpose | Tool | Notes |
|---------|------|-------|
| Dev server | `n8n-node dev` | Hot reload. Symlinks project into n8n’s custom nodes dir. |
| Build | `vite build` (library mode) | Bundles all deps into `dist/`. CJS output, ~100ms. Vite is already installed via vitest — no extra dependency. |
| Lint | `oxlint` | Rust-native speed. |
| Format | `oxfmt` | Separate npm package (not bundled with oxlint). Config file: `.oxfmtrc.json`. |
| Test | `vitest` + `msw` | ESM-native. Mock XRPC server. |
| Publish | `n8n-node release` | Builds, lints, tags, publishes to npm with provenance. |

## Dependencies

### Runtime: none

n8n verification guidelines require zero runtime dependencies. All packages are bundled into `dist/` by Vite at build time.

### Externalized (provided by n8n)

```
n8n-workflow           — node types, error classes (externalized in vite.config.build.ts)
```

### Dev / bundled (all in devDependencies)

```
@atproto/api              — CredentialSession, Agent, XRPC (bundled into dist)
@atproto/lexicon-resolver — DNS-based lexicon fallback (bundled, lazy-loaded via import())
typescript                — type-checking (tsc --watch in n8n-node dev)
@n8n/node-cli             — dev server + npm provenance
vitest                    — test runner (also provides vite for building)
msw                       — mock XRPC server
oxlint                    — lint
oxfmt                     — format
```

### Bundle size

| Chunk | Raw | Gzipped | Notes |
|-------|-----|---------|-------|
| `Atproto.node.js` | 883 KB | 123 KB | Main entry. 91% is `@atproto/api` (barrel exports, not tree-shakeable) |
| `_chunks/dist.js` | 213 KB | 49 KB | Shared: zod, multiformats, @atproto/syntax |
| `_chunks/dist2.js` | 1,183 KB | 287 KB | **Lazy-loaded** via `import()` — only when DNS lexicon fallback fires. Contains undici (660 KB) |
| **Eager total** | **1,096 KB** | **172 KB** | What loads at runtime |

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

## Phase 0 — Project Scaffolding ✅

> Done in `d9c7329`. Reference only; no work left here.

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
    "@atproto/api": "^0.20.0",
    "@atproto/lexicon-resolver": "^0.4.0"
  },
  "peerDependencies": {
    "n8n-workflow": "*"
  },
  "devDependencies": {
    "@n8n/node-cli": "^0.32.0",
    "@n8n/eslint-plugin-community-nodes": "latest",
    "oxlint": "latest",
    "oxfmt": "latest",
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
  "jsPlugins": ["@n8n/eslint-plugin-community-nodes"]
  // n8n community node rules via jsPlugins (alpha).
  // If jsPlugins fails with this plugin, fall back:
  //   1. Remove jsPlugins from oxlint.json
  //   2. Add eslint + flat config for n8n rules only
  //   3. Add "lint:n8n": "eslint" to scripts
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

## Phase 1 — Credentials + Generic CRUD ✅

> Done in `d9c7329`. 35 tests covering TID generation, all 5 CRUD operations, `$type`/`createdAt` injection, and error paths.

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

Session management: call `session.login()` on every execution. The `CredentialSession` automatically handles token refresh within a single execution (if `accessJwt` expires mid-batch, it transparently uses `refreshJwt`). No cross-execution caching — n8n's `getWorkflowStaticData` is unreliable and doesn't work in manual test mode. The overhead of one `createSession` call per execution is negligible for app passwords.

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

## Phase 2 — Dynamic Field Mapping ✅

> Done in `31140d5` + `34a5e16`. 57 tests covering lexicon resolution, type mapping, recursive ref flattening, dotted-key un-flattening, and `buildRecordFromNodeParams`.
>
> **Deviations from the original plan, with reasons:**
>
> 1. **PDS path uses error-body extraction, not the typed client's normal return path.** The `@atproto/api` v0.20.6 XRPC client validates `resolveLexicon` responses against a schema whose `schema` field is a `ref` to a `record` type — the validator rejects this with `XRPCInvalidResponseError` even when the response is well-formed. We call the client anyway, catch the error, and parse `err.responseBody.schema`. See decision log entry 10.
>
> 2. **Added `unflattenDottedKeys` in the execute path.** Field flattening produces dotted keys like `reply.root` in the UI; the resourceMapper returns those literally, so we must un-flatten back to nested objects before the XRPC call. The first review missed this because each module looked correct in isolation — only end-to-end tracing surfaced it. See decision log entry 11.
>
> 3. **`resolveRefProperties` returns `{ properties, required }`** (the `ResolvedRef` type) so flattened ref sub-fields get accurate required status. See decision log entry 12.
>
> 4. **`@atproto/lexicon-resolver` is imported dynamically** with a `@ts-expect-error` for module resolution. The package is ESM-only and our `tsconfig` uses `module: commonjs`; dynamic `import()` works at runtime in Node 22 but TypeScript can't statically resolve the ESM exports under that config. A future tsconfig migration to `node16`/`bundler` resolution would clean this up.
>
> 5. **`loadOptionsDependsOn: ['collection']`, `supportAutoMap: true`, and `noFieldsError`** were added to the resourceMapper config beyond what the plan called for — the first two avoid running `getRecordFields` on every keystroke and let users auto-map; the third gives a useful hint when resolution fails.

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

## Phase 3 — Blob Support ✅

> Done. 11 tests covering blob upload, field identification, error paths, MIME detection, and record immutability.
>
> **Decisions made:**
> - MIME type from binary metadata (falls back to `application/octet-stream`)
> - Top-level blob fields only (not recursive into refs/objects)
> - Rollback on first failure (first blob upload error stops processing)
> - New file `src/nodes/Atproto/blob.ts` (separate from `operations.ts`)
>
> **Resolved open question:** `applyBlobUploads(record, schema, agent, itemIndex, executeFunctions)` is called as an async post-processing step after `buildRecordFromNodeParams` in both the `createRecord` and `putRecord` execute branches. The execute path now also calls `resolveLexiconSchema` (with module-level cache) to determine which fields are blobs.
>
> **Key discovery:** `agent.com.atproto.repo.uploadBlob(data, opts)` takes two arguments (not a single `{ data, encoding }` object). The first is the raw binary buffer, the second is `{ encoding: mimeType }`. The XRPC client returns a `BlobRef` class instance (from `@atproto/lexicon`) which `stringifyLex` knows how to serialize for the subsequent `createRecord`/`putRecord` call.

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

- [x] `npm run lint` passes
- [x] `npm test` passes (103 tests)
- [x] `npm run build` produces clean `dist/` (Vite, ~100ms)
- [x] Zero runtime `dependencies` in package.json
- [x] Dev server starts without crashes (`npm run dev`)
- [ ] Manual test: full CRUD lifecycle against Bluesky
- [ ] Manual test: field mapping with `app.bsky.feed.post`
- [ ] README has install instructions for community nodes panel
- [ ] `package.json` has correct `repository.url`, `author`, `description`
- [ ] Icon displays correctly in n8n node palette
- [ ] Publish with `npm publish --provenance` via GitHub Actions
- [ ] Submit for n8n community node verification
