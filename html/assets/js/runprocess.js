import * as CheerpX from "https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js";

const WORKSPACE_CHANGE_MARKER = "__CX_WS_CHANGED__";

/**
 * Wrapper class for managing and interacting with a CheerpX Linux instance.
 */
export class CheerpXRunner {
	/**
	 * Initializes a CheerpXRunner instance with optional default settings.
	 * @param {Object} [defaultOptions] - Optional default configuration.
	 * @param {string} [defaultOptions.decCode] - Default text decoder encoding.
	 * @param {Object} [defaultOptions.runOpt] - Default process execution options.
	 * @param {Function} [defaultOptions.onWorkspaceChange] - Callback invoked when workspace changes are detected.
	 */
	constructor (defaultOptions) {
		let defRunOpt = null;

		defRunOpt = {
			env: [
				"HOME=/root",
				"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
				"TERM=xterm-256color",
				"COLORTERM=truecolor",
				"LANG=C.UTF-8"
			],
			cwd: "/root",
			uid: 0,
			gid: 0
		};

		this.decCode = "utf-8";
		this.runOpt = defRunOpt;
		this.cx = null;
		this.sendFunc = null;
		this.isSilent = false;
		this.captureBuffer = "";
		this.isCapturing = false;
		this.onWorkspaceChange = null;
		this._lineCarry = "";

		if (defaultOptions === undefined) {
			return;
		}
		if (defaultOptions.decCode !== undefined) {
			this.decCode = defaultOptions.decCode;
		}
		if (typeof defaultOptions.onWorkspaceChange === "function") {
			this.onWorkspaceChange = defaultOptions.onWorkspaceChange;
		}
		this._applyRunOptions(this.runOpt, defaultOptions.runOpt);
	}

	/**
	 * Applies partial run options onto a target options object.
	 * @param {Object} targetOpt - Target run options object to mutate.
	 * @param {Object} [srcOpt] - Source run options to apply.
	 */
	_applyRunOptions (targetOpt, srcOpt) {
		if (srcOpt === undefined) {
			return;
		}
		if (srcOpt.env !== undefined) {
			targetOpt.env = srcOpt.env;
		}
		if (srcOpt.cwd !== undefined) {
			targetOpt.cwd = srcOpt.cwd;
		}
		if (srcOpt.uid !== undefined) {
			targetOpt.uid = srcOpt.uid;
		}
		if (srcOpt.gid !== undefined) {
			targetOpt.gid = srcOpt.gid;
		}
	}

	/**
	 * Filters workspace change markers out of console text and triggers callback.
	 * @param {string} chunk - Decoded console output chunk.
	 * @returns {string} Chunk with marker lines removed.
	 */
	_consumeChangeMarkers (chunk) {
		let combined = "";
		let endsWithNewline = false;
		let parts = [];
		let tail = "";
		let cleanTail = "";
		let filtered = [];
		let i = 0;
		let line = "";
		let hasChanged = false;
		let result = "";

		combined = this._lineCarry + chunk;
		this._lineCarry = "";
		endsWithNewline = combined.endsWith("\n");
		parts = combined.split("\n");

		if (endsWithNewline === false) {
			tail = parts.pop();
			if (tail === undefined) {
				tail = "";
			}
			cleanTail = tail.replace(/\r$/, "");
			if (cleanTail === WORKSPACE_CHANGE_MARKER || (cleanTail.startsWith("__CX_") && WORKSPACE_CHANGE_MARKER.startsWith(cleanTail))) {
				this._lineCarry = tail;
			} else {
				filtered.push(tail);
			}
		}

		for (i = 0; i < parts.length; i++) {
			if (endsWithNewline === true && i === parts.length - 1 && parts[i] === "") {
				continue;
			}
			line = parts[i].replace(/\r$/, "");
			if (line === WORKSPACE_CHANGE_MARKER) {
				hasChanged = true;
			} else {
				filtered.push(parts[i]);
			}
		}

		if (hasChanged === true) {
			if (typeof this.onWorkspaceChange === "function") {
				this.onWorkspaceChange();
			}
		}

		result = filtered.join("\n");
		if (endsWithNewline === true && filtered.length > 0) {
			result = result + "\n";
		}

		return result;
	}

	/**
	 * Starts a background inotify watcher inside CheerpX for targetDir.
	 * @param {string} targetDir - Directory path to watch.
	 * @returns {Promise<void>}
	 */
	async startWorkspaceWatcher (targetDir) {
		let watchCmd = "";
		let runOpt = null;

		if (this.cx === null) {
			return;
		}

		runOpt = {
			env: this.runOpt.env,
			cwd: targetDir,
			uid: this.runOpt.uid,
			gid: this.runOpt.gid
		};

		watchCmd = [
			`mkdir -p "${targetDir}"`,
			`prev_snap=""`,
			`while true; do`,
			`  cur_snap=$(find "${targetDir}" -printf '%y %p %T@ %s\n' 2>/dev/null || ls -laR "${targetDir}" 2>/dev/null)`,
			`  if [ "$cur_snap" != "$prev_snap" ]; then`,
			`    prev_snap="$cur_snap"`,
			`    echo "${WORKSPACE_CHANGE_MARKER}"`,
			`  fi`,
			`  sleep 0.5`,
			`done`
		].join("\n");

		this.cx.run("/bin/sh", ["-c", watchCmd], runOpt).catch((err) => {
			console.warn("[Watcher] Watch loop ended:", err);
		});
	}

