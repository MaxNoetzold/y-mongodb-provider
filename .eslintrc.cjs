module.exports = {
	env: {
		es2021: true,
		jest: true,
	},
	extends: [
		'airbnb-base',
		'plugin:prettier/recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:import/typescript',
	],
	parser: '@typescript-eslint/parser',
	plugins: ['prettier', '@typescript-eslint'],
	overrides: [],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	rules: {
		'prettier/prettier': 'error',
		'no-tabs': 'off',
		indent: ['warn', 'tab'],
		'no-underscore-dangle': 'off',
		'import/prefer-default-export': 'off',
		'no-else-return': 'off',
		'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
		'implicit-arrow-linebreak': 'off',
		'import/extensions': 'off',
		'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
	},
};
