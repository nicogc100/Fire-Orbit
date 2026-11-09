// Revisión estática del código (ESLint 9, configuración plana).
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/',
      'globo-incendios/tierra/vendor/',
      'globo-incendios/data/',
      'globo-incendios/tierra/assets/',
    ],
  },
  js.configs.recommended,
  {
    files: ['globo-incendios/tierra/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['globo-incendios/tierra/*-worker.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['globo-incendios/datos.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      eqeqeq: ['error', 'smart'],
    },
  },
];
