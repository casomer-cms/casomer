import stylistic from '@stylistic/eslint-plugin';
import typescriptEslint from 'typescript-eslint';

// The house layout (DEVELOPMENT section 8) sits on top of @stylistic's
// maintained defaults: customize() supplies the popular baseline for every
// formatting dimension, and the overrides below are the points where the
// Casomer style is deliberately its own. Nobody hand-formats: editors fix
// on save, the pre-commit hook fixes staged files, CI is the backstop.

const baseline = stylistic.configs.customize( {
    indent: 4,
    quotes: 'single',
    semi: true,
    braceStyle: 'allman',
    commaDangle: 'always-multiline',
    arrowParens: true,
} );

export default [
    {
        ignores: [ 'node_modules/**', 'dist/**', 'studio/dist/**', 'studio/app/engine.js' ],
    },
    {
        files: [ '**/*.js', '**/*.ts' ],
        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            ...baseline.rules,
            '@stylistic/brace-style': [ 'error', 'allman', { allowSingleLine: true } ],
            '@stylistic/space-in-parens': [ 'error', 'always' ],
            '@stylistic/array-bracket-spacing': [ 'error', 'always' ],
            '@stylistic/computed-property-spacing': [ 'error', 'always' ],
            '@stylistic/space-before-function-paren': [ 'error', 'always' ],
            '@stylistic/linebreak-style': [ 'error', 'unix' ],
            '@stylistic/max-statements-per-line': [ 'error', { max: 2 } ],
        },
    },
];
