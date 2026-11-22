const ROOT_DIR = "/workspace";
const SYNC_DEBOUNCE_MS = 250;
const INPUT_COOLDOWN_MS = 250;
const MAX_SYNC_WAIT_MS = 1500;

/**
 * Handles CheerpX workspace file synchronization, watcher lifecycle,
 * file/folder creation, copy/move/rename operations, and cache migration.
 */
export class WorkspaceSyncController {
	/**
	 * Creates a new WorkspaceSyncController instance.
	 * @param {object} mgr - WorkspaceManager instance.
	 */
	constructor (mgr) {
		this.mgr = mgr;
		this.fileContents = new Map();
		this.isWatching = false;
		this.hasPendingSync = false;
		this.firstPendingAt = 0;
		this.lastTerminalInputAt = 0;
		this.syncTimerId = null;
		this.isSyncing = false;
		this.isTransferringZip = false;
	}

	/**
	 * Records the timestamp of recent terminal input for sync deferral.
	 * @param {number} [timestamp] - Epoch milliseconds.
	 * @returns {void}
	 */
	recordTerminalInput (timestamp) {
		if (timestamp !== undefined) {
			this.lastTerminalInputAt = timestamp;
		} else {
			this.lastTerminalInputAt = Date.now();
		}
	}

	/**
	 * Marks workspace as dirty and schedules a deferred sync when not busy or typing.
	 * @returns {void}
	 */
	handleWorkspaceChangeSignal () {
		let now = 0;

		now = Date.now();
		if (this.hasPendingSync === false) {
			this.firstPendingAt = now;
		}
		this.hasPendingSync = true;
		this._scheduleDeferredSync();
	}

	/**
	 * Schedules syncFromCheerpX while deferring during active sync or recent terminal input.
	 * @returns {void}
	 */
	_scheduleDeferredSync () {
		let self = null;

		self = this;
		if (this.syncTimerId !== null) {
			clearTimeout(this.syncTimerId);
			this.syncTimerId = null;
		}

		this.syncTimerId = setTimeout(async () => {
			let now = 0;
			let elapsedSinceInput = 0;
			let totalWaited = 0;

			self.syncTimerId = null;
			if (self.hasPendingSync === false) {
				return;
			}

			now = Date.now();
			totalWaited = now - self.firstPendingAt;

			if (self.isSyncing === true) {
				self._scheduleDeferredSync();
				return;
			}

			elapsedSinceInput = now - self.lastTerminalInputAt;
			if (elapsedSinceInput < INPUT_COOLDOWN_MS && totalWaited < MAX_SYNC_WAIT_MS) {
				self._scheduleDeferredSync();
				return;
			}

			self.hasPendingSync = false;
			self.firstPendingAt = 0;
			self.isSyncing = true;
			try {
				await self.syncFromCheerpX();
			} finally {
				self.isSyncing = false;
				if (self.hasPendingSync === true) {
					self._scheduleDeferredSync();
				}
			}
		}, SYNC_DEBOUNCE_MS);
	}

	/**
	 * Syncs workspace files and paths from CheerpX into `fileContents` and the file tree.
	 * @returns {Promise<void>}
	 */
	async syncFromCheerpX () {
		let runner = null;
		let syncRes = null;
		let paths = [];
		let fileMap = null;

		if (this.mgr === null || this.mgr.runner === null) {
			return;
		}
		runner = this.mgr.runner;

		if (runner.cx === null) {
			return;
		}

		syncRes = await runner.syncWorkspaceFiles(ROOT_DIR);
		paths = syncRes.paths;
		fileMap = syncRes.fileMap;

		if (fileMap instanceof Map) {
			this.fileContents = fileMap;
		} else {
			this.fileContents = new Map();
		}

		if (this.mgr.treeMgr !== null) {
			this.mgr.treeMgr.reload(paths);
		}
	}

	/**
	 * Starts watching ROOT_DIR using watcher inside CheerpX.
	 * @returns {Promise<void>}
	 */
	async startInotifyWatch () {
		let runner = null;

		if (this.isWatching) {
			console.log("[Watcher] Already watching");
			return;
		}

		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			return;
		}

