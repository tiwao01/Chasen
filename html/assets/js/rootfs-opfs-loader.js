const DEFAULT_PART_PREFIX = "part-";
const PART_PAD_LENGTH = 3;

/**
 * Manages downloading split gzip parts (with direct ext2 fallback), decompressing via stream, and caching ext2 in OPFS.
 */
export class RootfsOpfsLoader {
	/**
	 * @param {object} [options]
	 * @param {string} [options.baseDir] - Base URL directory containing part-000, etc.
	 * @param {string} [options.imageVersion] - Version tag for cache invalidation.
	 * @param {function(string): string} [options.resolveFallbackUrl] - Resolver returning fallback ext2 URL for a language.
	 */
	constructor (options) {
		this.baseDir = "/assets/rootfs";
		this.imageVersion = "default";
		this.resolveFallbackUrl = null;

		if (options !== undefined && options !== null) {
			if (typeof options.baseDir === "string" && options.baseDir.trim() !== "") {
				this.baseDir = options.baseDir.trim().replace(/\/+$/, "");
			}
			if (typeof options.imageVersion === "string" && options.imageVersion.trim() !== "") {
				this.imageVersion = options.imageVersion.trim();
			}
			if (typeof options.resolveFallbackUrl === "function") {
				this.resolveFallbackUrl = options.resolveFallbackUrl;
			}
		}
	}

	/**
	 * Formats a zero-padded part filename such as "part-000".
	 * @param {number} index - Zero-based part index.
	 * @returns {string}
	 */
	formatPartName (index) {
		let numStr = "";

		numStr = String(index);
		while (numStr.length < PART_PAD_LENGTH) {
			numStr = "0" + numStr;
		}
		return `${DEFAULT_PART_PREFIX}${numStr}`;
	}

	/**
	 * Resolves the directory URL for a given language.
	 * @param {string} lang - Language identifier.
	 * @returns {string}
	 */
	resolveLangDirUrl (lang) {
		return `${this.baseDir}/${lang}`;
	}

	/**
	 * Reads stored cache metadata for lang from OPFS if present.
	 * @param {FileSystemDirectoryHandle} rootDir - OPFS root directory handle.
	 * @param {string} lang - Language identifier.
	 * @returns {Promise<object|null>}
	 */
	async _readMeta (rootDir, lang) {
		let metaName = "";
		let fileHandle = null;
		let file = null;
		let text = "";

		metaName = `rootfs-${lang}.meta.json`;
		try {
			fileHandle = await rootDir.getFileHandle(metaName, { create: false });
			file = await fileHandle.getFile();
			text = await file.text();
			return JSON.parse(text);
		} catch (err) {
			return null;
		}
	}

	/**
	 * Writes cache metadata for lang into OPFS.
	 * @param {FileSystemDirectoryHandle} rootDir - OPFS root directory handle.
	 * @param {string} lang - Language identifier.
	 * @param {object} meta - Metadata object.
	 * @returns {Promise<void>}
	 */
	async _writeMeta (rootDir, lang, meta) {
		let metaName = "";
		let fileHandle = null;
		let writable = null;

		metaName = `rootfs-${lang}.meta.json`;
		fileHandle = await rootDir.getFileHandle(metaName, { create: true });
		writable = await fileHandle.createWritable();
		await writable.write(JSON.stringify(meta));
		await writable.close();
	}

	/**
	 * Removes cached files for languages other than activeLang.
	 * @param {FileSystemDirectoryHandle} rootDir - OPFS root directory handle.
	 * @param {string} activeLang - Currently active language identifier.
	 * @returns {Promise<void>}
	 */
	async cleanupOtherLanguages (rootDir, activeLang) {
		let entry = null;
		let name = "";
		let keepExt2 = "";
		let keepTmp = "";
		let keepMeta = "";

		keepExt2 = `rootfs-${activeLang}.ext2`;
		keepTmp = `rootfs-${activeLang}.ext2.tmp`;
		keepMeta = `rootfs-${activeLang}.meta.json`;

		for await (entry of rootDir.values()) {
			name = entry.name;
			if (name.startsWith("rootfs-") === false) {
				continue;
			}
			if (name === keepExt2 || name === keepTmp || name === keepMeta) {
				continue;
			}
			try {
				await rootDir.removeEntry(name, { recursive: true });
			} catch (err) {
				console.warn(`[RootfsOpfsLoader] Failed to remove stale OPFS entry: ${name}`, err);
			}
		}
	}

