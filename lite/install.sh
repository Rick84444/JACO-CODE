#!/bin/sh
# JACO Lite installer for macOS, Linux and Android (Termux).
#
#   curl -fsSL https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.sh | sh
#
# What it does, in order, and nothing else:
#   1. reads https://github.com/Rick84444/JACO-CODE/releases/latest/download/latest.json and picks the file for this machine
#   2. downloads it and refuses to go on unless its SHA-256 matches latest.json
#   3. uses the Node.js you have if it is new enough; otherwise downloads the official Node.js LTS build from
#      nodejs.org into the JACO folder (checked against nodejs.org's SHASUMS256.txt). Termux gets nodejs-lts from pkg.
#   4. unpacks into  $JACO_LITE_HOME/versions/<build>  and points  current  at it (the previous build is kept for
#      rollback, older ones are removed)
#   5. puts a  jaco-lite  command in ~/.local/bin (or tells you what to add to PATH)
# No administrator rights, nothing outside $JACO_LITE_HOME and that one command. Run it again to update.
#
#   jaco-lite             start JACO Lite in the current folder
#   jaco-lite update      install the newest build
#   jaco-lite rollback    go back to the previous build
#   jaco-lite doctor      what is installed and whether it can start
#   jaco-lite uninstall   remove it (your projects and ~/.jaco are not touched)
#
# Environment (all optional):
#   JACO_LITE_HOME          install folder (default ~/.local/share/jaco-lite, Termux ~/.jaco-lite)
#   JACO_LITE_BASE_URL      where latest.json and the zips are (default https://github.com/Rick84444/JACO-CODE/releases/latest/download)
#   JACO_LITE_NODE_DIST_URL where Node.js builds are (default https://nodejs.org/dist/latest-v24.x)
#   JACO_LITE_BIN_DIR       where the command goes (default ~/.local/bin, Termux $PREFIX/bin)
#   JACO_LITE_FORCE=1       install even if this build is already installed
set -eu

BASE_URL="${JACO_LITE_BASE_URL:-https://github.com/Rick84444/JACO-CODE/releases/latest/download}"
NODE_DIST="${JACO_LITE_NODE_DIST_URL:-https://nodejs.org/dist/latest-v24.x}"
TERMUX=0
case "${PREFIX:-}" in */com.termux/*) TERMUX=1 ;; esac
[ -n "${TERMUX_VERSION:-}" ] && TERMUX=1
if [ "$TERMUX" = 1 ]; then
  HOME_DIR="${JACO_LITE_HOME:-$HOME/.jaco-lite}"
  BIN_DIR="${JACO_LITE_BIN_DIR:-${PREFIX:-$HOME/.local}/bin}"
else
  HOME_DIR="${JACO_LITE_HOME:-$HOME/.local/share/jaco-lite}"
  BIN_DIR="${JACO_LITE_BIN_DIR:-$HOME/.local/bin}"
fi

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf 'jaco-lite install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # url -> stdout
  if have curl; then curl -fsSL --retry 3 --connect-timeout 15 "$1"
  elif have wget; then wget -qO- "$1"
  else die "curl or wget is needed to download files."; fi
}
fetch_to() { # url file
  if have curl; then curl -fL --retry 3 --connect-timeout 15 --progress-bar -o "$2" "$1"
  elif have wget; then wget -q -O "$2" "$1"
  else die "curl or wget is needed to download files."; fi
}
sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  elif have openssl; then openssl dgst -sha256 "$1" | sed 's/^.*= //'
  else die "no sha256sum, shasum or openssl to check the download with."; fi
}
json_field() { # key (flat, from stdin): value of "key": "..." or number
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n1
}

# --- what machine is this ---------------------------------------------------
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Linux) KIND=universal; NODE_OS=linux ;;
  Darwin) KIND=universal; NODE_OS=darwin ;;
  *) die "this installer is for macOS, Linux and Termux. On Windows use:  irm https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.ps1 | iex" ;;
esac
[ "$TERMUX" = 1 ] && KIND=android
case "$ARCH" in
  x86_64|amd64) NODE_ARCH=x64 ;;
  aarch64|arm64) NODE_ARCH=arm64 ;;
  armv7l|armv8l) NODE_ARCH=armv7l ;;
  *) NODE_ARCH="" ;;
esac

step "Looking up the newest JACO Lite ($KIND)"
META="$(fetch "$BASE_URL/latest.json")" || die "could not read $BASE_URL/latest.json (offline?)."
# latest.json has files.<kind>.{file,sha256}; take the block for our kind.
BLOCK="$(printf '%s' "$META" | tr -d '\n' | sed "s/.*\"$KIND\"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/")"
FILE="$(printf '%s' "$BLOCK" | json_field file)"
WANT_SHA="$(printf '%s' "$BLOCK" | json_field sha256)"
BUILT="$(printf '%s' "$META" | json_field builtAt)"
VERSION="$(printf '%s' "$META" | json_field version)"
[ -n "$FILE" ] && [ -n "$WANT_SHA" ] || die "latest.json has no download for '$KIND'."
case "$FILE" in */*|*..*) die "latest.json names an unsafe file: $FILE" ;; esac
case "$WANT_SHA" in *[!0-9a-f]*) die "latest.json has a bad checksum." ;; esac
[ "${#WANT_SHA}" = 64 ] || die "latest.json has a bad checksum."
say "    build $BUILT  ($FILE)"

