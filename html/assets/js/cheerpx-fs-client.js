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
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isCapturing = false;
		result = this.captureBuffer;
		this.captureBuffer = "";

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
		let bStr = "";
		let b64 = "";
		let cmd = "";
		let i = 0;

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		enc = new TextEncoder();
		bytes = enc.encode(content);
		for (i = 0; i < bytes.length; i++) {
			bStr = bStr + String.fromCharCode(bytes[i]);
		}
		b64 = btoa(bStr);

		this.isSilent = true;
		cmd = `mkdir -p "$(dirname "${filePath}")" && echo "${b64}" | base64 -d > "${filePath}" && sync >/dev/null 2>&1`;
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isSilent = false;
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
		cmd = `mkdir -p "${dirPath}" && sync >/dev/null 2>&1`;
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isSilent = false;
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
		cmd = `rm -rf "${filePath}" && sync >/dev/null 2>&1`;
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isSilent = false;
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
		cmd = `mkdir -p "$(dirname "${destPath}")" && cp -r "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isSilent = false;
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
		cmd = `mkdir -p "$(dirname "${destPath}")" && mv "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
		await this.runner.cx.run("/bin/sh", ["-c", cmd], this.runner.runOpt);
		this.isSilent = false;
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
		let entryPath = null;
		let filePath = "";
		let content = "";
		let normTarget = "";

		if (this.runner === null || this.runner.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		fileMap = new Map();
		cmd = `mkdir -p "${targetDir}" && find "${targetDir}" -mindepth 1 2>/dev/null`;
		rawOut = await this.execSilentOutput(cmd);
		lines = rawOut.split(/\r?\n/);
		normTarget = targetDir.replace(/\/+$/, "");

		for (i = 0; i < lines.length; i++) {
			entryPath = await this._resolveEntryPath(lines[i], normTarget);
			if (entryPath !== null) {
				paths.push(entryPath);
			}
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