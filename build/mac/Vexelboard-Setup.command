#!/usr/bin/env bash
set -euo pipefail

# Vexelboard macOS Setup Helper — Install, Update in place, or Uninstall from the same DMG.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_APP="$SCRIPT_DIR/Vexelboard.app"
APP_NAME="Vexelboard"
SYSTEM_APP="/Applications/${APP_NAME}.app"
USER_APP="$HOME/Applications/${APP_NAME}.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  osascript -e 'display dialog "Could not locate Vexelboard.app next to this setup script. Please run it directly from the mounted Vexelboard DMG." buttons {"OK"} default button "OK" with icon stop with title "Vexelboard Setup"'
  exit 1
fi

read_version() {
  local app_path="$1"
  local plist="$app_path/Contents/Info.plist"
  if [[ -f "$plist" ]]; then
    /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$plist" 2>/dev/null || echo "unknown"
  else
    echo "unknown"
  fi
}

NEW_VERSION="$(read_version "$SOURCE_APP")"
TARGET_APP="$SYSTEM_APP"
INSTALLED="0"
OLD_VERSION=""

if [[ -d "$SYSTEM_APP" ]]; then
  INSTALLED="1"
  TARGET_APP="$SYSTEM_APP"
  OLD_VERSION="$(read_version "$SYSTEM_APP")"
elif [[ -d "$USER_APP" ]]; then
  INSTALLED="1"
  TARGET_APP="$USER_APP"
  OLD_VERSION="$(read_version "$USER_APP")"
fi

quit_running_app() {
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6; do
      if ! pgrep -x "$APP_NAME" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      pkill -x "$APP_NAME" >/dev/null 2>&1 || true
      sleep 0.5
    fi
  fi
}

run_install_or_update() {
  local dest="$1"
  local dest_dir
  dest_dir="$(dirname "$dest")"

  quit_running_app

  if [[ -w "$dest_dir" ]] && { [[ ! -e "$dest" ]] || [[ -w "$dest" ]]; }; then
    rm -rf "$dest"
    ditto "$SOURCE_APP" "$dest"
    xattr -cr "$dest" 2>/dev/null || true
    codesign --verify --deep --strict "$dest" >/dev/null 2>&1 || codesign --force --deep --sign - "$dest" 2>/dev/null || true
  else
    osascript -e "do shell script \"rm -rf $(printf '%q' "$dest") && ditto $(printf '%q' "$SOURCE_APP") $(printf '%q' "$dest") && xattr -cr $(printf '%q' "$dest") && (codesign --verify --deep --strict $(printf '%q' "$dest") || codesign --force --deep --sign - $(printf '%q' "$dest")) || true\" with administrator privileges"
  fi

  local launch_choice
  launch_choice="$(osascript -e "button returned of (display dialog \"Vexelboard v${NEW_VERSION} has been installed to ${dest}. Your existing boards, chats, and Knowledge Studio data are preserved.\" buttons {\"Done\", \"Open Vexelboard\"} default button \"Open Vexelboard\" with icon note with title \"Vexelboard Setup\")")" || launch_choice="Done"

  if [[ "$launch_choice" == "Open Vexelboard" ]]; then
    open "$dest"
  fi
}

run_uninstall() {
  local dest="$1"
  local dest_dir
  dest_dir="$(dirname "$dest")"

  local remove_choice
  remove_choice="$(osascript -e "button returned of (display dialog \"Uninstall Vexelboard (v${OLD_VERSION}) from ${dest}?\n\nYou can keep your saved projects, boards, and Knowledge Studio database, or remove everything.\" buttons {\"Cancel\", \"Uninstall App & Data\", \"Uninstall App Only\"} default button \"Uninstall App Only\" with icon caution with title \"Uninstall Vexelboard\")")" || exit 0

  if [[ "$remove_choice" == "Cancel" ]]; then
    exit 0
  fi

  quit_running_app

  if [[ -w "$dest_dir" ]] && [[ -w "$dest" ]]; then
    rm -rf "$dest"
  else
    osascript -e "do shell script \"rm -rf $(printf '%q' "$dest")\" with administrator privileges"
  fi

  if [[ "$remove_choice" == "Uninstall App & Data" ]]; then
    rm -rf "$HOME/Library/Application Support/vexelboard" \
           "$HOME/Library/Application Support/Vexelboard" \
           "$HOME/Library/Caches/com.vexelboard.app" \
           "$HOME/Library/Caches/com.vexelboard.app.ShipIt" \
           "$HOME/Library/Preferences/com.vexelboard.app.plist" \
           "$HOME/Library/Saved Application State/com.vexelboard.app.savedState" 2>/dev/null || true
  fi

  osascript -e "display dialog \"Vexelboard has been uninstalled from this Mac.\" buttons {\"OK\"} default button \"OK\" with icon note with title \"Vexelboard Uninstalled\""
}

if [[ "$INSTALLED" == "1" ]]; then
  ACTION="$(osascript -e "button returned of (display dialog \"Vexelboard v${OLD_VERSION} is already installed at:\n${TARGET_APP}\n\nWhat would you like to do with Vexelboard v${NEW_VERSION}?\" buttons {\"Cancel\", \"Uninstall\", \"Update to v${NEW_VERSION}\"} default button \"Update to v${NEW_VERSION}\" with icon note with title \"Vexelboard Setup\")")" || exit 0

  case "$ACTION" in
    "Update to v${NEW_VERSION}")
      run_install_or_update "$TARGET_APP"
      ;;
    "Uninstall")
      run_uninstall "$TARGET_APP"
      ;;
    *)
      exit 0
      ;;
  esac
else
  ACTION="$(osascript -e "button returned of (display dialog \"Install Vexelboard v${NEW_VERSION} into /Applications?\" buttons {\"Cancel\", \"Install\"} default button \"Install\" with icon note with title \"Vexelboard Setup\")")" || exit 0

  if [[ "$ACTION" == "Install" ]]; then
    run_install_or_update "$SYSTEM_APP"
  fi
fi
