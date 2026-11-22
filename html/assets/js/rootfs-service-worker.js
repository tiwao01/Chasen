const OPFS_IMAGE_ROUTE_PREFIX = "/opfs-rootfs-image/";

/**
 * Parses an HTTP byte Range header into inclusive start and end offsets.
 * @param {string|null} rangeHeader - Raw Range header value.
 * @param {number} totalSize - Total file size in bytes.
 * @returns {{start: number, end: number}|null}
 */
function parseByteRange (rangeHeader, totalSize) {
	let matches = null;
	let startStr = "";
	let endStr = "";
	let start = 0;
	let end = 0;

	if (typeof rangeHeader !== "string" || rangeHeader.trim() === "") {
		return null;
	}
	if (totalSize <= 0) {
		return null;
	}

	matches = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
	if (matches === null) {
		return null;
	}

	startStr = matches[1];
	endStr = matches[2];

	if (startStr === "" && endStr === "") {
		return null;
	}

	if (startStr === "") {
		end = totalSize - 1;
		start = totalSize - Number(endStr);
		if (start < 0) {
			start = 0;
		}
		return {
			start: start,
			end: end
		};
	}

	start = Number(startStr);
	if (endStr === "") {
		end = totalSize - 1;
	} else {
		end = Number(endStr);
	}

	if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= totalSize) {
		return null;
	}

	if (end >= totalSize) {
		end = totalSize - 1;
	}

	return {
		start: start,
		end: end
	};
}

/**
 * Builds common HTTP headers including ETag and Last-Modified required by HttpBytesDevice.
 * @param {File} file - OPFS File handle.
 * @returns {Headers}
 */
function buildImageHeaders (file) {
	let headers = null;
	let lastModDate = null;
	let etagVal = "";

	headers = new Headers();
	lastModDate = new Date(file.lastModified);
	etagVal = `"opfs-${file.size.toString(16)}-${file.lastModified.toString(16)}"`;

	headers.set("Content-Type", "application/octet-stream");
	headers.set("Accept-Ranges", "bytes");
	headers.set("ETag", etagVal);
	headers.set("Last-Modified", lastModDate.toUTCString());
	headers.set("Cache-Control", "no-store");

	return headers;
}

/**
 * Handles GET/HEAD requests for OPFS-cached rootfs ext2 images.
 * @param {Request} request - Incoming fetch request.
 * @returns {Promise<Response>}
 */
async function handleOpfsRootfsImageRequest (request) {
	let url = null;
	let fileName = "";
	let rootDir = null;
	let fileHandle = null;
	let file = null;
	let headers = null;
	let rangeHeader = null;
	let byteRange = null;
	let slicedBlob = null;
	let chunkLength = 0;

	url = new URL(request.url);
	if (url.pathname.startsWith(OPFS_IMAGE_ROUTE_PREFIX) === false) {
		return fetch(request);
	}

	fileName = decodeURIComponent(url.pathname.slice(OPFS_IMAGE_ROUTE_PREFIX.length));
	if (fileName === "" || fileName.indexOf("/") !== -1 || fileName.indexOf("..") !== -1) {
		return new Response("Invalid rootfs file name", { status: 400 });
	}

	if (typeof navigator === "undefined" || navigator.storage === undefined || typeof navigator.storage.getDirectory !== "function") {
		return new Response("OPFS is not supported in this browser", { status: 500 });
	}

	try {
		rootDir = await navigator.storage.getDirectory();
		fileHandle = await rootDir.getFileHandle(fileName, { create: false });
		file = await fileHandle.getFile();
	} catch (err) {
		return new Response(`Rootfs image not found in OPFS: ${fileName}`, {
			status: 404,
			headers: {
				"X-Rootfs-Sw": "opfs-miss",
				"Cache-Control": "no-store"
			}
		});
	}

	headers = buildImageHeaders(file);
	rangeHeader = request.headers.get("Range");

	if (rangeHeader !== null && rangeHeader !== "") {
		byteRange = parseByteRange(rangeHeader, file.size);
		if (byteRange === null) {
			headers.set("Content-Range", `bytes */${file.size}`);
			return new Response(null, {
				status: 416,
				headers: headers
			});
		}

		chunkLength = byteRange.end - byteRange.start + 1;
		headers.set("Content-Range", `bytes ${byteRange.start}-${byteRange.end}/${file.size}`);
		headers.set("Content-Length", String(chunkLength));

		if (request.method === "HEAD") {
			return new Response(null, {
				status: 206,
				headers: headers
			});
		}

		slicedBlob = file.slice(byteRange.start, byteRange.end + 1, "application/octet-stream");
		return new Response(slicedBlob, {
			status: 206,
			headers: headers
		});
	}

	headers.set("Content-Length", String(file.size));
	if (request.method === "HEAD") {
		return new Response(null, {
			status: 200,
			headers: headers
		});
	}

	return new Response(file, {
		status: 200,
		headers: headers
	});
}

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	let reqUrl = null;

	if (event.request.method !== "GET" && event.request.method !== "HEAD") {
		return;
	}

	reqUrl = new URL(event.request.url);
	if (reqUrl.origin === self.location.origin && reqUrl.pathname.startsWith(OPFS_IMAGE_ROUTE_PREFIX)) {
		event.respondWith(handleOpfsRootfsImageRequest(event.request));
	}
});