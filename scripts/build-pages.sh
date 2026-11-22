#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="rootfs.config.json"
PAGES_DIR="pages-dist"
TMP_DIR="/tmp/cx-pages-build"

if [ ! -f "${CONFIG_FILE}" ]; then
	echo "Missing ${CONFIG_FILE}" >&2
	exit 1
fi

RELEASE_VERSION="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(cfg.releaseVersion || "").trim());' "${CONFIG_FILE}")"
RELEASE_BASE_URL="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(cfg.releaseBaseUrl || "").trim().replace(/\/+$/, ""));' "${CONFIG_FILE}")"
SPLIT_SIZE="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(cfg.splitSize || "20m").trim());' "${CONFIG_FILE}")"
LANGS="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const arr = Array.isArray(cfg.languages) ? cfg.languages : []; process.stdout.write(arr.join("\n"));' "${CONFIG_FILE}")"

if [ -z "${RELEASE_VERSION}" ] || [ -z "${RELEASE_BASE_URL}" ] || [ -z "${LANGS}" ]; then
	echo "Invalid ${CONFIG_FILE} values" >&2
	exit 1
fi

rm -rf "${PAGES_DIR}" "${TMP_DIR}"
mkdir -p "${PAGES_DIR}" "${TMP_DIR}"

cp -r ./html/* "${PAGES_DIR}/"
if [ -f "./html/_headers" ]; then
	cp ./html/_headers "${PAGES_DIR}/_headers"
fi
rm -rf "${PAGES_DIR}/dist"

if [ -f "${PAGES_DIR}/app.html" ]; then
	node -e '
const fs = require("fs");
const filePath = process.argv[1];
const version = process.argv[2];
let html = fs.readFileSync(filePath, "utf8");
html = html.replace(/window\.ROOTFS_IMAGE_VERSION\s*=\s*"[^"]*";/, `window.ROOTFS_IMAGE_VERSION = "${version}";`);
fs.writeFileSync(filePath, html, "utf8");
' "${PAGES_DIR}/app.html" "${RELEASE_VERSION}"
fi

while IFS= read -r lang; do
	if [ -z "${lang}" ]; then
		continue
	fi
	mkdir -p "${PAGES_DIR}/assets/rootfs/${lang}"
	curl -fsSL "${RELEASE_BASE_URL}/${RELEASE_VERSION}/rootfs-${lang}.ext2.gz" -o "${TMP_DIR}/rootfs-${lang}.ext2.gz"
	split -b "${SPLIT_SIZE}" -d -a 3 "${TMP_DIR}/rootfs-${lang}.ext2.gz" "${PAGES_DIR}/assets/rootfs/${lang}/part-"
done <<EOF
${LANGS}
EOF

rm -rf "${TMP_DIR}"