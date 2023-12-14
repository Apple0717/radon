import {
  Disposable,
  Webview,
  WebviewPanel,
  window,
  Uri,
  ViewColumn,
  ExtensionContext,
  debug,
  commands,
} from "vscode";

import { isFileInWorkspace } from "../utilities/isFileInWorkspace";
import { openFileAtPosition } from "../utilities/openFileAtPosition";

import { Project } from "../project/project";
import {
  ANDROID_FAIL_ERROR_MESSAGE,
  IOS_FAIL_ERROR_MESSAGE,
  getWorkspacePath,
} from "../utilities/common";
import {
  checkAdroidEmulatorExists,
  checkIosDependenciesInstalled,
  checkPodInstalled,
  checkSimctlInstalled,
  checkXCodeBuildInstalled,
  checkXcrunInstalled,
} from "../utilities/hostDependenciesChecks";
import { installIOSDependencies } from "../builders/buildIOS";
import { openExternalUrl } from "../utilities/vsc";
import vscode from "vscode";
import {
  AndroidImageEntry,
  checkSdkManagerInstalled,
  getAndroidSystemImages,
  installSystemImages,
  removeSystemImages,
} from "../utilities/sdkmanager";
import { GlobalStateManager } from "./GlobalStateManager";
import { DeviceSettings } from "../devices/DeviceBase";
import { Logger } from "../Logger";
import { generateWebviewContent } from "./webviewContentGenerator";

export class PreviewsPanel {
  public static currentPanel: PreviewsPanel | undefined;
  private readonly _panel: WebviewPanel;
  private readonly project: Project;
  private readonly globalStateManager: GlobalStateManager;
  private disposables: Disposable[] = [];

  private followEnabled = false;

  private constructor(panel: WebviewPanel, context: ExtensionContext) {
    this._panel = panel;

    // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
    // the panel or when the panel is closed programmatically)
    this._panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = generateWebviewContent(
      context,
      this._panel.webview,
      context.extensionUri
    );

    // Set an event listener to listen for messages passed from the webview context
    this._setWebviewMessageListener(this._panel.webview);

    // Set the manager to listen and change the persisting storage for the extension.
    this.globalStateManager = new GlobalStateManager(context, this._panel.webview);
    this.globalStateManager.startListening();

    this._setupEditorListeners(context);

    this.project = new Project(context);
  }

