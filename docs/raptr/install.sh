#!/bin/sh
# Raptr installer: puts a `raptr` command on your PATH. Needs only Python 3.8+.
#   curl -fsSL https://airaptr.github.io/raptr/install.sh | sh
set -e
if [ -z "${RAPTR_SRC:-}" ]; then
  printf '%s\n' "Airaptr is in private build right now, so the public installer is paused." "Try it in your browser meanwhile: https://airaptr.github.io/raptr/"
  exit 0
fi
SRC="$RAPTR_SRC"
HOME_DIR="${RAPTR_HOME:-$HOME/.raptr}"
BIN_DIR="${RAPTR_BIN:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then PY=$(command -v "$c"); break; fi
done
if [ -z "$PY" ]; then
  say "Raptr needs Python 3.8 or newer. Get it from https://www.python.org/downloads/ and run this again."
  exit 1
fi

mkdir -p "$HOME_DIR/bin" "$BIN_DIR"
TMP="$HOME_DIR/bin/raptr.download"
if command -v curl >/dev/null 2>&1; then curl -fsSL "$SRC" -o "$TMP"; else "$PY" -c "import sys,urllib.request as u; open(sys.argv[2],'wb').write(u.urlopen(sys.argv[1]).read())" "$SRC" "$TMP"; fi
head -c 200 "$TMP" | grep -q "Raptr" || { say "Download failed (not the Raptr file). Try again in a minute."; rm -f "$TMP"; exit 1; }
{ printf '#!%s\n' "$PY"; tail -n +2 "$TMP"; } > "$HOME_DIR/bin/raptr" && rm -f "$TMP"
chmod +x "$HOME_DIR/bin/raptr"
ln -sf "$HOME_DIR/bin/raptr" "$BIN_DIR/raptr"

say "Raptr $("$HOME_DIR/bin/raptr" --version) installed."
case ":$PATH:" in
  *":$BIN_DIR:"*) say "Start with: raptr" ;;
  *) say "Add it to your PATH, then start with: raptr"
     say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.$(basename "${SHELL:-sh}")rc && export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say "Free models work at \$0. You'll be asked for a free OpenRouter key on first run."
