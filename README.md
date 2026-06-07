# n8n-nodes-atproto

A generic AT Protocol node for [n8n](https://n8n.io) that works with **any** lexicon — Bluesky, [standard.site](https://standard.site), or any community-defined schema — without hardcoded knowledge of any of them.

Instead of building one node per AT Protocol app, this node speaks the protocol itself. Point it at a collection NSID, and it resolves the lexicon schema from the network to present you with the right fields, automatically.

## Why This Exists

The AT Protocol ecosystem is growing fast. New lexicons are appearing for long-form publishing ([standard.site](https://standard.site)), link aggregation, recipes, events, and more. Each one uses the same underlying record operations — `createRecord`, `putRecord`, `getRecord`, `deleteRecord`, `listRecords` — with different collection names and record shapes.

Building a separate n8n node for each lexicon doesn't scale. Building one node that understands the protocol does.

## What It Does

- **CRUD any AT Protocol record** — create, read, update, delete, and list records in any collection
- **Dynamic field mapping** — resolves lexicon schemas from the network and presents typed form fields in the n8n editor, so you fill in `title`, `publishedAt`, `tags` rather than crafting raw JSON
- **Deep schema resolution** — follows `ref` chains, resolves single-ref unions, flattens nested objects, and enforces schema constraints (enums, length limits, required fields)
- **Smart defaults** — auto-injects `$type` and `createdAt`, auto-resolves literal record keys (e.g. `app.bsky.actor.profile` → `self`), uploads blobs from binary input
- **Validation before submission** — checks required fields, types, constraints (string length, grapheme count, numeric range, enums), and `$type` discriminators at execution time with clear error messages, before the PDS ever sees the record
- **Works with any PDS** — Bluesky, self-hosted, Blacksky, or any AT Protocol–compatible server

## Use Cases

### Publish your blog to the ATmosphere

You have an Astro/Hugo/Next.js site with an RSS feed. An n8n workflow picks up new posts, generates summaries, and cross-posts to Bluesky, LinkedIn, and Mastodon. With this node, add standard.site as another lane — publish `site.standard.document` records so your posts appear on [Leaflet](https://leaflet.pub), [Pckt](https://read.pckt.blog), and other federated readers.

### Automate Bluesky beyond posting

The existing Bluesky n8n node covers social posting well. This node covers the rest — manage lists, labels, or any `app.bsky.*` record type directly, without waiting for someone to add support for each operation.

### Build on future lexicons without waiting

When a new AT Protocol app launches with its own lexicon, this node works with it on day one. No code changes, no new npm package, no PR to merge. Just type the NSID.

### Sync data between AT Protocol services

Read records from one collection, transform them, write to another. Mirror content, aggregate feeds, or build bridges between ATProto apps using n8n's visual workflow builder.

## Installation

```bash
# In your n8n instance
pnpm add n8n-nodes-atproto
```

Or install from the Community Nodes panel in n8n settings.

## Quick Start

1. **Create credentials** — add your AT Protocol handle and an [app password](https://bsky.app/settings/app-passwords)
2. **Add the node** to a workflow
3. **Choose an operation** — Create Record, Get Record, etc.
4. **Pick a collection** — select from the searchable dropdown (lists your repo's collections) or type any NSID manually
5. **Map your fields** — the node resolves the lexicon and shows you typed form fields with constraints, enums as dropdowns, and blob fields that explain what to attach
6. **Run it** — the node validates your data, injects `$type`/`createdAt`, uploads blobs, and sends the record

### Tips

- **Profiles and other singleton records** — leave the Record Key empty. The node auto-resolves literal keys (e.g. `app.bsky.actor.profile` uses `self`)
- **Blob fields** — the field label tells you to provide a binary property name. Use an HTTP Request or Read Binary File node upstream to attach the file
- **Nested objects** — sub-refs beyond the first level show as JSON fields with a template of the expected structure

## Recipes

Worked examples of common workflows. Each one is a chain of nodes — names in **bold**, key parameters inline.

### Compose a multi-image Bluesky post

`app.bsky.feed.post` supports up to 4 images, but the blobs live nested inside `embed.images[].image`, so the record's own lexicon doesn't know they're blobs. Use the standalone **Upload Blob** op to upload each image, then compose the embed by hand.

```
[HTTP Request: image 1]─┐
[HTTP Request: image 2]─┼─▶[AT Protocol: Blob → Upload] (run once per image, via Loop or three parallel branches)
[HTTP Request: image 3]─┘
                          │
                          ▼
                  [Aggregate / Set: collect blob refs into `images` array]
                          │
                          ▼
              [AT Protocol: Record → Create]
                  Collection: app.bsky.feed.post
                  recordData: {
                    "text": "three pictures",
                    "embed": {
                      "$type": "app.bsky.embed.images",
                      "images": [
                        { "alt": "...", "image": {{ $node["Upload 1"].json.blob }} },
                        { "alt": "...", "image": {{ $node["Upload 2"].json.blob }} },
                        { "alt": "...", "image": {{ $node["Upload 3"].json.blob }} }
                      ]
                    }
                  }
```

**Why this works:** `Upload Blob` outputs the canonical BlobRef shape (`{ $type, ref, mimeType, size }`) under `blob`, which is exactly what `embed.images[].image` expects. n8n's expression engine drops the object straight in.

**Convenience fields:** the upload also exposes `cid` / `mimeType` / `size` at the top level, so `{{ $json.cid }}` works without drilling into `blob.ref.$link`.

### Round-trip a blob (download, transform, re-upload)

Mirror a blob from another user's repo into your own. Useful for archival, format conversion, or re-hosting.

```
[AT Protocol: Record → Get]            ← fetch a post that contains an image
  Collection: app.bsky.feed.post
  Repo: alice.bsky.social
  rkey: 3jzfc...
        │
        ▼
[Set: extract blob ref]                 ← {{ $json.value.embed.images[0].image }}
        │
        ▼
[AT Protocol: Blob → Download]          ← paste the BlobRef into Blob Reference;
  (no Repo needed if pasting a CDN URL,    Repo = alice.bsky.social for at:// refs
   otherwise paste the source handle)
        │
        ▼
[Edit Image / Sharp / Compress]         ← optional: re-encode, resize, watermark
        │
        ▼
[AT Protocol: Blob → Upload]            ← now lives in YOUR repo as a fresh blob
```

**Tip:** `Download Blob` accepts whichever input is most convenient — a bare CID, the BlobRef JSON pasted from a previous op, or a `https://cdn.bsky.app/img/.../<did>/<cid>@jpeg` URL. CDN URLs also fill in the Repo automatically.

### List every blob in your repo

For audits, migrations, or finding orphaned blobs not referenced by any record.

```
[AT Protocol: Blob → List]
  Return All: ✅                          ← paginates internally; emits one item per CID
        │
        ▼
[Filter / Set / Aggregate to taste]
```

Without `Return All`, the node emits one item per CID for the current page and attaches the next-page `cursor` to each item, so manual pagination is also possible.

## Credentials

| Field | Description |
|-------|-------------|
| Identifier | Your handle (e.g. `you.bsky.social`) or DID |
| App Password | Generated at [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords) |
| Service URL | PDS endpoint (default: `https://bsky.social`) |

## Architecture

The node is deliberately thin — it speaks the AT Protocol and defers everything else to lexicon schemas.

| File | Purpose |
|------|---------|
| `Atproto.node.ts` | Node description, collection picker, execute flow |
| `lexicon.ts` | Schema resolution (PDS endpoint → DNS fallback → null) |
| `fieldMapping.ts` | Lexicon → n8n ResourceMapperFields (ref flattening, enums, constraints) |
| `typeInjection.ts` | Nested `$type` injection at execution time |
| `validation.ts` | Pre-submission schema validation with friendly errors |
| `blob.ts` | Binary upload via `com.atproto.repo.uploadBlob` |
| `operations.ts` | CRUD wrappers with `$type`/`createdAt` auto-injection |
| `tid.ts` | Timestamp ID generation |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and architecture overview.

## License

MIT
