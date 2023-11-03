const ORIGINAL_TRANSFORMER_PATH = process.env.RNSZTUDIO_ORIGINAL_BABEL_TRANSFORMER_PATH;

// The below section overrides import of @babel/plugin-transform-react-jsx to load @babel/plugin-transform-react-jsx/lib/development
// instead. We need this for because the default transformer doesn't attach source locations to JSX nodes, which is required for
// the code inspector to work.
// What we do here is resolve the original transfomer location and replace it in require cache with the development
// version. As a result, when the preset loads the transformer, it will load the development version.
const jsxTransformPluginPath = require.resolve("@babel/plugin-transform-react-jsx", {
  paths: [ORIGINAL_TRANSFORMER_PATH],
});
require(jsxTransformPluginPath);
const devJsxTransformPluginPath = require.resolve(
  "@babel/plugin-transform-react-jsx/lib/development",
  { paths: [ORIGINAL_TRANSFORMER_PATH] }
);
require(devJsxTransformPluginPath);
require.cache[jsxTransformPluginPath] = require.cache[devJsxTransformPluginPath];

function transformWrapper({ filename, src, ...rest }) {
  const { transform } = require(process.env.RNSZTUDIO_ORIGINAL_BABEL_TRANSFORMER_PATH);
  if (filename === "node_modules/react-native/Libraries/Core/InitializeCore.js") {
    src = `global.__REACT_DEVTOOLS_PORT__=${process.env.RCT_DEVTOOLS_PORT};\n${src}\nrequire("sztudio-runtime");\n`;
  }
  return transform({ filename, src, ...rest });
}

module.exports = { transform: transformWrapper };
