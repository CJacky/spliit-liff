#!/usr/bin/env bash

set -Eeuo pipefail

# Run on the NAS: load the image produced by build.sh and restart the services.
#   sudo ./load.sh
#
# Optional settings (environment variables, must match build.sh):
#   IMAGE_NAME=spliit-local
#   IMAGE_TAG=latest

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "${SCRIPT_DIR}"

IMAGE_NAME=${IMAGE_NAME:-spliit-local}
IMAGE_TAG=${IMAGE_TAG:-latest}
ARCHIVE_NAME="${IMAGE_NAME//\//_}-${IMAGE_TAG}.tar.gz"

fail() {
  echo "錯誤：$*" >&2
  exit 1
}

# Synology's docker lives in /usr/local/bin, which sudo's secure_path often omits.
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"

if [[ ${EUID} -ne 0 ]]; then
  exec sudo env "PATH=${PATH}" IMAGE_NAME="${IMAGE_NAME}" IMAGE_TAG="${IMAGE_TAG}" \
    bash "${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")" "$@"
fi

command -v docker >/dev/null 2>&1 || fail "找不到 docker 指令"

# DSM Container Manager may only ship docker-compose (no docker compose plugin).
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose)
else
  fail "找不到 docker compose / docker-compose"
fi

[[ -f "${ARCHIVE_NAME}" ]] || fail "找不到 ${SCRIPT_DIR}/${ARCHIVE_NAME}，請先在 PC 執行 build.sh"
[[ -f docker-compose.yml ]] || fail "找不到 ${SCRIPT_DIR}/docker-compose.yml"

echo "[1/2] 載入映像檔 ${ARCHIVE_NAME}"
docker load -i "${ARCHIVE_NAME}"

echo "[2/2] 啟動服務"
"${compose[@]}" up -d --no-build

"${compose[@]}" ps
echo "完成。查看 log：${compose[*]} logs -f spliit"
