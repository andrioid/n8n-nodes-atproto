# Changelog

## [0.2.0](https://github.com/andrioid/n8n-nodes-atproto/compare/n8n-nodes-atproto-v0.1.2...n8n-nodes-atproto-v0.2.0) (2026-06-07)


### ⚠ BREAKING CHANGES

* The Bluesky node's internal `name` field changes from `atproto-bluesky` (v0.1.2) to `atprotoBluesky`. Workflows saved against v0.1.2 that reference the Bluesky node will need to re-add the node. The AT Protocol main node and Jetstream trigger are unaffected.

### Features

* **atproto:** blob ops UX improvements ([0b5a912](https://github.com/andrioid/n8n-nodes-atproto/commit/0b5a912c8b93b7d518081a99a9294bec89074a9a))
* **atproto:** generic blob operations (upload, download, list) ([3ce0eb7](https://github.com/andrioid/n8n-nodes-atproto/commit/3ce0eb7c0a1294b4c10dc0546f41c7b415b659ec))
* **atproto:** Return All pagination + README recipes ([55d14fc](https://github.com/andrioid/n8n-nodes-atproto/commit/55d14fc2586a814d129c50e29a93fbaa098cc916))


### Bug Fixes

* **atproto:** pass default to getNodeParameter('collection') for blob ops ([eb4aa99](https://github.com/andrioid/n8n-nodes-atproto/commit/eb4aa9904d2f80230e1ec8e6751b9591a92b0d19))
* **bluesky:** rename node to atproto-bluesky to avoid naming conflict ([1d9ba60](https://github.com/andrioid/n8n-nodes-atproto/commit/1d9ba60b3535ca4948f942411090f6775ad31b47))
* **jetstream:** satisfy both tsc and lint for usableAsTool ([b9d90bf](https://github.com/andrioid/n8n-nodes-atproto/commit/b9d90bf94bd69f9d25db987c1fd94e0ee33df98b))


### Code Refactoring

* move sources from src/ to repo root + activate n8n verified ruleset ([e93037b](https://github.com/andrioid/n8n-nodes-atproto/commit/e93037bc9a1881b79827dce5a4dcfcf8661bda8d))

## [0.1.2](https://github.com/andrioid/n8n-nodes-atproto/compare/n8n-nodes-atproto-v0.1.1...n8n-nodes-atproto-v0.1.2) (2026-06-07)


### Bug Fixes

* **lint:** satisfy @n8n/community-nodes rules ([9f73697](https://github.com/andrioid/n8n-nodes-atproto/commit/9f73697489df2ba43379ee9a106bca11e6da360c))

## [0.1.1](https://github.com/andrioid/n8n-nodes-atproto/compare/n8n-nodes-atproto-v0.1.0...n8n-nodes-atproto-v0.1.1) (2026-06-07)


### Features

* add Bluesky convenience node (Post, Like, Repost, Follow) ([63fc728](https://github.com/andrioid/n8n-nodes-atproto/commit/63fc7283527c4a26f8b395b76782349bea6fdaea))
* implement Jetstream trigger node ([f3f91c5](https://github.com/andrioid/n8n-nodes-atproto/commit/f3f91c541174aaa2f54efcd61bb17f840f6d5f10))
* schema constraints, eslint migration, publish setup ([62f2003](https://github.com/andrioid/n8n-nodes-atproto/commit/62f20037bfa45090f0168a40c7333c134539d6a0))
* use resourceLocator collection picker in jetstream trigger ([2605610](https://github.com/andrioid/n8n-nodes-atproto/commit/26056102126dd6ea74603f726dfebf529350936b))


### Bug Fixes

* cast FlattenedJetstreamEvent to IDataObject in emit calls ([01436b8](https://github.com/andrioid/n8n-nodes-atproto/commit/01436b82deee8beda351e2310daed6203a0620fc))
* pass default values to getNodeParameter for conditionally-shown fields ([4177ebc](https://github.com/andrioid/n8n-nodes-atproto/commit/4177ebc643afee63f1c98157e4b3a56d945ea88e))
* rename trigger file to match n8n CustomDirectoryLoader convention ([790435b](https://github.com/andrioid/n8n-nodes-atproto/commit/790435bc355c9db4a8df2337f0b1d30fde365cc7))
* rename trigger node name so n8n groups it under AT Protocol ([018f1ca](https://github.com/andrioid/n8n-nodes-atproto/commit/018f1ca47f2408fa5642ca0bb0dd939100868e49))
