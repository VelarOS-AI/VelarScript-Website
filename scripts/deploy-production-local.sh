#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

mode="${1:-deploy}"
if [[ "$#" -gt 1 || ( "${mode}" != stage && "${mode}" != deploy ) ]]; then
  echo "Usage: deploy-production-local.sh <stage|deploy>" >&2
  exit 2
fi

config_path="${VELARSCRIPT_DEPLOY_CONFIG:-${project_root}/.env.deploy.local}"
if [[ -f "${config_path}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${config_path}"
  set +a
fi

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "${name} is required (configure ${config_path})." >&2
    exit 1
  fi
}

for command_name in curl git npm rsync shasum ssh ssh-keygen tar; do
  command -v "${command_name}" >/dev/null || {
    echo "Required command not found: ${command_name}" >&2
    exit 1
  }
done

require_value DEPLOY_HOST
require_value DEPLOY_USER
require_value DEPLOY_IDENTITY_FILE
require_value DEPLOY_KNOWN_HOSTS_FILE
DEPLOY_PORT="${DEPLOY_PORT:-22}"
VELARSCRIPT_DEPLOY_PATH="${VELARSCRIPT_DEPLOY_PATH:-/opt/velarscript-website}"
VELARSCRIPT_PUBLIC_ORIGIN="${VELARSCRIPT_PUBLIC_ORIGIN:-https://velarscript.velaros.cn}"

[[ "${DEPLOY_HOST}" =~ ^[A-Za-z0-9.-]+$ ]]
[[ "${DEPLOY_USER}" =~ ^[A-Za-z0-9._-]+$ ]]
[[ "${DEPLOY_PORT}" =~ ^[0-9]+$ ]]
[[ "${VELARSCRIPT_DEPLOY_PATH}" == /opt/velarscript-website ]]
[[ "${VELARSCRIPT_PUBLIC_ORIGIN}" == https://velarscript.velaros.cn ]]
for local_path in "${DEPLOY_IDENTITY_FILE}" "${DEPLOY_KNOWN_HOSTS_FILE}"; do
  [[ -f "${local_path}" ]] || {
    echo "Deployment credential file does not exist: ${local_path}" >&2
    exit 1
  }
done
ssh-keygen -F "${DEPLOY_HOST}" -f "${DEPLOY_KNOWN_HOSTS_FILE}" >/dev/null || {
  echo "No pinned host key for ${DEPLOY_HOST} in ${DEPLOY_KNOWN_HOSTS_FILE}." >&2
  exit 1
}

branch="$(git branch --show-current)"
[[ "${branch}" == main ]] || {
  echo "VelarScript Website production deployment requires main; current branch is ${branch:-detached}." >&2
  exit 1
}
release_sha="$(git rev-parse HEAD)"
git fetch --quiet origin main
origin_sha="$(git rev-parse origin/main)"
[[ "${release_sha}" == "${origin_sha}" ]] || {
  echo "HEAD ${release_sha} is not origin/main ${origin_sha}; push and merge first." >&2
  exit 1
}
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Notice: uncommitted files are present; deployment uses committed HEAD only." >&2
fi

staging_root="$(mktemp -d "${TMPDIR:-/tmp}/velarscript-website-deploy.XXXXXX")"
source_root="${staging_root}/source"
package_path="${staging_root}/velarscript-website-${release_sha}.tar"
cleanup() {
  rm -rf "${staging_root}"
}
trap cleanup EXIT

mkdir -p "${source_root}"
git archive --format=tar --output="${package_path}" "${release_sha}"
tar -xf "${package_path}" -C "${source_root}"
[[ -d "${project_root}/node_modules" ]] || {
  echo "node_modules is missing; bootstrap the verified VelarScript toolchain first." >&2
  exit 1
}
ln -s "${project_root}/node_modules" "${source_root}/node_modules"
package_sha256="$(shasum -a 256 "${package_path}" | awk '{print $1}')"

cd "${source_root}"
echo "Checking committed VelarScript Website package ${release_sha} (${package_sha256})..."
npm run validate
npm run deploy:prepare
npm run deploy:smoke
candidate="${source_root}/release/deployment/site"
test -s "${candidate}/index.html"
test -s "${candidate}/velar-build.json"
test -s "${candidate}/velar-deploy.json"

ssh_options=(
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${DEPLOY_KNOWN_HOSTS_FILE}"
  -i "${DEPLOY_IDENTITY_FILE}"
  -p "${DEPLOY_PORT}"
)
remote="${DEPLOY_USER}@${DEPLOY_HOST}"
release_path="${VELARSCRIPT_DEPLOY_PATH}/releases/${release_sha}"
rsync_shell="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${DEPLOY_KNOWN_HOSTS_FILE} -i ${DEPLOY_IDENTITY_FILE} -p ${DEPLOY_PORT}"

echo "Uploading the VelarScript Website release..."
ssh "${ssh_options[@]}" "${remote}" "mkdir -p '${release_path}'"
rsync -az --delete -e "${rsync_shell}" "${candidate}/" "${remote}:${release_path}/"
ssh "${ssh_options[@]}" "${remote}" \
  "test -s '${release_path}/index.html' && test -s '${release_path}/velar-build.json' && test -s '${release_path}/velar-deploy.json'"
if [[ "${mode}" == stage ]]; then
  echo "VelarScript Website release staged: ${release_sha} (${package_sha256})"
  exit 0
fi

echo "Atomically activating the VelarScript Website..."
ssh "${ssh_options[@]}" "${remote}" \
  "DEPLOY_PATH='${VELARSCRIPT_DEPLOY_PATH}' RELEASE_SHA='${release_sha}' bash -s" \
  < deploy/activate-release.sh

npm run verify:deployment -- --url "${VELARSCRIPT_PUBLIC_ORIGIN}"
ssh "${ssh_options[@]}" "${remote}" \
  "test \"\$(readlink '${VELARSCRIPT_DEPLOY_PATH}/current')\" = 'releases/${release_sha}'"
echo "VelarScript Website deployment completed: ${release_sha} (${package_sha256})"
