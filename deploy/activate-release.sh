#!/usr/bin/env bash

set -euo pipefail

: "${DEPLOY_PATH:?DEPLOY_PATH is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

[[ "${DEPLOY_PATH}" == /opt/velarscript-website ]]
[[ "${RELEASE_SHA}" =~ ^[0-9a-f]{40}$ ]]

cd "${DEPLOY_PATH}"
test -s "releases/${RELEASE_SHA}/index.html"
test -s "releases/${RELEASE_SHA}/velar-build.json"
test -s "releases/${RELEASE_SHA}/velar-deploy.json"
temporary_link=".current-${RELEASE_SHA}"
rm -f "${temporary_link}"
ln -s "releases/${RELEASE_SHA}" "${temporary_link}"
mv -Tf "${temporary_link}" current
find releases -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +6 \
  | cut -d' ' -f2- \
  | xargs -r rm -rf
test -s current/index.html
echo "VelarScript Website release activated: current -> ${RELEASE_SHA}"
