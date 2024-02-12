import { useState, useRef, useEffect } from "react";
import { throttle } from "../utilities/common";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { keyboardEventToHID } from "../utilities/keyMapping";
import "./Preview.css";
import { useProject } from "../providers/ProjectProvider";
import { Platform } from "../../common/DeviceManager";
import {
  ANDROID_DEVICE_GRAPHICAL_PROPERTIES,
  IOS_DEVICE_GRAPHICAL_PROPERTIES,
} from "../utilities/consts";
import Button from "./shared/Button";

function cssPropertiesForDevice(device) {
  return {
    "--phone-screen-height": `${(device.screenHeight / device.frameHeight) * 100}%`,
    // "--phone-screen-width": `${(device.screenWidth / device.frameWidth) * 100}%`,
    "--phone-screen-aspect-ratio": `${device.screenWidth} / ${device.screenHeight}`,
    "--phone-mask-image": `url(${device.maskImage})`,
    "--phone-top": `${(device.offsetY / device.frameHeight) * 100}%`,
    "--phone-left": `${(device.offsetX / device.frameWidth) * 100}%`,
  };
}

function Preview({ isInspecting, setIsInspecting }) {
  const wrapperDivRef = useRef(null);
  const [isPressing, setIsPressing] = useState(false);

  const { projectState, project } = useProject();

  const hasBuildError = projectState?.status === "buildError";

  const [inspectData, setInspectData] = useState(null);
  useEffect(() => {
    if (!isInspecting) {
      setInspectData(null);
    }
  }, [isInspecting]);

  function sendTouch(event, type) {
    const imgRect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - imgRect.left) / imgRect.width;
    const y = (event.clientY - imgRect.top) / imgRect.height;
    project.dispatchTouch(x, y, type);
  }

  function sendInspectUnthrottled(event, type) {
    if (type === "Leave") {
      setInspectData(null);
      return;
    }
    const imgRect = event.target.getBoundingClientRect();
    const x = (event.clientX - imgRect.left) / imgRect.width;
    const y = (event.clientY - imgRect.top) / imgRect.height;
    project.inspectElementAt(x, y, type === "Down", setInspectData);
  }

  const sendInspect = throttle(sendInspectUnthrottled, 50);

  function onMouseMove(e) {
    e.preventDefault();
    if (isPressing) {
      sendTouch(e, "Move");
    } else if (isInspecting) {
      sendInspect(e, "Move", false);
    }
  }

  function onMouseDown(e) {
    e.preventDefault();
    wrapperDivRef.current.focus();
    if (isInspecting) {
      sendInspect(e, "Down", true);
      setIsInspecting(false);
    } else if (inspectData) {
      // if element is highlighted, we clear it here and ignore first click (don't send it to device)
      setInspectData(null);
    } else {
      setIsPressing(true);
      sendTouch(e, "Move");
    }
  }

  function onMouseUp(e) {
    e.preventDefault();
    if (isPressing) {
      sendTouch(e, "Up");
    }
    setIsPressing(false);
  }

  function onMouseLeave(e) {
    e.preventDefault();
    if (isPressing) {
      sendTouch(e, "Up");
      setIsPressing(false);
    }
    if (isInspecting) {
      // we force inspect event here to make sure no extra events are throttled
      // and will be dispatched later on
      sendInspect(e, "Leave", true);
    }
  }

  useEffect(() => {
    function keyEventHandler(e) {
      if (document.activeElement === wrapperDivRef.current) {
        e.preventDefault();
        const hidCode = keyboardEventToHID(e);
        project.dispatchKeyPress(hidCode, e.type === "keydown" ? "Down" : "Up");
      }
    }
    document.addEventListener("keydown", keyEventHandler);
    document.addEventListener("keyup", keyEventHandler);
    return () => {
      document.removeEventListener("keydown", keyEventHandler);
      document.removeEventListener("keyup", keyEventHandler);
    };
  }, [project]);

  const debugPaused = projectState?.status === "debuggerPaused";
  const debugException = projectState?.status === "runtimeError";

  const isStarting =
    !projectState || projectState.previewURL === undefined || projectState.status === "starting";
  const previewURL = projectState?.previewURL;

  const device =
    projectState?.selectedDevice?.platform === Platform.Android
      ? ANDROID_DEVICE_GRAPHICAL_PROPERTIES
      : IOS_DEVICE_GRAPHICAL_PROPERTIES;

  const inspectFrame = inspectData?.frame;
  return (
    <div
      className="phone-wrapper"
      style={cssPropertiesForDevice(device)}
      tabIndex={0} // allows keyboard events to be captured
      ref={wrapperDivRef}>
      {!isStarting && !hasBuildError && (
        <div className="phone-content">
          <img
            src={previewURL}
            style={{
              cursor: isInspecting ? "crosshair" : "default",
            }}
            className="phone-screen"
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
          />
          {inspectFrame && (
            <div className="phone-screen phone-inspect-overlay">
              <div
                className="inspect-area"
                style={{
                  left: `${inspectFrame.x * 100}%`,
                  top: `${inspectFrame.y * 100}%`,
                  width: `${inspectFrame.width * 100}%`,
                  height: `${inspectFrame.height * 100}%`,
                }}
              />
            </div>
          )}
          {debugPaused && (
            <div className="phone-screen phone-debug-overlay">
              <button className="continue-button" onClick={() => project.resumeDebugger()}>
                Paused in debugger&nbsp;
                <span className="codicon codicon-debug-continue" />
              </button>
            </div>
          )}
          {debugException && (
            <div className="phone-screen phone-debug-overlay phone-exception-overlay">
              <button className="uncaught-button" onClick={() => project.resumeDebugger()}>
                Uncaught exception&nbsp;
                <span className="codicon codicon-debug-continue" />
              </button>
            </div>
          )}

          <img src={device.frameImage} className="phone-frame" />
        </div>
      )}
      {isStarting && !hasBuildError && (
        <div className="phone-content">
          <div className="phone-sized phone-screen phone-content-loading-overlay" />
          <div className="phone-sized phone-screen phone-content-loading ">
            <VSCodeProgressRing />
          </div>
          <img src={device.frameImage} className="phone-frame" />
        </div>
      )}
      {hasBuildError && (
        <div className="phone-content">
          <div className="phone-sized phone-screen extension-error-screen">
            <h2>An error occurred. Click the button to restart the process.</h2>
            <Button
              type="secondary"
              onClick={() => {
                project.restart(false);
              }}>
              <span className="codicon codicon-refresh" />
            </Button>
          </div>
          <img src={device.frameImage} className="phone-frame" />
        </div>
      )}
    </div>
  );
}

export default Preview;
