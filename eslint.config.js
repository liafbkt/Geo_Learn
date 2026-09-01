import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src-tauri', 'coverage', 'playwright-report', 'test-results', 'release-artifacts', '.superpowers'],
  },
  tseslint.configs.recommended,
);