if [ -f "$HOME_DIR/install.json" ] && [ "${JACO_LITE_FORCE:-0}" != 1 ]; then
  HAVE_SHA="$(json_field sha256 < "$HOME_DIR/install.json")"
  if [ "$HAVE_SHA" = "$WANT_SHA" ] && [ -d "$HOME_DIR/current" ]; then
    say "    already up to date."
    DONE_UP_TO_DATE=1
  fi
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/jaco-lite-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ "${DONE_UP_TO_DATE:-0}" != 1 ]; then
  step "Downloading $FILE"
  fetch_to "$BASE_URL/$FILE" "$WORK/$FILE"
  GOT_SHA="$(sha256_of "$WORK/$FILE")"
  [ "$GOT_SHA" = "$WANT_SHA" ] || die "the download does not match its SHA-256 (expected $WANT_SHA, got $GOT_SHA). Nothing was installed."
  say "    SHA-256 matches."
fi

# --- Node.js ----------------------------------------------------------------
node_ok() { # path-to-node: version 22.5 or newer
  "$1" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)" >/dev/null 2>&1
}
NODE_BIN=""
step "Checking Node.js"
if have node && node_ok "$(command -v node)"; then
  NODE_BIN="$(command -v node)"; say "    using $NODE_BIN ($("$NODE_BIN" --version))"
elif [ "$TERMUX" = 1 ]; then
  have pkg || die "start this from the Termux app."
  say "    installing nodejs-lts with pkg"
  pkg install -y nodejs-lts >/dev/null || die "pkg could not install nodejs-lts."
  NODE_BIN="$(command -v node || true)"; [ -n "$NODE_BIN" ] && node_ok "$NODE_BIN" || die "Node.js 22.5 or newer is needed; 'node --version' says otherwise."
else
  [ -n "$NODE_ARCH" ] || die "Node.js 22.5 or newer is needed and there is no official build for $ARCH. Install Node.js and run this again."
  have tar || die "tar is needed to unpack Node.js."
  RUNTIME="$HOME_DIR/runtime"
  if [ -x "$RUNTIME/node/bin/node" ] && node_ok "$RUNTIME/node/bin/node"; then
    NODE_BIN="$RUNTIME/node/bin/node"; say "    using the Node.js JACO installed earlier ($("$NODE_BIN" --version))"
  else
    say "    Node.js 22.5+ not found; downloading the official Node.js LTS build (this stays inside $HOME_DIR)"
    SUMS="$(fetch "$NODE_DIST/SHASUMS256.txt")" || die "could not read $NODE_DIST/SHASUMS256.txt"
    LINE="$(printf '%s\n' "$SUMS" | grep -E " node-v[0-9.]+-$NODE_OS-$NODE_ARCH\.tar\.gz\$" | head -n1)"
    [ -n "$LINE" ] || die "nodejs.org has no $NODE_OS-$NODE_ARCH build in $NODE_DIST."
    NODE_SHA="${LINE%% *}"; NODE_TGZ="${LINE##* }"
    fetch_to "$NODE_DIST/$NODE_TGZ" "$WORK/$NODE_TGZ"
    [ "$(sha256_of "$WORK/$NODE_TGZ")" = "$NODE_SHA" ] || die "the Node.js download does not match nodejs.org's checksum. Nothing was installed."
    mkdir -p "$WORK/node-unpack" && tar -xzf "$WORK/$NODE_TGZ" -C "$WORK/node-unpack"
    mkdir -p "$RUNTIME" && rm -rf "$RUNTIME/node" "$RUNTIME/node.new"
    mv "$WORK/node-unpack"/node-v* "$RUNTIME/node.new" && mv "$RUNTIME/node.new" "$RUNTIME/node"
    NODE_BIN="$RUNTIME/node/bin/node"; node_ok "$NODE_BIN" || die "the downloaded Node.js does not start on this machine."
    say "    installed Node.js $("$NODE_BIN" --version)"
  fi
