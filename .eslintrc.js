module.exports = {
	env: {
		browser: true,
		es2021: true,
	},
	extends: 'airbnb-base',
	overrides: [],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
	},
	rules: {
		// 'linebreak-style': ['warn', 'windows'],
		'no-tabs': 'off',
		indent: ['warn', 'tab'],
		'no-underscore-dangle': 'off', // easier to see if a function is intended as private function
		'import/prefer-default-export': 'off', // I like it more this way
		'no-else-return': 'off', // sometimes, its just easier to read
		'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
		'implicit-arrow-linebreak': 'off',
	},
};
