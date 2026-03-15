"""Extract unit detections from all screenshots via GPU template matching.

Uses PyTorch conv2d on GPU for normalized cross-correlation — much faster
than OpenCV's CPU matchTemplate.

Usage:
    cd tracker && python extract_detections.py [--debug]
"""

import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from cv_parser import (
    UNIT_ICON_SCALES,
    UNIT_MATCH_THRESHOLD,
    ICON_INNER_FRAC,
    MM_COL_UNITS,
    MM_COL_SYNERGY,
    TABLE_Y_START,
    TABLE_Y_END,
    _load_icon,
    _find_my_matches_rows,
    detect_screen_type,
)
from utils import ICONS_DIR

DATA_DIR = Path(__file__).parent.parent.parent / "data"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
OUTPUT_PATH = DATA_DIR / "detections.json"

# Wide region for my_matches: from units column start to synergy column end
MM_WIDE_X0 = MM_COL_UNITS[0]      # 0.480
MM_WIDE_X1 = MM_COL_SYNERGY[1]    # 0.692

# Median icon size used as bbox estimate
MEDIAN_ICON_SIZE = UNIT_ICON_SCALES[len(UNIT_ICON_SCALES) // 2]

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _load_gpu_templates(
    icons_dir: Path,
    scales: list[int],
    inner_frac: float = ICON_INNER_FRAC,
) -> dict[str, list[tuple[torch.Tensor, int, int]]]:
    """Load icon templates as GPU tensors at multiple scales.

    Returns {name: [(tensor_CHW, h, w), ...]}.
    """
    templates = {}
    for f in sorted(icons_dir.iterdir()):
        if f.suffix.lower() != ".png":
            continue
        img = _load_icon(f, inner_frac=inner_frac, color=False)
        if img is None:
            continue
        oh, ow = img.shape[:2]
        aspect = ow / oh
        resized = []
        for s in scales:
            tw = max(int(s * aspect), 1)
            tmpl = cv2.resize(img, (tw, s), interpolation=cv2.INTER_AREA)
            t = torch.from_numpy(tmpl.astype(np.float32)).to(DEVICE)
            resized.append((t, s, tw))
        templates[f.stem] = resized
    return templates


def _ncc_match(region_t: torch.Tensor, tmpl_t: torch.Tensor) -> torch.Tensor:
    """Normalized cross-correlation using conv2d on GPU.

    region_t: (H, W) float32 on device
    tmpl_t: (h, w) float32 on device
    Returns: (H-h+1, W-w+1) correlation map, values in [-1, 1].
    """
    th, tw = tmpl_t.shape
    # Normalize template
    tmpl_mean = tmpl_t.mean()
    tmpl_std = tmpl_t.std()
    if tmpl_std < 1e-6:
        return torch.zeros(region_t.shape[0] - th + 1, region_t.shape[1] - tw + 1, device=region_t.device)
    tmpl_norm = (tmpl_t - tmpl_mean) / tmpl_std

    # Compute local mean and std of region using conv2d
    ones_kernel = torch.ones(1, 1, th, tw, device=region_t.device)
    region_4d = region_t.unsqueeze(0).unsqueeze(0)  # (1, 1, H, W)
    n = th * tw

    local_sum = F.conv2d(region_4d, ones_kernel).squeeze()
    local_sum_sq = F.conv2d(region_4d ** 2, ones_kernel).squeeze()
    local_mean = local_sum / n
    local_var = local_sum_sq / n - local_mean ** 2
    local_std = torch.sqrt(torch.clamp(local_var, min=1e-6))

    # Cross-correlation with normalized template
    tmpl_kernel = tmpl_norm.unsqueeze(0).unsqueeze(0)  # (1, 1, h, w)
    cross = F.conv2d(region_4d, tmpl_kernel).squeeze()

    # NCC = cross / (n * local_std)
    ncc = cross / (n * local_std)
    return ncc


def _match_region_gpu(
    region_gray: np.ndarray,
    templates: dict[str, list[tuple[torch.Tensor, int, int]]],
    threshold: float = 0.80,
    min_gap: int = 25,
) -> list[tuple[str, float, int, int]]:
    """GPU-accelerated multi-scale template matching on a grayscale region.

    Returns [(name, score, x, y), ...] sorted by x.
    """
    region_t = torch.from_numpy(region_gray.astype(np.float32)).to(DEVICE)
    rh, rw = region_gray.shape[:2]

    matches = []
    for name, tmpls in templates.items():
        for tmpl_t, th, tw in tmpls:
            if rh < th or rw < tw:
                continue
            result = _ncc_match(region_t, tmpl_t)
            locs = torch.where(result >= threshold)
            if locs[0].numel() == 0:
                continue
            scores = result[locs].cpu().numpy()
            ys = locs[0].cpu().numpy()
            xs = locs[1].cpu().numpy()
            for s, y, x in zip(scores, ys, xs):
                matches.append((name, float(s), int(x), int(y)))

    # De-duplicate: keep highest score per location
    matches.sort(key=lambda m: -m[1])
    kept = []
    used = []
    for name, score, x, y in matches:
        if not any(abs(x - ux) < min_gap and abs(y - uy) < min_gap for ux, uy in used):
            kept.append((name, score, x, y))
            used.append((x, y))

    kept.sort(key=lambda m: m[2])
    return kept


def extract_from_screenshot(
    filepath: Path,
    templates: dict,
    debug: bool = False,
) -> dict | None:
    """Extract detections from a single screenshot using GPU matching."""
    img = cv2.imread(str(filepath))
    if img is None:
        print(f"  SKIP: cannot read {filepath.name}")
        return None

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    screen_type = detect_screen_type(img)
    if debug:
        print(f"  {filepath.name}: {w}x{h}, type={screen_type}")

    detections = []
    det_id = 0

    if screen_type == "my_matches":
        rows = _find_my_matches_rows(img, debug=debug)
        for row_idx, (y0, y1) in enumerate(rows):
            px0 = int(w * MM_WIDE_X0)
            py0 = int(h * y0)
            px1 = int(w * MM_WIDE_X1)
            py1 = int(h * y1)
            region = gray[py0:py1, px0:px1]

            matches = _match_region_gpu(region, templates)
            for name, score, rx, ry in matches:
                detections.append({
                    "id": det_id,
                    "predicted": name,
                    "score": round(score, 4),
                    "x": px0 + rx, "y": py0 + ry,
                    "w": MEDIAN_ICON_SIZE, "h": MEDIAN_ICON_SIZE,
                    "reviewed": None, "corrected": None,
                })
                det_id += 1
    elif screen_type == "game_over":
        px0 = 0
        px1 = w
        py0 = int(h * TABLE_Y_START)
        py1 = int(h * TABLE_Y_END)
        region = gray[py0:py1, px0:px1]

        matches = _match_region_gpu(region, templates)
        for name, score, rx, ry in matches:
            detections.append({
                "id": det_id,
                "predicted": name,
                "score": round(score, 4),
                "x": px0 + rx, "y": py0 + ry,
                "w": MEDIAN_ICON_SIZE, "h": MEDIAN_ICON_SIZE,
                "reviewed": None, "corrected": None,
            })
            det_id += 1
    else:
        if debug:
            print(f"  SKIP: unsupported screen type '{screen_type}'")
        return None

    if not detections:
        if debug:
            print(f"  No detections in {filepath.name}")
        return None

    return {
        "file": filepath.name,
        "width": w, "height": h,
        "screen_type": screen_type,
        "detections": detections,
    }


def main():
    debug = "--debug" in sys.argv

    screenshots = sorted(SCREENSHOTS_DIR.glob("*.jpg"))
    if not screenshots:
        print(f"No screenshots found in {SCREENSHOTS_DIR}")
        sys.exit(1)
    print(f"Found {len(screenshots)} screenshots")
    print(f"Device: {DEVICE}")

    units_dir = ICONS_DIR / "units"
    print(f"Loading GPU templates from {units_dir}...")
    templates = _load_gpu_templates(units_dir, UNIT_ICON_SCALES, inner_frac=0.85)
    print(f"Loaded {len(templates)} unit templates at scales {UNIT_ICON_SCALES}")

    classes = sorted(templates.keys())

    results = []
    total_detections = 0
    t0 = time.time()
    for i, filepath in enumerate(screenshots):
        t1 = time.time()
        print(f"[{i+1}/{len(screenshots)}] {filepath.name}...", end=" ", flush=True)
        entry = extract_from_screenshot(filepath, templates, debug=debug)
        if entry:
            for det in entry["detections"]:
                det["id"] = total_detections
                total_detections += 1
            results.append(entry)
            print(f"{len(entry['detections'])} detections ({time.time()-t1:.1f}s)")
        else:
            print(f"skipped ({time.time()-t1:.1f}s)")

    # Auto-approve high-confidence detections
    AUTO_APPROVE_THRESHOLD = 0.82
    auto_approved = 0
    for entry in results:
        for det in entry["detections"]:
            if det["score"] >= AUTO_APPROVE_THRESHOLD:
                det["reviewed"] = True
                auto_approved += 1

    output = {
        "classes": classes,
        "screenshots": results,
    }

    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    elapsed = time.time() - t0
    needs_review = total_detections - auto_approved
    print(f"\nWrote {total_detections} detections across {len(results)} screenshots to {OUTPUT_PATH}")
    print(f"Auto-approved: {auto_approved} (score >= {AUTO_APPROVE_THRESHOLD})")
    print(f"Needs review: {needs_review}")
    print(f"Total time: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
