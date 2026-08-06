#!/usr/bin/env bash
# Bumps the Qotoba build stamp so the next push is treated as a new release:
# the service worker installs, purges the old cache, and every connected
# browser/PWA home-screen user gets the update on their next visit.
#
# Run this before committing a release:
#   ./scripts/bump-version.sh
#
# It rewrites BUILD_ID in sw.js and the matching ?v= cache-busters in
# index.html and manifest.json. Commit the result together with your changes.
set -euo pipefail
cd "$(dirname "$0")/.."

current=$(sed -n "s/.*BUILD_ID = '\(v[0-9][0-9]*\)'.*/\1/p" sw.js | tail -1)
if [ -z "$current" ]; then
  echo "ERROR: could not find BUILD_ID in sw.js" >&2
  exit 1
fi

next="v$(( ${current#v} + 1 ))"
echo "Bumping build stamp: ${current} -> ${next}"

sed -i "s/const BUILD_ID = '${current}'/const BUILD_ID = '${next}'/" sw.js
sed -i "s/?v=${current}/?v=${next}/g" index.html manifest.json

echo "Done. Commit these changes and push — users update without a manual cache clear or reinstall."
