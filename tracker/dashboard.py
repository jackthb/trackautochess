"""Recent Games dashboard window (tkinter)."""

import threading
import tkinter as tk
from tkinter import ttk

_instance_lock = threading.Lock()
_instance: "DashboardWindow | None" = None


class DashboardWindow:
    """Singleton tkinter window showing recent games."""

    def __init__(self, steam_id: str, steam_name: str, games_csv):
        self.steam_id = steam_id
        self.steam_name = steam_name
        self.games_csv = games_csv  # Path to local CSV fallback

        self.root = tk.Tk()
        self.root.title("DAC Tracker — Recent Games")
        self.root.geometry("720x480")
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._build_ui()
        self._refresh()

    def _build_ui(self):
        # Header frame
        header = tk.Frame(self.root)
        header.pack(fill=tk.X, padx=8, pady=(8, 4))

        label_text = self.steam_name or self.steam_id or "Local Games"
        tk.Label(header, text=label_text, font=("", 12, "bold")).pack(side=tk.LEFT)

        ttk.Button(header, text="Refresh", command=self._refresh).pack(side=tk.RIGHT)

        # Treeview
        cols = ("num", "placement", "rank", "lineup", "date")
        self.tree = ttk.Treeview(self.root, columns=cols, show="headings", height=18)
        self.tree.heading("num", text="#")
        self.tree.heading("placement", text="Rank")
        self.tree.heading("rank", text="Tier")
        self.tree.heading("lineup", text="Lineup")
        self.tree.heading("date", text="Date")

        self.tree.column("num", width=30, stretch=False)
        self.tree.column("placement", width=50, stretch=False)
        self.tree.column("rank", width=80, stretch=False)
        self.tree.column("lineup", width=360)
        self.tree.column("date", width=140, stretch=False)

        self.tree.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        # Scrollbar
        scrollbar = ttk.Scrollbar(self.root, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.place(relx=1.0, rely=0, relheight=1.0, anchor=tk.NE)

        # Status bar
        self.status_var = tk.StringVar(value="Loading...")
        tk.Label(self.root, textvariable=self.status_var, anchor=tk.W).pack(
            fill=tk.X, padx=8, pady=(0, 8)
        )

    def _refresh(self):
        """Fetch games and populate the table."""
        # Clear existing rows
        for item in self.tree.get_children():
            self.tree.delete(item)
        self.status_var.set("Loading...")
        self.root.update_idletasks()

        games = self._fetch_data()

        for i, g in enumerate(games, 1):
            placement = g.get("placement", "")
            rank = g.get("rank", "")
            lineup = g.get("lineup", "").replace("|", ", ")
            date = g.get("date", g.get("created_at", ""))
            self.tree.insert("", tk.END, values=(i, placement, rank, lineup, date))

        self.status_var.set(f"{len(games)} game(s)")

    def _fetch_data(self) -> list[dict]:
        """Try Supabase first, fall back to local CSV."""
        if self.steam_id:
            try:
                from db import fetch_games
                games = fetch_games(self.steam_id)
                if games is not None:
                    return games
            except Exception as e:
                print(f"[dashboard] Supabase fetch failed: {e}")

        # Fallback: local CSV
        return self._read_local_csv()

    def _read_local_csv(self) -> list[dict]:
        from pathlib import Path
        from csv_writer import read_all
        path = Path(self.games_csv) if self.games_csv else None
        if path and path.exists():
            rows = read_all(path)
            # Return as dicts, newest first
            from dataclasses import asdict
            return [asdict(r) for r in reversed(rows)]
        return []

    def _on_close(self):
        global _instance
        with _instance_lock:
            _instance = None
        self.root.destroy()

    def _run(self):
        self.root.mainloop()

    @classmethod
    def show(cls, steam_id: str = "", steam_name: str = "", games_csv=None):
        """Open the dashboard (singleton). Runs in a daemon thread."""
        global _instance
        with _instance_lock:
            if _instance is not None:
                # Re-focus existing window
                try:
                    _instance.root.lift()
                    _instance.root.focus_force()
                    return
                except tk.TclError:
                    _instance = None

            def _run_window():
                global _instance
                win = cls(steam_id, steam_name, games_csv)
                with _instance_lock:
                    _instance = win
                win._run()

            t = threading.Thread(target=_run_window, daemon=True, name="dashboard")
            t.start()


if __name__ == "__main__":
    # Standalone test — show local CSV data
    from utils import GAMES_CSV
    DashboardWindow.show(games_csv=str(GAMES_CSV))
    # Keep main thread alive while tkinter runs
    import time
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
