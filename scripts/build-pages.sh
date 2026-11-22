#!/usr/bin/env bash
set -euo pipefail

ROOTFS_VERSION="v0.1.0"
LANG_NAME="c"
RELEASE_BASE_URL="https://github.com/tiwao01/Chasen/releases/download/${ROOTFS_VERSION}"
PAGES_DIR="pages-dist"
TMP_DIR="/tmp/cx-pages-build"

rm -rf "${PAGES_DIR}" "${TMP_DIR}"
mkdir -p "${PAGES_DIR}" "${TMP_DIR}" "${PAGES_DIR}/assets/rootfs/${LANG_NAME}"

cp -r ./html/* "${PAGES_DIR}/"
if [ -f "./html/_headers" ]; then
	cp ./html/_headers "${PAGES_DIR}/_headers"
fi
rm -rf "${PAGES_DIR}/dist"

curl -fsSL "${RELEASE_BASE_URL}/rootfs-${LANG_NAME}.ext2.gz" -o "${TMP_DIR}/rootfs-${LANG_NAME}.ext2.gz"
split -b 20m -d -a 3 "${TMP_DIR}/rootfs-${LANG_NAME}.ext2.gz" "${PAGES_DIR}/assets/rootfs/${LANG_NAME}/part-"

rm -rf "${TMP_DIR}"