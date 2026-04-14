"""Post-parse confirmation UI — review and correct parsed rows before pushing to DB.

Shows a tkinter modal with:
- Screenshot preview at top
- Editable table of parsed rows
- Per-row checkboxes to include/exclude
- Confirm / Cancel buttons

Usage:
    from confirm_ui import show_confirmation
    confirmed = show_confirmation(img, rows, timestamps)
    if confirmed is None:  # user cancelled
        return
    for row_data, played_at in confirmed:
        push_game(...)
"""

import logging
import threading
import tkinter as tk
from tkinter import ttk

import cv2
import numpy as np
from PIL import Image, ImageTk

log = logging.getLogger("dac")

# ── Theme ────────────────────────────────────────────────────────────────────
BG = "#1a1a2e"
BG_ALT = "#16213e"
ACCENT = "#E0402A"
FONT = "Segoe UI"
FG = "#e0e0e0"
FG_DIM = "#888888"
FG_ERR = "#e94560"
BTN_CONFIRM_BG = "#2d6a4f"
BTN_CANCEL_BG = "#333333"


def show_confirmation(img: np.ndarray, rows: list[dict], timestamps: list[str]):
    """Show confirmation modal. Returns list of (row_dict, timestamp) or None if cancelled.

    Blocks the calling thread until the user confirms or cancels.
    Must be called from a non-main thread (tkinter runs its own mainloop).
    """
    result = [None]  # mutable container for thread communication

    def _run():
        result[0] = _build_and_run(img, rows, timestamps)

    thread = threading.Thread(target=_run, daemon=True, name="confirm-ui")
    thread.start()
    thread.join()
    return result[0]


