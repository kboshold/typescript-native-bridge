import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'

// One type-aware rule is enough. no-unsafe-argument asks the type checker for
// the type of every call argument via getTypeAtLocation(). Under TNB that query
// crosses the Go bridge and, for the empty-tuple argument in src/trigger.ts,
// reaches (*Type).ThisType() and dereferences a nil InterfaceType.
export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'error',
    },
  },
]
