#!/usr/bin/env bash

set -Eeuo pipefail

# 在 NAS 上執行：載入 build.sh 產生的映像檔並重新啟動服務。
#   sudo ./load.sh
#
# 可選設定（環境變數，需與 build.sh 一致）：
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

# Synology 的 docker 在 /usr/local/bin，sudo 的 secure_path 常常不包含它。
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"

if [[ ${EUID} -ne 0 ]]; then
  exec sudo env "PATH=${PATH}" IMAGE_NAME="${IMAGE_NAME}" IMAGE_TAG="${IMAGE_TAG}" \
    bash "${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")" "$@"
fi

command -v docker >/dev/null 2>&1 || fail "找不到 docker 指令"

# DSM Container Manager 可能只有 docker-compose（無 docker compose 外掛）。
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
