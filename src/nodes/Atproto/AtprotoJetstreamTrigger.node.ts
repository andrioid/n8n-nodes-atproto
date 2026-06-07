import type {
  IDataObject,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
  ITriggerFunctions,
  ITriggerResponse,
} from 'n8n-workflow';

import { JetstreamClient } from './jetstream';
import type { FlattenedJetstreamEvent } from './jetstream';

// ---------------------------------------------------------------------------
// Public Jetstream instances
// ---------------------------------------------------------------------------

const PUBLIC_ENDPOINTS = [
  {
    name: 'US-East 1',
    value: 'wss://jetstream1.us-east.bsky.network/subscribe',
    description: 'Bluesky Jetstream instance in US-East (Virginia)',
  },
  {
    name: 'US-East 2',
    value: 'wss://jetstream2.us-east.bsky.network/subscribe',
    description: 'Bluesky Jetstream instance in US-East (Virginia)',
  },
  {
    name: 'US-West 1',
    value: 'wss://jetstream1.us-west.bsky.network/subscribe',
    description: 'Bluesky Jetstream instance in US-West (Oregon)',
  },
  {
    name: 'US-West 2',
    value: 'wss://jetstream2.us-west.bsky.network/subscribe',
    description: 'Bluesky Jetstream instance in US-West (Oregon)',
  },
] as const;

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export class AtprotoJetstreamTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'AT Protocol Jetstream Trigger',
    name: 'atprotoJetstreamTrigger',
    icon: 'file:atproto.svg',
    group: ['trigger'],
    version: 1,
    subtitle:
      '={{ $parameter["eventKinds"].join(", ") || "commits" }} — {{ $parameter["endpoint"].split("/")[2] || "?" }}',
    description: 'Subscribe to the AT Protocol firehose via Jetstream',
    defaults: {
      name: 'AT Protocol Jetstream',
    },
    inputs: [],
    outputs: [],
    credentials: [
      {
        name: 'atprotoApi',
        required: true,
      },
    ],
    properties: [
      // ------------------------------------------------------------------
      // Jetstream Endpoint
      // ------------------------------------------------------------------
      {
        displayName: 'Jetstream Endpoint',
        name: 'endpoint',
        type: 'options',
        default: 'wss://jetstream2.us-west.bsky.network/subscribe',
        description: 'The Jetstream WebSocket endpoint to connect to',
        options: [
          ...PUBLIC_ENDPOINTS.map((e) => ({
            name: e.name,
            value: e.value,
            description: e.description,
          })),
          {
            name: 'Custom',
            value: 'custom',
            description: 'Use a custom Jetstream WebSocket endpoint',
          },
        ],
      },
      {
        displayName: 'Custom Endpoint',
        name: 'customEndpoint',
        type: 'string',
        default: '',
        placeholder: 'wss://your-jetstream.example.com/subscribe',
        description: 'The full WebSocket URL of a custom Jetstream instance',
        displayOptions: {
          show: {
            endpoint: ['custom'],
          },
        },
        required: true,
      },

      // ------------------------------------------------------------------
      // Collections
      // ------------------------------------------------------------------
      {
        displayName: 'Collections (NSID)',
        name: 'collections',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        default: {},
        description:
          'Filter by collection NSIDs. Leave empty to receive all collections.',
        placeholder: 'Add Collection',
        options: [
          {
            displayName: 'Collection',
            name: 'collectionValues',
            values: [
              {
                displayName: 'Collection NSID',
                name: 'collection',
                type: 'string',
                default: '',
                placeholder: 'e.g. app.bsky.feed.post',
                description:
                  'NSID of the collection (supports wildcard prefixes like app.bsky.feed.*)',
              },
            ],
          },
        ],
      },

      // ------------------------------------------------------------------
      // Wanted DIDs
      // ------------------------------------------------------------------
      {
        displayName: 'Wanted DIDs',
        name: 'wantedDids',
        type: 'fixedCollection',
        typeOptions: {
          multipleValues: true,
        },
        default: {},
        description:
          'Filter by repo DIDs. Leave empty to receive events for all repos.',
        placeholder: 'Add DID',
        options: [
          {
            displayName: 'DID',
            name: 'didValues',
            values: [
              {
                displayName: 'DID',
                name: 'did',
                type: 'string',
                default: '',
                placeholder: 'did:plc:abc123...',
                description: 'DID of a repo to watch',
              },
            ],
          },
        ],
      },

      // ------------------------------------------------------------------
      // Event Kinds
      // ------------------------------------------------------------------
      {
        displayName: 'Event Kinds',
        name: 'eventKinds',
        type: 'multiOptions',
        default: ['commit'],
        description: 'Which types of Jetstream events to emit',
        options: [
          {
            name: 'Commits',
            value: 'commit',
            description: 'Record creates, updates, and deletes',
          },
          {
            name: 'Identity',
            value: 'identity',
            description: 'Handle changes and identity updates',
          },
          {
            name: 'Account',
            value: 'account',
            description: 'Account status changes (active, deactivated, takendown)',
          },
        ],
      },

      // ------------------------------------------------------------------
      // Operations (shown when Commits is selected)
      // ------------------------------------------------------------------
      {
        displayName: 'Operations',
        name: 'operations',
        type: 'multiOptions',
        default: ['create', 'update', 'delete'],
        description: 'Which commit operations to emit. Only applies when "Commits" event kind is selected.',
        displayOptions: {
          show: {
            eventKinds: ['commit'],
          },
        },
        options: [
          {
            name: 'Create',
            value: 'create',
            description: 'New record created',
          },
          {
            name: 'Update',
            value: 'update',
            description: 'Existing record updated',
          },
          {
            name: 'Delete',
            value: 'delete',
            description: 'Record deleted',
          },
        ],
      },

      // ------------------------------------------------------------------
      // Compression
      // ------------------------------------------------------------------
      {
        displayName: 'Use Compression',
        name: 'compression',
        type: 'boolean',
        default: true,
        description:
          'Whether to use zstd compression. Reduces bandwidth by ~56%. Requires the Jetstream custom dictionary (bundled).',
      },

      // ------------------------------------------------------------------
      // Options collection (advanced)
      // ------------------------------------------------------------------
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
          {
            displayName: 'Max Message Size (bytes)',
            name: 'maxMessageSize',
            type: 'number',
            default: 0,
            description:
              'Maximum message size in bytes. 0 means no limit. Messages larger than this are dropped by the server.',
            typeOptions: {
              minValue: 0,
            },
          },
        ],
      },
    ],
  };

  // -----------------------------------------------------------------------
  // Trigger
  // -----------------------------------------------------------------------
  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const staticData = this.getWorkflowStaticData('node');

    // Read parameters
    const endpointParam = this.getNodeParameter('endpoint') as string;
    const customEndpoint = this.getNodeParameter('customEndpoint') as string;
    const collectionsParam = this.getNodeParameter('collections') as {
      collectionValues?: Array<{ collection: string }>;
    };
    const wantedDidsParam = this.getNodeParameter('wantedDids') as {
      didValues?: Array<{ did: string }>;
    };
    const eventKinds = this.getNodeParameter('eventKinds') as string[];
    const operations = this.getNodeParameter('operations') as string[];
    const compression = this.getNodeParameter('compression') as boolean;
    const options = this.getNodeParameter('options') as {
      maxMessageSize?: number;
    };

    // Resolve endpoint
    const endpoint =
      endpointParam === 'custom'
        ? customEndpoint
        : endpointParam;

    if (!endpoint) {
      throw new Error(
        'Jetstream endpoint is required. Select a public instance or provide a custom endpoint.',
      );
    }

    // Extract collections
    const wantedCollections = collectionsParam?.collectionValues
      ?.map((c) => c.collection)
      .filter(Boolean);

    // Extract DIDs
    const wantedDids = wantedDidsParam?.didValues
      ?.map((d) => d.did)
      .filter(Boolean);

    // Build a Set for fast operation filter lookup (empty = all)
    const operationFilter =
      operations.length > 0 ? new Set(operations) : null;

    // Build a Set for event kind filter lookup
    const kindFilter = new Set(eventKinds);

    // Restore cursor from previous run
    const savedCursor = staticData.cursor as number | undefined;

    // Create the Jetstream client
    const client = new JetstreamClient(
      {
        endpoint,
        wantedCollections: wantedCollections?.length ? wantedCollections : undefined,
        wantedDids: wantedDids?.length ? wantedDids : undefined,
        cursor: savedCursor,
        compression,
        maxMessageSize: options.maxMessageSize || undefined,
      },
      {
        onEvent: (event: FlattenedJetstreamEvent) => {
          // Filter by event kind
          if (!kindFilter.has(event.kind)) return;

          // Filter by operation (commit only)
          if (
            event.kind === 'commit' &&
            event.operation &&
            operationFilter &&
            !operationFilter.has(event.operation)
          ) {
            return;
          }

          // Track cursor for persistence
          if (event.timeUs) {
            staticData.cursor = event.timeUs;
          }

          this.emit([[{ json: event as unknown as IDataObject, pairedItem: undefined }]]);
        },
        onError: (error: Error) => {
          // Non-fatal errors are logged but don't stop the trigger.
          // The client handles reconnection internally.
          this.logger.warn(`[Jetstream] ${error.message}`);
        },
      },
    );

    // Connect
    await client.connect();

    // Close function: persist cursor and tear down
    const closeFunction = async () => {
      client.stop();
    };

    // Manual trigger: connect, wait for first event, then disconnect
    const manualTriggerFunction = async () => {
      return new Promise<void>((resolve, reject) => {
        // Connect and use a one-shot listener to capture the first event
        const onEvent = (event: FlattenedJetstreamEvent) => {
          // Apply the same filters as the main trigger
          if (!kindFilter.has(event.kind)) return;
          if (
            event.kind === 'commit' &&
            event.operation &&
            operationFilter &&
            !operationFilter.has(event.operation)
          ) {
            return;
          }

          // Emit the event
          this.emit([[{ json: event as unknown as IDataObject, pairedItem: undefined }]]);

          // Record cursor and stop
          if (event.timeUs) {
            staticData.cursor = event.timeUs;
          }
          client.stop();
          resolve();
        };

        const onError = (error: Error) => {
          client.stop();
          reject(error);
        };

        // Replace handlers with one-shot versions
        const tempClient = new JetstreamClient(
          {
            endpoint,
            wantedCollections: wantedCollections?.length
              ? wantedCollections
              : undefined,
            wantedDids: wantedDids?.length ? wantedDids : undefined,
            compression,
            maxMessageSize: options.maxMessageSize || undefined,
          },
          { onEvent, onError },
        );

        tempClient.connect().catch(reject);

        // Safety timeout: if no matching event arrives in ~30s, give up
        setTimeout(() => {
          tempClient.stop();
          resolve();
        }, 30_000);
      });
    };

    return {
      closeFunction,
      manualTriggerFunction,
    };
  }
}
