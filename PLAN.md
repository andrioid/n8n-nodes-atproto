# Implementation Plan

## Status

| Phase | State | Tests | Commit |
|-------|-------|-------|--------|
| Phase 0 - Scaffolding | ✅ Done | n/a | `d9c7329` |
| Phase 1 - Generic CRUD | ✅ Done | 35 | `d9c7329` |
| Phase 2 - Dynamic field mapping | ✅ Done | 57 | `31140d5`, `34a5e16` (review fixes) |
| Phase 3 - Blob support | ✅ Done | 11 | `8f468d7` |
| Distribution - Bundling | ✅ Done | - | `00a4933`, `976ee7e` |
| Phase 4 - Deep resolution & UX | ✅ Done | 22 | `85beddc`-`b156743` |
| Phase 5 - Schema constraints | ⏳ Not started | - | - |
| Distribution - Publish | ⏳ Not started | - | - |

**Current totals:** 125 tests passing, lint clean, build clean (Vite, ~100ms).

## Decisions Log

All design ambiguities were resolved. Reference these if anything feels unclear during implementation. Entries 10-12 were added during Phase 2 implementation as new surprises emerged.

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 15 | Single-ref unions | Treat as resolvable refs via `getResolvableRef()` helper | Common ATProto pattern (`type: "union", refs: ["one.ref"]`); user sees flattened fields instead of raw JSON |
| 16 | Type-only lexicons (no main record) | Return defs-only schema `{ properties: {}, rawDefs }` | Enables fragment resolution for cross-document refs like `site.standard.theme.color#rgb` |
| 17 | RGB color objects | Collapse to single hex string field; expand at execution time | 4 fields instead of 12; hex is universally understood |
| 18 | Nested `$type` injection | Walk record + schema at execution time; inject before PDS call | Users shouldn't need to know about AT Protocol discriminators |
| 19 | Collection picker | `resourceLocator` with `describeRepo` list + free-text NSID mode | Users shouldn't need to memorize NSIDs |
| 20 | Literal record keys | Auto-resolve from schema when rkey is empty | `app.bsky.actor.profile` always uses `self`; users shouldn't need to know |
| 21 | Pre-submission validation | Validate against schema before PDS call; bullet-point errors | PDS errors are opaque (`InvalidRecord`); ours say which field is wrong |
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
| 13 | Zero runtime dependencies | Bundle `@atproto/api` and `@atproto/lexicon-resolver` into `dist/` with Vite. Published package has empty `dependencies`. Only `n8n-workflow` is externalized. | n8n verification guidelines require no runtime deps. Also fixes `n8n-node dev` crash - the dev symlink exposes `node_modules` and n8n's glob picks up `uint8arrays/*.node.js` files |
| 14 | `uint8arrays` `.node.js` files | `postinstall` script patches `uint8arrays`' conditional exports to redirect `"node"` → `"import"` targets, then deletes the `.node.js` files | These platform-specific files (Buffer vs Uint8Array) crash n8n's node loader during dev. The ESM fallbacks are functionally identical |
| 22 | `enum` → n8n control | Map to `type: 'options'` with `options[]` array | `ResourceMapperField` natively supports this; gives users a dropdown instead of guesswork |
| 23 | `knownValues` → n8n control | Show values in `displayName` hint, keep `type: 'string'` | Open set - user can type anything, but sees common values at a glance |
| 24 | `const` handling | `readOnly: true` + `defaultValue` in field mapping; auto-inject at execution if missing | Users see the value but can't break it; execution is defensive |
| 25 | `maxGraphemes` counting | Use `Intl.Segmenter` (Node 16+) | The spec requires Unicode Grapheme Cluster counting; `Intl.Segmenter` is the standard API for this in JavaScript |
| 26 | `nullable` handling | Stop stripping `null` in `unflattenDottedKeys`; only strip `undefined` and `''` | Preserves explicit nulls for nullable fields while still cleaning up empty optional fields |
| 27 | Constraint displayName hints | Append `[max N chars]` / `[≥min, ≤max]` after description | Users see limits at a glance without needing to look up the lexicon |
| 28 | Blob `accept`/`maxSize` | Validate before upload, not after | Saves bandwidth + gives immediate clear error instead of deferred PDS rejection |

