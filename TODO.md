# TODO

## ✅ Phase 0 — Project Scaffolding

- [x] Initialize project (inspired by `n8n-nodes-starter`, not cloned)
- [x] Configure `package.json` with `n8n` node/credential paths, metadata, and scripts
- [x] Set up `tsconfig.json` (target ES2022, module commonjs, strict)
- [x] Set up `oxlint.json` with `@n8n/eslint-plugin-community-nodes` via jsPlugins
- [x] Set up `vitest.config.ts`
- [x] Add `@atproto/api` + `@atproto/lexicon-resolver` as runtime dependencies
- [x] Add `oxlint`, `vitest`, `msw`, `typescript`, `@n8n/node-cli` as dev dependencies
- [x] Create the node icon (AT Protocol logo as `atproto.svg`)
- [x] Verify scaffold: `npm install`, `npm run build`, `npm run lint`, `npm test` all pass

## ✅ Phase 1 — Generic CRUD

- [x] Credential definition with test block (identifier, appPassword, serviceUrl)
- [x] TID generation (13-char base32-sortable, top bit 0, 53-bit timestamp, 10-bit clock ID)
- [x] Node description with all 5 operations (Create, Get, Put, Delete, List Records)
- [x] CRUD operations with `$type`/`createdAt` auto-injection
- [x] Execute method with `CredentialSession` + `createAgent` helper
- [x] Error handling: friendlyError maps XRPC errors to n8n messages
- [x] Session management: login per execution, auto-refresh within execution
- [x] Optional `repo` field for Get/List (defaults to authenticated user)
- [x] Record key: auto TID or custom
- [x] Swap commit CID for optimistic concurrency
- [x] Limit + Cursor pagination for List
- [x] `continueOnFail` support for batch processing

## ✅ Phase 2 — Dynamic Field Mapping

- [x] Lexicon resolution: PDS endpoint (with response body fallback on validation error) → DNS-based resolver → `null`
- [x] In-memory cache (module-level Map) keyed by NSID
- [x] Lexicon document parsing: extracts `defs.main.record.properties`, `required`, `nullable`, `key`
- [x] Lexicon type → n8n FieldType mapping (string, integer→number, boolean, datetime→dateTime, blob, cid-link, bytes, array→object, ref→object)
- [x] `ResourceMapperField` construction with `id`, `displayName`, `required`, `defaultMatch`, `type`
- [x] `createdAt` auto-default: `defaultMatch: true`, `defaultValue: '={{ $now }}'`
- [x] Ref flattening: local refs (`#replyRef`) → dotted-path sub-fields (`reply.root`, `reply.parent`)
- [x] Recursive ref resolution with depth cap (MAX_REF_DEPTH = 3)
- [x] Cross-document ref resolution with fragment support (`nsid#fragment`)
- [x] Inline object flattening with dotted prefix
- [x] Fallback: when lexicon resolution fails, return empty fields → n8n shows raw JSON editor
- [x] `resourceMapper` property wired into node description for Create/Put
- [x] `methods.resourceMapping.getRecordFields` implementation
- [x] `buildRecordFromNodeParams` helper: handles both resourceMapper and raw JSON formats
- [x] Test mock lexicons: `APP_BSKY_FEED_POST`, `PRIMITIVE_ONLY`, `QUERY_NOT_RECORD`, `INLINE_OBJECT`, `DEEPLY_NESTED`
- [x] Mock XRPC server updated with `com.atproto.lexicon.resolveLexicon` handler
- [x] Tests: `tests/lexicon.test.ts` (11 tests)
- [x] Tests: `tests/fieldMapping.test.ts` (15 tests)
- [x] Tests: `tests/recursiveRef.test.ts` (8 tests)

## Phase 3 — Blob Support

- [ ] As a user, I can attach a binary property to a blob field and the node uploads it via `uploadBlob` automatically
- [ ] As a user, the uploaded blob reference is injected into the record in the correct format

## Testing

- [x] Unit tests for TID generation (valid format, uniqueness, sortability)
- [x] Unit tests for `$type` auto-injection
- [x] Unit tests for request construction (correct XRPC endpoint, auth headers, body shape)
- [x] Unit tests for error handling paths (401, 429, not found, malformed response)
- [x] Unit tests for lexicon schema → ResourceMapperField mapping
- [x] Unit tests for recursive ref resolution
- [x] Mock XRPC server setup (msw) for all automated tests
- [ ] Manual testing against real Bluesky PDS during development
- [ ] Docker-based integration tests deferred

## Session Management

- [x] Call `session.login()` on every execution (simple + reliable)
- [x] Rely on `CredentialSession` auto-refresh within a single execution for long-running batches

## Distribution

- [ ] Lint with oxlint + `@n8n/eslint-plugin-community-nodes` via jsPlugins
- [ ] Publish to npm as a community node package
- [ ] Add install-from-community-nodes instructions to README
- [ ] Submit for n8n community node verification
