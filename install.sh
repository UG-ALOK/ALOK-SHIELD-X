#!/bin/sh
# UG ALOK — Ultimate Security Toolkit installer / environment check
# Non-destructive: no root, no package installs, no system changes.
set -eu

cd "$(dirname "$0")"

say()  { printf '%s\n' "$*"; }
fail() { printf '[x] %s\n' "$*" >&2; exit 1; }

say "UG ALOK — Ultimate Security Toolkit : environment check"
say "-------------------------------------------------------"

if [ "$(id -u 2>/dev/null || echo 1)" = "0" ]; then
  say "[!] You are running as root. Root is NOT needed; consider using a normal user."
fi

if ! command -v node >/dev/null 2>&1; then
  say "[x] Node.js was not found."
  say ""
  say "Install Node.js 18 or newer, then run this script again:"
  say "  Termux (Android) : pkg update && pkg install nodejs"
  say "  Debian / Ubuntu  : sudo apt install nodejs   (or use https://nodejs.org)"
  say "  Fedora           : sudo dnf install nodejs"
  say "  macOS (Homebrew) : brew install node"
  say "  Other systems    : https://nodejs.org/en/download"
  exit 1
fi

NODE_VER="$(node -p "process.versions.node")"
NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
say "[+] Node.js $NODE_VER detected."
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js 18+ is required (built-in fetch). Upgrade, e.g. Termux: pkg upgrade nodejs"
fi

[ -f main.js ] || fail "main.js not found next to install.sh. Re-extract the ZIP and try again."
say "[+] main.js found."

node --check main.js || fail "main.js failed the syntax check."
say "[+] main.js syntax OK."

chmod +x main.js 2>/dev/null || say "[!] Could not set executable bit (not needed; use 'node main.js')."
say "[+] Permissions set. No dependencies to install."

say ""
say "Launch the toolkit with:"
say "  node main.js"
say ""
say "Optional shortcut (add to ~/.bashrc yourself if you want it):"
say "  alias ugalok='node \"$(pwd)/main.js\"'"
say ""
say "Use only on systems you own or are authorized to test."
