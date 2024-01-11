import { ExtensionContext, Webview } from "vscode";
import { DeviceInfo } from "../utilities/device";
import { isFunction } from "lodash";

const STATE_NAME = "react-native-sztudio";

export class GlobalStateManager {
  private context: ExtensionContext;
  private webview: Webview;

  constructor(context: ExtensionContext, webview: Webview) {
    this.context = context;
    this.webview = webview;
  }

  public getState(): any {
    return this.context.globalState.get(STATE_NAME);
  }

  private notifyWebviewAboutUpdate() {
    this.webview.postMessage({
      command: "stateUpdate",
      state: this.getState(),
    });
  }

  public updateState(stateUpdate: any) {
    const presentState = this.getState();
    let newState = stateUpdate;
    if (isFunction(stateUpdate)) {
      newState = stateUpdate(presentState);
    }
    this.context.workspaceState.update(STATE_NAME, newState);
    this.notifyWebviewAboutUpdate();
  }

  startListening() {
    this.webview.onDidReceiveMessage((message: any) => {
      const command = message.command;
      switch (command) {
        case "setState":
          this.context.globalState.update(STATE_NAME, message.state);
          break;
        case "getState":
          this.webview.postMessage({
            command: "getState",
            state: this.getState(),
          });
          break;
      }
    });
  }

  updateDevice(device: DeviceInfo) {
    const currentState = this.getState();
    if (!currentState?.devices) {
      return;
    }
    const newDevices = [...currentState.devices];

    const oldDeviceIndex = newDevices.findIndex((newDevice) => newDevice.id === device.id);

    if (oldDeviceIndex < 0) {
      return;
    }

    newDevices[oldDeviceIndex] = device;
    this.context.globalState.update(STATE_NAME, { ...currentState, devices: newDevices });
    this.notifyWebviewAboutUpdate();
  }
}