	/**
	 * Creates a ReadableStream that sequentially reads from an array of Response bodies.
	 * @param {Response[]} responses - Ordered list of HTTP responses with body streams.
	 * @returns {ReadableStream<Uint8Array>}
	 */
	_createConcatStream (responses) {
		let currentIndex = 0;
		let currentReader = null;

		return new ReadableStream({
			async pull (controller) {
				let readResult = null;
				let bodyStream = null;

				while (currentIndex < responses.length) {
					if (currentReader === null) {
						bodyStream = responses[currentIndex].body;
						if (bodyStream === null) {
							currentIndex = currentIndex + 1;
							continue;
						}
						currentReader = bodyStream.getReader();
					}

					readResult = await currentReader.read();
					if (readResult.done === true) {
						currentReader.releaseLock();
						currentReader = null;
						currentIndex = currentIndex + 1;
						continue;
					}

					controller.enqueue(readResult.value);
					return;
				}

				controller.close();
			},
			async cancel (reason) {
				if (currentReader !== null) {
					await currentReader.cancel(reason);
					currentReader.releaseLock();
					currentReader = null;
				}
			}
		});
	}

	/**
	 * Streams a raw ext2 response directly into an OPFS writable stream.
	 * @param {Response} res - HTTP response for raw ext2 image.
	 * @param {FileSystemWritableFileStream} writable - Target OPFS writable stream.
	 * @param {string} lang - Language identifier.
	 * @param {function(object): void} [onProgress] - Progress callback.
	 * @returns {Promise<number>} Total written byte count.
	 */
	async _writeRawExt2Stream (res, writable, lang, onProgress) {
		let reader = null;
		let writtenBytes = 0;
		let step = null;

		if (res.body === null) {
			throw new Error("フォールバックイメージのレスポンスボディが空です");
		}

		reader = res.body.getReader();
		while (true) {
			step = await reader.read();
			if (step.done === true) {
				break;
			}
			await writable.write(step.value);
			writtenBytes = writtenBytes + step.value.byteLength;
			if (typeof onProgress === "function") {
				onProgress({
					phase: "fallback",
					downloadedBytes: writtenBytes,
					writtenBytes: writtenBytes,
					partCount: 0
				});
			}
		}

		return writtenBytes;
	}

	/**
	 * Streams concatenated gzip part responses through DecompressionStream into an OPFS writable stream.
	 * @param {Response[]} responses - Ordered list of split gzip part responses.
	 * @param {FileSystemWritableFileStream} writable - Target OPFS writable stream.
	 * @param {string} lang - Language identifier.
	 * @param {function(object): void} [onProgress] - Progress callback.
	 * @returns {Promise<number>} Total decompressed written byte count.
	 */
	async _writeDecompressedPartsStream (responses, writable, lang, onProgress) {
		let concatStream = null;
		let decompressedStream = null;
		let reader = null;
		let writtenBytes = 0;
		let step = null;

		if (typeof DecompressionStream === "undefined") {
			throw new Error("このブラウザは DecompressionStream('gzip') に非対応です");
		}

		concatStream = this._createConcatStream(responses);
		decompressedStream = concatStream.pipeThrough(new DecompressionStream("gzip"));
		reader = decompressedStream.getReader();

		while (true) {
			step = await reader.read();
			if (step.done === true) {
				break;
			}
			await writable.write(step.value);
			writtenBytes = writtenBytes + step.value.byteLength;
			if (typeof onProgress === "function") {
				onProgress({
					phase: "extracting",
					downloadedBytes: 0,
					writtenBytes: writtenBytes,
					partCount: responses.length
				});
			}
		}

		return writtenBytes;
	}