## Tooling

| Purpose | Tool | Notes |
|---------|------|-------|
| Dev server | `n8n-node dev` | Hot reload. Symlinks project into n8n's custom nodes dir. |
| Build | `vite build` (library mode) | Bundles all deps into `dist/`. CJS output, ~100ms. Vite is already installed via vitest - no extra dependency. |
| Lint | `oxlint` | Rust-native speed. |
| Format | `oxfmt` | Separate npm package (not bundled with oxlint). Config file: `.oxfmtrc.json`. |
| Test | `vitest` + `msw` | ESM-native. Mock XRPC server. |
| Publish | `n8n-node release` | Builds, lints, tags, publishes to npm with provenance. |

## Dependencies

### Runtime: none

n8n verification guidelines require zero runtime dependencies. All packages are bundled into `dist/` by Vite at build time.

### Externalized (provided by n8n)

```
n8n-workflow           - node types, error classes (externalized in vite.config.build.ts)
```

### Dev / bundled (all in devDependencies)

```
@atproto/api              - CredentialSession, Agent, XRPC (bundled into dist)
@atproto/lexicon-resolver - DNS-based lexicon fallback (bundled, lazy-loaded via import())
typescript                - type-checking (tsc --watch in n8n-node dev)
@n8n/node-cli             - dev server + npm provenance
vitest                    - test runner (also provides vite for building)
msw                       - mock XRPC server
oxlint                    - lint
oxfmt                     - format
```

### Bundle size

| Chunk | Raw | Gzipped | Notes |
|-------|-----|---------|-------|
| `Atproto.node.js` | 883 KB | 123 KB | Main entry. 91% is `@atproto/api` (barrel exports, not tree-shakeable) |
| `_chunks/dist.js` | 213 KB | 49 KB | Shared: zod, multiformats, @atproto/syntax |
| `_chunks/dist2.js` | 1,183 KB | 287 KB | **Lazy-loaded** via `import()` - only when DNS lexicon fallback fires. Contains undici (660 KB) |
| **Eager total** | **1,096 KB** | **172 KB** | What loads at runtime |

---

## Dev Loop

The fast feedback loop for verifying changes against a real n8n instance:

