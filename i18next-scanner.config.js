module.exports = {
  input: [
    'client/src/**/*.{js,jsx,ts,tsx}',
    // Use ! to filter out files or directories
    '!client/src/**/*.spec.{js,jsx,ts,tsx}',
    '!client/src/**/*.test.{js,jsx,ts,tsx}',
    '!client/src/**/*.d.ts',
    '!**/node_modules/**',
  ],
  output: './',
  options: {
    debug: true,
    func: {
      list: ['t', 'i18next.t', 'i18n.t'],
      extensions: ['.js', '.jsx', '.ts', '.tsx']
    },
    trans: {
      component: 'Trans',
      i18nKey: 'i18nKey',
      defaultsKey: 'defaults',
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      fallbackKey: function(ns, value) {
        return value;
      },
      acorn: {
        ecmaVersion: 10,
        sourceType: 'module',
        allowHashBang: true,
      },
    },
    lngs: ['en', 'es', 'pt', 'fr', 'zh'],
    defaultLng: 'en',
    defaultValue: '__STRING_NOT_TRANSLATED__',
    resource: {
      loadPath: 'client/src/locales/{{lng}}.json',
      savePath: 'client/src/locales/{{lng}}.json',
      jsonIndent: 2,
      lineEnding: '\n'
    },
    nsSeparator: ':',
    keySeparator: '.',
    interpolation: {
      prefix: '{{',
      suffix: '}}'
    }
  }
};
