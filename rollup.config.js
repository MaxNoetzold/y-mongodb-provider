import typescript from '@rollup/plugin-typescript';
import cleanup from 'rollup-plugin-cleanup';

export default [
	{
		external: (id) => /^(lib0|yjs|mongodb|buffer)/.test(id),
		input: 'src/y-mongodb.ts',
		treeshake: false,
		plugins: [typescript({ tsconfig: './tsconfig.json' }), cleanup({ extensions: ['ts'] })],
		output: [
			{
				dir: 'dist',
				format: 'es',
				preserveModules: true,
				entryFileNames: '[name].mjs',
				sourcemap: true,
			},
			{
				dir: 'dist',
				format: 'cjs',
				preserveModules: true,
				entryFileNames: '[name].cjs',
				sourcemap: true,
				paths: (path) => {
					if (/^lib0\//.test(path)) {
						return `lib0/dist/${path.slice(5)}.cjs`;
					}
					return path;
				},
			},
		],
	},
];
