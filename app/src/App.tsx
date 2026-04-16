import { useState, useCallback, useRef, useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { HistoryTab } from "./components/HistoryTab";
import { ReplaysTab } from "./components/ReplaysTab";
import { ConfirmationTab } from "./components/ConfirmationTab";
import { SettingsTab } from "./components/SettingsTab";
import { LogTab } from "./components/LogTab";
import { useTrackerEvents } from "./hooks/useTrackerEvents";
import { useGames } from "./hooks/useGames";
import { useDrodo } from "./hooks/useDrodo";
import { useReplays } from "./hooks/useReplays";
import "./styles/app.css";

type TabId = "history" | "replays" | "confirm" | "settings" | "log";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("history");
  const [focusGameId, setFocusGameId] = useState<number | null>(null);

  const gamesState = useGames();
  const drodoState = useDrodo();
  const replaysState = useReplays();

  const handleImportResult = useCallback(() => {
    gamesState.refresh();
  }, [gamesState.refresh]);

  const tracker = useTrackerEvents(handleImportResult, replaysState.refresh);

  const hasParseResult = tracker.pendingParseResult !== null;
  const prevHasResult = useRef(false);

  useEffect(() => {
    if (hasParseResult && !prevHasResult.current) {
      setActiveTab("confirm");
    }
    prevHasResult.current = hasParseResult;
  }, [hasParseResult]);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
  }, []);

  const handleViewGame = useCallback((gameId: number) => {
    setFocusGameId(gameId);
    setActiveTab("history");
  }, []);

  return (
    <>
      <TitleBar />
      <TabBar
        active={activeTab}
        onChange={handleTabChange}
        showConfirmBadge={hasParseResult}
      />
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activeTab === "history" && (
          <HistoryTab
            {...gamesState}
            drodo={drodoState.drodo}
            drodoLoading={drodoState.loading}
            refreshDrodo={drodoState.refresh}
            focusGameId={focusGameId}
            onFocusHandled={() => setFocusGameId(null)}
          />
        )}
        {activeTab === "replays" && (
          <ReplaysTab
            {...replaysState}
            recording={tracker.status?.recording ?? false}
            recordingStats={tracker.status?.recording_stats ?? null}
            games={gamesState.games}
            onViewGame={handleViewGame}
          />
        )}
        {activeTab === "confirm" && (
          <ConfirmationTab
            parseResult={tracker.pendingParseResult}
            onClear={tracker.clearParseResult}
            lastImportResult={tracker.lastImportResult}
            onClearImportResult={tracker.clearImportResult}
            unitCosts={gamesState.unitCosts}
            unitsFull={gamesState.unitsFull}
            synergiesData={gamesState.synergiesData}
            relicsData={gamesState.relicsData}
            importing={tracker.importing}
            onBeginImport={tracker.beginImport}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            status={tracker.status}
            replayStats={replaysState.stats}
          />
        )}
        {activeTab === "log" && <LogTab entries={tracker.logEntries} />}
      </div>
      <StatusBar status={tracker.status} />
    </>
  );
}
