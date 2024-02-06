module.exports = {
	env: {
		es2021: true,
		jest: true,
	},
	extends: ['airbnb-base', 'plugin:prettier/recommended'],
	plugins: ['prettier'],
	overrides: [],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	rules: {
		'prettier/prettier': 'error',
		// 'linebreak-style': ['warn', 'windows'],
		'no-tabs': 'off',
		indent: ['warn', 'tab'],
		'no-underscore-dangle': 'off', // easier to see if a function is intended as private function
		'import/prefer-default-export': 'off', // I like it more this way
		'no-else-return': 'off', // sometimes, its just easier to read
		'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
		'implicit-arrow-linebreak': 'off',
		'import/extensions': ['error', 'ignorePackages'],
	},
};
