/**
 * Bluesky node — opinionated, task-shaped wrappers around the
 * AT Protocol `app.bsky.*` lexicons. Hides NSIDs and lexicon details
 * for the most common Bluesky tasks: posting, replying, quoting,
 * liking, reposting and following.
 *
 * Power users should keep using the generic AT Protocol node for
 * anything not covered here, or for non-default collection NSIDs.
 */

import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { createAgent } from '../Atproto/shared';
import {
  createPost,
  followUser,
  likePost,
  quotePost,
  replyToPost,
  repostPost,
} from './operations';
import {
  fetchExternalMetadata,
  fetchThumbnail,
} from './external';

export class AtprotoBluesky implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Bluesky',
    name: 'atprotoBluesky',
    icon: 'file:bluesky.svg',
    group: ['transform'],
    version: 1,
    subtitle:
      '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description: 'Post, reply, quote, like, repost and follow on Bluesky',
    defaults: {
      name: 'Bluesky',
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
          { name: 'Follow', value: 'follow' },
          { name: 'Like', value: 'like' },
          { name: 'Post', value: 'post' },
          { name: 'Repost', value: 'repost' },
        ],
        default: 'post',
      },

      // ------------------------------------------------------------------
      // Operation — Post
      // ------------------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['post'] },
        },
        // Sorted alphabetically per @n8n/community-nodes lint rule.
        options: [
          {
            name: 'Create',
            value: 'create',
            description: 'Create a new post',
            action: 'Create a post',
          },
          {
            name: 'Quote',
            value: 'quote',
            description: 'Quote-post an existing post',
            action: 'Quote a post',
          },
          {
            name: 'Reply',
            value: 'reply',
            description: 'Reply to an existing post',
            action: 'Reply to a post',
          },
        ],
        default: 'create',
      },

      // ------------------------------------------------------------------
      // Operation — Like / Repost / Follow (single operation, hidden)
      // ------------------------------------------------------------------
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: { resource: ['like', 'repost', 'follow'] },
        },
        options: [
          {
            name: 'Create',
            value: 'create',
            action: 'Create',
          },
        ],
        default: 'create',
      },

      // ------------------------------------------------------------------
      // Text — Post Create / Reply / Quote
      // ------------------------------------------------------------------
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'Hello @alice.bsky.social, check this out!',
        description:
          'The post text. Mentions (@handle), URLs and #hashtags are auto-detected and rendered as rich-text facets.',
        typeOptions: {
          rows: 4,
        },
        displayOptions: {
          show: {
            resource: ['post'],
            operation: ['create', 'reply', 'quote'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Parent URI — Reply
      // ------------------------------------------------------------------
      {
        displayName: 'Reply To',
        name: 'parentUri',
        type: 'string',
        required: true,
        default: '',
        placeholder:
          'at://did:plc:.../app.bsky.feed.post/3jzfc... or https://bsky.app/profile/.../post/3jzfc...',
        description:
          'The post to reply to. Accepts either an at:// URI or a bsky.app URL.',
        displayOptions: {
          show: {
            resource: ['post'],
            operation: ['reply'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Quoted URI — Quote
      // ------------------------------------------------------------------
      {
        displayName: 'Quoted Post',
        name: 'quotedUri',
        type: 'string',
        required: true,
        default: '',
        placeholder:
          'at://did:plc:.../app.bsky.feed.post/3jzfc... or https://bsky.app/profile/.../post/3jzfc...',
        description:
          'The post to quote. Accepts either an at:// URI or a bsky.app URL.',
        displayOptions: {
          show: {
            resource: ['post'],
            operation: ['quote'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Subject — Like / Repost
      // ------------------------------------------------------------------
      {
        displayName: 'Post',
        name: 'subjectUri',
        type: 'string',
        required: true,
        default: '',
        placeholder:
          'at://did:plc:.../app.bsky.feed.post/3jzfc... or https://bsky.app/profile/.../post/3jzfc...',
        description: 'The post to like or repost. Accepts at:// URI or bsky.app URL.',
        displayOptions: {
          show: {
            resource: ['like', 'repost'],
          },
        },
      },

      // ------------------------------------------------------------------
      // User — Follow
      // ------------------------------------------------------------------
      {
        displayName: 'User',
        name: 'subjectUser',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'alice.bsky.social or did:plc:...',
        description: 'The handle or DID of the user to follow',
        displayOptions: {
          show: {
            resource: ['follow'],
          },
        },
      },

      // ------------------------------------------------------------------
      // Options — Post Create / Reply / Quote
      // ------------------------------------------------------------------
      {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            resource: ['post'],
            operation: ['create', 'reply', 'quote'],
          },
        },
        options: [
          {
            displayName: 'Auto-Scrape Link Metadata',
            name: 'externalAutoScrape',
            type: 'boolean',
            default: true,
            description:
              'Whether to fetch the page OpenGraph title, description and thumbnail. The item fails if the page cannot be fetched.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'External Link URL',
            name: 'externalUrl',
            type: 'string',
            default: '',
            placeholder: 'https://example.com/article',
            description:
              'URL to embed as a link card below the post. Leave empty for no card.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'Image Alt Text',
            name: 'imageAlt',
            type: 'string',
            default: '',
            description: 'Accessibility description of the embedded image',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'Image Binary Property',
            name: 'imageBinaryProperty',
            type: 'string',
            default: '',
            placeholder: 'data',
            description:
              'Name of the binary property on the incoming item containing an image to embed. Leave empty for a text-only post.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'Languages',
            name: 'langs',
            type: 'string',
            default: 'en',
            placeholder: 'en or en,is,fr',
            description:
              'Comma-separated BCP-47 language tags for the post. Defaults to en.',
          },
          {
            displayName: 'Link Description',
            name: 'externalDescription',
            type: 'string',
            default: '',
            description:
              'Card description. Overrides the scraped description when set.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'Link Thumbnail Binary Property',
            name: 'externalThumbBinaryProperty',
            type: 'string',
            default: '',
            placeholder: 'data',
            description:
              'Name of a binary property holding a custom card thumbnail. Overrides the scraped image.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
          {
            displayName: 'Link Title',
            name: 'externalTitle',
            type: 'string',
            default: '',
            description: 'Card title. Overrides the scraped title when set.',
            displayOptions: {
              show: {
                '/operation': ['create'],
              },
            },
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions) {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials('atprotoApi');
    const agent = await createAgent(credentials as IDataObject);

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;

        let result: IDataObject;

        if (resource === 'post' && operation === 'create') {
          const text = this.getNodeParameter('text', i) as string;
          const options = this.getNodeParameter(
            'options',
            i,
            {},
          ) as {
            langs?: string;
            imageBinaryProperty?: string;
            imageAlt?: string;
            externalUrl?: string;
            externalAutoScrape?: boolean;
            externalTitle?: string;
            externalDescription?: string;
            externalThumbBinaryProperty?: string;
          };

          const langs = parseLangs(options.langs);

          if (options.imageBinaryProperty && options.externalUrl) {
            throw new NodeOperationError(
              this.getNode(),
              'A post can carry either an image embed or an external link card, not both.',
              { itemIndex: i },
            );
          }

          let image: { blob: unknown; alt: string } | undefined;

          if (options.imageBinaryProperty) {
            const binaryData = await this.helpers.getBinaryDataBuffer(
              i,
              options.imageBinaryProperty,
            );
            const mimeType =
              items[i].binary?.[options.imageBinaryProperty]?.mimeType ??
              'application/octet-stream';
            const uploaded = await agent.com.atproto.repo.uploadBlob(
              binaryData,
              { encoding: mimeType },
            );
            image = {
              blob: uploaded.data.blob,
              alt: options.imageAlt ?? '',
            };
          }

          let external:
            | { uri: string; title: string; description: string; thumb?: unknown }
            | undefined;

          if (options.externalUrl) {
            let title = options.externalTitle ?? '';
            let description = options.externalDescription ?? '';
            let imageUrl: string | undefined;

            if (options.externalAutoScrape !== false) {
              const meta = await fetchExternalMetadata(options.externalUrl);
              title = options.externalTitle || meta.title;
              description = options.externalDescription || meta.description;
              imageUrl = meta.image;
            }

            let thumb: unknown;
            if (options.externalThumbBinaryProperty) {
              const thumbData = await this.helpers.getBinaryDataBuffer(
                i,
                options.externalThumbBinaryProperty,
              );
              const mimeType =
                items[i].binary?.[options.externalThumbBinaryProperty]
                  ?.mimeType ?? 'application/octet-stream';
              const uploaded = await agent.com.atproto.repo.uploadBlob(
                thumbData,
                { encoding: mimeType },
              );
              thumb = uploaded.data.blob;
            } else if (imageUrl) {
              try {
                const { bytes, mimeType } = await fetchThumbnail(imageUrl);
                if (bytes.byteLength <= 1_000_000) {
                  const uploaded = await agent.com.atproto.repo.uploadBlob(
                    bytes,
                    { encoding: mimeType },
                  );
                  thumb = uploaded.data.blob;
                }
              } catch {
                // Thumbnail is best-effort: keep the card without it.
              }
            }

            external = {
              uri: options.externalUrl,
              title,
              description,
              ...(thumb ? { thumb } : {}),
            };
          }

          result = (await createPost(agent, {
            text,
            langs,
            image,
            external,
          })) as unknown as IDataObject;
        } else if (resource === 'post' && operation === 'reply') {
          const text = this.getNodeParameter('text', i) as string;
          const parentUri = this.getNodeParameter('parentUri', i) as string;
          const options = this.getNodeParameter('options', i, {}) as {
            langs?: string;
          };

          result = (await replyToPost(agent, {
            text,
            parentUri,
            langs: parseLangs(options.langs),
          })) as unknown as IDataObject;
        } else if (resource === 'post' && operation === 'quote') {
          const text = this.getNodeParameter('text', i) as string;
          const quotedUri = this.getNodeParameter('quotedUri', i) as string;
          const options = this.getNodeParameter('options', i, {}) as {
            langs?: string;
          };

          result = (await quotePost(agent, {
            text,
            quotedUri,
            langs: parseLangs(options.langs),
          })) as unknown as IDataObject;
        } else if (resource === 'like') {
          const subjectUri = this.getNodeParameter('subjectUri', i) as string;
          result = (await likePost(
            agent,
            subjectUri,
          )) as unknown as IDataObject;
        } else if (resource === 'repost') {
          const subjectUri = this.getNodeParameter('subjectUri', i) as string;
          result = (await repostPost(
            agent,
            subjectUri,
          )) as unknown as IDataObject;
        } else if (resource === 'follow') {
          const subjectUser = this.getNodeParameter(
            'subjectUser',
            i,
          ) as string;
          result = (await followUser(
            agent,
            subjectUser,
          )) as unknown as IDataObject;
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `Unsupported resource/operation: ${resource}/${operation}`,
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
              error: error instanceof Error ? error.message : String(error),
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

/**
 * Normalize a user-supplied "en,is,fr" string into a string[] for the
 * record's `langs` field. Returns undefined for empty input so the
 * caller falls back to its own default.
 */
function parseLangs(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}
