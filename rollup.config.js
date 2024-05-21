export default [
	{
		input: './src/y-mongodb.js',
		output: {
			name: 'Y',
			file: 'dist/y-mongodb.cjs',
			format: 'cjs',
			sourcemap: true,
			paths: (path) => {
				if (/^lib0\//.test(path)) {
					// return `lib0/dist/${path.slice(5, -3)}.cjs
					return `lib0/dist/${path.slice(5)}.cjs`;
				}
				return path;
			},
		},
		external: (id) => /^(lib0|yjs|mongodb|buffer)/.test(id),
	},
];
