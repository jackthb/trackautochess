import { useState, useCallback, useRef, useEffect } from "react";
import { capture, identify, reset } from "./lib/posthog";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
// PARKED (single-view simplification): tabs below are intentionally not
// rendered. Imports kept so the parked JSX still type-checks if revived.
// To restore: uncomment the corresponding tab in TabBar.tsx, then uncomment
// the matching JSX block + state below.
import { HistoryTab } from "./components/HistoryTab";
import { ReplaysTab } from "./components/ReplaysTab";
// REMOVED: ConfirmationTab and LabTab — source files deleted.
// import { ConfirmationTab } from "./components/ConfirmationTab";
// import { LabTab } from "./components/LabTab";
import { SettingsTab } from "./components/SettingsTab";
import { LogTab } from "./components/LogTab";
import { LoginScreen } from "./components/LoginScreen";
// REMOVED: UploadShell — screenshot upload flow removed.
// import { UploadShell } from "./components/UploadShell";
import { NetTableHome } from "./components/NetTableHome";
import { GlobalSearch } from "./components/GlobalSearch";
import { FeedbackSurveyButton } from "./components/FeedbackSurveyButton";
import { useTrackerEvents } from "./hooks/useTrackerEvents";
import { useNetTableEvents } from "./hooks/useNetTableEvents";
import { useGames } from "./hooks/useGames";
import { useDrodo } from "./hooks/useDrodo";
import { useReplays } from "./hooks/useReplays";
import "./styles/app.css";

type TabId =
  | "home"
  // PARKED tabs — kept in the union so reviving them stays a one-line uncomment.
  | "history"
  | "replays"
  | "settings"
  | "log";

// PARKED: admin/"preview as user" toggle. Single-view simplification — the
// app now renders the same flow for everyone (including admins). Restore by
// uncommenting ADMIN_PREVIEW_KEY, the adminPreviewAsUser state + effect, the
// isAdmin/isUserView lines, and the related props on TabBar/NetTableHome/UploadShell.
// const ADMIN_PREVIEW_KEY = "dac.adminPreviewAsUser";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  // History tab is back. ReplaysTab is still parked — its focus handoff
  // (jump from a replay row to that game in History) is parked alongside it.
  // const [focusGameId, setFocusGameId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // PARKED: admin preview toggle.
  // const [adminPreviewAsUser, setAdminPreviewAsUser] = useState<boolean>(() => {
  //   const saved = localStorage.getItem(ADMIN_PREVIEW_KEY);
  //   return saved === null ? true : saved === "true";
  // });
  //
  // useEffect(() => {
  //   localStorage.setItem(ADMIN_PREVIEW_KEY, String(adminPreviewAsUser));
  // }, [adminPreviewAsUser]);

  // gamesState/drodoState/replaysState are still wired so useTrackerEvents
  // can call replaysState.refresh on incoming events and gamesState.refresh
  // on imports. Cheap to keep; reviving the parked tabs needs no rewiring.
  const gamesState = useGames();
  const drodoState = useDrodo();
  const replaysState = useReplays();
  // Hoisted out of NetTableHome so the subscription + state survive when the
  // user leaves the home tab and comes back — otherwise the grid layout
  // flickers between setup-incomplete and setup-complete on every return.
  const netTable = useNetTableEvents();

  const handleImportResult = useCallback(() => {
    gamesState.refresh();
  }, [gamesState.refresh]);

  const tracker = useTrackerEvents(handleImportResult, replaysState.refresh);

  // Telemetry: initialise PostHog once on mount and record app open. No-ops
  // cleanly when no token is configured (see src/lib/posthog.ts).
  useEffect(() => {
    capture("app_opened");
  }, []);

  // Identify the user once steam_id is known so events are filterable
  // per-friend. distinct_id MUST be the steam_id. Re-runs only when the
  // identity actually changes, not on every status tick.
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
    // Mirror the web viewer's person shape (web/pages/_app.tsx): `$name` is the
    // Persons-list label, `steam_id` the stable distinct_id — so the same human
    // is one PostHog person across web + app.
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
  // PARKED: admin / preview-as-user gating.
  // const isAdmin = tracker.status?.admin_mode === true;
  const showLoginScreen = !tracker.status?.logged_in;
  // const isUserView = Boolean(
  //   tracker.status?.logged_in && (!isAdmin || adminPreviewAsUser)
  // );

  // REMOVED: ConfirmationTab auto-switch logic (source file deleted).

  useEffect(() => {
    if (showLoginScreen) {
      setSearchOpen(false);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showLoginScreen]);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
    capture("tab_viewed", { tab });
  }, []);

  // PARKED with ReplaysTab — jumped from a replay row to that game in History.
  // const handleViewGame = useCallback((gameId: number) => {
  //   setFocusGameId(gameId);
  //   setActiveTab("history");
  // }, []);

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
          <TabBar
            active={activeTab}
            onChange={handleTabChange}
            showConfirmBadge={false}
            userName={steamName ?? undefined}
          />
          <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
            {activeTab === "home" && (
              <NetTableHome
                unitsFull={gamesState.unitsFull}
                synergiesData={gamesState.synergiesData}
                relicsData={gamesState.relicsData}
                itemsFull={gamesState.itemsFull}
                netTable={netTable}
              />
            )}
            {activeTab === "history" && (
              <HistoryTab
                {...gamesState}
                drodo={drodoState.drodo}
                drodoLoading={drodoState.loading}
                refreshDrodo={drodoState.refresh}
                focusGameId={null}
                onFocusHandled={() => {}}
              />
            )}
            {/* PARKED — single-view simplification. Restore alongside the
                matching tab entry in TabBar.tsx. */}
            {/*
            {activeTab === "replays" && (
              <ReplaysTab
                {...replaysState}
                recording={tracker.status?.recording ?? false}
                recordingStats={tracker.status?.recording_stats ?? null}
                games={gamesState.games}
                updateGame={gamesState.updateGame}
                onViewGame={handleViewGame}
              />
            )}
            */}
            {activeTab === "settings" && (
              <SettingsTab status={tracker.status} />
            )}
            {activeTab === "log" && <LogTab />}
          </div>
          <StatusBar status={tracker.status} />
          <GlobalSearch
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            unitsFull={gamesState.unitsFull}
            unitCosts={gamesState.unitCosts}
            synergiesData={gamesState.synergiesData}
            relicsData={gamesState.relicsData}
            itemsData={gamesState.itemsData}
            talentsData={gamesState.talentsData}
          />
          <FeedbackSurveyButton status={tracker.status} />
        </>
      )}
    </>
  );
}
