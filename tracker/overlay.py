"""Game-end overlay — prompts user to open Match History for capture.

Shows a compact topmost window when the sentinel detects Final Ranking.
The user navigates to My Matches, then clicks "Capture" to screenshot,
parse, and push results to DB.

Requires: tkinter (stdlib on Windows Python).
"""

import logging
import threading
import tkinter as tk

log = logging.getLogger("dac")

# How long the overlay stays visible before auto-dismissing (seconds)
OVERLAY_TIMEOUT = 120


class GameEndOverlay:
    """Topmost overlay window shown after game end detection."""

    def __init__(self, on_capture, on_dismiss=None):
        """
        Args:
            on_capture: Called (no args) when user clicks Capture.
            on_dismiss: Called (no args) when overlay is dismissed without capture.
        """
        self._on_capture = on_capture
        self._on_dismiss = on_dismiss
        self._root = None
        self._thread = None
        self._alive = False

    def show(self):
        """Show the overlay (spawns a tkinter mainloop in a new thread)."""
        if self._alive:
            return
        self._alive = True
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="overlay",
        )
        self._thread.start()

    def dismiss(self):
        """Dismiss the overlay from any thread."""
        if self._root and self._alive:
            try:
                self._root.after(0, self._close)
            except Exception:
                pass

    def _run(self):
        try:
            self._build_window()
            self._root.mainloop()
        except Exception as e:
            log.error("Overlay error: %s", e)
        finally:
            self._alive = False

    def _build_window(self):
        root = tk.Tk()
        self._root = root

        root.title("DAC Tracker")
        root.attributes("-topmost", True)
        root.overrideredirect(True)  # no title bar
        root.configure(bg="#1a1a2e")

        # Size and position — bottom-right corner of primary monitor
        w, h = 320, 130
        screen_w = root.winfo_screenwidth()
        screen_h = root.winfo_screenheight()
        x = screen_w - w - 20
        y = screen_h - h - 60
        root.geometry(f"{w}x{h}+{x}+{y}")

        # Semi-transparent on Windows
        try:
            root.attributes("-alpha", 0.92)
        except Exception:
            pass

        # Content
        frame = tk.Frame(root, bg="#1a1a2e", padx=12, pady=8)
        frame.pack(fill=tk.BOTH, expand=True)

        title = tk.Label(
            frame, text="Game Ended!", font=("Segoe UI", 14, "bold"),
            fg="#e0e0e0", bg="#1a1a2e",
        )
        title.pack(anchor=tk.W)

        subtitle = tk.Label(
            frame, text="Open Match History, then click Capture.",
            font=("Segoe UI", 10), fg="#a0a0a0", bg="#1a1a2e",
            wraplength=290, justify=tk.LEFT,
        )
        subtitle.pack(anchor=tk.W, pady=(2, 8))

        btn_frame = tk.Frame(frame, bg="#1a1a2e")
        btn_frame.pack(fill=tk.X)

        capture_btn = tk.Button(
            btn_frame, text="Capture Match History",
            font=("Segoe UI", 11, "bold"),
            bg="#4a6fa5", fg="white", activebackground="#5a8fd5",
            relief=tk.FLAT, padx=16, pady=6,
            command=self._on_capture_click,
        )
        capture_btn.pack(side=tk.LEFT)

        dismiss_btn = tk.Button(
            btn_frame, text="Dismiss",
            font=("Segoe UI", 10),
            bg="#333", fg="#aaa", activebackground="#555",
            relief=tk.FLAT, padx=10, pady=6,
            command=self._on_dismiss_click,
        )
        dismiss_btn.pack(side=tk.RIGHT)

        # Auto-dismiss after timeout
        root.after(OVERLAY_TIMEOUT * 1000, self._on_timeout)

    def _on_capture_click(self):
        log.info("Overlay: user clicked Capture")
        self._close()
        # Fire callback in a separate thread so we don't block tkinter teardown
        threading.Thread(
            target=self._on_capture, daemon=True, name="overlay-capture",
        ).start()

    def _on_dismiss_click(self):
        log.info("Overlay: user dismissed")
        self._close()
        if self._on_dismiss:
            self._on_dismiss()

    def _on_timeout(self):
        if self._alive:
            log.info("Overlay: auto-dismissed after %ds", OVERLAY_TIMEOUT)
            self._close()
            if self._on_dismiss:
                self._on_dismiss()

    def _close(self):
        self._alive = False
        try:
            self._root.destroy()
        except Exception:
            pass
