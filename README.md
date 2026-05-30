# n8n-nodes-atproto

A generic AT Protocol node for [n8n](https://n8n.io) that works with **any** lexicon — Bluesky, [standard.site](https://standard.site), or any community-defined schema — without hardcoded knowledge of any of them.

Instead of building one node per AT Protocol app, this node speaks the protocol itself. Point it at a collection NSID, and it resolves the lexicon schema from the network to present you with the right fields, automatically.

## Why This Exists

The AT Protocol ecosystem is growing fast. New lexicons are appearing for long-form publishing ([standard.site](https://standard.site)), link aggregation, recipes, events, and more. Each one uses the same underlying record operations — `createRecord`, `putRecord`, `getRecord`, `deleteRecord`, `listRecords` — with different collection names and record shapes.

Building a separate n8n node for each lexicon doesn't scale. Building one node that understands the protocol does.

## What It Does

- **CRUD any AT Protocol record** — create, read, update, delete, and list records in any collection
- **Dynamic field mapping** — resolves lexicon schemas from the network and presents typed form fields in the n8n editor, so you fill in `title`, `publishedAt`, `tags` rather than crafting raw JSON
- **Handles the hard parts** — PDS resolution, session management, TID generation, and record key conventions
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
4. **Enter a collection NSID** — e.g. `site.standard.document`
5. **Map your fields** — the node resolves the lexicon and shows you the schema's fields
6. **Run it**

## Credentials

| Field | Description |
|-------|-------------|
| Identifier | Your handle (e.g. `you.bsky.social`) or DID |
| App Password | Generated at [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords) |
| Service URL | PDS endpoint (default: `https://bsky.social`) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, and architecture overview.

## License

MIT
