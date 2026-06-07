import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		ignores: ['tests/**', 'vite.config.build.ts', 'vitest.config.ts', 'scripts/**'],
	},
	{
		// The no-credential-reuse rule resolves dist/X → X to find source files,
		// but our source lives in src/X (Vite compiles src/ → dist/). False positive.
		rules: {
			'@n8n/community-nodes/no-credential-reuse': 'off',
		},
	},
];
