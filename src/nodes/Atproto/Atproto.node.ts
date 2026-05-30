import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ResourceMapperField,
  ResourceMapperFields,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { Agent, CredentialSession } from '@atproto/api';

import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  putRecord,
} from './operations';
import { generateTid } from './tid';
import { resolveLexiconSchema } from './lexicon';
import { lexiconToResourceMapperFields } from './fieldMapping';

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
// Helper: create an authenticated Agent from node credentials
// ---------------------------------------------------------------------------

async function createAgent(credentials: IDataObject): Promise<Agent> {
  const identifier = credentials.identifier as string;
  const appPassword = credentials.appPassword as string;
  const serviceUrl = (credentials.serviceUrl as string) || 'https://bsky.social';

  const session = new CredentialSession(new URL(serviceUrl));
  await session.login({ identifier, password: appPassword });
  return new Agent(session);
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
    description: 'CRUD records in any AT Protocol collection',
    defaults: {
      name: 'AT Protocol',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'atprotoApi',
        required: true,
      },
    ],
    properties: [
      // ------------------------------------------------------------------
      // Operation
      // ------------------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Create Record',
            value: 'createRecord',
            description: 'Create a new record in a collection',
            action: 'Create a record',
          },
          {
            name: 'Get Record',
            value: 'getRecord',
            description: 'Get a record by collection and record key',
            action: 'Get a record',
          },
          {
            name: 'Put Record',
            value: 'putRecord',
            description: 'Full-replace a record',
            action: 'Update a record',
          },
          {
            name: 'Delete Record',
            value: 'deleteRecord',
            description: 'Delete a record by collection and record key',
            action: 'Delete a record',
          },
          {
            name: 'List Records',
            value: 'listRecords',
            description: 'List records in a collection with pagination',
            action: 'List records',
          },
        ],
        default: 'createRecord',
      },

      // ------------------------------------------------------------------
      // Collection NSID
      // ------------------------------------------------------------------
      {
        displayName: 'Collection (NSID)',
        name: 'collection',
        type: 'string',
        required: true,
        placeholder: 'app.bsky.feed.post',
        description: 'The NSID of the record collection (e.g. app.bsky.feed.post)',
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
        default: '',
      },

      // ------------------------------------------------------------------
      // Repo (for Get/List — optional, defaults to self)
      // ------------------------------------------------------------------
      {
        displayName: 'Repo (DID or handle)',
        name: 'repo',
        type: 'string',
        required: false,
        placeholder: 'did:plc:... or user.bsky.social',
        description:
          'Optional. The DID or handle of the repo. Defaults to the authenticated user. Useful for reading other users\' public records.',
        displayOptions: {
          show: {
            operation: ['getRecord', 'listRecords'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Record Key — shown for Get/Put/Delete
      // ------------------------------------------------------------------
      {
        displayName: 'Record Key (rkey)',
        name: 'rkey',
        type: 'string',
        required: true,
        placeholder: '3jzfcijpj2z2a',
        description: 'The record key (rkey) for the record',
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
          },
        },
        displayOptions: {
          show: {
            operation: ['createRecord', 'putRecord'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Swap Commit (Put only — optional)
      // ------------------------------------------------------------------
      {
        displayName: 'Swap Commit (CID)',
        name: 'swapCommit',
        type: 'string',
        required: false,
        placeholder: 'bafyreia...',
        description:
          'Optional. Compare-and-swap with the current commit CID. The put is rejected if the current record CID does not match.',
        displayOptions: {
          show: {
            operation: ['putRecord', 'deleteRecord', 'createRecord'],
          },
        },
        default: '',
      },

      // ------------------------------------------------------------------
      // Limit (List only)
      // ------------------------------------------------------------------
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: {
          minValue: 1,
          maxValue: 100,
        },
        displayOptions: {
          show: {
            operation: ['listRecords'],
          },
        },
        default: 50,
        description: 'Maximum number of records to return per page',
      },

      // ------------------------------------------------------------------
      // Cursor (List only — optional)
      // ------------------------------------------------------------------
      {
        displayName: 'Cursor',
        name: 'cursor',
        type: 'string',
        required: false,
        placeholder: '...',
        description:
          'Optional. Cursor for pagination. Pass the cursor from a previous List Records response to get the next page.',
        displayOptions: {
          show: {
            operation: ['listRecords'],
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
    resourceMapping: {
      getRecordFields: async function (
        this: ILoadOptionsFunctions,
      ): Promise<ResourceMapperFields> {
        const nsid = this.getNodeParameter('collection') as string;

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
        const collection = this.getNodeParameter('collection', i) as string;

        let result: IDataObject;

        switch (operation) {
          case 'createRecord': {
            const rkeyMode = this.getNodeParameter('rkeyMode', i) as string;
            const rkey =
              rkeyMode === 'custom'
                ? (this.getNodeParameter('rkey', i) as string)
                : generateTid();
            const recordData = this.getNodeParameter('recordData', i);
            const record = buildRecordFromNodeParams(recordData, collection);
            const swapCommit = this.getNodeParameter('swapCommit', i) as string;

            const res = await createRecord(agent, {
              collection,
              rkey,
              record,
              ...(swapCommit ? { swapCommit } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'getRecord': {
            const rkey = this.getNodeParameter('rkey', i) as string;
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
            const rkey = this.getNodeParameter('rkey', i) as string;
            const recordData = this.getNodeParameter('recordData', i);
            const record = buildRecordFromNodeParams(recordData, collection);
            const swapCommit = this.getNodeParameter('swapCommit', i) as string;

            const res = await putRecord(agent, {
              collection,
              rkey,
              record,
              ...(swapCommit ? { swapCommit } : {}),
            });
            result = res as unknown as IDataObject;
            break;
          }

          case 'deleteRecord': {
            const rkey = this.getNodeParameter('rkey', i) as string;
            const swapCommit = this.getNodeParameter('swapCommit', i) as string;

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
 * Phase 2: When `recordData` is a `resourceMapper` value (object with
 * `mappingMode` and `value`), read the mapped fields and construct the
 * record. When it's a raw JSON string (Phase 1 fallback), parse it.
 *
 * In both cases, `$type` and `createdAt` are handled by the operations
 * layer (auto-injected in `operations.ts`).
 */
function buildRecordFromNodeParams(
  recordData: unknown,
  collection: string,
): Record<string, unknown> {
  // Phase 1 fallback: raw JSON string
  if (typeof recordData === 'string') {
    try {
      return JSON.parse(recordData) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  // Phase 2: resourceMapper value
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

    if (rm.mappingMode === 'defineBelow' && rm.value) {
      return rm.value;
    }

    if (rm.mappingMode === 'autoMapInputData' && rm.value) {
      return rm.value;
    }

    return {};
  }

  // Fallback: return as-is
  return recordData as Record<string, unknown>;
}
