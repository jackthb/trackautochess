#!/usr/bin/env bash
set -euo pipefail

# Shortcut for invoking the native Windows verifier from WSL without exposing
# Windows tools to a \\wsl.localhost UNC checkout. The current working tree is
# exported to a normal C:\ path, then PowerShell runs the verifier from there.

repo_root="$(git rev-parse --show-toplevel)"
# Use a fresh directory for every run, including the output, so verification
# never removes an existing build or depends on a particular Windows user.
windows_temp="$(powershell.exe -NoProfile -Command '[System.IO.Path]::GetTempPath()' | tr -d '\r\n')"
win_temp_unix="$(mktemp -d "$(wslpath -u "$windows_temp")/track-auto-chess-win-verify.XXXXXX")"
win_temp_ps="$(wslpath -w "$win_temp_unix")"

echo "Exporting working tree to ${win_temp_ps}..."
git -C "${repo_root}" ls-files -z --cached --others --exclude-standard \
  | tar -C "${repo_root}" --null -T - -cf - \
  | tar -x -C "${win_temp_unix}"

echo "Running Windows verifier..."
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "${win_temp_ps}\\scripts\\verify-desktop-windows.ps1" \
  "$@"

echo "Windows app executable: ${win_temp_ps}\\app\\release\\win-unpacked\\Track Auto Chess.exe"
echo "Verification export retained at ${win_temp_ps}; remove it when no longer needed."