  public static render(context: ExtensionContext, fileName?: string, lineNumber?: number) {
    if (PreviewsPanel.currentPanel) {
      // If the webview panel already exists reveal it
      PreviewsPanel.currentPanel._panel.reveal(ViewColumn.Beside);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "RNPreview",
        "React Native Preview",
        ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: [
            Uri.joinPath(context.extensionUri, "dist"),
            Uri.joinPath(context.extensionUri, "node_modules"),
          ],
          retainContextWhenHidden: true,
        }
      );
      PreviewsPanel.currentPanel = new PreviewsPanel(panel, context);
      commands.executeCommand("workbench.action.lockEditorGroup");
    }

    if (fileName !== undefined && lineNumber !== undefined) {
      PreviewsPanel.currentPanel.project.startPreview(`preview:/${fileName}:${lineNumber}`);
    }
  }

  public dispose() {
    PreviewsPanel.currentPanel = undefined;

    // Dispose of the current webview panel
    this._panel.dispose();

    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  public notifyAppReady(deviceId: string, previewURL: string) {
    this._panel.webview.postMessage({
      command: "appReady",
      deviceId: deviceId,
      previewURL: previewURL,
    });
  }

  public notifyAppUrlChanged(appKey: string) {
    this._panel.webview.postMessage({
      command: "appUrlChanged",
      url: appKey,
    });
  }

  private _setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      (message: any) => {
        const command = message.command;

        Logger.log(`Extension received a message with command ${command}.`);

        switch (command) {
          case "log":
            return;
          case "startProject":
            this._startProject(message.deviceId, message.settings, message.systemImagePath);
            return;
          case "debugResume":
            debug.activeDebugSession?.customRequest("continue");
            return;
          case "changeDevice":
            this._handleSelectDevice(message.deviceId, message.settings, message.systemImagePath);
            return;
          case "changeDeviceSettings":
            this.project.changeDeviceSettings(message.deviceId, message.settings);
            return;
          case "touch":
            this.project.sendTouch(message.deviceId, message.xRatio, message.yRatio, message.type);
            return;
          case "key":
            this.project.sendKey(message.deviceId, message.keyCode, message.type);
            return;
          case "inspect":
            this.project.inspectElementAt(message.xRatio, message.yRatio, (inspectData) => {
              this._panel.webview.postMessage({
                command: "inspectData",
                data: inspectData,
              });
              if (message.type === "Down") {
                // find last element in inspectData.hierarchy with source that belongs to the workspace
                for (let i = inspectData.hierarchy.length - 1; i >= 0; i--) {
                  const element = inspectData.hierarchy[i];
                  if (isFileInWorkspace(element.source.fileName)) {
                    openFileAtPosition(
                      element.source.fileName,
                      element.source.lineNumber - 1,
                      element.source.columnNumber - 1
                    );
                    break;
                  }
                }
              }
            });
            return;
          case "openUrl":
            this.project.openUrl(message.url);
            return;
          case "stopFollowing":
            this.followEnabled = false;
            return;
          case "startFollowing":
            this.followEnabled = true;
            return;
          case "openLogs":
            commands.executeCommand("workbench.panel.repl.view.focus");
            return;
          case "refreshDependencies":
            this._refreshDependencies();
            return;
          case "openExternalUrl":
            openExternalUrl(message.url);
            return;
          case "installIOSDependencies":
            this._installIOSDependencies();
            return;
          case "handlePrerequisites":
            this._handlePrerequisites();
            return;
          case "restartProject":
            this._resetProject(message.deviceId, message.settings, message.systemImagePath);
            return;
          case "listAllAndroidImages":
            this._listAllAndroidImages();
            return;
          case "listInstalledAndroidImages":
            this._listInstalledAndroidImages();
            return;
          case "processAndroidImageChanges":
            this._processAndroidImageChanges(message.toRemove, message.toInstall);
            return;
        }
      },
      undefined,
      this.disposables
    );
  }

  private async _processAndroidImageChanges(
    toRemove: AndroidImageEntry[],
    toInstall: AndroidImageEntry[]
  ) {
    const streamInstallStdoutProgress = (line: string) => {
      this._panel.webview.postMessage({
        command: "streamAndroidInstallationProgress",
        stream: line,
      });
    };

    if (!!toInstall.length) {
      const toInstallImagePaths = toInstall.map((imageToInstall) => imageToInstall.path);
      await installSystemImages(toInstallImagePaths, streamInstallStdoutProgress);
    }

    if (!!toRemove.length) {
      const toRemoveImagePaths = toRemove.map((imageToRemove) => imageToRemove.location!);
      await removeSystemImages(toRemoveImagePaths);
    }

    const [installedImages, availableImages] = await getAndroidSystemImages();
    this._panel.webview.postMessage({
      command: "installProcessFinished",
      installedImages,
      availableImages,
    });
  }

  private async _listAllAndroidImages() {
    const [installedImages, availableImages] = await getAndroidSystemImages();
    this._panel.webview.postMessage({
      command: "allAndroidImagesListed",
      installedImages,
      availableImages,
    });
  }

  private async _listInstalledAndroidImages() {
    const [installedImages] = await getAndroidSystemImages();
    this._panel.webview.postMessage({
      command: "installedAndroidImagesListed",
      images: installedImages,
    });
  }

  private async _startProject(deviceId: string, settings: DeviceSettings, systemImagePath: string) {
    await this.project.start();
    this.project.addEventMonitor({
      onLogReceived: (message) => {
        this._panel.webview.postMessage({
          command: "logEvent",
          type: message.type,
        });
      },
      onDebuggerPaused: () => {
        this._panel.webview.postMessage({
          command: "debuggerPaused",
        });
      },
      onDebuggerContinued: () => {
        this._panel.webview.postMessage({
          command: "debuggerContinued",
        });
      },
      onUncaughtException: (isFatal) => {
        this._panel.webview.postMessage({
          command: "uncaughtException",
          isFatal: isFatal,
        });
      },
    });
    this.disposables.push(this.project);
    this._handleSelectDevice(deviceId, settings, systemImagePath);
  }

  private async _handleSelectDevice(
    deviceId: string,
    settings: DeviceSettings,
    systemImagePath: string
  ) {
    try {
      await this.project.selectDevice(deviceId, settings, systemImagePath);
    } catch (error) {
      const isStringError = typeof error === "string";
      this._panel.webview.postMessage({
        command: "projectError",
        androidBuildFailed: isStringError && error.startsWith(ANDROID_FAIL_ERROR_MESSAGE),
        iosBuildFailed: isStringError && error.startsWith(IOS_FAIL_ERROR_MESSAGE),
        error,
      });
      throw error;
    }
  }

  private async _resetProject(deviceId: string, settings: DeviceSettings, systemImagePath: string) {
    this.project.dispose();
    await this._handlePrerequisites();
    this._startProject(deviceId, settings, systemImagePath);
  }

  private async _handlePrerequisites() {
    const { iosDependencies, podCli } = await this._checkDependencies();

    if (!iosDependencies && podCli) {
      await this._installIOSDependencies();
    }

    const dependenciesDiagnostic = await this._checkDependencies();

    Logger.log(`Dependencies checked ${dependenciesDiagnostic}`);
    this._panel.webview.postMessage({
      command: "checkedDependencies",
      dependencies: dependenciesDiagnostic,
    });
  }

  private async _refreshDependencies() {
    const dependenciesDiagnostic = await this._checkDependencies();
    this._panel.webview.postMessage({
      command: "checkedDependencies",
      dependencies: dependenciesDiagnostic,
    });
  }

  private async _installIOSDependencies() {
    try {
      const { stdout, stderr } = await installIOSDependencies(getWorkspacePath());
      const isSuccess = !!stdout.length && !stderr.length;
      if (!isSuccess) {
        vscode.window.showErrorMessage(
          `Error occured while installing ios dependencies: ${stderr}.`
        );
      } else {
        vscode.window.showInformationMessage("Successfully installed ios dependencies.");
        this._checkDependencies();
      }

      this._panel.webview.postMessage({
        command: "installationComplete",
      });
    } catch (e) {
      Logger.error(`${e}`);
      this._panel.webview.postMessage({
        command: "installationComplete",
      });
      throw e;
    }
  }

  private async _checkDependencies() {
    const xcodebuild = checkXCodeBuildInstalled();
    const xcrun = checkXcrunInstalled();
    const simctl = checkSimctlInstalled();
    const podCli = checkPodInstalled();
    const iosDependencies = checkIosDependenciesInstalled();
    const androidEmulator = checkAdroidEmulatorExists();
    const sdkManager = checkSdkManagerInstalled();

    return Promise.all([
      xcodebuild,
      xcrun,
      simctl,
      podCli,
      iosDependencies,
      androidEmulator,
      sdkManager,
    ]).then(
      ([xcodebuild, xcrun, simctl, podCli, iosDependencies, androidEmulator, sdkManager]) => ({
        xcodebuild,
        xcrun,
        simctl,
        podCli,
        iosDependencies,
        androidEmulator,
        sdkManager,
      })
    );
  }

  private _onActiveFileChange(filename: string) {
    Logger.log(`LastEditor ${filename}`);
    this.project.onActiveFileChange(filename, this.followEnabled);
  }

  private _setupEditorListeners(context: ExtensionContext) {
    context.subscriptions.push(
      window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this._onActiveFileChange(editor.document.fileName);
        }
      })
    );
  }
}
