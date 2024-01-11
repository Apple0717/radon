import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { useGlobalStateContext } from "../providers/GlobalStateProvider";
import "./ManageDevicesView.css";
import { useEffect, useMemo, useState } from "react";
import IconButton from "../components/IconButton";
import DeviceRemovalConfirmation from "../components/DeviceRemovalConfirmation";
import {
  AndroidSystemImage,
  IosRuntime,
  useSystemImagesContext,
} from "../providers/SystemImagesProvider";
import { Device, PLATFORM } from "../utilities/device";
import CreateDeviceView from "./CreateDeviceView";
import Tooltip from "../components/Tooltip";
import {
  ANDROID_DEVICE_GRAPHICAL_PROPERTIES,
  IOS_DEVICE_GRAPHICAL_PROPERTIES,
} from "../utilities/consts";

interface DeviceRowProps {
  device: Device;
  imageMissing: boolean;
  onDeviceDelete: (device: Device) => void;
}

function DeviceRow({ device, imageMissing, onDeviceDelete }: DeviceRowProps) {
  return (
    <div className="device-row">
      <div className="device-label-row">
        <div className="device-label">
          <span className="codicon codicon-device-mobile" />
          {imageMissing && (
            <Tooltip
              label={`${
                device.platform === PLATFORM.IOS
                  ? `Runtime ${device.runtime ? device.runtime?.name : ""}`
                  : `System image ${
                      device.systemImage
                        ? `${device.systemImage?.apiLevel} - ${device.systemImage?.description}`
                        : ""
                    }`
              } was not detected. Make sure it's installed and available.`}
              side={"bottom"}>
              <span className="codicon codicon-warning warning" />
            </Tooltip>
          )}
          {device.name}
        </div>
      </div>
      <IconButton
        tooltip={{
          label: `Remove device with it's ${
            device.platform === PLATFORM.IOS ? "runtime." : "system image."
          }`,
          side: "bottom",
        }}
        onClick={() => onDeviceDelete(device)}>
        <span className="codicon codicon-trash delete-icon" />
      </IconButton>
    </div>
  );
}

function ManageDevicesView() {
  const [selectedDevice, setSelectedDevice] = useState<Device | undefined>(undefined);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [createDeviceViewOpen, setCreateDeviceViewOpen] = useState(false);
  const { removeDeviceWithImage, isDeviceImageInstalled } = useSystemImagesContext();
  const { updateDevices, devices } = useGlobalStateContext();

  const handleConfirmation = (isConfirmed: boolean) => {
    setDeleteConfirmationOpen(false);
    if (!isConfirmed) {
      return;
    }

    const filteredDevices = devices.filter((device) => device.id !== selectedDevice?.id);
    updateDevices(filteredDevices);
    removeDeviceWithImage(selectedDevice!);
  };

  const androidDevices = useMemo(
    () => devices.filter((device) => device.platform === PLATFORM.ANDROID),
    [devices]
  );

  const iOSDevices = useMemo(
    () => devices.filter((device) => device.platform === PLATFORM.IOS),
    [devices]
  );

  const handleDeviceDelete = (device: Device) => {
    setSelectedDevice(device);
    setDeleteConfirmationOpen(true);
  };

  const handleCreateFinished = (
    name: string,
    platform: PLATFORM,
    systemImage: IosRuntime | AndroidSystemImage
  ) => {
    if (platform === PLATFORM.IOS) {
      const newDevice = {
        ...IOS_DEVICE_GRAPHICAL_PROPERTIES,
        id: name,
        name,
        platform,
        runtime: systemImage,
      } as Device;
      updateDevices([...devices, newDevice]);
    } else {
      const newDevice = {
        ...ANDROID_DEVICE_GRAPHICAL_PROPERTIES,
        id: name,
        name,
        platform,
        systemImage,
      } as Device;
      updateDevices([...devices, newDevice]);
    }
    setCreateDeviceViewOpen(false);
  };

  if (deleteConfirmationOpen && selectedDevice) {
    return <DeviceRemovalConfirmation device={selectedDevice} onConfirm={handleConfirmation} />;
  }

  if (createDeviceViewOpen) {
    return (
      <CreateDeviceView
        onCancel={() => setCreateDeviceViewOpen(false)}
        onCreate={handleCreateFinished}
      />
    );
  }

  return (
    <div className="container">
      <IconButton className="create-button" onClick={() => setCreateDeviceViewOpen(true)}>
        <span className="codicon codicon-add" />
        <div className="create-button-text">Create new device</div>
      </IconButton>
      {!!iOSDevices.length && (
        <>
          <div className="platform-header">iOS Devices</div>
          {iOSDevices.map((iOSDevice) => (
            <DeviceRow
              key={iOSDevice.id}
              device={iOSDevice}
              imageMissing={!isDeviceImageInstalled(iOSDevice)}
              onDeviceDelete={handleDeviceDelete}
            />
          ))}
        </>
      )}
      {!!iOSDevices.length && !!androidDevices.length && (
        <div className="platform-section-separator" />
      )}
      {!!androidDevices.length && (
        <>
          <div className="platform-header">Android Devices</div>
          {androidDevices.map((androidDevice) => (
            <DeviceRow
              key={androidDevice.id}
              device={androidDevice}
              imageMissing={!isDeviceImageInstalled(androidDevice)}
              onDeviceDelete={handleDeviceDelete}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default ManageDevicesView;
