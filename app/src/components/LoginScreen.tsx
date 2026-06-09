import { useEffect, useState } from "react";
import type { TrackerStatus } from "../types";

interface LoginScreenProps {
  status: TrackerStatus | null;
  authError: string | null;
  onClearAuthError: () => void;
}

export function LoginScreen({ status, authError, onClearAuthError }: LoginScreenProps) {
  const [version, setVersion] = useState("—");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    window.appApi.getVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (status?.logged_in) {
      setLoggingIn(false);
    }
  }, [status?.logged_in]);

  useEffect(() => {
    if (authError) {
      setLoggingIn(false);
    }
  }, [authError]);

  const backendReady = status !== null;

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-eyebrow">Track Auto Chess</div>
        <h1 className="login-title">Login with Steam</h1>
        <p className="login-copy">
          {backendReady
            ? "Sign in to load your match history, replays, and synced profile data."
            : "Connecting to the tracker backend..."}
        </p>
        <button
          className={`login-button${loggingIn ? " btn-loading" : ""}`}
          disabled={!backendReady || loggingIn}
          onClick={() => {
            onClearAuthError();
            setLoggingIn(true);
            window.tracker.sendCommand({ cmd: "steam_login" });
          }}
        >
          {backendReady ? (loggingIn ? "Logging in" : "Continue with Steam") : "Connecting"}
        </button>
        {authError && <div className="login-error">{authError}</div>}
        <div className="login-meta">
          <span>Version {version}</span>
          <span>{backendReady ? "Backend connected" : "Backend starting"}</span>
        </div>
      </div>
    </div>
  );
}