fi

# --- unpack, switch, command ------------------------------------------------
if [ "${DONE_UP_TO_DATE:-0}" != 1 ]; then
  step "Installing"
  have unzip || have bsdtar || have python3 || die "unzip is needed to unpack the download (Termux: pkg install unzip; Debian/Ubuntu: apt install unzip)."
  STAMP="$(printf '%s' "$BUILT" | tr -c 'A-Za-z0-9\n' '-' | sed 's/-*$//')"
  [ -n "$STAMP" ] || STAMP="$(date +%Y%m%d%H%M%S)"
  DEST="$HOME_DIR/versions/$STAMP"
  mkdir -p "$HOME_DIR/versions" "$WORK/unpack"
  if have unzip; then unzip -q "$WORK/$FILE" -d "$WORK/unpack"
  elif have bsdtar; then bsdtar -xf "$WORK/$FILE" -C "$WORK/unpack"
  else python3 -m zipfile -e "$WORK/$FILE" "$WORK/unpack"; fi
  TOP="$(ls "$WORK/unpack" | head -n1)"
  [ -f "$WORK/unpack/$TOP/start.mjs" ] || die "the archive does not look like JACO Lite (no start.mjs). Nothing was installed."
  rm -rf "$DEST.new" "$DEST"
  mv "$WORK/unpack/$TOP" "$DEST.new" && mv "$DEST.new" "$DEST"
  chmod +x "$DEST/start.sh" "$DEST/START-ANDROID.sh" 2>/dev/null || true
  PREVIOUS=""
  [ -L "$HOME_DIR/current" ] && PREVIOUS="$(readlink "$HOME_DIR/current")"
  [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "versions/$STAMP" ] && ln -sfn "$PREVIOUS" "$HOME_DIR/previous"
  ln -sfn "versions/$STAMP" "$HOME_DIR/current"
  # keep the build before this one for rollback, remove the rest
  for old in "$HOME_DIR"/versions/*; do
    [ -d "$old" ] || continue
    case "versions/$(basename "$old")" in "versions/$STAMP"|"$PREVIOUS") ;; *) rm -rf "$old" ;; esac
  done
  printf '{\n  "version": "%s",\n  "builtAt": "%s",\n  "file": "%s",\n  "sha256": "%s",\n  "kind": "%s"\n}\n' "$VERSION" "$BUILT" "$FILE" "$WANT_SHA" "$KIND" > "$HOME_DIR/install.json"
fi

mkdir -p "$HOME_DIR/bin"
# On a phone there is no browser to open from Termux: print the address instead.
LAUNCH_ARGS=""; [ "$TERMUX" = 1 ] && LAUNCH_ARGS="--no-open"
# a copy of this installer, so  jaco-lite update  works offline from the script (the download itself is fetched fresh)
if [ -f "$0" ] && grep -q "JACO Lite installer" "$0" 2>/dev/null; then cp "$0" "$HOME_DIR/install.sh" 2>/dev/null || true  # (same file when run as  jaco-lite update)
else
  if fetch "${JACO_LITE_INSTALL_URL:-https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/install.sh}" > "$WORK/install.sh.new" 2>/dev/null && [ -s "$WORK/install.sh.new" ]; then cp "$WORK/install.sh.new" "$HOME_DIR/install.sh"; fi
fi

cat > "$HOME_DIR/bin/jaco-lite" <<LAUNCHER
#!/bin/sh
# JACO Lite launcher (written by install.sh)
JACO_LITE_HOME="\${JACO_LITE_HOME:-$HOME_DIR}"
export JACO_LITE_HOME JACO_LITE_INSTALLER=1
NODE="$NODE_BIN"
EXTRA_ARGS="$LAUNCH_ARGS"
[ -x "\$NODE" ] || NODE="\$(command -v node || true)"
case "\${1:-}" in
  update) shift; exec sh "\$JACO_LITE_HOME/install.sh" "\$@" ;;
  rollback)
    [ -L "\$JACO_LITE_HOME/previous" ] || { echo "jaco-lite: there is no previous build to go back to." >&2; exit 1; }
    prev="\$(readlink "\$JACO_LITE_HOME/previous")"; cur="\$(readlink "\$JACO_LITE_HOME/current")"
    ln -sfn "\$prev" "\$JACO_LITE_HOME/current" && ln -sfn "\$cur" "\$JACO_LITE_HOME/previous" && echo "jaco-lite: now on \$prev (was \$cur)."; exit \$? ;;
  uninstall)
    if [ "\${2:-}" != "--yes" ]; then printf 'Remove %s and the jaco-lite command? Your projects and ~/.jaco are not touched. [y/N] ' "\$JACO_LITE_HOME"; read -r a </dev/tty || a=n; case "\$a" in y|Y) ;; *) echo "kept."; exit 0 ;; esac; fi
    rm -f "$BIN_DIR/jaco-lite"; rm -rf "\$JACO_LITE_HOME"; echo "jaco-lite: removed."; exit 0 ;;
  doctor)
    echo "install folder : \$JACO_LITE_HOME"; echo "current build  : \$(readlink "\$JACO_LITE_HOME/current")"; echo "previous build : \$(readlink "\$JACO_LITE_HOME/previous" 2>/dev/null || echo none)"
    echo "node           : \$NODE (\$("\$NODE" --version 2>/dev/null || echo 'does not start'))"
    sed -n -e 's/^  "builtAt": "\(.*\)",\{0,1\}\$/built at       : \1/p' -e 's/^  "sha256": "\(.*\)",\{0,1\}\$/sha256         : \1/p' -e 's/^  "kind": "\(.*\)",\{0,1\}\$/kind           : \1/p' "\$JACO_LITE_HOME/install.json" 2>/dev/null
    exec "\$NODE" "\$JACO_LITE_HOME/current/start.mjs" --check ;;
  version|--version) sed -n 's/^  "version": "\(.*\)",\$/\1/p' "\$JACO_LITE_HOME/install.json"; exit 0 ;;
esac
[ -x "\$NODE" ] || { echo "jaco-lite: Node.js is missing. Run: jaco-lite update" >&2; exit 2; }
exec "\$NODE" "\$JACO_LITE_HOME/current/start.mjs" \$EXTRA_ARGS "\$@"
LAUNCHER
chmod +x "$HOME_DIR/bin/jaco-lite"

mkdir -p "$BIN_DIR" 2>/dev/null || true
ON_PATH=0
if [ -d "$BIN_DIR" ] && [ -w "$BIN_DIR" ]; then
  ln -sf "$HOME_DIR/bin/jaco-lite" "$BIN_DIR/jaco-lite"
  case ":$PATH:" in *":$BIN_DIR:"*) ON_PATH=1 ;; esac
fi

step "Done"
say "    JACO Lite is installed in $HOME_DIR"
if [ "$ON_PATH" = 1 ]; then
  say "    Start it in any project folder with:  jaco-lite"
else
  say "    Start it with:  $HOME_DIR/bin/jaco-lite"
  say "    To type just  jaco-lite  add this to your shell profile:  export PATH=\"$BIN_DIR:\$PATH\""
fi
say "    Update:  jaco-lite update    Remove:  jaco-lite uninstall"
[ "$TERMUX" = 1 ] && say "    Android is experimental: it has not been verified on a phone yet. Open the address JACO prints in your browser."
exit 0
