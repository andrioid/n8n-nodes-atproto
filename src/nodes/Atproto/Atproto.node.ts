import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  ResourceMapperFields,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type { Agent } from '@atproto/api';

import {
  createRecord,
  deleteRecord,
  getRecord,
  getBlob,
  listBlobs,
  listRecords,
  putRecord,
  resolveActorToDid,
  uploadBlob,
  applyConstValues,
} from './operations';
import { createAgent, extractCollectionNsid, searchCollections } from './shared';
import { generateTid } from './tid';
import { resolveLexiconSchema } from './lexicon';
import { lexiconToResourceMapperFields } from './fieldMapping';
import { applyBlobUploads } from './blob';
import { parseBlobReference } from './blobInput';
import { injectNestedTypes } from './typeInjection';
import { validateRecord } from './validation';

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Maps XRPC error messages to user-friendly descriptions.
 */
function friendlyError(error: unknown, context?: Record<string, string>): string {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    error && typeof error === 'object' && 'status' in error
      ? (error as { status: number }).status
      : 0;

  if (status === 401 || status === 403 || message.includes('Authentication')) {
    return 'Authentication failed — check your app password';
  }
  if (message.includes('AccountTakedown') || message.includes('takendown')) {
    return 'Account is suspended';
  }
  if (message.includes('RecordNotFound')) {
    const where = context?.rkey
      ? `${context.collection ?? '?'}/${context.rkey}`
      : context?.collection ?? '?';
    return `Record not found at ${where}`;
  }
  if (message.includes('BlobNotFound')) {
    const where =
      context?.cid && context?.did
        ? `${context.did}/${context.cid}`
        : context?.cid ?? '?';
    return `Blob not found at ${where}`;
  }
  if (
    status === 413 ||
    message.includes('PayloadTooLarge') ||
    /blob too large/i.test(message)
  ) {
    return 'Blob too large — the PDS rejected the upload (bsky.social limits blobs to ~1 MB)';
  }
  if (status === 429 || message.includes('RateLimit')) {
    const match = message.match(/retry.*?(\d+)/i);
    const seconds = match ? match[1] : '?';
    return `Rate limited — retry after ${seconds}s`;
  }
  if (
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND')
  ) {
    const url = context?.serviceUrl ?? 'PDS';
    return `Could not reach ${url}`;
  }
  if (message.includes('InvalidRecord') || message.includes('invalid record')) {
    return `Record validation failed: ${message}`;
  }
  return message;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the record key for get/put/delete operations.
 *
 * When the user leaves rkey empty, attempts to resolve the lexicon
 * schema and use the literal key (e.g. `self` for `app.bsky.actor.profile`).
 * Throws if the key can’t be determined.
 */
async function resolveRkey(
  rkey: string,
  collection: string,
  agent: Agent,
): Promise<string> {
  if (rkey) return rkey;

  const schema = await resolveLexiconSchema(agent, collection);
  if (schema?.key === 'literal' && schema.literalKey) {
    return schema.literalKey;
  }

  throw new Error(
    `Record key is required for ${collection}. The lexicon does not declare a fixed key.`,
  );
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class Atproto implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'AT Protocol',
    name: 'atproto',
    icon: 'file:atproto.svg',
    group: ['transform'],
    version: 1,
    subtitle:
      '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description: 'CRUD records and manage blobs in any AT Protocol repo',
    defaults: {
      name: 'AT Protocol',
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: 'atprotoApi',
        required: true,
      },
    ],
    properties: [
      // ------------------------------------------------------------------
      // Resource
      // ------------------------------------------------------------------
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        // Sorted alphabetically per @n8n/community-nodes lint rule.
        options: [
          { name: 'Blob', value: 'blob' },
          { name: 'Record', value: 'record' },
        ],
        default: 'record',
      },

      // ------------------------------------------------------------------
      // Operation — Record
      // ------------------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['record'] },
        },
        // Sorted alphabetically per @n8n/community-nodes lint rule.
        options: [
          {
            name: 'Create',
            value: 'createRecord',
            description: 'Create a new record in a collection',
            action: 'Create a record',
          },
          {
            name: 'Delete',
            value: 'deleteRecord',
            description: 'Delete a record by collection and record key',
            action: 'Delete a record',
          },
          {
            name: 'Get',
            value: 'getRecord',
            description: 'Get a record by collection and record key',
            action: 'Get a record',
          },
          {
            name: 'List',
            value: 'listRecords',
            description: 'List records in a collection with pagination',
            action: 'List records',
          },
          {
            name: 'Put',
            value: 'putRecord',
            description: 'Full-replace a record',
            action: 'Update a record',
          },
        ],
        default: 'createRecord',
      },

      // ------------------------------------------------------------------
      // Operation — Blob
      // ------------------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['blob'] },
        },
        // Sorted alphabetically per @n8n/community-nodes lint rule.
        options: [
          {
            name: 'Download',
            value: 'getBlob',
            description: 'Download a blob by CID from a repo',
            action: 'Download a blob',
          },
          {
            name: 'List',
            value: 'listBlobs',
            description: 'List blob CIDs in a repo with pagination',
            action: 'List blobs',
          },
          {
            name: 'Upload',
            value: 'uploadBlob',
            description: 'Upload a binary as a blob to the PDS',
            action: 'Upload a blob',
          },
        ],
        default: 'uploadBlob',
      },

      // ------------------------------------------------------------------
      // Collection (resourceLocator — searchable list + free text)
      // ------------------------------------------------------------------
      {
        displayName: 'Collection',
        name: 'collection',
        type: 'resourceLocator',
        required: true,
        description: 'The record collection to operate on',
        default: { mode: 'list', value: '' },
        displayOptions: {
          show: {
            operation: [
              'createRecord',
              'getRecord',
              'putRecord',
              'deleteRecord',
              'listRecords',
            ],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            placeholder: 'Select a collection…',
            typeOptions: {
              searchListMethod: 'searchCollections',
              searchable: true,
            },
          },
          {
            displayName: 'By NSID',
            name: 'nsid',
            type: 'string',
            placeholder: 'e.g. app.bsky.feed.post',
            validation: [
              {
                type: 'regex',
                properties: {
                  regex: '^[a-z][a-z0-9]*(\\.[a-zA-Z][a-zA-Z0-9]*){2,}$',
                  errorMessage: 'Must be a valid NSID (e.g. app.bsky.feed.post)',
                },
              },
            ],
          },
        ],
      },

      // ------------------------------------------------------------------
      // Repo (for Get/List Record + List Blobs — optional, defaults to self)
      // ------------------------------------------------------------------
      {
        displayName: 'Repo (DID or handle)',
        name: 'repo',
        type: 'string',
        required: false,
        placeholder: 'did:plc:... or user.bsky.social',
        description:
          'Optional. The DID or handle of the repo. Defaults to the authenticated user. Useful for reading other users\' public records or blobs.',
        displayOptions: {
          show: {
            operation: ['getRecord', 'listRecords', 'listBlobs'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Repo (for Download Blob — can be DID or handle; optional when the
      // CID field is a bsky CDN URL with the DID embedded)
      // ------------------------------------------------------------------
      {
        displayName: 'Repo (DID or handle)',
        name: 'repo',
        type: 'string',
        required: false,
        placeholder: 'did:plc:... or user.bsky.social',
        description:
          'The DID or handle of the repo that owns the blob. Optional when the CID field is a bsky CDN URL — the DID is extracted from the URL.',
        displayOptions: {
          show: {
            operation: ['getBlob'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // CID / Blob reference (Download Blob only)
      // ------------------------------------------------------------------
      {
        displayName: 'Blob Reference',
        name: 'cid',
        type: 'string',
        required: true,
        placeholder:
          'bafkreig... or https://cdn.bsky.app/img/.../<did>/<cid>@jpeg',
        description:
          'A bare CID, a BlobRef JSON (e.g. `{"$link":"bafkreig..."}`), or a bsky CDN URL. CDN URLs also fill in the Repo.',
        displayOptions: {
          show: {
            operation: ['getBlob'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Binary Property (Upload Blob — input, Download Blob — output)
      // ------------------------------------------------------------------
      {
        displayName: 'Input Binary Property',
        name: 'binaryPropertyName',
        type: 'string',
        required: true,
        default: 'data',
        placeholder: 'data',
        description:
          'Name of the binary property on the incoming item containing the data to upload',
        displayOptions: {
          show: {
            operation: ['uploadBlob'],
          },
        },
      },
      {
        displayName: 'Output Binary Property',
        name: 'binaryPropertyName',
        type: 'string',
        required: true,
        default: 'data',
        placeholder: 'data',
        description:
          'Name of the binary property to write the downloaded blob to on the output item',
        displayOptions: {
          show: {
            operation: ['getBlob'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Upload Blob — advanced options
      // ------------------------------------------------------------------
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            operation: ['uploadBlob'],
          },
        },
        options: [
          {
            displayName: 'MIME Type Override',
            name: 'mimeTypeOverride',
            type: 'string',
            default: '',
            placeholder: 'image/jpeg',
            description:
              'Override the MIME type sent to the PDS. Defaults to the binary metadata\'s mimeType, or application/octet-stream if unset.',
          },
        ],
      },

      // ------------------------------------------------------------------
      // List Blobs — advanced options
      // ------------------------------------------------------------------
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            operation: ['listBlobs'],
          },
        },
        options: [
          {
            displayName: 'Since (Repo Revision)',
            name: 'since',
            type: 'string',
            default: '',
            placeholder: '3jzfc...',
            description:
              'Only list blobs added after this repo revision. Useful for incremental sync.',
          },
        ],
      },

      // ------------------------------------------------------------------
      // Record Key — shown for Get/Put/Delete
      // ------------------------------------------------------------------
      {
        displayName: 'Record Key (rkey)',
        name: 'rkey',
        type: 'string',
        required: false,
        placeholder: '3jzfcijpj2z2a',
        description:
          'The record key. Leave empty for collections that use a fixed key (e.g. app.bsky.actor.profile always uses "self").',
        displayOptions: {
          show: {
            operation: ['getRecord', 'putRecord', 'deleteRecord'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Record Key — Create mode (auto TID or custom)
      // ------------------------------------------------------------------
      {
        displayName: 'Record Key',
        name: 'rkeyMode',
        type: 'options',
        options: [
          {
            name: 'Auto-generate (TID)',
            value: 'auto',
            description: 'Generate a timestamp-based record key (TID) automatically',
          },
          {
            name: 'Custom',
            value: 'custom',
            description: 'Provide a custom record key',
          },
        ],
        displayOptions: {
          show: {
            operation: ['createRecord'],
          },
        },
        default: 'auto',
      },
      {
        displayName: 'Custom Record Key',
        name: 'rkey',
        type: 'string',
        required: true,
        placeholder: 'my-custom-key',
        description: 'A custom record key (rkey)',
        displayOptions: {
          show: {
            operation: ['createRecord'],
            rkeyMode: ['custom'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Record Data — resourceMapper for Create/Put (Phase 2)
      // Falls back to JSON when lexicon cannot be resolved.
      // ------------------------------------------------------------------
      {
        displayName: 'Record Data',
        name: 'recordData',
        type: 'resourceMapper',
        default: {
          mappingMode: 'defineBelow',
          value: null,
        },
        required: true,
        typeOptions: {
          resourceMapper: {
            resourceMapperMethod: 'getRecordFields',
            mode: 'add',
            fieldWords: {
              singular: 'field',
              plural: 'fields',
            },
            supportAutoMap: true,
            noFieldsError:
              'Could not resolve lexicon for this NSID. Enter record data as JSON using an expression, or check the collection NSID.',
          },
          loadOptionsDependsOn: ['collection.value'],
        },
        displayOptions: {
          show: {
            operation: ['createRecord', 'putRecord'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Options (advanced / less-common fields)
      // ------------------------------------------------------------------
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            operation: ['createRecord', 'putRecord', 'deleteRecord'],
          },
        },
        options: [
          {
            displayName: 'Swap Commit (CID)',
            name: 'swapCommit',
            type: 'string',
            default: '',
            placeholder: 'bafyreia...',
            description:
              'Compare-and-swap with the current commit CID. The write is rejected if the repo head does not match.',
          },
        ],
      },

      // ------------------------------------------------------------------
      // Limit (List Records / List Blobs)
      // ------------------------------------------------------------------
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: {
          minValue: 1,
          maxValue: 1000,
        },
        displayOptions: {
          show: {
            operation: ['listRecords', 'listBlobs'],
          },
        },
        default: 50,
        description: 'Maximum number of items to return per page',
      },

      // ------------------------------------------------------------------
      // Cursor (List Records / List Blobs — optional)
      // ------------------------------------------------------------------
      {
        displayName: 'Cursor',
        name: 'cursor',
        type: 'string',
        required: false,
        placeholder: '...',
        description:
          'Optional. Cursor for pagination. Pass the cursor from a previous response to get the next page.',
        displayOptions: {
          show: {
            operation: ['listRecords', 'listBlobs'],
          },
        },
        default: '',
      },
    ],
  };

  // -----------------------------------------------------------------------
  // Resource mapper method — called in the n8n editor to resolve fields
  // -----------------------------------------------------------------------
  methods = {
    listSearch: {
      searchCollections,
    },
    resourceMapping: {
      getRecordFields: async function (
        this: ILoadOptionsFunctions,
      ): Promise<ResourceMapperFields> {
        const nsid = extractCollectionNsid(
          this.getNodeParameter('collection'),
        );

        if (!nsid) {
          return { fields: [] };
        }

        // Try to get credentials for PDS-based resolution
        let agent: Agent | null = null;
        try {
          const credentials = await this.getCredentials('atprotoApi');
          if (credentials) {
            agent = await createAgent(credentials as IDataObject);
          }
        } catch {
          // Credentials not available — fall back to DNS-based resolution
          agent = null;
        }

        const schema = await resolveLexiconSchema(agent, nsid);

        if (!schema) {
          // Cannot resolve — return empty fields. n8n will show a warning
          // and the user can switch to JSON mode or provide a raw JSON value
          // via an expression.
          return { fields: [] };
        }

        const fields = await lexiconToResourceMapperFields(schema, agent);
        return { fields };
      },
    },
  };

  // -----------------------------------------------------------------------
  // Execute — called at workflow runtime
  // -----------------------------------------------------------------------
  async execute(this: IExecuteFunctions) {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    // Get credentials once — shared across all items in this execution
    const credentials = await this.getCredentials('atprotoApi');
    const agent = await createAgent(credentials as IDataObject);

    // Process each input item
    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as string;
        const collection = extractCollectionNsid(
          this.getNodeParameter('collection', i),
        );

        let result: IDataObject;

        switch (operation) {
          case 'createRecord': {
            const rkeyMode = this.getNodeParameter('rkeyMode', i) as string;
            const rkey =
              rkeyMode === 'custom'
                ? (this.getNodeParameter('rkey', i) as string)
                : generateTid();
            const recordData = this.getNodeParameter('recordData', i);
            const record = buildRecordFromNodeParams(recordData);
            const opts = this.getNodeParameter('options', i, {}) as IDataObject;
            const swapCommit = (opts.swapCommit as string) ?? '';

            // Resolve schema once for all downstream steps
            const schema = await resolveLexiconSchema(agent, collection);

            // Phase 5: inject const values from schema
            applyConstValues(record, schema);

            // Phase 3: upload blobs referenced by binary property names
            const recordWithBlobs = await applyBlobUploads(
              record,
              schema,
              agent,
              i,
              this,
            );

            // Phase 4: inject $type on nested ref/union objects
            const recordWithTypes = await injectNestedTypes(
              recordWithBlobs,
              schema,
              agent,
            );

            // Phase 5: validate before sending
            const createErrors = await validateRecord(
              recordWithTypes,
              schema,
              agent,
            );
            if (createErrors.length > 0) {
              throw new NodeOperationError(
                this.getNode(),
                `Record validation failed:\n• ${createErrors.join('\n• ')}`,
                { itemIndex: i },
              );
            }

            const res = await createRecord(agent, {
              collection,
              rkey,
              record: recordWithTypes,
              ...(swapCommit ? { swapCommit } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'getRecord': {
            const rkey = await resolveRkey(
              this.getNodeParameter('rkey', i) as string,
              collection,
              agent,
            );
            const repo = this.getNodeParameter('repo', i) as string;

            const res = await getRecord(agent, {
              collection,
              rkey,
              ...(repo ? { repo } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'putRecord': {
            const rkey = await resolveRkey(
              this.getNodeParameter('rkey', i) as string,
              collection,
              agent,
            );
            const recordData = this.getNodeParameter('recordData', i);
            const record = buildRecordFromNodeParams(recordData);
            const putOpts = this.getNodeParameter('options', i, {}) as IDataObject;
            const swapCommit = (putOpts.swapCommit as string) ?? '';

            // Resolve schema once for all downstream steps
            const schema = await resolveLexiconSchema(agent, collection);

            // Phase 5: inject const values from schema
            applyConstValues(record, schema);

            // Phase 3: upload blobs referenced by binary property names
            const recordWithBlobs = await applyBlobUploads(
              record,
              schema,
              agent,
              i,
              this,
            );

            // Phase 4: inject $type on nested ref/union objects
            const recordWithTypes = await injectNestedTypes(
              recordWithBlobs,
              schema,
              agent,
            );

            // Phase 5: validate before sending
            const putErrors = await validateRecord(
              recordWithTypes,
              schema,
              agent,
            );
            if (putErrors.length > 0) {
              throw new NodeOperationError(
                this.getNode(),
                `Record validation failed:\n• ${putErrors.join('\n• ')}`,
                { itemIndex: i },
              );
            }

            const res = await putRecord(agent, {
              collection,
              rkey,
              record: recordWithTypes,
              ...(swapCommit ? { swapCommit } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'deleteRecord': {
            const rkey = await resolveRkey(
              this.getNodeParameter('rkey', i) as string,
              collection,
              agent,
            );
            const delOpts = this.getNodeParameter('options', i, {}) as IDataObject;
            const swapCommit = (delOpts.swapCommit as string) ?? '';

            const res = await deleteRecord(agent, {
              collection,
              rkey,
              ...(swapCommit ? { swapCommit } : {}),
            });
            result = (res ?? { success: true }) as unknown as IDataObject;
            break;
          }

          case 'listRecords': {
            const limit = this.getNodeParameter('limit', i) as number;
            const cursor = this.getNodeParameter('cursor', i) as string;
            const repo = this.getNodeParameter('repo', i) as string;

            const res = await listRecords(agent, {
              collection,
              limit,
              ...(cursor ? { cursor } : {}),
              ...(repo ? { repo } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'uploadBlob': {
            const binaryPropertyName = this.getNodeParameter(
              'binaryPropertyName',
              i,
            ) as string;
            const opts = this.getNodeParameter('options', i, {}) as {
              mimeTypeOverride?: string;
            };

            const buffer = await this.helpers.getBinaryDataBuffer(
              i,
              binaryPropertyName,
            );
            if (!buffer) {
              throw new NodeOperationError(
                this.getNode(),
                `Binary property "${binaryPropertyName}" not found on input item`,
                { itemIndex: i },
              );
            }

            const binaryMeta = items[i].binary?.[binaryPropertyName];
            const mimeType =
              opts.mimeTypeOverride?.trim() ||
              binaryMeta?.mimeType ||
              'application/octet-stream';

            const res = await uploadBlob(agent, {
              data: buffer,
              mimeType,
            });
            // Flat sibling fields for ergonomic expression access:
            // `{{ $json.cid }}` instead of `{{ $json.blob.ref.$link }}`.
            result = {
              blob: res.blob,
              cid: res.blob.ref.$link,
              mimeType: res.blob.mimeType,
              size: res.blob.size,
            } as unknown as IDataObject;
            break;
          }

          case 'getBlob': {
            const repoInput = this.getNodeParameter('repo', i) as string;
            const blobInput = this.getNodeParameter('cid', i) as string;
            const binaryPropertyName = this.getNodeParameter(
              'binaryPropertyName',
              i,
            ) as string;

            // Parse the blob reference (bare CID / JSON ref / CDN URL).
            // CDN URLs may carry a DID that we use when Repo is empty.
            let parsed;
            try {
              parsed = parseBlobReference(blobInput);
            } catch (err) {
              throw new NodeOperationError(
                this.getNode(),
                err instanceof Error ? err.message : String(err),
                { itemIndex: i },
              );
            }
            const { cid } = parsed;

            const repoSource = repoInput?.trim() || parsed.did || '';
            if (!repoSource) {
              throw new NodeOperationError(
                this.getNode(),
                'Repo (DID or handle) is required when the Blob Reference does not contain a DID',
                { itemIndex: i },
              );
            }
            const did = await resolveActorToDid(agent, repoSource);

            try {
              const res = await getBlob(agent, { did, cid });

              const binaryData = await this.helpers.prepareBinaryData(
                res.data,
                cid,
                res.mimeType || undefined,
              );

              returnData.push({
                json: {
                  cid,
                  did,
                  mimeType: res.mimeType,
                  size: res.size,
                },
                binary: { [binaryPropertyName]: binaryData },
                pairedItem: { item: i },
              });
            } catch (err) {
              // Re-throw with cid/did context so friendlyError can produce
              // a useful 'Blob not found at <did>/<cid>' message.
              if (this.continueOnFail()) {
                returnData.push({
                  json: {
                    error: friendlyError(err, { cid, did }),
                    ...(err instanceof Error ? { message: err.message } : {}),
                  },
                  pairedItem: { item: i },
                });
                continue;
              }
              throw new NodeOperationError(
                this.getNode(),
                friendlyError(err, { cid, did }),
                { itemIndex: i },
              );
            }
            continue;
          }

          case 'listBlobs': {
            const limit = this.getNodeParameter('limit', i) as number;
            const cursor = this.getNodeParameter('cursor', i) as string;
            const repoInput = this.getNodeParameter('repo', i) as string;
            const listOpts = this.getNodeParameter('options', i, {}) as {
              since?: string;
            };

            const did = repoInput
              ? await resolveActorToDid(agent, repoInput)
              : agent.did ?? undefined;

            const res = await listBlobs(agent, {
              ...(did ? { did } : {}),
              limit,
              ...(cursor ? { cursor } : {}),
              ...(listOpts.since ? { since: listOpts.since } : {}),
            });

            // Emit one output item per CID so downstream Filter/Loop/Set
            // nodes can iterate naturally. Cursor is attached to every item
            // so any downstream node can drive the next page.
            for (const blobCid of res.cids) {
              returnData.push({
                json: {
                  cid: blobCid,
                  ...(did ? { did } : {}),
                  ...(res.cursor ? { cursor: res.cursor } : {}),
                },
                pairedItem: { item: i },
              });
            }
            continue;
          }

          default:
            throw new NodeOperationError(
              this.getNode(),
              `Unknown operation: ${operation}`,
              { itemIndex: i },
            );
        }

        returnData.push({
          json: result,
          pairedItem: { item: i },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: {
              error: friendlyError(error),
              ...(error instanceof Error ? { message: error.message } : {}),
            },
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeOperationError(
          this.getNode(),
          error instanceof Error ? error : new Error(String(error)),
          { itemIndex: i },
        );
      }
    }

    return [returnData];
  }
}

// ---------------------------------------------------------------------------
// Record building helper
// ---------------------------------------------------------------------------

/**
 * Build a record object from node parameters.
 *
 * Handles three input formats:
 *  1. Raw JSON string (legacy / fallback)
 *  2. `resourceMapper` value object `{ mappingMode, value, ... }`
 *  3. Plain object (when called from an expression)
 *
 * For resourceMapper values, dotted keys produced by ref/object flattening
 * (e.g. `reply.root`, `reply.parent`) are un-flattened into nested objects
 * (`{ reply: { root, parent } }`) so the resulting record matches the
 * lexicon's expected shape.
 *
 * `$type` and `createdAt` are NOT handled here — they're auto-injected in
 * `operations.ts`.
 */
export function buildRecordFromNodeParams(
  recordData: unknown,
): Record<string, unknown> {
  // Format 1: raw JSON string
  if (typeof recordData === 'string') {
    try {
      return JSON.parse(recordData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  // Format 2: resourceMapper value
  if (
    recordData &&
    typeof recordData === 'object' &&
    'mappingMode' in recordData &&
    'value' in recordData
  ) {
    const rm = recordData as {
      mappingMode: string;
      value: Record<string, unknown> | null;
    };

    if (!rm.value) return {};

    // Both defineBelow and autoMapInputData produce a flat key/value object.
    // Un-flatten dotted keys back into nested objects.
    return unflattenDottedKeys(rm.value);
  }

  // Format 3: plain object (e.g. from an expression)
  return (recordData ?? {}) as Record<string, unknown>;
}

/**
 * Convert a flat object with dotted keys into a nested object.
 *
 * `{ "reply.root": "x", "reply.parent": "y", text: "hi" }`
 * becomes
 * `{ reply: { root: "x", parent: "y" }, text: "hi" }`.
 *
 * Conflicts (a dotted key whose prefix is also a leaf) prefer the more
 * specific (dotted) value and discard the conflicting leaf.
 */
export function unflattenDottedKeys(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(flat)) {
    if (value === undefined || value === '') {
      // Skip empty/undefined values — the user didn't fill in this field.
      // Preserve `null` for nullable fields (the PDS accepts null when
      // the schema declares a field as nullable).
      continue;
    }

    if (!key.includes('.')) {
      result[key] = value;
      continue;
    }

    const parts = key.split('.');
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = cursor[part];
      if (
        existing === undefined ||
        existing === null ||
        typeof existing !== 'object'
      ) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = value;
  }

  return result;
}