```
Terminal:  npm run dev          # starts n8n on localhost:5678 with hot reload
Browser:   http://localhost:5678  # n8n editor - add the AT Protocol node, test it
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

## Phase 0 — Scaffolding ✅

> Done in `d9c7329`. Set up project with `@n8n/node-cli` conventions: `src/` layout, package.json, tsconfig, oxlint, vitest, atproto.svg icon.

<details>
<summary>Original step-by-step (reference only)</summary>

### 0.1 - Initialize project

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

### 0.2 - package.json

```jsonc
{
  "name": "n8n-nodes-atproto",
  "version": "0.1.0",
  "description": "Generic AT Protocol node for n8n - CRUD any record in any lexicon",
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

### 0.3 - tsconfig.json

Extend n8n conventions: `target: ES2022`, `module: commonjs` (n8n requires CJS), strict mode, `outDir: dist`, `rootDir: src`, include `src/`.

### 0.4 - oxlint.json

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

### 0.5 - Icon

Use the AT Protocol logo (`@` butterfly mark) as `src/nodes/Atproto/atproto.svg`. Source from official AT Protocol branding assets.

### 0.6 - Verify scaffold

- `npm install` succeeds
- `npm run build` produces `dist/` with compiled JS + icon
- `npm run dev` starts n8n on localhost:5678 and the node appears in the palette
- `npm run lint` runs without errors on empty project
- `npm test` runs (no tests yet, should pass vacuously)

</details>

---

## Phase 1 — Credentials + Generic CRUD ✅

> Done in `d9c7329`. 35 tests. Credential definition (handle + app password + PDS URL), TID generation, all 5 CRUD operations (`createRecord`, `getRecord`, `putRecord`, `deleteRecord`, `listRecords`), `$type`/`createdAt` auto-injection, error mapping (401/429/network/InvalidRecord), `continueOnFail` pattern.

<details>
<summary>Original step-by-step (reference only)</summary>

### 1.1 - Credential definition

**File:** `credentials/AtprotoApi.credentials.ts`

Three fields:
- `identifier` (string) - handle or DID (e.g. `you.bsky.social`)
- `appPassword` (string, password type) - app password from bsky.app/settings
- `serviceUrl` (string, default `https://bsky.social`) - PDS endpoint

Include a `test` block that calls `com.atproto.server.createSession` to validate credentials. Return clear error messages for invalid credentials.

**How to test:** Manual - enter real credentials in n8n, verify green checkmark.

### 1.2 - TID generation

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

### 1.3 - Node description

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
5. **Record Data** (json): shown for Create/Put - raw JSON input for Phase 1
6. **Swap Record** (string, optional): CID, shown for Put only
7. **Limit** (number, default 50): shown for List only
8. **Cursor** (string, optional): shown for List only

### 1.4 - Operations

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

### 1.5 - Execute method

In `Atproto.node.ts`, implement `execute()`:

1. Get credentials from `this.getCredentials('atprotoApi')`
2. Create `CredentialSession` with service URL
3. Login with identifier + app password
4. Create `Agent` from session
5. Loop over input items
6. Switch on operation, call the corresponding function from `operations.ts`
7. Return output items with `{ json: result }`

Session management: call `session.login()` on every execution. The `CredentialSession` automatically handles token refresh within a single execution (if `accessJwt` expires mid-batch, it transparently uses `refreshJwt`). No cross-execution caching - n8n's `getWorkflowStaticData` is unreliable and doesn't work in manual test mode. The overhead of one `createSession` call per execution is negligible for app passwords.

### 1.6 - Error handling

Wrap each operation in try/catch. Map XRPC errors to n8n-friendly messages:

| XRPC error | n8n behavior |
|------------|--------------|
| `InvalidToken` / 401 | "Authentication failed - check your app password" |
| `AccountTakedown` | "Account is suspended" |
| `RecordNotFound` | "Record not found at {collection}/{rkey}" |
| `InvalidRecord` | "Record validation failed: {message}" - surface the PDS validation error |
| `RateLimitExceeded` / 429 | "Rate limited - retry after {seconds}s" |
| Network error | "Could not reach PDS at {url}" |

Use `continueOnFail` pattern so one failed item doesn't stop the batch.

### 1.7 - Phase 1 tests

**Files:**
- `tests/tid.test.ts` - see 1.2
- `tests/operations.test.ts` - mock XRPC server with msw, test each operation
- `tests/type-injection.test.ts` - verify `$type` is set correctly, not clobbered

Mock server setup in `tests/setup.ts`:
- Intercept `POST /xrpc/com.atproto.server.createSession` → return fake tokens
- Intercept `POST /xrpc/com.atproto.repo.createRecord` → validate body shape, return `{ uri, cid }`
- etc. for all 5 operations

### 1.8 - Phase 1 manual validation

Test against real Bluesky:
1. Create a `app.bsky.feed.post` with text + createdAt
2. Get it back by URI
3. List posts in `app.bsky.feed.post`
4. Delete the post
5. Verify each operation returns expected output in n8n

</details>

---

## Phase 2 — Dynamic Field Mapping ✅

> Done in `31140d5` + `34a5e16`. 57 tests. Lexicon resolution (PDS endpoint → `@atproto/lexicon-resolver` fallback → JSON fallback), `lexiconToResourceMapperFields()`, recursive ref flattening with dotted-path keys, `unflattenDottedKeys()` in the execute path, `resourceLocator` collection picker, `supportAutoMap`.
>
> **Key deviations:**
> 1. PDS path extracts schema from `XRPCInvalidResponseError.responseBody` because the typed client rejects the valid response (decision 10).
> 2. `unflattenDottedKeys` was added to reconstruct nested objects from flat resourceMapper output (decision 11).
> 3. `resolveRefProperties` returns `{ properties, required }` for accurate sub-field required propagation (decision 12).
> 4. `@atproto/lexicon-resolver` is imported dynamically with `@ts-expect-error` (ESM-only package under CJS tsconfig).

<details>
<summary>Original step-by-step (reference only)</summary>

### 2.1 - Lexicon resolution

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
- `defs.main.record.properties` - the field definitions
- `defs.main.record.required` - required field names
- `defs.main.key` - record key strategy (tid, any, literal:self)

Cache results in a module-level `Map<string, LexiconSchema>` keyed by NSID. The `resourceMapperMethod` runs in the editor, not during execution, so a simple in-memory cache is sufficient.

### 2.2 - Field mapping

**File:** `src/nodes/Atproto/fieldMapping.ts`

```typescript
export function lexiconToResourceMapperFields(
  schema: LexiconSchema
): ResourceMapperField[]
```

Walk `schema.properties`, map each to a `ResourceMapperField` using the type mapping table from DESIGN.md.

For `ref` types: recursively resolve the referenced schema and flatten its properties with a dotted prefix (e.g. `reply.root.uri`, `reply.root.cid`). Cap recursion depth at 3 to avoid infinite loops.

For `createdAt` fields marked as required: set `defaultMatch: true` and provide a default value expression that evaluates to the current ISO timestamp.

### 2.3 - Wire up resourceMapping

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

### 2.4 - Build record from mapped fields

In the execute method, when `resourceMapping` is active, read mapped fields from `this.getNodeParameter('recordData.value')` and construct the record object. Auto-inject `$type` and `createdAt` as before.

### 2.5 - Fallback UX

When lexicon resolution fails:
- Log a warning: `this.logger.warn('Could not resolve lexicon for ${nsid}, falling back to JSON input')`
- Return empty `ResourceMapperField[]` so n8n shows the raw JSON editor
- The user can still proceed with manual JSON

### 2.6 - Phase 2 tests

- `tests/fieldMapping.test.ts` - test type mapping for every lexicon type
- `tests/lexicon.test.ts` - test resolution chain (PDS success, PDS fail + resolver success, both fail)
- `tests/recursiveRef.test.ts` - test ref resolution with depth limit
- Mock a realistic lexicon (e.g. `app.bsky.feed.post`) and verify the generated fields match expected output

</details>

---

## Phase 3 — Blob Support ✅

> Done in `8f468d7`. 11 tests. `applyBlobUploads()` walks the record post-build, reads binary from n8n input, calls `uploadBlob`, substitutes blob references. Top-level blob fields only. MIME from binary metadata. Rollback on first failure.
>
> **Key discovery:** `agent.com.atproto.repo.uploadBlob(data, opts)` takes two args (buffer + `{ encoding: mimeType }`), not a single options object.

---

## Phase 4 — Deep Resolution & UX ✅

> Done in `85beddc`–`b156743`. 22 tests. Single-ref union flattening (`getResolvableRef`), RGB color collapse to hex string, type-only lexicon support, nested `$type` injection, hex→RGB expansion, pre-submission schema validation, literal record key auto-resolve.

---

## Phase 5 — Schema Constraints

The node handles the structural skeleton of lexicons (types, refs, unions, arrays, objects, required/optional) but drops nearly all constraint metadata during parsing. The `LexiconProperty` interface captures 9 of ~25 schema attributes defined in the AT Protocol spec. This phase closes the gap in five ordered steps.

**Root cause:** `LexiconProperty` and `parseInlineProperty()` don't extract constraint fields from the raw lexicon JSON. Fixing parsing unblocks everything - each downstream consumer (mapping, validation, injection) then adds a small, independent piece.

### 5.1 - Expand `LexiconProperty` + parsing

**Files:** `src/nodes/Atproto/lexicon.ts`

Add every constraint attribute from the AT Protocol spec to `LexiconProperty`:

```typescript
export interface LexiconProperty {
  type: string;
  format?: string;
  ref?: string;
  refs?: string[];
  items?: LexiconProperty;
  properties?: Record<string, LexiconProperty>;
  required?: string[];
  description?: string;
  nullable?: boolean;
  // --- New: value constraints ---
  default?: string | number | boolean;
  const?: string | number | boolean;
  enum?: (string | number)[];
  knownValues?: string[];
  // --- New: numeric range ---
  minimum?: number;
  maximum?: number;
  // --- New: length constraints (string: UTF-8 bytes; bytes: raw; array: element count) ---
  minLength?: number;
  maxLength?: number;
  // --- New: grapheme constraints (string only) ---
  minGraphemes?: number;
  maxGraphemes?: number;
  // --- New: blob constraints ---
  accept?: string[];
  maxSize?: number;
  // --- New: union flag ---
  closed?: boolean;
}
```

Update three parse sites to extract the new fields:

1. **`extractRecordSchema()`** (line ~253) - the loop that builds top-level `parsedProperties`. Add reads for all new attributes from the raw `prop` object.

2. **`parseInlineProperty()`** (line ~293) - the recursive helper for array items, inline objects, and nested definitions. Add the same reads so constraints propagate into nested structures.

3. **`extractObjectDef()`** (line ~423) - the ref resolution helper. Already delegates to `parseInlineProperty`, so it picks up the new fields automatically. No changes needed here.

For all three sites, the pattern is the same - cast and assign:

```typescript
default: raw.default as string | number | boolean | undefined,
const: raw.const as string | number | boolean | undefined,
enum: raw.enum as (string | number)[] | undefined,
knownValues: raw.knownValues as string[] | undefined,
minimum: raw.minimum as number | undefined,
maximum: raw.maximum as number | undefined,
minLength: raw.minLength as number | undefined,
maxLength: raw.maxLength as number | undefined,
minGraphemes: raw.minGraphemes as number | undefined,
maxGraphemes: raw.maxGraphemes as number | undefined,
accept: raw.accept as string[] | undefined,
maxSize: raw.maxSize as number | undefined,
closed: raw.closed as boolean | undefined,
```

**Tests:** `tests/lexicon.test.ts`
- Add a `CONSTRAINED_SCHEMA` mock lexicon with every constraint type: string with `enum`, `knownValues`, `maxLength`, `maxGraphemes`, `default`; integer with `minimum`, `maximum`, `enum`, `const`; blob with `accept`, `maxSize`; array with `minLength`/`maxLength`; union with `closed: true`.
- Verify `parseLexiconDoc()` returns a `LexiconSchema` with all constraint fields populated on the correct properties.
- Verify constraints propagate through `parseInlineProperty` for array items.

### 5.2 - Wire `enum`/`knownValues` → options dropdown

**File:** `src/nodes/Atproto/fieldMapping.ts`

n8n's `ResourceMapperField` supports `type: 'options'` with an `options: INodePropertyOptions[]` array. This is a direct fit for `enum` (closed set). For `knownValues` (open set), the values should appear in the `displayName` hint since the user can still type a custom value.

In `propToFields()`, add a new branch before the simple-types fallback:

```typescript
// --- enum: closed set → options dropdown ---
if (prop.enum?.length && (prop.type === 'string' || prop.type === 'integer')) {
  const desc = prop.description?.replace(/\.\s*$/, '');
  return [{
    id: name,
    displayName: desc ? `${name} (${desc})` : name,
    required,
    defaultMatch: name === 'createdAt',
    display: true,
    type: 'options' as ResourceMapperField['type'],
    options: prop.enum.map(v => ({ name: String(v), value: v })),
    ...(prop.default !== undefined ? { defaultValue: prop.default } : {}),
  }];
}
```

For `knownValues`, append the values to `displayName` so users see them as suggestions:

```typescript
// --- knownValues: open set → string with hints ---
if (prop.knownValues?.length) {
  const shortNames = prop.knownValues.map(v => {
    const hash = v.indexOf('#');
    return hash >= 0 ? v.slice(hash + 1) : v.split('.').pop() ?? v;
  });
  const hint = shortNames.length <= 4
    ? shortNames.join(', ')
    : `${shortNames.slice(0, 3).join(', ')}, ...`;
  const desc = prop.description?.replace(/\.\s*$/, '');
  field.displayName = desc
    ? `${name} (${desc} - e.g. ${hint})`
    : `${name} (e.g. ${hint})`;
}
```

**Tests:** `tests/fieldMapping.test.ts`
- String field with `enum: ['public', 'private', 'unlisted']` → `type: 'options'`, 3 options.
- Integer field with `enum: [0, 1, 2]` → `type: 'options'`, 3 options.
- String field with `knownValues: ['com.example.defs#tokenA', 'com.example.defs#tokenB']` → `type: 'string'`, displayName contains "tokenA, tokenB".
- Enum field with `default: 'public'` → `defaultValue: 'public'`.

### 5.3 - Wire `default`/`const` → defaultValue/readOnly

**File:** `src/nodes/Atproto/fieldMapping.ts`

For **schema `default`** values, apply them as `defaultValue` on the `ResourceMapperField`. Currently only `createdAt` is hardcoded in the `AUTO_DEFAULTS` map. Schema defaults should be the general mechanism:

```typescript
// After computing the field, before returning:
if (AUTO_DEFAULTS[name] !== undefined) {
  field.defaultValue = AUTO_DEFAULTS[name];
} else if (prop.default !== undefined) {
  field.defaultValue = prop.default;
}
```

For **`const`** fields (fixed, immutable value), render as `readOnly: true` with the constant pre-filled. Users see the value but can't change it:

```typescript
// In propToFields(), early return for const:
if (prop.const !== undefined) {
  return [{
    id: name,
    displayName: `${name} (fixed: ${String(prop.const)})`,
    required,
    defaultMatch: false,
    display: true,
    type: fieldType as ResourceMapperField['type'],
    readOnly: true,
    defaultValue: prop.const,
  }];
}
```

Also wire `const` into the execution path. In `typeInjection.ts`, add `const` injection alongside the existing `$type` injection. In `operations.ts`, `ensureCreatedAt()` already handles one auto-injected field; add a general `applyConstValues()` step that walks schema properties and injects `const` values for any field the user left empty.

**Tests:** `tests/fieldMapping.test.ts`
- Field with `default: 'draft'` → `defaultValue: 'draft'`.
- Field with `const: true` → `readOnly: true`, `defaultValue: true`.
- `createdAt` hardcoded default still takes priority over schema default.

**Tests:** `tests/buildRecord.test.ts`
- A record with a `const` field missing from user input → const value injected.
- A record with a `const` field already provided by user → user value preserved (defensive, shouldn't happen with readOnly).

### 5.4 - Add constraint validation

**File:** `src/nodes/Atproto/validation.ts`

Extend `checkType()` to validate constraints after the existing JS type checks pass. Every check is additive - the existing type checks remain unchanged.

#### String constraints

```typescript
case 'string':
  if (typeof value !== 'string') {
    errors.push(`'${path}' must be a string, got ${describeType(value)}`);
    break;
  }
  // Length in UTF-8 bytes
  if (prop.maxLength) {
    const byteLen = Buffer.byteLength(value, 'utf8');
    if (byteLen > prop.maxLength)
      errors.push(`'${path}' is ${byteLen} bytes (max ${prop.maxLength})`);
  }
  if (prop.minLength) {
    const byteLen = Buffer.byteLength(value, 'utf8');
    if (byteLen < prop.minLength)
      errors.push(`'${path}' is ${byteLen} bytes (min ${prop.minLength})`);
  }
  // Grapheme count (Intl.Segmenter, available since Node 16)
  if (prop.maxGraphemes || prop.minGraphemes) {
    const segmenter = new Intl.Segmenter();
    const count = [...segmenter.segment(value)].length;
    if (prop.maxGraphemes && count > prop.maxGraphemes)
      errors.push(`'${path}' has ${count} graphemes (max ${prop.maxGraphemes})`);
    if (prop.minGraphemes && count < prop.minGraphemes)
      errors.push(`'${path}' has ${count} graphemes (min ${prop.minGraphemes})`);
  }
  // Closed enum
  if (prop.enum?.length && !prop.enum.includes(value))
    errors.push(`'${path}' must be one of: ${prop.enum.join(', ')}`);
  // Const
  if (prop.const !== undefined && value !== prop.const)
    errors.push(`'${path}' must be '${prop.const}'`);
  break;
```

#### Integer constraints

```typescript
case 'integer':
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push(`'${path}' must be an integer, got ${describeType(value)}`);
    break;
  }
  if (prop.minimum !== undefined && value < prop.minimum)
    errors.push(`'${path}' must be ≥ ${prop.minimum}, got ${value}`);
  if (prop.maximum !== undefined && value > prop.maximum)
    errors.push(`'${path}' must be ≤ ${prop.maximum}, got ${value}`);
  if (prop.enum?.length && !prop.enum.includes(value))
    errors.push(`'${path}' must be one of: ${prop.enum.join(', ')}`);
  if (prop.const !== undefined && value !== prop.const)
    errors.push(`'${path}' must be ${prop.const}`);
  break;
```

#### Boolean constraints

```typescript
case 'boolean':
  if (typeof value !== 'boolean') {
    errors.push(`'${path}' must be true or false, got ${describeType(value)}`);
    break;
  }
  if (prop.const !== undefined && value !== prop.const)
    errors.push(`'${path}' must be ${prop.const}`);
  break;
```

#### Array constraints

```typescript
case 'array':
  if (!Array.isArray(value)) {
    errors.push(`'${path}' must be a JSON array, got ${describeType(value)}`);
    break;
  }
  if (prop.maxLength !== undefined && value.length > prop.maxLength)
    errors.push(`'${path}' has ${value.length} items (max ${prop.maxLength})`);
  if (prop.minLength !== undefined && value.length < prop.minLength)
    errors.push(`'${path}' has ${value.length} items (min ${prop.minLength})`);
  break;
```

#### Blob pre-upload constraints

**File:** `src/nodes/Atproto/blob.ts`

Before calling `uploadBlobFromBinary`, check `accept` and `maxSize` against the binary metadata. This avoids wasting bandwidth on uploads that will be rejected:

```typescript
// In applyBlobUploads(), before the upload call:
if (propDef.accept?.length) {
  const mimeType = binaryMeta?.mimeType ?? 'application/octet-stream';
  const accepted = propDef.accept.some(pattern => {
    if (pattern === '*/*') return true;
    if (pattern.endsWith('/*'))
      return mimeType.startsWith(pattern.slice(0, -1));
    return mimeType === pattern;
  });
  if (!accepted) {
    throw new Error(
      `'${key}' accepts ${propDef.accept.join(', ')} but got ${mimeType}`
    );
  }
}
if (propDef.maxSize && buffer.length > propDef.maxSize) {
  throw new Error(
    `'${key}' max size is ${propDef.maxSize} bytes, file is ${buffer.length} bytes`
  );
}
```

**Tests:** `tests/validation.test.ts`
- String exceeding `maxLength` → error with byte count.
- String exceeding `maxGraphemes` → error with grapheme count. Include a multi-codepoint emoji test (e.g. 👨‍👩‍👦 = 1 grapheme, 25 UTF-8 bytes).
- String not in `enum` → error listing valid values.
- Integer below `minimum` → error.
- Integer above `maximum` → error.
- Integer not in `enum` → error.
- Boolean not matching `const` → error.
- Array exceeding `maxLength` → error.
- Array below `minLength` → error.
- All constraints passing → empty errors array.

**Tests:** `tests/blob.test.ts`
- Blob with wrong MIME type vs `accept: ['image/*']` → error before upload.
- Blob exceeding `maxSize` → error before upload.
- Blob with matching MIME + under size → upload proceeds.

### 5.5 - Fix `unknown` type + surface string `format` + displayName hints

**File:** `src/nodes/Atproto/fieldMapping.ts`

Small UX fixes that round out the mapping layer.

#### Fix `unknown` type

Add explicit case to `lexiconTypeToFieldType()`:

```typescript
case 'unknown':
  return 'object';
```

Per the AT Protocol spec, `unknown` must be a JSON object. Currently falls through to `default: return 'string'` which is incorrect.

#### Surface string `format`

Map `uri` and `at-uri` formats to n8n's `url` FieldType for clickable link rendering:

```typescript
case 'string':
  if (prop.format === 'datetime') return 'dateTime';
  if (prop.format === 'uri' || prop.format === 'at-uri') return 'url';
  return 'string';
```

For other formats (`did`, `handle`, `at-identifier`, `nsid`, `cid`, `language`, `tid`, `record-key`), append the format to `displayName` so users see what's expected:

```typescript
// In the simple-types section, after computing displayName:
if (prop.format && prop.format !== 'datetime'
    && prop.format !== 'uri' && prop.format !== 'at-uri') {
  const base = field.displayName;
  field.displayName = `${base} (${prop.format})`;
}
```

#### Show constraints in displayName

Append key constraints to the display name so users see limits at a glance:

```typescript
// After the format hint, add constraint hints:
const hints: string[] = [];
if (prop.maxGraphemes) hints.push(`max ${prop.maxGraphemes} chars`);
else if (prop.maxLength) hints.push(`max ${prop.maxLength} bytes`);
if (prop.minimum !== undefined || prop.maximum !== undefined) {
  const parts = [];
  if (prop.minimum !== undefined) parts.push(`≥${prop.minimum}`);
  if (prop.maximum !== undefined) parts.push(`≤${prop.maximum}`);
  hints.push(parts.join(', '));
}
if (hints.length) {
  field.displayName += ` [${hints.join('; ')}]`;
}
```

Example result: `text (Post text) [max 300 chars]`, `count [≥0, ≤100]`.

#### Nullable handling

The `nullable` flag is already parsed but never consumed. Two changes:

1. In `unflattenDottedKeys()` (`Atproto.node.ts`), preserve `null` values when the schema declares the field as nullable. This requires passing the schema into the unflatten step, or doing a post-unflatten pass. The simpler approach: stop stripping `null` in `unflattenDottedKeys` (only strip `undefined` and `''`), and let the validation layer distinguish nullable vs non-nullable.

2. In `walkAndValidate()` (`validation.ts`), skip the "missing required field" error for nullable fields that are explicitly `null`.

**Tests:** `tests/fieldMapping.test.ts`
- `unknown` type → `type: 'object'`.
- `string` with `format: 'uri'` → `type: 'url'`.
- `string` with `format: 'did'` → `type: 'string'`, displayName contains `(did)`.
- `string` with `maxGraphemes: 300` → displayName contains `[max 300 chars]`.
- `integer` with `minimum: 0, maximum: 255` → displayName contains `[≥0, ≤255]`.

**Tests:** `tests/buildRecord.test.ts`
- Nullable field with `null` value → preserved in output (not stripped).
- Non-nullable field with `null` value → stripped (existing behavior).

**Tests:** `tests/validation.test.ts`
- Nullable required field with `null` → no error.
- Non-nullable required field with `null` → error.

### 5.6 - Open/closed union + array item validation

**File:** `src/nodes/Atproto/validation.ts`

Lower-priority polish for completeness.

#### Closed union

When `prop.closed` is true, reject unknown `$type` values. When false (default), log a warning but don't block:

```typescript
case 'union':
  // ... existing $type checks ...
  // Open unions: only warn on unknown $type (already handled)
  // Closed unions: reject unknown $type with error
  if (prop.closed && prop.refs?.length && obj['$type']
      && !prop.refs.includes(obj['$type'] as string)) {
    errors.push(
      `'${path}' has $type '${obj['$type']}' which is not allowed ` +
      `in this closed union (expected: ${prop.refs.join(', ')})`
    );
  }
  break;
```

Note: the existing check already catches invalid `$type` on all unions. The `closed` flag changes the severity - open unions could in theory accept future types the schema doesn't yet list. For now, the existing strict check is fine for both; the `closed` flag is just tracked for future use.

#### Array item validation

For arrays where `prop.items` defines a specific type, validate each element:

```typescript
case 'array':
  if (!Array.isArray(value)) { /* existing */ break; }
  // Length checks (from 5.4)
  // Item type checks:
  if (prop.items && prop.items.type !== 'unknown') {
    for (let idx = 0; idx < value.length; idx++) {
      const itemErrors = checkType(`${path}[${idx}]`, value[idx], prop.items);
      errors.push(...itemErrors);
    }
  }
  break;
```

This catches e.g. `tags: [1, 2, 3]` where the schema says items are strings.

**Tests:** `tests/validation.test.ts`
- Closed union with unknown `$type` → error mentioning "closed union".
- Open union with unknown `$type` → existing behavior (error with valid types listed).
- Array of strings containing a number → error on the offending index.
- Array of integers containing a string → error.
- Array of unknown items → no item-level errors.

### Phase 5 - Implementation order

The steps are ordered by dependency - each builds on the previous:

1. **5.1** unblocks everything (parsing).
2. **5.2** and **5.3** can be done in parallel after 5.1 (field mapping changes).
3. **5.4** depends on 5.1 (validation needs the parsed constraints).
4. **5.5** is independent small fixes, can land anytime after 5.1.
5. **5.6** is lowest priority, can land last.

Estimated scope: ~300 lines of source, ~400 lines of tests.

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
