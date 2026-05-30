# TODO

## Project Setup

- [ ] Initialize project (inspired by `n8n-nodes-starter`, not cloned)
- [ ] Configure `package.json` with `n8n` node/credential paths, metadata, and scripts
- [ ] Set up `tsconfig.json` (target ES2022, module commonjs, strict)
- [ ] Set up `oxlint.json` with `@n8n/eslint-plugin-community-nodes` via jsPlugins
- [ ] Set up `vitest.config.ts`
- [ ] Add `@atproto/api` + `@atproto/lexicon-resolver` as runtime dependencies
- [ ] Add `oxlint`, `vitest`, `msw`, `typescript`, `@n8n/node-cli` as dev dependencies
- [ ] Create the node icon (AT Protocol logo as `atproto.svg`)
- [ ] Verify scaffold: `npm install`, `npm run build`, `npm run lint`, `npm test` all pass

## Credentials

- [ ] As a user, I can add my AT Protocol credentials (handle, app password, service URL) so the node can authenticate on my behalf
- [ ] As a user, I see a clear error when my credentials are invalid, because the credential definition includes a test request against `createSession`

## Phase 1 — Generic CRUD

- [ ] As a user, I can create a record in any collection by providing an NSID and a JSON body
- [ ] As a user, I can get a record by collection, repo, and record key
- [ ] As a user, I can update (put) a record by collection and record key with a new JSON body (full replace, not merge)
- [ ] As a user, I can optionally provide a `swapRecord` CID on put for optimistic concurrency control
- [ ] As a user, I can delete a record by collection and record key
- [ ] As a user, I can list records in a collection with limit and cursor for pagination (returns one page per execution)
- [ ] As a user, I get a TID auto-generated as the record key by default, so I don't have to understand the key format
- [ ] As a user, I can provide a custom record key when the lexicon or my use case requires it
- [ ] As a user, the node resolves my PDS from my DID automatically, so I don't need to know my PDS URL
- [ ] As a user, `$type` is auto-injected into my records from the collection NSID — I never need to set it manually
- [ ] As a user, `createdAt` is auto-injected (as ISO datetime) if the lexicon schema requires it — I can override via field mapping
- [ ] As a user, I can optionally specify a different repo (DID/handle) for Get and List operations to read other users' public records (defaults to my own)

## Phase 2 — Dynamic Field Mapping

- [ ] As a user, when I type a collection NSID, the node resolves the lexicon schema and shows me typed fields for that record
- [ ] As a user, I see required fields marked as such, matching what the lexicon schema declares
- [ ] As a user, I can map incoming n8n data to individual record fields using expressions, instead of building JSON manually
- [ ] As a user, when lexicon resolution fails (unpublished schema, network error), I see a warning and can fall back to raw JSON input
- [ ] As a user, string fields with `datetime` format render as date/time inputs
- [ ] As a user, complex fields (objects, unions, arrays) render as JSON inputs
- [ ] As a user, fields that reference other schemas (`ref` types) are resolved recursively so I get typed sub-fields instead of raw JSON

## Phase 3 — Blob Support

- [ ] As a user, I can attach a binary property to a blob field and the node uploads it via `uploadBlob` automatically
- [ ] As a user, the uploaded blob reference is injected into the record in the correct format

## Testing

- [ ] Unit tests for TID generation (valid format, uniqueness, sortability)
- [ ] Unit tests for lexicon schema → ResourceMapperField mapping
- [ ] Unit tests for `$type` auto-injection
- [ ] Unit tests for request construction (correct XRPC endpoint, auth headers, body shape)
- [ ] Unit tests for error handling paths (401, 429, not found, malformed response)
- [ ] Mock XRPC server setup (msw or similar) for all automated tests
- [ ] Manual testing against real Bluesky PDS during development
- [ ] Docker-based integration tests deferred to post-Phase 1

## Session Management

- [ ] Cache `accessJwt` and `refreshJwt` in n8n credential state across executions
- [ ] Use refresh token to obtain new access tokens when expired, avoiding `createSession` on every run

## Distribution

- [ ] Lint with oxlint + `@n8n/eslint-plugin-community-nodes` via jsPlugins
- [ ] Publish to npm as a community node package
- [ ] Add install-from-community-nodes instructions to README
- [ ] Submit for n8n community node verification
