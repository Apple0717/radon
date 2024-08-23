import { workspace } from "vscode";
import { LaunchConfigurationOptions } from "../common/LaunchConfig";

export function getLaunchConfiguration(): LaunchConfigurationOptions {
  return (
    workspace
      .getConfiguration("launch")
      ?.configurations?.find((config: any) => config.type === "react-native-ide") || {}
  );
}
