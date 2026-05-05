import nextTs from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react/display-name': 'warn',
      'react/no-unescaped-entities': 'warn',
      'prefer-const': 'warn',
      // Disable react-compiler rules (too strict for this project)
      'react-compiler/cascading-setState-in-effect': 'off',
      'react-compiler/cannot-preserve-memoization': 'off',
      'react-compiler/compilable-never': 'off',
      'react-compiler/invalid-hook-call': 'off',
      'react-compiler/no-direct-mutation': 'off',
      'react-compiler/primitives': 'off',
      'react-compiler/reactivity': 'off',
      'react-compiler/valid-react-call': 'off',
      'react-compiler/rules-of-hooks': 'off',
      'react-compiler/declare-variable': 'off',
      'react-compiler/access-variable-before-definition': 'off',
      // Disable React Compiler's strict react-hooks rules
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build artifacts:
    'server.js',
    'dist/**',
    // Script files (CommonJS):
    'scripts/**/*.js',
  ]),
]);

export default eslintConfig;
