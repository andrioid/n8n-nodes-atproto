import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		ignores: ['tests/**', 'vite.config.build.ts', 'vitest.config.ts', 'scripts/**'],
	},
];
