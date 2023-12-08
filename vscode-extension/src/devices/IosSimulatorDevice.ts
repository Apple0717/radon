import { getAppCachesDir } from "../utilities/common";
import { DeviceBase, DeviceSettings } from "./DeviceBase";
import { Preview } from "./preview";
import { Logger } from "../Logger";

const execa = require("execa");
const os = require("os");
const path = require("path");
const fs = require("fs");

interface DeviceInfo {
  availability?: string;
  state?: string;
  isAvailable?: boolean;
  name: string;
  udid: string;
  version?: string;
  availabilityError?: string;
  type?: "simulator" | "device" | "catalyst";
  booted?: boolean;
  lastBootedAt?: string;
}

interface RuntimeInfo {
  bundlePath: string;
  buildversion: string;
  platform: "iOS" | "tvOS" | "watchOS";
  runtimeRoot: string;
  identifier: string;
  version: string;
  isInternal: boolean;
  isAvailable: boolean;
  name: string;
  supportedDeviceTypes: Array<{ name: string; identifier: string }>;
}

interface DeviceTypeInfo {
  productFamily: "iPhone" | "iPad" | "Apple Watch" | "Apple TV";
  bundlePath: string;
  maxRuntimeVersion: number;
  maxRuntimeVersionString: string;
  identifier: string;
  modelIdentifier: string;
  minRuntimeVersion: number;
  minRuntimeVersionString: string;
  name: string;
}

export class IosSimulatorDevice extends DeviceBase {
  private deviceUdid: string | undefined;
  private deviceSetPath = getOrCreateDeviceSet();

  get name(): string | undefined {
    return this.deviceUdid;
  }

  get deviceSet(): string {
    return this.deviceSetPath;
  }

  async bootDevice() {
    this.deviceUdid = await findOrCreateSimulator(this.deviceSetPath);
  }

  async changeSettings(settings: DeviceSettings) {
    await execa("xcrun", [
      "simctl",
      "--set",
      this.deviceSetPath,
      "ui",
      this.deviceUdid!,
      "appearance",
      settings.appearance,
    ]);
    await execa("xcrun", [
      "simctl",
      "--set",
      this.deviceSetPath,
      "ui",
      this.deviceUdid!,
      "content_size",
      convertToSimctlSize(settings.contentSize),
    ]);
  }

  async configureMetroPort(bundleID: string, metroPort: number) {
    const { stdout: appDataLocation } = await execa("xcrun", [
      "simctl",
      "--set",
      this.deviceSetPath,
      "get_app_container",
      this.deviceUdid!,
      bundleID,
      "data",
    ]);
    const userDefaultsLocation = path.join(
      appDataLocation,
      "Library",
      "Preferences",
      `${bundleID}.plist`
    );
    Logger.log(`Defaults location ${userDefaultsLocation}`);
    try {
      await execa("/usr/libexec/PlistBuddy", [
        "-c",
        `Add :RCT_jsLocation string localhost:${metroPort}`,
        userDefaultsLocation,
      ]);
    } catch (e) {
      await execa("/usr/libexec/PlistBuddy", [
        "-c",
        `Set :RCT_jsLocation localhost:${metroPort}`,
        userDefaultsLocation,
      ]);
    }
  }

  async launchApp(bundleID: string, metroPort: number) {
    await this.configureMetroPort(bundleID, metroPort);
    await execa("xcrun", [
      "simctl",
      "--set",
      this.deviceSetPath,
      "launch",
      "--terminate-running-process",
      this.deviceUdid!,
      bundleID,
    ]);
  }

  async installApp(appPath: string) {
    await execa("xcrun", [
      "simctl",
      "--set",
      this.deviceSetPath,
      "install",
      this.deviceUdid!,
      appPath,
    ]);
  }

  makePreview(): Preview {
    return new Preview(["ios", this.deviceUdid!, this.deviceSetPath]);
  }
}

async function getNewestAvailableRuntime() {
  const runtimesData: { runtimes: Array<RuntimeInfo> } = JSON.parse(
    (await execa.command(`xcrun simctl list runtimes --json`)).stdout
  );

  // sort available runtimes by version
  const availableRuntimes = runtimesData.runtimes.filter((runtime) => runtime.isAvailable);
  availableRuntimes.sort((a, b) => (a.version.localeCompare(b.version) ? -1 : 1));

  // pick the newest runtime
  return availableRuntimes[0];
}

async function getNewestNonProIPhone() {
  const deviceTypesData: { devicetypes: Array<DeviceTypeInfo> } = JSON.parse(
    (await execa.command(`xcrun simctl list devicetypes --json`)).stdout
  );

  // filter iPhones:
  const iphones = deviceTypesData.devicetypes.filter((deviceType) => {
    // exclude phones with names that contains Pro/SE/Plus
    return deviceType.productFamily === "iPhone" && deviceType.name.match(/Pro/);
  });

  // select iPhone with highest minRuntimeVersion
  iphones.sort((a, b) => (a.minRuntimeVersion > b.minRuntimeVersion ? -1 : 1));
  return iphones[0];
}

async function getPreferredSimulator(deviceSetLocation: string) {
  let simulatorData: { devices: { [index: string]: Array<DeviceInfo> } };

  const { stdout } = await execa("xcrun", [
    "simctl",
    "--set",
    deviceSetLocation,
    "list",
    "devices",
    "--json",
  ]);
  simulatorData = JSON.parse(stdout);

  // get list of available simulators
  const allDevices = Object.keys(simulatorData.devices)
    .map((key) => simulatorData.devices[key])
    .reduce((acc, val) => acc.concat(val), [])
    .filter((device) => device.isAvailable);

  return allDevices.length ? allDevices[0] : undefined;
}

async function findOrCreateSimulator(deviceSetLocation: string) {
  let simulator = await getPreferredSimulator(deviceSetLocation);
  if (simulator && simulator.state === "Booted") {
    // this simulator is ok to be used
    return simulator.udid;
  }

  if (!simulator) {
    // we need to create a new simulator
    const deviceType = await getNewestNonProIPhone();

    // second, select the newest runtime
    const runtime = await getNewestAvailableRuntime();

    Logger.log(`Create simulator ${deviceType.name} with runtime ${runtime.name}`);
    // create new simulator with selected runtime
    await execa("xcrun", [
      "simctl",
      "--set",
      deviceSetLocation,
      "create",
      "ReactNativePreviewVSCode",
      deviceType.identifier,
      runtime.identifier,
    ]);

    simulator = await getPreferredSimulator(deviceSetLocation)!;
  }

  // for new simulator or old one that's not booted, we try booting it
  await execa("xcrun", ["simctl", "--set", deviceSetLocation, "boot", simulator!.udid]);
  return simulator!.udid;
}

function getOrCreateDeviceSet() {
  const appCachesDir = getAppCachesDir();
  const deviceSetLocation = path.join(appCachesDir, "Devices", "iOS");
  if (!fs.existsSync(deviceSetLocation)) {
    fs.mkdirSync(deviceSetLocation, { recursive: true });
  }

  return deviceSetLocation;
}

function convertToSimctlSize(size: DeviceSettings["contentSize"]): string {
  switch (size) {
    case "xsmall":
      return "extra-small";
    case "small":
      return "small";
    case "normal":
      return "medium";
    case "large":
      return "large";
    case "xlarge":
      return "extra-large";
    case "xxlarge":
      return "extra-extra-large";
    case "xxxlarge":
      return "extra-extra-extra-large";
  }
}