		runner = this.mgr.runner;
		this.isWatching = true;
		await runner.startWorkspaceWatcher(ROOT_DIR);
		console.log("[Watcher] Started watching:", ROOT_DIR);
	}

	/**
	 * Prompts for a new file name, creates it in CheerpX, syncs the workspace, and opens it.
	 * @returns {Promise<void>}
	 */
	async handleNewFile () {
		let fileName = "";
		let baseDir = "";
		let cleanName = "";
		let fullPath = "";
		let runner = null;

		fileName = prompt("新規ファイル名を入力してください:");
		if (fileName === null) {
			return;
		}
		cleanName = fileName.trim().replace(/^\/+/, "");
		if (cleanName === "") {
			return;
		}

		baseDir = ROOT_DIR;
		if (this.mgr !== null && this.mgr.treeMgr !== null) {
			baseDir = this.mgr.treeMgr.getTargetDirectory();
		}
		fullPath = baseDir + "/" + cleanName;

		if (!(this.fileContents instanceof Map)) {
			this.fileContents = new Map();
		}
		this.fileContents.set(fullPath, "");

		runner = this.mgr !== null ? this.mgr.runner : null;
		if (runner !== null) {
			await runner.writeFile(fullPath, "");
		}

		await this.syncFromCheerpX();
		if (this.mgr !== null && this.mgr.editorMgr !== null) {
			this.mgr.editorMgr.openFile(fullPath);
		}
	}

	/**
	 * Prompts for a new directory name, creates it in CheerpX, and syncs the workspace.
	 * @returns {Promise<void>}
	 */
	async handleNewFolder () {
		let folderName = "";
		let cleanName = "";
		let baseDir = "";
		let fullPath = "";
		let keepFilePath = "";
		let runner = null;

		folderName = prompt("新規ディレクトリ名を入力してください:");
		if (folderName === null) {
			return;
		}
		cleanName = folderName.trim().replace(/^\/+|\/+$/g, "");
		if (cleanName === "") {
			return;
		}

		baseDir = ROOT_DIR;
		if (this.mgr !== null && this.mgr.treeMgr !== null) {
			baseDir = this.mgr.treeMgr.getTargetDirectory();
			this.mgr.treeMgr.expandedPaths.add(baseDir);
		}
		fullPath = baseDir + "/" + cleanName;

		runner = this.mgr !== null ? this.mgr.runner : null;
		if (runner !== null) {
			if (typeof runner.createDirectory === "function") {
				await runner.createDirectory(fullPath);
			} else if (typeof runner.mkdir === "function") {
				await runner.mkdir(fullPath);
			} else {
				keepFilePath = fullPath + "/.gitkeep";
				await runner.writeFile(keepFilePath, "");
				if (typeof runner.removeFile === "function") {
					await runner.removeFile(keepFilePath);
				}
			}
		}

		if (this.mgr !== null && this.mgr.treeMgr !== null) {
			this.mgr.treeMgr.expandedPaths.add(fullPath);
		}
		await this.syncFromCheerpX();
	}

	/**
	 * Creates an empty file at fullPath, syncs workspace, and opens it in the editor.
	 * @param {string} fullPath - Full target file path.
	 * @returns {Promise<void>}
	 */
	async createFileAtPath (fullPath) {
		let runner = null;

		if (fullPath === "") {
			return;
		}

		if (!(this.fileContents instanceof Map)) {
			this.fileContents = new Map();
		}
		this.fileContents.set(fullPath, "");

		runner = this.mgr !== null ? this.mgr.runner : null;
		if (runner !== null) {
			await runner.writeFile(fullPath, "");
		}

		await this.syncFromCheerpX();
		if (this.mgr !== null && this.mgr.editorMgr !== null) {
			this.mgr.editorMgr.openFile(fullPath);
		}
	}

	/**
	 * Creates a directory at fullPath and syncs the workspace.
	 * @param {string} fullPath - Full target directory path.
	 * @returns {Promise<void>}
	 */
	async createFolderAtPath (fullPath) {
		let keepFilePath = "";
		let runner = null;

		if (fullPath === "") {
			return;
		}

		runner = this.mgr !== null ? this.mgr.runner : null;
		if (runner !== null) {
			if (typeof runner.createDirectory === "function") {
				await runner.createDirectory(fullPath);
			} else if (typeof runner.mkdir === "function") {
				await runner.mkdir(fullPath);
			} else {
				keepFilePath = fullPath + "/.gitkeep";
				await runner.writeFile(keepFilePath, "");
				if (typeof runner.removeFile === "function") {
					await runner.removeFile(keepFilePath);
				}
			}
		}

		await this.syncFromCheerpX();
	}

	/**
	 * Deletes a file or directory at targetPath, closes matching editor tabs, and syncs.
	 * @param {string} targetPath - Full path to remove.
	 * @param {boolean} isFolder - True if target is a directory.
	 * @returns {Promise<void>}
	 */
	async deletePath (targetPath, isFolder) {
		let runner = null;
		let normTarget = "";
		let openKeys = [];
		let i = 0;
		let key = "";

		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			return;
		}
		normTarget = targetPath.replace(/\/+$/, "");
		if (normTarget === "" || normTarget === ROOT_DIR) {
			return;
		}

		runner = this.mgr.runner;
		this.isSyncing = true;
		try {
			if (typeof runner.removeFile === "function") {
				await runner.removeFile(normTarget);
			}

			if (this.fileContents instanceof Map) {
				if (isFolder === true) {
					openKeys = Array.from(this.fileContents.keys());
					for (i = 0; i < openKeys.length; i++) {
						key = openKeys[i];
						if (key === normTarget || key.startsWith(normTarget + "/")) {
							this.fileContents.delete(key);
						}
					}
				} else {
					this.fileContents.delete(normTarget);
				}
			}

			if (this.mgr.editorMgr !== null && this.mgr.editorMgr.openWidgets instanceof Map) {
				openKeys = Array.from(this.mgr.editorMgr.openWidgets.keys());
				for (i = 0; i < openKeys.length; i++) {
					key = openKeys[i];
					if (isFolder === true) {
						if (key === normTarget || key.startsWith(normTarget + "/")) {
							this.mgr.editorMgr.closeFile(key);
						}
					} else if (key === normTarget) {
						this.mgr.editorMgr.closeFile(key);
					}
				}
			}

			await this.syncFromCheerpX();
		} finally {
			this.isSyncing = false;
			if (this.hasPendingSync === true) {
				this._scheduleDeferredSync();
			}
		}
	}

	/**
	 * Closes editor tabs corresponding to a deleted file or directory.
	 * @param {string} targetPath - Normalized deleted path without trailing slash.
	 * @param {boolean} isFolder - True if target is a directory.
	 * @returns {void}
	 */
	_closeTabsForDeletedPath (targetPath, isFolder) {
		let openWidgets = null;
		let keys = [];
		let i = 0;
		let key = "";

		if (this.mgr === null || typeof this.mgr.closeFile !== "function") {
			return;
		}
		openWidgets = this.mgr.openWidgets;
		if (!(openWidgets instanceof Map)) {
			return;
		}

		keys = Array.from (openWidgets.keys ());
		for (i = 0; i < keys.length; i++) {
			key = keys[i];
			if (isFolder === true) {
				if (key === targetPath || key.startsWith (targetPath + "/")) {
					this.mgr.closeFile (key);
				}
			} else if (key === targetPath) {
				this.mgr.closeFile (key);
			}
		}
	}

	/**
	 * Copies or moves a file or folder into destDir and synchronizes the workspace.
	 * @param {"copy"|"move"} mode - Operation mode.
	 * @param {string} sourcePath - Source file or directory path.
	 * @param {string} destDir - Target directory path.
	 * @param {boolean} isFolder - True if sourcePath is a directory.
	 * @returns {Promise<void>}
	 */
	async transferItem (mode, sourcePath, destDir, isFolder) {
		let runner = null;
		let normSrc = "";
		let normDestDir = "";
		let baseName = "";
		let destPath = "";
		let exists = false;
		let shouldOverwrite = false;

		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			return;
		}
		if (this.mgr.treeMgr !== null && this.mgr.treeMgr.canTransfer(sourcePath, destDir, mode) === false) {
			return;
		}

		runner = this.mgr.runner;
		normSrc = sourcePath.replace(/\/+$/, "");
		normDestDir = destDir.replace(/\/+$/, "");
		baseName = normSrc.split("/").pop();
		destPath = normDestDir + "/" + baseName;

		if (normSrc === destPath) {
			return;
		}

		if (typeof runner.pathExists === "function") {
			exists = await runner.pathExists(destPath);
			if (exists === true) {
				shouldOverwrite = confirm(`"${destPath}" はすでに存在します。上書きしますか？`);
				if (shouldOverwrite === false) {
					return;
				}
			}
		}

		this.isSyncing = true;
		try {
			if (mode === "copy") {
				if (exists === true) {
					await runner.removeFile(destPath);
				}
				await runner.copyFile(normSrc, destPath);
				if (isFolder === false) {
					this._copySingleFileCacheAndEditor(normSrc, destPath);
				} else {
					this._copyCachedEntries(normSrc, destPath, true);
				}
			} else {
				if (exists === true) {
					await runner.removeFile(destPath);
				}
				if (typeof runner.movePath === "function") {
					await runner.movePath(normSrc, destPath);
				} else {
					await runner.copyFile(normSrc, destPath);
					await runner.removeFile(normSrc);
				}
				this._migrateCachedAndOpenEntries(normSrc, destPath, isFolder === true);
			}

			if (this.mgr.treeMgr !== null) {
				this.mgr.treeMgr.expandedPaths.add(normDestDir);
				if (isFolder === true) {
					this.mgr.treeMgr.expandedPaths.add(destPath);
				}
			}

			await this.syncFromCheerpX();
		} finally {
			this.isSyncing = false;
			if (this.hasPendingSync === true) {
				this._scheduleDeferredSync();
			}
		}
	}

	/**
	 * Copies single-file content into fileContents and updates open editor if destPath is open.
	 * @param {string} srcPath - Source file path.
	 * @param {string} destPath - Destination file path.
	 * @returns {void}
	 */
	_copySingleFileCacheAndEditor (srcPath, destPath) {
		let content = "";

		if (this.mgr !== null && this.mgr.editorMgr !== null) {
			content = this.mgr.editorMgr.getLatestFileContent(srcPath);
		} else if (this.fileContents instanceof Map && this.fileContents.has(srcPath) === true) {
			content = this.fileContents.get(srcPath);
		}

		if (this.fileContents instanceof Map) {
			this.fileContents.set(destPath, content);
		}
		if (this.mgr !== null && this.mgr.editorMgr !== null) {
			this.mgr.editorMgr.updateOpenEditorContent(destPath, content);
		}
	}

	/**
	 * Renames a file or folder from oldPath to newPath and updates open widgets and caches.
	 * @param {string} oldPath - Current path.
	 * @param {string} newPath - New path.
	 * @param {boolean} isFolder - True if target is a folder.
	 * @returns {Promise<void>}
	 */
	async renamePath (oldPath, newPath, isFolder) {
		let runner = null;
		let normOld = "";
		let normNew = "";
		let parentDir = "";

		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			return;
		}
		runner = this.mgr.runner;
		normOld = oldPath.replace(/\/+$/, "");
		normNew = newPath.replace(/\/+$/, "");
		if (normOld === normNew) {
			return;
		}

		this.isSyncing = true;
		try {
			if (typeof runner.movePath === "function") {
				await runner.movePath(normOld, normNew);
			} else {
				await runner.copyFile(normOld, normNew);
				await runner.removeFile(normOld);
			}
			this._migrateCachedAndOpenEntries(normOld, normNew, isFolder === true);

			parentDir = normNew.substring(0, normNew.lastIndexOf("/"));
			if (parentDir !== "" && this.mgr.treeMgr !== null) {
				this.mgr.treeMgr.expandedPaths.add(parentDir);
			}
			await this.syncFromCheerpX();
		} finally {
			this.isSyncing = false;
			if (this.hasPendingSync === true) {
				this._scheduleDeferredSync();
			}
		}
	}

	/**
	 * Copies cached fileContents entries from srcPath to destPath.
	 * @param {string} srcPath - Source path.
	 * @param {string} destPath - Destination path.
	 * @param {boolean} isFolder - True if copying a directory.
	 * @returns {void}
	 */
	_copyCachedEntries (srcPath, destPath, isFolder) {
		let entries = [];
		let i = 0;
		let key = "";
		let val = "";
		let mappedKey = "";

		if (!(this.fileContents instanceof Map)) {
			return;
		}

		if (isFolder === false) {
			if (this.fileContents.has(srcPath) === true) {
				this.fileContents.set(destPath, this.fileContents.get(srcPath));
			}
			return;
		}

		entries = Array.from(this.fileContents.entries());
		for (i = 0; i < entries.length; i++) {
			key = entries[i][0];
			val = entries[i][1];
			if (key.startsWith(srcPath + "/")) {
				mappedKey = destPath + key.substring(srcPath.length);
				this.fileContents.set(mappedKey, val);
			}
		}
	}

	/**
	 * Migrates fileContents and openWidgets when a file or folder is moved or renamed.
	 * @param {string} oldPath - Previous path.
	 * @param {string} newPath - New path.
	 * @param {boolean} isFolder - True if moving a directory.
	 * @returns {void}
	 */
	_migrateCachedAndOpenEntries (oldPath, newPath, isFolder) {
		let entries = [];
		let i = 0;
		let key = "";
		let val = "";
		let mappedKey = "";
		let openWidgets = null;
		let widgetEntries = [];
		let widget = null;

		if (this.fileContents instanceof Map) {
			if (isFolder === false) {
				if (this.fileContents.has(oldPath) === true) {
					val = this.fileContents.get(oldPath);
					this.fileContents.delete(oldPath);
					this.fileContents.set(newPath, val);
				}
			} else {
				entries = Array.from(this.fileContents.entries());
				for (i = 0; i < entries.length; i++) {
					key = entries[i][0];
					val = entries[i][1];
					if (key.startsWith(oldPath + "/")) {
						mappedKey = newPath + key.substring(oldPath.length);
						this.fileContents.delete(key);
						this.fileContents.set(mappedKey, val);
					}
				}
			}
		}

		openWidgets = this.mgr !== null && this.mgr.editorMgr !== null ? this.mgr.editorMgr.openWidgets : null;
		if (!(openWidgets instanceof Map)) {
			return;
		}

		widgetEntries = Array.from(openWidgets.entries());
		for (i = 0; i < widgetEntries.length; i++) {
			key = widgetEntries[i][0];
			widget = widgetEntries[i][1];
			mappedKey = "";

			if (isFolder === false && key === oldPath) {
				mappedKey = newPath;
			} else if (isFolder === true && key.startsWith(oldPath + "/")) {
				mappedKey = newPath + key.substring(oldPath.length);
			}

			if (mappedKey !== "") {
				openWidgets.delete(key);
				openWidgets.set(mappedKey, widget);
				if (widget !== null && widget !== undefined) {
					widget.title.label = mappedKey.split("/").pop();
					widget.fp = mappedKey;
					widget.fn = mappedKey.split("/").pop();
					if ("filePath" in widget) {
						widget.filePath = mappedKey;
					}
				}
			}
		}
	}

	/**
	 * Shows a toast notification via UiHelper using #toast element.
	 * @param {string} msg - Message to display.
	 * @returns {void}
	 */
	_notifyToast (msg) {
		let toastElm = null;

		toastElm = document.getElementById("toast");
		if (toastElm !== null && this.mgr !== null && this.mgr.ui !== null) {
			this.mgr.ui.showToast(toastElm, msg);
		}
	}

	/**
	 * Flushes currently open editor widget contents to CheerpX before export.
	 * @returns {Promise<void>}
	 */
	async _flushOpenEditorsToCheerpX () {
		let runner = null;
		let openWidgets = null;
		let entries = [];
		let i = 0;
		let filePath = "";
		let content = "";

		if (this.mgr === null || this.mgr.runner === null || this.mgr.editorMgr === null) {
			return;
		}
		runner = this.mgr.runner;
		openWidgets = this.mgr.editorMgr.openWidgets;
		if (!(openWidgets instanceof Map)) {
			return;
		}

		entries = Array.from(openWidgets.entries());
		for (i = 0; i < entries.length; i++) {
			filePath = entries[i][0];
			if (filePath.startsWith(ROOT_DIR + "/") === false) {
				continue;
			}
			if (typeof this.mgr.editorMgr.getLatestFileContent === "function") {
				content = this.mgr.editorMgr.getLatestFileContent(filePath);
				await runner.writeFile(filePath, content);
			}
		}
	}

	/**
	 * Closes all currently open editor tabs.
	 * @returns {void}
	 */
	_closeAllEditorTabs () {
		let openWidgets = null;
		let keys = [];
		let i = 0;

		if (this.mgr === null || this.mgr.editorMgr === null) {
			return;
		}
		openWidgets = this.mgr.editorMgr.openWidgets;
		if (!(openWidgets instanceof Map)) {
			return;
		}

		keys = Array.from(openWidgets.keys());
		for (i = 0; i < keys.length; i++) {
			this.mgr.editorMgr.closeFile(keys[i]);
		}
	}

	/**
	 * Compresses /workspace into a ZIP file and triggers browser download.
	 * @returns {Promise<void>}
	 */
	async exportWorkspaceToZip () {
		let runner = null;
		let tmpZipPath = "";
		let bytes = null;
		let blob = null;
		let url = "";
		let anchor = null;
		let langName = "";
		let progress = null;

		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			this._notifyToast("環境がまだ準備できていません。");
			return;
		}
		if (this.isTransferringZip === true) {
			this._notifyToast("処理中です。完了までお待ちください。");
			return;
		}

		runner = this.mgr.runner;
		tmpZipPath = "/tmp/workspace_export.zip";
		this.isTransferringZip = true;
		this.isSyncing = true;

		if (this.mgr.ui !== null && typeof this.mgr.ui.showProgressDialog === "function") {
			progress = this.mgr.ui.showProgressDialog("ZIPダウンロード", "エディタの内容を反映中...");
			progress.update("エディタの内容を反映中...", 15);
		}

		try {
			await this._flushOpenEditorsToCheerpX();
			if (progress !== null) {
				progress.update(`${ROOT_DIR} をZIP圧縮中...`, 45);
			}
			await runner.createZipArchive(ROOT_DIR, tmpZipPath);
			if (progress !== null) {
				progress.update("ZIPデータを読み込み中...", 80);
			}
			bytes = await runner.readFileBytes(tmpZipPath);

			if (bytes === null || bytes.length === 0) {
				throw new Error("ZIPデータが空です");
			}

			langName = "workspace";
			if (typeof this.mgr.lang === "string" && this.mgr.lang !== "") {
				langName = `workspace_${this.mgr.lang}`;
			}

			if (progress !== null) {
				progress.update("ダウンロードを開始中...", 100);
			}
			blob = new Blob([bytes], { type: "application/zip" });
			url = URL.createObjectURL(blob);
			anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${langName}.zip`;
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			setTimeout(() => {
				URL.revokeObjectURL(url);
			}, 1000);

			this._notifyToast("ZIPをダウンロードしました。");
		} catch (err) {
			console.error("Failed to export workspace ZIP:", err);
			this._notifyToast(`ダウンロードに失敗しました: ${err.message}`);
		} finally {
			if (progress !== null) {
				progress.close();
			}
			try {
				await runner.removeFile(tmpZipPath);
			} catch (e) {
				// Ignore cleanup failure
			}
			this.isSyncing = false;
			this.isTransferringZip = false;
			if (this.hasPendingSync === true) {
				this._scheduleDeferredSync();
			}
		}
	}

	/**
	 * Prompts confirmation, validates uploaded ZIP, replaces /workspace completely, and syncs UI.
	 * @param {File} file - Selected ZIP file from input element.
	 * @returns {Promise<void>}
	 */
	async importWorkspaceFromZip (file) {
		let runner = null;
		let confirmed = false;
		let arrayBuf = null;
		let bytes = null;
		let tmpZipPath = "";
		let replaced = false;
		let progress = null;

		if (file === null || file === undefined) {
			return;
		}
		if (this.mgr === null || this.mgr.runner === null || this.mgr.runner.cx === null) {
			this._notifyToast("環境がまだ準備できていません。");
			return;
		}
		if (this.isTransferringZip === true) {
			this._notifyToast("処理中です。完了までお待ちください。");
			return;
		}
		if (file.name.toLowerCase().endsWith(".zip") === false) {
			this._notifyToast("ZIPファイル（.zip）を選択してください。");
			return;
		}

		if (this.mgr.ui !== null && typeof this.mgr.ui.showConfirmDialog === "function") {
			confirmed = await this.mgr.ui.showConfirmDialog(
				"ワークスペースの置き換え",
				`現在の ${ROOT_DIR} 内のファイル・ディレクトリはすべて削除され、「${file.name}」の内容で完全に作り直されます。この操作は元に戻せません。続行しますか？`,
				"OK"
			);
		}
		if (confirmed === false) {
			return;
		}

		runner = this.mgr.runner;
		tmpZipPath = "/tmp/workspace_import.zip";
		this.isTransferringZip = true;
		this.isSyncing = true;

		if (this.mgr.ui !== null && typeof this.mgr.ui.showProgressDialog === "function") {
			progress = this.mgr.ui.showProgressDialog("ZIPアップロード", "ZIPファイルを読み込み中...");
			progress.update("ZIPファイルを読み込み中...", 15);
		}

		try {
			arrayBuf = await file.arrayBuffer();
			bytes = new Uint8Array(arrayBuf);
			if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
				throw new Error("有効なZIPファイルではありません");
			}
			if (typeof runner.fs !== "undefined" && typeof runner.fs.validateZipEntriesSafe === "function") {
				runner.fs.validateZipEntriesSafe(bytes);
			}

			if (progress !== null) {
				progress.update("環境へZIPを転送中...", 40);
			}
			await runner.writeFileBytes(tmpZipPath, bytes);

			if (progress !== null) {
				progress.update("安全性を検証して /workspace を置き換え中...", 70);
			}
			await runner.replaceDirectoryFromZip(tmpZipPath, ROOT_DIR);
			replaced = true;

			this._closeAllEditorTabs();
			this.fileContents = new Map();
			if (this.mgr.treeMgr !== null) {
				this.mgr.treeMgr.expandedPaths = new Set([ROOT_DIR]);
			}

			this.hasPendingSync = false;
			this.firstPendingAt = 0;

			if (progress !== null) {
				progress.update("ファイルツリーを同期中...", 90);
			}
			await this.syncFromCheerpX();
			if (progress !== null) {
				progress.update("完了しました", 100);
				progress.close();
				progress = null;
			}
			this._notifyToast("ZIPからワークスペースを復元しました。");
		} catch (err) {
			console.error("Failed to import workspace ZIP:", err);
			if (progress !== null) {
				progress.close();
				progress = null;
			}
			if (replaced === true) {
				this._notifyToast("復元は完了しましたが、表示の更新に失敗しました。更新ボタンを押してください。");
			} else {
				this._notifyToast(`アップロードに失敗しました: ${err.message}`);
			}
		} finally {
			if (progress !== null) {
				progress.close();
				progress = null;
			}
			this.isSyncing = false;
			this.isTransferringZip = false;
		}
	}
}