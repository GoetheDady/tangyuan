import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules', 'dist', 'out', 'coverage'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'max-lines': [
        'error',
        { max: 1000, skipBlankLines: true, skipComments: true },
      ],
      // 下划线前缀是仓库既有约定，用于标注「签名需要但实现不用」的参数
      // （mock 工厂、接口占位实现）。变量与解构仍需真实使用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
    },
  },
  // 关掉与 prettier 冲突的风格规则，再把格式差异本身作为 lint 问题报出来。
  // apps/desktop 通过 @electron-toolkit/eslint-config-prettier 达成同样效果；
  // 这里补齐 packages/*，避免两边「lint 是否检查格式」不一致导致格式静默漂移。
  eslintConfigPrettier,
  {
    plugins: { prettier: eslintPluginPrettier },
    rules: {
      'prettier/prettier': 'warn',
    },
  },
)
