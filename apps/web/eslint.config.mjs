import reactHooks from 'eslint-plugin-react-hooks';
import root from '../../eslint.config.js';

/**
 * Next lance ESLint depuis ce dossier : les chemins sont alors relatifs a
 * `apps/web`, d'ou ce bloc local qui reactive les regles hooks sur tout le front.
 */
export default [
  ...root,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-console': 'off',
    },
  },
];
