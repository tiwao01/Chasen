import * as CheerpX from "https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js";
import { CheerpXFsClient } from "./cheerpx-fs-client.js";
import { WorkspaceWatcher } from "./workspace-watcher.js";

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
		let onWsChange = null;

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

		if (defaultOptions !== undefined) {
			if (defaultOptions.decCode !== undefined) {
				this.decCode = defaultOptions.decCode;
			}
			if (typeof defaultOptions.onWorkspaceChange === "function") {
				onWsChange = defaultOptions.onWorkspaceChange;
			}
			this._applyRunOptions(this.runOpt, defaultOptions.runOpt);
		}

		this.fs = new CheerpXFsClient(this);
		this.watcher = new WorkspaceWatcher(this, onWsChange);
	}

	/**
	 * Gets whether silent console mode is active.
	 * @returns {boolean}
	 */
	get isSilent () {
		return this.fs.isSilent;
	}

	/**
	 * Sets whether silent console mode is active.
	 * @param {boolean} val - True to suppress terminal writes.
	 */
	set isSilent (val) {
		this.fs.isSilent = val;
	}

	/**
	 * Gets captured console output buffer.
	 * @returns {string}
	 */
	get captureBuffer () {
		return this.fs.captureBuffer;
	}

	/**
	 * Sets captured console output buffer.
	 * @param {string} val - Buffer string.
	 */
	set captureBuffer (val) {
		this.fs.captureBuffer = val;
	}

	/**
	 * Gets whether console output capture is active.
	 * @returns {boolean}
	 */
	get isCapturing () {
		return this.fs.isCapturing;
	}

	/**
	 * Sets whether console output capture is active.
	 * @param {boolean} val - True to capture output.
	 */
	set isCapturing (val) {
		this.fs.isCapturing = val;
	}

	/**
	 * Gets workspace change callback.
	 * @returns {Function|null}
	 */
	get onWorkspaceChange () {
		return this.watcher.onWorkspaceChange;
	}

	/**
	 * Sets workspace change callback.
	 * @param {Function|null} val - Callback function.
	 */
	set onWorkspaceChange (val) {
		this.watcher.setOnWorkspaceChange(val);
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
	 * Starts a background watcher loop inside CheerpX for targetDir.
	 * @param {string} targetDir - Directory path to watch.
	 * @returns {Promise<void>}
	 */
	async startWorkspaceWatcher (targetDir) {
		await this.watcher.startWorkspaceWatcher(targetDir);
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
		await this.fs.writeFile(filePath, content);
	}

	/**
	 * Creates a directory (including parent directories) inside the CheerpX filesystem.
	 * @param {string} dirPath - Directory path to create.
	 * @returns {Promise<void>}
	 */
	async createDirectory (dirPath) {
		await this.fs.createDirectory(dirPath);
	}

	/**
	 * Checks whether a file or directory exists at targetPath inside CheerpX.
	 * @param {string} targetPath - Target path to check.
	 * @returns {Promise<boolean>} True if the path exists.
	 */
	async pathExists (targetPath) {
		return await this.fs.pathExists(targetPath);
	}

	/**
	 * Checks whether targetPath is a directory inside CheerpX.
	 * @param {string} targetPath - Target path to check.
	 * @returns {Promise<boolean>} True if the path is a directory.
	 */
	async isDirectory (targetPath) {
		return await this.fs.isDirectory(targetPath);
	}

	/**
	 * Removes a file or directory inside the CheerpX filesystem.
	 * @param {string} filePath - Target path to remove.
	 * @returns {Promise<void>}
	 */
	async removeFile (filePath) {
		await this.fs.removeFile(filePath);
	}

	/**
	 * Copies a file or directory inside the CheerpX filesystem.
	 * @param {string} srcPath - Source path.
	 * @param {string} destPath - Destination path.
	 * @returns {Promise<void>}
	 */
	async copyFile (srcPath, destPath) {
		await this.fs.copyFile(srcPath, destPath);
	}

	/**
	 * Moves (renames or relocates) a file or directory inside the CheerpX filesystem.
	 * @param {string} srcPath - Source path.
	 * @param {string} destPath - Destination path.
	 * @returns {Promise<void>}
	 */
	async movePath (srcPath, destPath) {
		await this.fs.movePath(srcPath, destPath);
	}

	/**
	 * Executes a shell command and captures its console output without writing to terminal.
	 * @param {string} cmd - Shell command to execute.
	 * @returns {Promise<string>} Captured output string.
	 */
	async execSilentOutput (cmd) {
		return await this.fs.execSilentOutput(cmd);
	}

	/**
	 * Lists entry paths under a target directory excluding the directory itself.
	 * @param {string} targetDir - Directory path to scan.
	 * @returns {Promise<string[]>} List of found paths.
	 */
	async listFiles (targetDir) {
		return await this.fs.listFiles(targetDir);
	}

	/**
	 * Reads and decodes a file from the CheerpX filesystem using base64.
	 * @param {string} filePath - File path to read.
	 * @returns {Promise<string>} Decoded file content, or empty string on failure/empty file.
	 */
	async readFile (filePath) {
		return await this.fs.readFile(filePath);
	}

	/**
	 * Synchronizes directory entries and file contents into a path list and Map.
	 * @param {string} targetDir - Target directory path to sync.
	 * @returns {Promise<{paths: string[], fileMap: Map<string, string>}>} Synced paths and file contents.
	 */
	async syncWorkspaceFiles (targetDir) {
		return await this.fs.syncWorkspaceFiles(targetDir);
	}

	/**
	 * Checks for the workspace change flag file and resets it if present.
	 * @returns {Promise<boolean>} True if the change flag existed, false otherwise.
	 */
	async checkAndResetChangeFlag () {
		return await this.fs.checkAndResetChangeFlag();
	}

	/**
	 * Counts the number of entries under a target directory.
	 * @param {string} targetDir - Target directory path.
	 * @returns {Promise<string>} Line count output from `wc -l`.
	 */
	async getWorkspaceCount (targetDir) {
		return await this.fs.getWorkspaceCount(targetDir);
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
					if (this.fs.isCapturing) {
						this.fs.captureBuffer = this.fs.captureBuffer + txt;
						return;
					}
					if (this.fs.isSilent) {
						return;
					}
					cleanedTxt = this.watcher.consumeChangeMarkers(txt);
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