def _build_and_run(img: np.ndarray, rows: list[dict], timestamps: list[str]):
    """Build the tkinter window and run mainloop. Returns confirmed rows or None."""
    root = tk.Tk()
    root.title("DAC Tracker — Confirm Parsed Matches")
    root.configure(bg=BG)
    root.attributes("-topmost", True)

    # Size and center
    win_w, win_h = 1100, 700
    screen_w = root.winfo_screenwidth()
    screen_h = root.winfo_screenheight()
    x = (screen_w - win_w) // 2
    y = (screen_h - win_h) // 2
    root.geometry(f"{win_w}x{win_h}+{x}+{y}")
    root.minsize(800, 500)

    try:
        root.attributes("-alpha", 0.96)
    except Exception:
        pass

    result = [None]

    # ── Screenshot preview ───────────────────────────────────────────────────
    preview_frame = tk.Frame(root, bg=BG)
    preview_frame.pack(fill=tk.X, padx=12, pady=(12, 4))

    # Convert BGR→RGB, resize for preview
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h_img, w_img = rgb.shape[:2]
    preview_h = 180
    scale = preview_h / h_img
    preview_w = int(w_img * scale)
    pil_img = Image.fromarray(rgb).resize((preview_w, preview_h), Image.LANCZOS)
    tk_img = ImageTk.PhotoImage(pil_img, master=root)

    img_label = tk.Label(preview_frame, image=tk_img, bg=BG, bd=1, relief=tk.SOLID)
    img_label.image = tk_img  # prevent GC
    img_label.pack(side=tk.LEFT)

    info_frame = tk.Frame(preview_frame, bg=BG)
    info_frame.pack(side=tk.LEFT, padx=(12, 0), fill=tk.Y)
    tk.Label(info_frame, text=f"{len(rows)} rows parsed",
             font=(FONT, 14, "bold"), fg=FG, bg=BG).pack(anchor=tk.W)
    tk.Label(info_frame, text=f"Screenshot: {w_img}×{h_img}",
             font=(FONT, 10), fg=FG_DIM, bg=BG).pack(anchor=tk.W)
    tk.Label(info_frame, text="Edit fields below, uncheck rows to exclude, then Confirm.",
             font=(FONT, 10), fg=FG_DIM, bg=BG, wraplength=400, justify=tk.LEFT
             ).pack(anchor=tk.W, pady=(8, 0))

    # ── Scrollable table ─────────────────────────────────────────────────────
    table_outer = tk.Frame(root, bg=BG)
    table_outer.pack(fill=tk.BOTH, expand=True, padx=12, pady=4)

    canvas = tk.Canvas(table_outer, bg=BG, highlightthickness=0)
    scrollbar = tk.Scrollbar(table_outer, orient=tk.VERTICAL, command=canvas.yview)
    table_frame = tk.Frame(canvas, bg=BG)

    table_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.create_window((0, 0), window=table_frame, anchor=tk.NW)
    canvas.configure(yscrollcommand=scrollbar.set)

    canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

    # Mouse wheel scrolling
    def _on_mousewheel(event):
        canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
    canvas.bind_all("<MouseWheel>", _on_mousewheel)

    # Header row
    headers = ["", "#", "Place", "Level", "W-L", "Rank", "Units", "Synergies", "Relic", "Time"]
    col_widths = [3, 3, 5, 5, 7, 10, 30, 25, 20, 10]
    for col_i, (hdr, w) in enumerate(zip(headers, col_widths)):
        tk.Label(table_frame, text=hdr, font=(FONT, 10, "bold"),
                 fg=ACCENT, bg="#0f3460", anchor=tk.W, padx=4, pady=4,
                 width=w).grid(row=0, column=col_i, sticky=tk.EW, padx=1)

    # Data rows — track tkinter variables for editable fields
    row_vars = []  # list of dicts with tk variables per row
    for i, (rd, ts) in enumerate(zip(rows, timestamps)):
        row_bg = BG if i % 2 == 0 else BG_ALT
        rv = {}

        # Checkbox
        rv["checked"] = tk.BooleanVar(value=True)
        cb = tk.Checkbutton(table_frame, variable=rv["checked"],
                            bg=row_bg, activebackground=row_bg,
                            selectcolor=BG, highlightthickness=0)
        cb.grid(row=i + 1, column=0, padx=1, sticky=tk.W)

        # Row number (label)
        tk.Label(table_frame, text=str(i + 1), font=(FONT, 10),
                 fg=FG_DIM, bg=row_bg, anchor=tk.W, padx=4
                 ).grid(row=i + 1, column=1, sticky=tk.EW, padx=1)

        # Editable: placement
        rv["placement"] = tk.StringVar(value=rd.get("placement", ""))
        e = tk.Entry(table_frame, textvariable=rv["placement"], width=5,
                     font=(FONT, 10), bg="#0a0a1e", fg=FG, insertbackground=FG,
                     relief=tk.FLAT, bd=2)
        e.grid(row=i + 1, column=2, sticky=tk.EW, padx=1, pady=1)

        # Editable: level
        rv["level"] = tk.StringVar(value=rd.get("level", ""))
        e = tk.Entry(table_frame, textvariable=rv["level"], width=5,
                     font=(FONT, 10), bg="#0a0a1e", fg=FG, insertbackground=FG,
                     relief=tk.FLAT, bd=2)
        e.grid(row=i + 1, column=3, sticky=tk.EW, padx=1, pady=1)

        # Editable: W-L
        rv["wl"] = tk.StringVar(value=rd.get("wl", ""))
        e = tk.Entry(table_frame, textvariable=rv["wl"], width=7,
                     font=(FONT, 10), bg="#0a0a1e", fg=FG, insertbackground=FG,
                     relief=tk.FLAT, bd=2)
        e.grid(row=i + 1, column=4, sticky=tk.EW, padx=1, pady=1)

        # Label: rank
        rank_text = rd.get("rank", "")
        rank_change = rd.get("rank_change", "none")
        if rank_change == "up":
            rank_display = f"{rank_text} (+)"
            rank_fg = "#4ade80"
        elif rank_change == "down":
            rank_display = f"{rank_text} (-)"
            rank_fg = FG_ERR
        else:
            rank_display = rank_text
            rank_fg = FG
        tk.Label(table_frame, text=rank_display, font=(FONT, 10),
                 fg=rank_fg, bg=row_bg, anchor=tk.W, padx=4
                 ).grid(row=i + 1, column=5, sticky=tk.EW, padx=1)

        # Editable: units (comma-separated display)
        units = rd.get("units", [])
        rv["units"] = tk.StringVar(value=", ".join(units))
        e = tk.Entry(table_frame, textvariable=rv["units"], width=30,
                     font=(FONT, 9), bg="#0a0a1e", fg=FG, insertbackground=FG,
                     relief=tk.FLAT, bd=2)
        e.grid(row=i + 1, column=6, sticky=tk.EW, padx=1, pady=1)

        # Label: synergies
        syn_text = rd.get("synergies", "")
        # Make it more readable
        syn_display = syn_text.replace("|", ", ").replace(":", " ") if syn_text else "-"
        tk.Label(table_frame, text=syn_display, font=(FONT, 9),
                 fg=FG_DIM, bg=row_bg, anchor=tk.W, padx=4, wraplength=200
                 ).grid(row=i + 1, column=7, sticky=tk.EW, padx=1)

        # Label: relic
        relic_text = rd.get("relic", "") or "-"
        # Truncate long relic lists
        if len(relic_text) > 30:
            relic_text = relic_text[:27] + "..."
        tk.Label(table_frame, text=relic_text, font=(FONT, 9),
                 fg=FG_DIM, bg=row_bg, anchor=tk.W, padx=4, wraplength=160
                 ).grid(row=i + 1, column=8, sticky=tk.EW, padx=1)

        # Label: time
        time_ago = rd.get("time_ago", "")
        tk.Label(table_frame, text=time_ago or "-", font=(FONT, 9),
                 fg=FG_DIM, bg=row_bg, anchor=tk.W, padx=4
                 ).grid(row=i + 1, column=9, sticky=tk.EW, padx=1)

        # Store original row data for fields we don't edit
        rv["_orig"] = rd
        rv["_timestamp"] = ts
        row_vars.append(rv)

    # Make unit column expand
    table_frame.columnconfigure(6, weight=1)

    # ── Buttons ──────────────────────────────────────────────────────────────
    btn_frame = tk.Frame(root, bg=BG)
    btn_frame.pack(fill=tk.X, padx=12, pady=(4, 12))

    def _on_confirm():
        confirmed = []
        for rv in row_vars:
            if not rv["checked"].get():
                continue
            rd = dict(rv["_orig"])  # copy original
            # Apply edits
            rd["placement"] = rv["placement"].get().strip()
            rd["level"] = rv["level"].get().strip()
            rd["wl"] = rv["wl"].get().strip()
            # Parse units back from comma-separated
            units_str = rv["units"].get().strip()
            if units_str:
                rd["units"] = [u.strip() for u in units_str.split(",") if u.strip()]
            else:
                rd["units"] = []
            confirmed.append((rd, rv["_timestamp"]))
        result[0] = confirmed
        root.destroy()

    def _on_cancel():
        result[0] = None
        root.destroy()

    cancel_btn = tk.Button(
        btn_frame, text="Cancel", font=(FONT, 11), width=12,
        bg=BTN_CANCEL_BG, fg="#aaa", activebackground="#555",
        relief=tk.FLAT, pady=6, command=_on_cancel,
    )
    cancel_btn.pack(side=tk.RIGHT, padx=(8, 0))

    checked_count = sum(1 for rv in row_vars if rv["checked"].get())
    confirm_text_var = tk.StringVar(value=f"Confirm ({checked_count})")

    confirm_btn = tk.Button(
        btn_frame, textvariable=confirm_text_var,
        font=(FONT, 11, "bold"), width=14,
        bg=BTN_CONFIRM_BG, fg="white", activebackground="#40916c",
        relief=tk.FLAT, pady=6, command=_on_confirm,
    )
    confirm_btn.pack(side=tk.RIGHT)

    # Update confirm button count when checkboxes change
    def _update_count(*_args):
        n = sum(1 for rv in row_vars if rv["checked"].get())
        confirm_text_var.set(f"Confirm ({n})")

    for rv in row_vars:
        rv["checked"].trace_add("write", _update_count)

    # Escape to cancel
    root.bind("<Escape>", lambda _: _on_cancel())
    # Enter to confirm
    root.bind("<Return>", lambda _: _on_confirm())

    root.mainloop()
    return result[0]
