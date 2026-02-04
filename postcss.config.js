// PostCSS config - using function format to provide 'from' option
export default (ctx) => {
  return {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
    // Provide 'from' option to prevent warnings
    from: ctx?.file || ctx?.from || undefined,
  };
};
