import { useRef, useEffect } from "react";
import { capture, identify, reset } from "./lib/posthog";
import { initErrorReporting } from "./lib/errorReporting";
import { TitleBar } from "./components/TitleBar";
import { StatusBar } from "./components/StatusBar";
import { LoginScreen } from "./components/LoginScreen";
import { TrackerHome } from "./components/TrackerHome";
import { FeedbackSurveyButton } from "./components/FeedbackSurveyButton";
import { useTrackerEvents } from "./hooks/useTrackerEvents";
import { useNetTableEvents } from "./hooks/useNetTableEvents";
import { useUnitsFull } from "./hooks/useUnitsFull";
import "./styles/app.css";

export default function App() {
  const { unitsFull } = useUnitsFull();
  const netTable = useNetTableEvents();
  const tracker = useTrackerEvents();

  useEffect(() => {
    capture("app_opened");
  }, []);

  useEffect(() => initErrorReporting(), []);

  const identifiedRef = useRef<string | null>(null);
  const steamId = tracker.status?.steam_id;
  const steamName = tracker.status?.steam_name;
  useEffect(() => {
    if (!steamId) {
      if (identifiedRef.current !== null) {
        identifiedRef.current = null;
        reset();
      }
      return;
    }
    if (identifiedRef.current === steamId) return;
    identifiedRef.current = steamId;
    const nameProps = steamName
      ? { $name: steamName, steam_name: steamName }
      : {};
    void window.appApi
      .getVersion()
      .then((app_version) =>
        identify(steamId, { steam_id: steamId, ...nameProps, app_version }),
      )
      .catch(() => identify(steamId, { steam_id: steamId, ...nameProps }));
  }, [steamId, steamName]);

  const showLoginScreen = !tracker.status?.logged_in;

  return (
    <>
      <TitleBar />
      {showLoginScreen ? (
        <LoginScreen
          status={tracker.status}
          authError={tracker.authError}
          onClearAuthError={tracker.clearAuthError}
        />
      ) : (
        <>
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            <TrackerHome
              unitsFull={unitsFull}
              netTable={netTable}
              status={tracker.status}
            />
          </div>
          <StatusBar status={tracker.status} />
          <FeedbackSurveyButton status={tracker.status} />
        </>
      )}
    </>
  );
}
