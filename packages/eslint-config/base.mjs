import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['node_modules', 'dist', 'out', 'coverage']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'max-lines': [
        'error',
        { max: 1000, skipBlankLines: true, skipComments: true }
      ],
      // 下划线前缀是仓库既有约定，用于标注「签名需要但实现不用」的参数
      // （mock 工厂、接口占位实现）。变量与解构仍需真实使用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'max-lines': 'off'
    }
  }
)