	/**
	 * Sends a command string byte-by-byte to the active console input callback.
	 * @param {string} cmdStr - Command string to send.
	 */
	sendCommand (cmdStr) {
		let enc = null;
		let bytes = null;
		let i = 0;

		if (this.sendFunc === null) {
			return;
		}

		enc = new TextEncoder();
		bytes = enc.encode(cmdStr);
		for (i = 0; i < bytes.length; i++) {
			this.sendFunc(bytes[i]);
		}
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

		if (this.cx === null) {
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
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isSilent = false;
	}

	/**
	 * Creates a directory (including parent directories) inside the CheerpX filesystem.
	 * @param {string} dirPath - Directory path to create.
	 * @returns {Promise<void>}
	 */
	async createDirectory (dirPath) {
		let cmd = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `mkdir -p "${dirPath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
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

		if (this.cx === null) {
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

		if (this.cx === null) {
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

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `rm -rf "${filePath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
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

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `mkdir -p "$(dirname "${destPath}")" && cp -r "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
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

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `mkdir -p "$(dirname "${destPath}")" && mv "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isSilent = false;
	}

	/**
	 * Executes a shell command and captures its console output without writing to terminal.
	 * @param {string} cmd - Shell command to execute.
	 * @returns {Promise<string>} Captured output string.
	 */
	async execSilentOutput (cmd) {
		let result = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.captureBuffer = "";
		this.isCapturing = true;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isCapturing = false;
		result = this.captureBuffer;
		this.captureBuffer = "";

		return result;
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
			dec = new TextDecoder(this.decCode);
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

		if (this.cx === null) {
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

		if (this.cx === null) {
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

		if (this.cx === null) {
			return "";
		}

		cmd = `find "${targetDir}" 2>/dev/null | wc -l`;
		result = await this.execSilentOutput(cmd);
		result = result.trim();

		return result;
	}

	/**
	 * Initializes CheerpX devices/Linux instance, binds terminal I/O, and runs a process.
	 * @param {string} exPath - Executable path to run.
	 * @param {string[]} args - Arguments passed to the executable.
	 * @param {Object} term - Terminal instance with `cols`, `rows`, `write`, and `onData`.
	 * @param {string} imgPath - URL or path to the disk image for HttpBytesDevice.
	 * @param {string} dbName - IndexedDB name for IDBDevice.
	 * @param {Object} [overrideOptions] - Optional per-run overrides for `decCode`, `runOpt`, and `onWorkspaceChange`.
	 * @returns {Promise<void>}
	 */
	async runProcess (exPath, args, term, imgPath, dbName, overrideOptions) {
		let httpDev = null;
		let idbDev = null;
		let overlayDev = null;
		let dec = null;
		let enc = null;
		let decCode = "";
		let runOpt = null;
		let txt = "";
		let cleanedTxt = "";
		let normd = "";
		let bData = null;
		let j = 0;

		decCode = this.decCode;
		runOpt = {
			env: this.runOpt.env,
			cwd: this.runOpt.cwd,
			uid: this.runOpt.uid,
			gid: this.runOpt.gid
		};

		if (overrideOptions !== undefined) {
			if (overrideOptions.decCode !== undefined) {
				decCode = overrideOptions.decCode;
			}
			if (typeof overrideOptions.onWorkspaceChange === "function") {
				this.onWorkspaceChange = overrideOptions.onWorkspaceChange;
			}
			this._applyRunOptions(runOpt, overrideOptions.runOpt);
		}

		try {
			httpDev = await CheerpX.HttpBytesDevice.create(imgPath);
			idbDev = await CheerpX.IDBDevice.create(dbName);
			overlayDev = await CheerpX.OverlayDevice.create(httpDev, idbDev);

			this.cx = await CheerpX.Linux.create(
				{
					mounts: [
						{
							type: "ext2",
							path: "/",
							dev: overlayDev
						},
						{
							type: "devs",
							path: "/dev"
						}
					]
				}
			);

			dec = new TextDecoder(decCode);
			this.sendFunc = this.cx.setCustomConsole(
				(buf) => {
					txt = dec.decode(
						buf,
						{
							stream: true
						}
					);
					if (this.isCapturing) {
						this.captureBuffer = this.captureBuffer + txt;
						return;
					}
					if (this.isSilent) {
						return;
					}
					cleanedTxt = this._consumeChangeMarkers(txt);
					if (cleanedTxt === "") {
						return;
					}
					normd = cleanedTxt.replace(/\n/g, "\r\n");
					term.write(normd);
				},
				term.cols,
				term.rows
			);

			enc = new TextEncoder();
			term.onData(
				(str) => {
					bData = enc.encode(str);
					for (j = 0; j < bData.length; j++) {
						this.sendFunc(bData[j]);
					}
				}
			);

			await this.cx.run(exPath, args, runOpt);
		} catch (err) {
			console.error("Error starting process:", err);
		}
	}
}