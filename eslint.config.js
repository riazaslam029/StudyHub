const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['.agents/**', '.expo/**', 'node_modules/**', 'semantic-review/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'react/display-name': 'off',
    },
  },
];
