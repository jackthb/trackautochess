$ErrorActionPreference = "SilentlyContinue"

if (-not ("DotaFind" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class DotaFind {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc cb, IntPtr lp);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int L;
    public int T;
    public int R;
    public int B;
  }

  public static string Find() {
    var pids = new HashSet<uint>();
    foreach (var p in Process.GetProcessesByName("dota2")) {
      try { pids.Add((uint)p.Id); } catch {}
    }
    if (pids.Count == 0) return "";

    // Only report bounds when Dota is the window the user is actively looking at.
    // Otherwise the overlay would hover over the desktop/browser after alt-tabbing.
    uint fgPid;
    GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    if (!pids.Contains(fgPid)) return "";

    IntPtr best = IntPtr.Zero;
    int bestArea = 0;
    RECT bestR = new RECT();

    EnumWindows((h, lp) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;

      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      int w = r.R - r.L;
      int hgt = r.B - r.T;
      if (w < 400 || hgt < 300) return true;
      int area = w * hgt;
      if (area > bestArea) {
        bestArea = area;
        best = h;
        bestR = r;
      }
      return true;
    }, IntPtr.Zero);

    if (best == IntPtr.Zero) return "";
    return string.Format(
      "{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3}}}",
      bestR.L, bestR.T, bestR.R - bestR.L, bestR.B - bestR.T
    );
  }
}
"@
}

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $cmd = $line.Trim().ToUpperInvariant()
  if ($cmd -eq "EXIT") { break }
  if ($cmd -ne "FIND") { continue }

  $result = [DotaFind]::Find()
  if ([string]::IsNullOrWhiteSpace($result)) {
    [Console]::Out.WriteLine("NONE")
  } else {
    [Console]::Out.WriteLine($result)
  }
  [Console]::Out.Flush()
}
