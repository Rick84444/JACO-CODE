#!/bin/sh
# Kept so an old habit still works. Everything lives in install.sh now, which
# installs only what is missing and then starts JACO.
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$DIR/install.sh" "$@"