	/**
	 * Ensures rootfs-<lang>.ext2 exists in OPFS and returns its File handle.
	 * @param {string} lang - Language identifier.
	 * @param {function(object): void} [onProgress] - Progress callback.
	 * @returns {Promise<{file: File, fileName: string, fromCache: boolean, source: string}>}
	 */
	async ensureExt2InOpfs (lang, onProgress) {
		let rootDir = null;
		let finalName = "";
		let tmpName = "";
		let meta = null;
		let existingHandle = null;
		let existingFile = null;
		let partIndex = 0;
		let partName = "";
		let partUrl = "";
		let res = null;
		let responses = [];
		let fallbackUrl = "";
		let fallbackRes = null;
		let tmpHandle = null;
		let writable = null;
		let writtenBytes = 0;
		let sourceType = "parts";
		let cachedPartCount = 0;

		if (typeof navigator === "undefined" || navigator.storage === undefined || typeof navigator.storage.getDirectory !== "function") {
			throw new Error("このブラウザは OPFS (navigator.storage.getDirectory) に非対応です");
		}

		rootDir = await navigator.storage.getDirectory();
		finalName = `rootfs-${lang}.ext2`;
		tmpName = `rootfs-${lang}.ext2.tmp`;

		await this.cleanupOtherLanguages(rootDir, lang);

		try {
			await rootDir.removeEntry(tmpName);
		} catch (err) {
		}

		meta = await this._readMeta(rootDir, lang);
		if (meta !== null && meta.version === this.imageVersion) {
			try {
				existingHandle = await rootDir.getFileHandle(finalName, { create: false });
				existingFile = await existingHandle.getFile();
				if (existingFile.size > 0) {
					if (typeof meta.partCount === "number") {
						cachedPartCount = meta.partCount;
					}
					if (typeof onProgress === "function") {
						onProgress({
							phase: "cached",
							downloadedBytes: 0,
							writtenBytes: existingFile.size,
							partCount: cachedPartCount
						});
					}
					return {
						file: existingFile,
						fileName: finalName,
						fromCache: true,
						source: meta.source || "cache"
					};
				}
			} catch (err) {
			}
		}

		partIndex = 0;
		while (true) {
			partName = this.formatPartName(partIndex);
			partUrl = `${this.resolveLangDirUrl(lang)}/${partName}`;
			res = await fetch(partUrl, { cache: "no-store" });
			if (res.status === 404) {
				break;
			}
			if (res.ok === false) {
				throw new Error(`イメージチャンクの取得に失敗しました (${partName}: HTTP ${res.status})`);
			}

			responses.push(res);
			if (typeof onProgress === "function") {
				onProgress({
					phase: "downloading",
					downloadedBytes: 0,
					writtenBytes: 0,
					partCount: responses.length
				});
			}
			partIndex = partIndex + 1;
		}

		if (responses.length === 0) {
			if (typeof this.resolveFallbackUrl !== "function") {
				throw new Error(`対象言語 (${lang}) の分割イメージが見つかりません`);
			}
			fallbackUrl = this.resolveFallbackUrl(lang);
			if (typeof fallbackUrl !== "string" || fallbackUrl.trim() === "") {
				throw new Error(`対象言語 (${lang}) の分割イメージが見つかりません`);
			}
			fallbackRes = await fetch(fallbackUrl, { cache: "no-store" });
			if (fallbackRes.ok === false) {
				throw new Error(`フォールバックイメージの取得に失敗しました (${fallbackUrl}: HTTP ${fallbackRes.status})`);
			}
			sourceType = "fallback";
		}

		tmpHandle = await rootDir.getFileHandle(tmpName, { create: true });
		writable = await tmpHandle.createWritable();

		try {
			if (sourceType === "fallback") {
				writtenBytes = await this._writeRawExt2Stream(fallbackRes, writable, lang, onProgress);
			} else {
				writtenBytes = await this._writeDecompressedPartsStream(responses, writable, lang, onProgress);
			}

			await writable.close();
			writable = null;
		} catch (err) {
			if (writable !== null) {
				try {
					await writable.abort();
				} catch (abortErr) {
				}
			}
			try {
				await rootDir.removeEntry(tmpName);
			} catch (rmErr) {
			}
			throw err;
		}

		await this._commitTempFile(rootDir, tmpName, finalName);
		await this._writeMeta(rootDir, lang, {
			version: this.imageVersion,
			source: sourceType,
			partCount: responses.length,
			sizeBytes: writtenBytes,
			updatedAt: new Date().toISOString()
		});

		existingHandle = await rootDir.getFileHandle(finalName, { create: false });
		existingFile = await existingHandle.getFile();

		return {
			file: existingFile,
			fileName: finalName,
			fromCache: false,
			source: sourceType
		};
	}

	/**
	 * Replaces finalName with tmpName inside OPFS and removes tmpName.
	 * @param {FileSystemDirectoryHandle} rootDir - OPFS root directory handle.
	 * @param {string} tmpName - Temporary file name.
	 * @param {string} finalName - Final destination file name.
	 * @returns {Promise<void>}
	 */
	async _commitTempFile (rootDir, tmpName, finalName) {
		let tmpHandle = null;
		let tmpFile = null;
		let destHandle = null;
		let writable = null;
		let stream = null;

		tmpHandle = await rootDir.getFileHandle(tmpName, { create: false });
		tmpFile = await tmpHandle.getFile();

		destHandle = await rootDir.getFileHandle(finalName, { create: true });
		writable = await destHandle.createWritable();
		stream = tmpFile.stream();
		await stream.pipeTo(writable);

		await rootDir.removeEntry(tmpName);
	}
}