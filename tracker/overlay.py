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

# Match History icon position (fractional screen coords from sentinel picker)
ICON_X = 0.087  # center of icon horizontally
ICON_Y = 0.027  # center of icon vertically

# Transparent key color — Windows will punch through this color
TRANSPARENT_KEY = "#f0f0f0"


class GameEndOverlay:
    """Topmost overlay window shown after game end detection."""

    def __init__(self, on_capture, on_dismiss=None, won=False):
        """
        Args:
            on_capture: Called (no args) when user clicks Capture.
            on_dismiss: Called (no args) when overlay is dismissed without capture.
            won: True if the player won (shows "GG!" instead of "Game Over!").
        """
        self._on_capture = on_capture
        self._on_dismiss = on_dismiss
        self._won = won
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
        root.configure(bg=TRANSPARENT_KEY)

        screen_w = root.winfo_screenwidth()
        screen_h = root.winfo_screenheight()

        # Position overlay just right of the Match History icon
        icon_px = int(ICON_X * screen_w)
        icon_py = int(ICON_Y * screen_h)
        arrow_w = 30  # width reserved for the arrow
        panel_w = 280
        panel_h = 120
        w = arrow_w + panel_w
        h = panel_h
        x = icon_px + 20  # offset right of icon center
        y = max(0, icon_py - h // 2)  # vertically centered on icon
        root.geometry(f"{w}x{h}+{x}+{y}")

        # Transparent key color — Windows punches through this
        try:
            root.wm_attributes("-transparentcolor", TRANSPARENT_KEY)
        except Exception:
            pass

        # Semi-transparent on Windows
        try:
            root.attributes("-alpha", 0.95)
        except Exception:
            pass

        # Arrow canvas — background is transparent key, only polygon is opaque
        arrow_y = int(h * 0.25)
        arrow_canvas = tk.Canvas(
            root, width=w, height=h, bg=TRANSPARENT_KEY,
            highlightthickness=0, bd=0,
        )
        arrow_canvas.place(x=0, y=0)
        arrow_canvas.create_polygon(
            0, arrow_y,              # tip (pointing left)
            arrow_w, arrow_y - 14,   # top-right
            arrow_w, arrow_y + 14,   # bottom-right
            fill="#4a6fa5", outline="",
        )

        # Content panel
        frame = tk.Frame(
            root, bg="#0e1014", padx=10, pady=8,
            highlightbackground="#1e2230", highlightthickness=1,
        )
        frame.place(x=arrow_w, y=0, width=panel_w, height=h)

        title_text = "GG!" if self._won else "Game Over!"
        title_fg = "#4eaa62" if self._won else "#c8ccd8"
        title = tk.Label(
            frame, text=title_text, font=("Consolas", 14, "bold"),
            fg=title_fg, bg="#0e1014",
        )
        title.pack(anchor=tk.W)

        subtitle = tk.Label(
            frame, text="Click Match History, then Capture.",
            font=("Consolas", 10), fg="#6b7080", bg="#0e1014",
            wraplength=250, justify=tk.LEFT,
        )
        subtitle.pack(anchor=tk.W, pady=(2, 8))

        btn_frame = tk.Frame(frame, bg="#0e1014")
        btn_frame.pack(fill=tk.X)

        btn_w = 12  # character width — same for both
        capture_btn = tk.Button(
            btn_frame, text="Capture",
            font=("Consolas", 10, "bold"), width=btn_w,
            bg="#4a6fa5", fg="white", activebackground="#5a8fd5",
            relief=tk.FLAT, pady=4,
            command=self._on_capture_click,
        )
        capture_btn.pack(side=tk.LEFT)

        dismiss_btn = tk.Button(
            btn_frame, text="Dismiss",
            font=("Consolas", 10), width=btn_w,
            bg="#14161c", fg="#3a3f50", activebackground="#1a1d26",
            relief=tk.FLAT, pady=4,
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
