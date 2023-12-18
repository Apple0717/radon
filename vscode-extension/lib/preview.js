require("expo-router/entry");
const { AppRegistry, View } = require("react-native");

global.__rnp_previews ||= new Map();

function stringifyProps(obj) {
  const keyValuePairs = [];

  for (let key in obj) {
    if (obj.hasOwnProperty(key)) {
      keyValuePairs.push(`${key}=${obj[key]}`);
    }
  }

  return keyValuePairs.join(" ");
}

export function preview(component) {
  if (component._source == null) {
    return;
  }

  const name = `preview:/${component._source.fileName}:${component._source.lineNumber}`;
  function Preview() {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>{component}</View>
    );
  }
  global.__rnp_previews.set(name, {
    appKey: name,
    name: component.type.name,
    props: stringifyProps(component.props),
    fileName: component._source.fileName,
    lineNumber: component._source.lineNumber,
  });
  AppRegistry.registerComponent(name, () => Preview);
}
