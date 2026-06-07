import type {
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class AtprotoApi implements ICredentialType {
  name = 'atprotoApi';

  displayName = 'AT Protocol API';

  icon = { light: 'file:../nodes/Atproto/atproto.svg', dark: 'file:../nodes/Atproto/atproto.svg' } as const;

  documentationUrl =
    'https://atproto.com/guides/account#app-passwords';

  properties: INodeProperties[] = [
    {
      displayName: 'AT Protocol Identifier',
      name: 'identifier',
      type: 'string',
      default: '',
      placeholder: 'you.bsky.social',
      description:
        'Handle or DID (e.g. you.bsky.social or did:plc:abc123)',
      required: true,
    },
    {
      displayName: 'App Password',
      name: 'appPassword',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      placeholder: 'xxxx-xxxx-xxxx-xxxx',
      description:
        'App password generated at bsky.app/settings. Never use your main password.',
      required: true,
    },
    {
      displayName: 'PDS Service URL',
      name: 'serviceUrl',
      type: 'string',
      default: 'https://bsky.social',
      description: 'Base URL of the PDS (Personal Data Server)',
      required: true,
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.serviceUrl}}',
      url: '/xrpc/com.atproto.server.createSession',
      method: 'POST',
      body: {
        identifier: '={{$credentials.identifier}}',
        password: '={{$credentials.appPassword}}',
      },
    },
  };
}
