#!/usr/bin/env bash
set -euo pipefail

# Shortcut for invoking the native Windows verifier from WSL without exposing
# Windows tools to a \\wsl.localhost UNC checkout. The current working tree is
# exported to a normal C:\ path, then PowerShell runs the verifier from there.

repo_root="$(git rev-parse --show-toplevel)"
win_temp_unix="/mnt/c/Users/jackc/AppData/Local/Temp/track-auto-chess-win-verify"
win_temp_ps="C:\\Users\\jackc\\AppData\\Local\\Temp\\track-auto-chess-win-verify"
win_output_unix="/mnt/c/Users/jackc/Desktop/Track Auto Chess win-unpacked"
win_output_ps="C:\\Users\\jackc\\Desktop\\Track Auto Chess win-unpacked"

echo "Exporting working tree to ${win_temp_ps}..."
rm -rf "${win_temp_unix}"
mkdir -p "${win_temp_unix}"
git -C "${repo_root}" ls-files -z --cached --others --exclude-standard \
  | tar -C "${repo_root}" --null -T - -cf - \
  | tar -x -C "${win_temp_unix}"

echo "Running Windows verifier..."
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "${win_temp_ps}\\scripts\\verify-desktop-windows.ps1" \
  "$@"

echo "Copying Windows app output to ${win_output_ps}..."
rm -rf "${win_output_unix}"
mkdir -p "$(dirname "${win_output_unix}")"
cp -a "${win_temp_unix}/app/release/win-unpacked" "${win_output_unix}"
echo "Windows app executable: ${win_output_ps}\\Track Auto Chess.exe"
