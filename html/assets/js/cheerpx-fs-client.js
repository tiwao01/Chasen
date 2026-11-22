const ZIP_STEP_TIMEOUT_MS = 8000;

/**
 * Client for reading, writing, listing, and synchronizing files inside a CheerpX Linux instance.
 */
export class CheerpXFsClient {
	/**
	 * Creates a new CheerpXFsClient instance.
	 * @param {object} runner - CheerpXRunner instance providing `cx`, `runOpt`, and `decCode`.
	 */
	constructor (runner) {
		this.runner = runner;
		this.isSilent = false;
		this.captureBuffer = "";
		this.isCapturing = false;
	}

	/**
	 * Strips workspace change markers from captured command output and triggers change callback if found.
	 * @param {string} rawText - Captured console output text.
	 * @returns {string} Output text without marker lines.
	 */
	_stripChangeMarkers (rawText) {
		let lines = [];
		let cleaned = [];
		let i = 0;
		let line = "";
		let trimmed = "";
		let hasMarker = false;

		if (typeof rawText !== "string" || rawText === "") {
			return "";
		}

		lines = rawText.split("\n");
		for (i = 0; i < lines.length; i++) {
			line = lines[i];
			trimmed = line.replace(/\r$/, "").trim();
			if (trimmed === "__CX_WS_CHANGED__" || trimmed.indexOf("__CX_WS_CHANGED__") !== -1) {
				hasMarker = true;
				continue;
			}
			cleaned.push(line);
		}

		if (hasMarker === true) {
			if (this.runner !== null && typeof this.runner.onWorkspaceChange === "function") {
				this.runner.onWorkspaceChange();
			}
		}

		return cleaned.join("\n");
	}

