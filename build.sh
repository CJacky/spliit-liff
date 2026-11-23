#!/usr/bin/env bash

set -Eeuo pipefail

# Build the spliit image on the PC and export it as a tar.gz into the NAS mount,
# then run `docker load` + `docker compose up -d` on the NAS; no building on the NAS.
#
# Optional settings (environment variables):
#   IMAGE_NAME=spliit-local     must match image: in the NAS docker-compose.yml
#   IMAGE_TAG=latest
#   OUTPUT_DIR=~/docker/spliit  SMB mount of the NAS

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
BUILD_CONTEXT="${SCRIPT_DIR}"

IMAGE_NAME=${IMAGE_NAME:-spliit-local}
IMAGE_TAG=${IMAGE_TAG:-latest}
OUTPUT_DIR=${OUTPUT_DIR:-"${HOME}/docker/spliit"}
# Synology DS920+ (synology_geminilake_920+) reports x86_64 from uname.
TARGET_PLATFORM=linux/amd64

IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
ARCHIVE_NAME="${IMAGE_NAME//\//_}-${IMAGE_TAG}.tar.gz"
ARCHIVE_PATH="${OUTPUT_DIR}/${ARCHIVE_NAME}"
TEMP_ARCHIVE="${SCRIPT_DIR}/.${ARCHIVE_NAME}.tmp.$$"
# Copy to a temp file on the NAS and then rename, so an interrupted copy never leaves a partial tar.gz.
REMOTE_TEMP="${OUTPUT_DIR}/.${ARCHIVE_NAME}.partial.$$"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
LOAD_SCRIPT="${SCRIPT_DIR}/load.sh"
# Files copied to the NAS alongside the image
RUNTIME_FILES=("${COMPOSE_FILE}" "${LOAD_SCRIPT}")
FILE_TEMP=""

cleanup() {
  rm -f -- "${TEMP_ARCHIVE}" "${REMOTE_TEMP}" ${FILE_TEMP:+"${FILE_TEMP}"}
}
trap cleanup EXIT

fail() {
  echo "錯誤：$*" >&2
  exit 1
}

for command_name in docker gzip cp mv grep; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "找不到必要指令：${command_name}"
done

docker info >/dev/null 2>&1 \
  || fail "無法連線 Docker daemon（權限不足或 daemon 未啟動）。
  若為權限問題：sudo usermod -aG docker \"\$USER\" 後重新登入 WSL（或執行 newgrp docker）。"
docker buildx version >/dev/null 2>&1 || fail "找不到 docker buildx 外掛"

[[ -f "${BUILD_CONTEXT}/Dockerfile" ]] || fail "找不到 ${BUILD_CONTEXT}/Dockerfile"
for runtime_file in "${RUNTIME_FILES[@]}"; do
  [[ -f "${runtime_file}" ]] || fail "找不到 ${runtime_file}"
done
grep -Eq "^[[:space:]]*image:[[:space:]]*[\"']?${IMAGE_REF}[\"']?[[:space:]]*$" "${COMPOSE_FILE}" \
  || fail "docker-compose.yml 沒有使用 image: ${IMAGE_REF}，NAS 會找不到映像檔"
if grep -Eq "^[[:space:]]*build:" "${COMPOSE_FILE}"; then
  fail "docker-compose.yml 含有 build: 區塊，NAS 可能會嘗試自行編譯，請移除"
fi
[[ -d "${OUTPUT_DIR}" ]] || fail "輸出目錄不存在：${OUTPUT_DIR}（NAS 是否已掛載？）"
[[ -w "${OUTPUT_DIR}" ]] || fail "輸出目錄無法寫入：${OUTPUT_DIR}"

echo "[1/4] 在 PC 本機編譯映像檔 ${IMAGE_REF} (${TARGET_PLATFORM})"
docker buildx build \
  --load \
  --platform "${TARGET_PLATFORM}" \
  --tag "${IMAGE_REF}" \
  "${BUILD_CONTEXT}"

echo "[2/4] 匯出映像檔 ${ARCHIVE_NAME}"
docker save "${IMAGE_REF}" | gzip -1 >"${TEMP_ARCHIVE}"
gzip -t -- "${TEMP_ARCHIVE}" || fail "匯出的壓縮檔損毀"

echo "[3/4] 複製映像檔至 ${OUTPUT_DIR}"
cp -f -- "${TEMP_ARCHIVE}" "${REMOTE_TEMP}"
mv -f -- "${REMOTE_TEMP}" "${ARCHIVE_PATH}"

echo "[4/4] 複製 docker-compose.yml、load.sh 至 ${OUTPUT_DIR}"
for runtime_file in "${RUNTIME_FILES[@]}"; do
  file_name=$(basename -- "${runtime_file}")
  FILE_TEMP="${OUTPUT_DIR}/.${file_name}.partial.$$"
  cp -f -- "${runtime_file}" "${FILE_TEMP}"
  mv -f -- "${FILE_TEMP}" "${OUTPUT_DIR}/${file_name}"
  FILE_TEMP=""
done

cat <<EOF
完成：
  ${ARCHIVE_PATH}
  ${OUTPUT_DIR}/docker-compose.yml
  ${OUTPUT_DIR}/load.sh

在 NAS 上執行：
  cd <NAS 上的 spliit 目錄> && sudo bash load.sh
EOF