	/**
	 * Validates ZIP central directory entries for path traversal, absolute paths, and symlinks.
	 * @param {Uint8Array} bytes - Raw ZIP file bytes.
	 * @returns {void}
	 */
	validateZipEntriesSafe (bytes) {
		let view = null;
		let eocdOffset = -1;
		let minOffset = 0;
		let i = 0;
		let cdOffset = 0;
		let cdEntries = 0;
		let pos = 0;
		let sig = 0;
		let versionMadeBy = 0;
		let nameLen = 0;
		let extraLen = 0;
		let commentLen = 0;
		let extAttr = 0;
		let unixMode = 0;
		let nameBytes = null;
		let entryName = "";
		let decoder = null;
		let parts = [];
		let j = 0;
		let S_IFMT = 0o170000;
		let S_IFLNK = 0o120000;

		if (!(bytes instanceof Uint8Array) || bytes.length < 22) {
			throw new Error("ZIPファイルが破損しているか、形式が不正です");
		}

		view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		minOffset = 0;
		if (bytes.length > 65557) {
			minOffset = bytes.length - 65557;
		}

		for (i = bytes.length - 22; i >= minOffset; i--) {
			if (view.getUint32(i, true) === 0x06054b50) {
				eocdOffset = i;
				break;
			}
		}

		if (eocdOffset === -1) {
			throw new Error("ZIPの終端レコードが見つかりません");
		}

		cdEntries = view.getUint16(eocdOffset + 10, true);
		cdOffset = view.getUint32(eocdOffset + 16, true);
		if (cdOffset + 46 > eocdOffset) {
			throw new Error("ZIPのディレクトリ構造が不正です");
		}

		decoder = new TextDecoder("utf-8");
		pos = cdOffset;

		for (i = 0; i < cdEntries; i++) {
			if (pos + 46 > eocdOffset) {
				throw new Error("ZIPエントリが破損しています");
			}
			sig = view.getUint32(pos, true);
			if (sig !== 0x02014b50) {
				throw new Error("ZIP中央ディレクトリの署名が不正です");
			}

			versionMadeBy = view.getUint16(pos + 4, true);
			nameLen = view.getUint16(pos + 28, true);
			extraLen = view.getUint16(pos + 30, true);
			commentLen = view.getUint16(pos + 32, true);
			extAttr = view.getUint32(pos + 38, true);

			if (pos + 46 + nameLen + extraLen + commentLen > eocdOffset) {
				throw new Error("ZIPエントリの長さが不正です");
			}

			nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLen);
			entryName = decoder.decode(nameBytes);

			if (entryName.indexOf("\\") !== -1 || entryName.indexOf("\0") !== -1) {
				throw new Error("不正なパス文字が含まれているため中止しました");
			}
			if (entryName.startsWith("/") || /^[a-zA-Z]:/.test(entryName)) {
				throw new Error("絶対パスが含まれているため中止しました");
			}

			parts = entryName.split("/");
			for (j = 0; j < parts.length; j++) {
				if (parts[j] === "..") {
					throw new Error("不正なパス（..）が含まれているため中止しました");
				}
			}

			if (((versionMadeBy >> 8) & 0xff) === 3) {
				unixMode = (extAttr >>> 16) & 0xffff;
				if ((unixMode & S_IFMT) === S_IFLNK) {
					throw new Error("シンボリックリンクが含まれているため中止しました");
				}
			}

			pos = pos + 46 + nameLen + extraLen + commentLen;
		}
	}

	/**
	 * Executes a shell command and captures its console output without writing to terminal.
	 * @param {string} cmd - Shell command to execute.
	 * @returns {Promise<string>} Captured output string.
	 */
	async execSilentOutput (cmd) {
		let result = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.captureBuffer = "";
		this.isCapturing = true;
		try {
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
			result = this._stripChangeMarkers(this.captureBuffer);
		} finally {
			this.isCapturing = false;
			this.captureBuffer = "";
		}

		return result;
	}

	/**
	 * Writes text content to a file inside the CheerpX filesystem via base64.
	 * @param {string} filePath - Destination file path.
	 * @param {string} content - File content to write.
	 * @returns {Promise<void>}
	 */
	async writeFile (filePath, content) {
		let enc = null;
		let bytes = null;

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		enc = new TextEncoder();
		bytes = enc.encode(content);
		await this.writeFileBytes(filePath, bytes);
	}

	/**
	 * Writes binary data (Uint8Array) to a file inside the CheerpX filesystem via chunked base64.
	 * @param {string} filePath - Destination file path.
	 * @param {Uint8Array} bytes - Binary content to write.
	 * @returns {Promise<void>}
	 */
	async writeFileBytes (filePath, bytes) {
		let chunkSize = 262144;
		let offset = 0;
		let end = 0;
		let bStr = "";
		let b64 = "";
		let op = ">";
		let cmd = "";
		let i = 0;

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		try {
			cmd = `mkdir -p "$(dirname "${filePath}")" && : > "${filePath}"`;
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);

			while (offset < bytes.length) {
				end = offset + chunkSize;
				if (end > bytes.length) {
					end = bytes.length;
				}
				bStr = "";
				for (i = offset; i < end; i++) {
					bStr = bStr + String.fromCharCode(bytes[i]);
				}
				b64 = btoa(bStr);
				op = ">>";
				cmd = `printf '%s' "${b64}" | base64 -d ${op} "${filePath}"`;
				await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
				offset = end;
			}
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Reads binary content (Uint8Array) from a file inside the CheerpX filesystem via base64.
	 * @param {string} filePath - File path to read.
	 * @returns {Promise<Uint8Array>} Decoded binary data.
	 */
	async readFileBytes (filePath) {
		let cmd = "";
		let b64 = "";
		let bStr = "";
		let bytes = null;
		let i = 0;

		cmd = `base64 "${filePath}" | tr -d '\\r\\n'`;
		b64 = await this.execSilentOutput(cmd);
		b64 = b64.trim();

		if (b64 === "") {
			return new Uint8Array(0);
		}

		bStr = atob(b64);
		bytes = new Uint8Array(bStr.length);
		for (i = 0; i < bStr.length; i++) {
			bytes[i] = bStr.charCodeAt(i);
		}
		return bytes;
	}

	/**
	 * Creates a ZIP archive of targetDir at zipPath inside CheerpX.
	 * @param {string} targetDir - Source directory path.
	 * @param {string} zipPath - Destination ZIP path.
	 * @returns {Promise<void>}
	 */
	async createZipArchive (targetDir, zipPath) {
		let cmd = "";
		let out = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		cmd = [
			`rm -f "${zipPath}" &&`,
			`mkdir -p "${targetDir}" &&`,
			`(cd "${targetDir}" && zip -r -q "${zipPath}" .) &&`,
			`if [ -f "${zipPath}" ]; then echo "ZIP_OK"; else echo "ZIP_FAIL"; fi`
		].join(" ");

		out = await this.execSilentOutput(cmd);
		if (out.indexOf("ZIP_OK") === -1) {
			throw new Error("ZIPアーカイブの作成に失敗しました");
		}
	}

	/**
	 * Runs a single shell step with a timeout guard for ZIP replacement.
	 * @param {string} cmd - Shell command to execute.
	 * @param {number} timeoutMs - Timeout in milliseconds.
	 * @param {string} stepLabel - Step name for timeout error reporting.
	 * @returns {Promise<string>} Output captured from the shell command.
	 */
	async _runZipStepWithTimeout (cmd, timeoutMs, stepLabel) {
		let timerId = null;

		try {
			return await Promise.race([
				this.execSilentOutput(cmd),
				new Promise((_, reject) => {
					timerId = setTimeout(() => {
						reject(new Error(`ZIP処理がタイムアウトしました（${stepLabel}）`));
					}, timeoutMs);
				})
			]);
		} finally {
			if (timerId !== null) {
				clearTimeout(timerId);
			}
		}
	}

	/**
	 * Extracts a ZIP archive into a staging directory, strips symlinks,
	 * clears targetDir, moves entries into targetDir, and cleans up temporary files.
	 * @param {string} zipPath - Uploaded ZIP path inside CheerpX.
	 * @param {string} targetDir - Target workspace directory (e.g. /workspace).
	 * @returns {Promise<void>}
	 */
	async replaceDirectoryFromZip (zipPath, targetDir) {
		let stageDir = "";
		let out = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		stageDir = `/tmp/ws_stage_${Date.now()}`;

		this.isSilent = true;
		try {
			out = await this._runZipStepWithTimeout(
				`if [ -f "${zipPath}" ]; then rm -rf "${stageDir}" && mkdir -p "${stageDir}" && unzip -oq "${zipPath}" -d "${stageDir}" < /dev/null && echo "UNZIP_OK"; else echo "ERR_NO_ZIP"; fi`,
				ZIP_STEP_TIMEOUT_MS,
				"解凍"
			);
			if (out.indexOf("ERR_NO_ZIP") !== -1) {
				throw new Error("ZIPファイルの転送に失敗しました");
			}
			if (out.indexOf("UNZIP_OK") === -1) {
				throw new Error("ZIPの展開に失敗しました");
			}

			await this._runZipStepWithTimeout(
				`find "${stageDir}" -type l -delete 2>/dev/null || true`,
				ZIP_STEP_TIMEOUT_MS,
				"リンク削除"
			);

			await this._runZipStepWithTimeout(
				`mkdir -p "${targetDir}" && rm -rf "${targetDir}"/* 2>/dev/null || true`,
				ZIP_STEP_TIMEOUT_MS,
				"既存ファイル削除"
			);

			await this._runZipStepWithTimeout(
				`for item in "${stageDir}"/* "${stageDir}"/.[!.]*; do [ -e "$item" ] && mv "$item" "${targetDir}/"; done`,
				ZIP_STEP_TIMEOUT_MS,
				"ワークスペースへ反映"
			);

			await this._runZipStepWithTimeout(
				`rm -rf "${stageDir}" "${zipPath}"`,
				ZIP_STEP_TIMEOUT_MS,
				"一時ファイル削除"
			);
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Creates a directory (including parent directories) inside the CheerpX filesystem.
	 * @param {string} dirPath - Directory path to create.
	 * @returns {Promise<void>}
	 */
	async createDirectory (dirPath) {
		let cmd = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		try {
			cmd = `mkdir -p "${dirPath}" && sync >/dev/null 2>&1`;
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Checks whether a file or directory exists at targetPath inside CheerpX.
	 * @param {string} targetPath - Target path to check.
	 * @returns {Promise<boolean>} True if the path exists.
	 */
	async pathExists (targetPath) {
		let cmd = "";
		let res = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		cmd = `if [ -e "${targetPath}" ]; then echo "YES"; else echo "NO"; fi`;
		res = await this.execSilentOutput(cmd);
		res = res.trim();

		return res === "YES";
	}

	/**
	 * Checks whether targetPath is a directory inside CheerpX.
	 * @param {string} targetPath - Target path to check.
	 * @returns {Promise<boolean>} True if the path is a directory.
	 */
	async isDirectory (targetPath) {
		let cmd = "";
		let res = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		cmd = `if [ -d "${targetPath}" ]; then echo "YES"; else echo "NO"; fi`;
		res = await this.execSilentOutput(cmd);
		res = res.trim();

		return res === "YES";
	}

	/**
	 * Removes a file or directory inside the CheerpX filesystem.
	 * @param {string} filePath - Target path to remove.
	 * @returns {Promise<void>}
	 */
	async removeFile (filePath) {
		let cmd = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		try {
			cmd = `rm -rf "${filePath}" && sync >/dev/null 2>&1`;
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Copies a file or directory inside the CheerpX filesystem.
	 * @param {string} srcPath - Source path.
	 * @param {string} destPath - Destination path.
	 * @returns {Promise<void>}
	 */
	async copyFile (srcPath, destPath) {
		let cmd = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		try {
			cmd = `mkdir -p "$(dirname "${destPath}")" && cp -r "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Moves (renames or relocates) a file or directory inside the CheerpX filesystem.
	 * @param {string} srcPath - Source path.
	 * @param {string} destPath - Destination path.
	 * @returns {Promise<void>}
	 */
	async movePath (srcPath, destPath) {
		let cmd = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		try {
			cmd = `mkdir -p "$(dirname "${destPath}")" && mv "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
			await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		} finally {
			this.isSilent = false;
		}
	}

	/**
	 * Lists entry paths under a target directory excluding the directory itself.
	 * @param {string} targetDir - Directory path to scan.
	 * @returns {Promise<string[]>} List of found paths.
	 */
	async listFiles (targetDir) {
		let cmd = "";
		let rawOut = "";
		let lines = [];
		let paths = [];
		let i = 0;
		let line = "";
		let normTarget = "";

		cmd = `mkdir -p "${targetDir}" && find "${targetDir}" -mindepth 1 2>/dev/null`;
		rawOut = await this.execSilentOutput(cmd);
		lines = rawOut.split(/\r?\n/);
		normTarget = targetDir.replace(/\/+$/, "");

		for (i = 0; i < lines.length; i++) {
			line = lines[i].trim();
			if (line === "") {
				continue;
			}
			if (line === normTarget) {
				continue;
			}
			if (line === normTarget + "/") {
				continue;
			}
			paths.push(line);
		}

		return paths;
	}

	/**
	 * Reads and decodes a file from the CheerpX filesystem using base64.
	 * @param {string} filePath - File path to read.
	 * @returns {Promise<string>} Decoded file content, or empty string on failure/empty file.
	 */
	async readFile (filePath) {
		let cmd = "";
		let b64 = "";
		let bStr = "";
		let bytes = null;
		let dec = null;
		let decCode = "utf-8";
		let i = 0;

		cmd = `base64 "${filePath}" | tr -d '\\r\\n'`;
		b64 = await this.execSilentOutput(cmd);
		b64 = b64.trim();

		if (b64 === "") {
			return "";
		}

		try {
			bStr = atob(b64);
			bytes = new Uint8Array(bStr.length);
			for (i = 0; i < bStr.length; i++) {
				bytes[i] = bStr.charCodeAt(i);
			}
			if (this.runner !== null && typeof this.runner.decCode === "string" && this.runner.decCode !== "") {
				decCode = this.runner.decCode;
			}
			dec = new TextDecoder(decCode);
			return dec.decode(bytes);
		} catch (e) {
			console.warn(`[readFile] Failed to base64 decode file: ${filePath}`, e);
			return "";
		}
	}

	/**
	 * Resolves a single entry path (appending "/" if it is a directory) or null if skipped.
	 * @param {string} rawLine - Raw line from find output.
	 * @param {string} normTarget - Normalized target directory path.
	 * @returns {Promise<string|null>} Normalized entry path or null.
	 */
	async _resolveEntryPath (rawLine, normTarget) {
		let line = "";
		let dirCmd = "";
		let dirRes = "";

		line = rawLine.trim();
		if (line === "") {
			return null;
		}
		if (line === normTarget) {
			return null;
		}
		if (line === normTarget + "/") {
			return null;
		}
		if (line === "/") {
			return null;
		}

		dirCmd = `if [ -d "${line}" ]; then echo "YES"; else echo "NO"; fi`;
		dirRes = await this.execSilentOutput(dirCmd);
		dirRes = dirRes.trim();

		if (dirRes === "YES") {
			return line + "/";
		}
		return line;
	}

	/**
	 * Synchronizes directory entries and file contents into a path list and Map.
	 * @param {string} targetDir - Target directory path to sync.
	 * @returns {Promise<{paths: string[], fileMap: Map<string, string>}>} Synced paths and file contents.
	 */
	async syncWorkspaceFiles (targetDir) {
		let cmd = "";
		let rawOut = "";
		let lines = [];
		let paths = [];
		let fileMap = null;
		let i = 0;
		let line = "";
		let filePath = "";
		let content = "";
		let normTarget = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		fileMap = new Map();
		normTarget = targetDir.replace(/\/+$/, "");
		cmd = [
			`mkdir -p "${normTarget}" &&`,
			`find "${normTarget}" -mindepth 1 2>/dev/null | while IFS= read -r p; do`,
			`  if [ -d "$p" ]; then printf '%s/\n' "$p"; else printf '%s\n' "$p"; fi`,
			`done`
		].join(" ");

		rawOut = await this.execSilentOutput(cmd);
		lines = rawOut.split(/\r?\n/);

		for (i = 0; i < lines.length; i++) {
			line = lines[i].trim();
			if (line === "" || line === normTarget || line === normTarget + "/" || line === "/") {
				continue;
			}
			paths.push(line);
		}

		for (i = 0; i < paths.length; i++) {
			filePath = paths[i];
			if (!filePath.endsWith("/")) {
				content = await this.readFile(filePath);
				fileMap.set(filePath, content);
			}
		}

		return {
			paths: paths,
			fileMap: fileMap
		};
	}

	/**
	 * Checks for the workspace change flag file and resets it if present.
	 * @returns {Promise<boolean>} True if the change flag existed, false otherwise.
	 */
	async checkAndResetChangeFlag () {
		let cmd = "";
		let result = "";

		if (this.runner === null || this.runner.cx === null) {
			return false;
		}

		cmd = `if [ -f /tmp/workspace_changed ]; then rm -f /tmp/workspace_changed && echo "YES"; else echo "NO"; fi`;
		result = await this.execSilentOutput(cmd);
		result = result.trim();

		return result === "YES";
	}

	/**
	 * Counts the number of entries under a target directory.
	 * @param {string} targetDir - Target directory path.
	 * @returns {Promise<string>} Line count output from `wc -l`.
	 */
	async getWorkspaceCount (targetDir) {
		let cmd = "";
		let result = "";

		if (this.runner === null || this.runner.cx === null) {
			return "";
		}

		cmd = `find "${targetDir}" 2>/dev/null | wc -l`;
		result = await this.execSilentOutput(cmd);
		result = result.trim();

		return result;
	}
}