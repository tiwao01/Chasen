import { CheerpXRunner } from "./runprocess.js";
import { UiHelper } from "./ui.js";
import { DockPanel, Widget } from "@lumino/widgets";
import { EditorWidget } from "./editor-widget.js";
import { TerminalManager } from "./terminal-manager.js";
import { FileTreeManager } from "./file-tree-manager.js";
import { TabManager } from "./tab-manager.js";

const EXT_LANG_MAP = {
	c: "c",
	h: "c",
	cpp: "cpp",
	hpp: "cpp",
	cc: "cpp",
	py: "python",
	js: "javascript",
	ts: "typescript",
	html: "html",
	css: "css",
	json: "json",
	md: "markdown",
	sh: "shell",
	bash: "shell"
};

const DEFAULT_LANG = "c";
const EDITOR_LAYOUT_DELAY_MS = 50;
const ROOT_DIR = "/workspace";
const CHEERPX_CHECK_INTERVAL_MS = 1000;
const SYNC_DEBOUNCE_MS = 250;
const INPUT_COOLDOWN_MS = 250;
const MAX_SYNC_WAIT_MS = 1500;

self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		let workerScript = "";
		workerScript = `
			self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
			importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
		`;
		return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerScript)}`;
	}
};

/**
 * Coordinates the workspace UI, Monaco editors, terminal, file tree, and CheerpX runtime.
 */
export class WorkspaceManager {
	/**
	 * Initializes workspace state and helper managers.
	 */
	constructor () {
		this.runner = null;
		this.dockPanel = null;
		this.openWidgets = new Map();
		this.fileContents = new Map();
		this.activeWidget = null;
		this.lang = null;
		this.ui = new UiHelper();
		this.termMgr = new TerminalManager();
		this.treeMgr = new FileTreeManager(this);
		this.tabMgr = new TabManager(this);
		this.isWatching = false;
		this.hasPendingSync = false;
		this.firstPendingAt = 0;
		this.lastTerminalInputAt = 0;
		this.syncTimerId = null;
		this.isSyncing = false;
	}

	/**
	 * Initializes UI components, event listeners, CheerpX runtime, and initial file sync.
	 * @returns {Promise<void>}
	 */
	async init () {
		let params = null;
		let badgeElm = null;
		let self = null;

		self = this;
		params = new URLSearchParams(window.location.search);
		this.lang = params.get("lang");
		if (this.lang === null) {
			this.lang = DEFAULT_LANG;
		}

		badgeElm = document.getElementById("env-badge");
		this.ui.updateBadgeLoading(badgeElm, this.lang);

		this.termMgr.init();
		if (this.termMgr !== null && this.termMgr.term !== null) {
			this.termMgr.term.onData(() => {
				self.lastTerminalInputAt = Date.now();
			});
		}

		this.initDockPanel();
		this.tabMgr.init();
		this.treeMgr.init();
		this.initEventListeners();

		await this.startCheerpX(badgeElm);

		await this.startInotifyWatch();
	}

	/**
	 * Creates and attaches the Lumino DockPanel to the workspace container.
	 */
	initDockPanel () {
		let dockElm = null;

		dockElm = document.getElementById("dock-container");
		this.dockPanel = new DockPanel();
		this.dockPanel.node.style.height = "100%";
		this.dockPanel.node.style.width = "100%";
		Widget.attach(this.dockPanel, dockElm);
	}

	/**
	 * Starts the CheerpX Linux environment and waits until the instance is ready.
	 * @param {HTMLElement|null} badgeElm - Status badge element to update.
	 * @returns {Promise<void>}
	 */
	async startCheerpX (badgeElm) {
		let imgPath = "";
		let dbName = "";
		let overrideOptions = null;
		let checkInterval = null;
		let self = null;

		try {
			self = this;
			this.runner = new CheerpXRunner({
				onWorkspaceChange: () => {
					self.handleWorkspaceChangeSignal();
				}
			});
			imgPath = `/dist/rootfs-${this.lang}.ext2`;
			dbName = `cache_${this.lang}`;

			this.ui.updateBadgeRunning(badgeElm, this.lang);

			overrideOptions = {
				runOpt: {
					cwd: ROOT_DIR
				}
			};

			this.runner.runProcess("/bin/sh", [], this.termMgr.term, imgPath, dbName, overrideOptions);

			await new Promise((resolve) => {
				checkInterval = setInterval(() => {
					if (self.runner !== null) {
						if (self.runner.cx !== null) {
							clearInterval(checkInterval);
							resolve();
						}
					}
				}, CHEERPX_CHECK_INTERVAL_MS);
			});

			await this.syncFromCheerpX();
		} catch (err) {
			console.error("Error starting CheerpX:", err);
			this.ui.updateBadgeError(badgeElm, err.message);
		}
	}

	/**
	 * Marks workspace as dirty and schedules a deferred sync when not busy or typing.
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
		let syncRes = null;
		let paths = [];
		let fileMap = null;

		if (this.runner === null) {
			return;
		}

		if (this.runner.cx === null) {
			return;
		}

		syncRes = await this.runner.syncWorkspaceFiles(ROOT_DIR);
		paths = syncRes.paths;
		fileMap = syncRes.fileMap;

		if (fileMap instanceof Map) {
			this.fileContents = fileMap;
		} else {
			this.fileContents = new Map();
		}

		if (this.treeMgr !== null) {
			this.treeMgr.reload(paths);
		}
	}

	/**
	 * Starts watching ROOT_DIR using inotify inside CheerpX.
	 * @returns {Promise<void>}
	 */
	async startInotifyWatch () {
		if (this.isWatching) {
			console.log("[Watcher] Already watching");
			return;
		}

		if (this.runner === null || this.runner.cx === null) {
			return;
		}

		this.isWatching = true;
		await this.runner.startWorkspaceWatcher(ROOT_DIR);
		console.log("[Watcher] Started watching:", ROOT_DIR);
	}

	/**
	 * Registers DOM and window event listeners for workspace actions and layout updates.
	 */
	initEventListeners () {
		let newFileElm = null;
		let newFolderElm = null;
		let refreshElm = null;
		let collapseElm = null;
		let self = null;

		self = this;
		newFileElm = document.getElementById("btn-new-file");
		if (newFileElm !== null) {
			newFileElm.addEventListener("click", () => {
				self.handleNewFile();
			});
		}

		newFolderElm = document.getElementById("btn-new-folder");
		if (newFolderElm !== null) {
			newFolderElm.addEventListener("click", () => {
				self.handleNewFolder();
			});
		}

		refreshElm = document.getElementById("btn-refresh-tree");
		if (refreshElm !== null) {
			refreshElm.addEventListener("click", () => {
				self.handleRefreshTree();
			});
		}

		collapseElm = document.getElementById("btn-collapse-all");
		if (collapseElm !== null) {
			collapseElm.addEventListener("click", () => {
				self.handleCollapseAll();
			});
		}

		window.addEventListener("resize", () => {
			self.handleResize();
		});
	}

	/**
	 * Updates terminal fit and dock panel layout on window resize.
	 */
	handleResize () {
		this.termMgr.fit();
		if (this.dockPanel !== null) {
			this.dockPanel.update();
		}
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

		fileName = prompt("新規ファイル名を入力してください:");
		if (fileName === null) {
			return;
		}
		cleanName = fileName.trim().replace(/^\/+/, "");
		if (cleanName === "") {
			return;
		}

		baseDir = ROOT_DIR;
		if (this.treeMgr !== null) {
			baseDir = this.treeMgr.getTargetDirectory();
		}
		fullPath = baseDir + "/" + cleanName;

		if (!(this.fileContents instanceof Map)) {
			this.fileContents = new Map();
		}
		this.fileContents.set(fullPath, "");

		if (this.runner !== null) {
			await this.runner.writeFile(fullPath, "");
		}

		await this.syncFromCheerpX();
		this.openFile(fullPath);
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

		folderName = prompt("新規ディレクトリ名を入力してください:");
		if (folderName === null) {
			return;
		}
		cleanName = folderName.trim().replace(/^\/+|\/+$/g, "");
		if (cleanName === "") {
			return;
		}

		baseDir = ROOT_DIR;
		if (this.treeMgr !== null) {
			baseDir = this.treeMgr.getTargetDirectory();
			this.treeMgr.expandedPaths.add(baseDir);
		}
		fullPath = baseDir + "/" + cleanName;

		if (this.runner !== null) {
			if (typeof this.runner.createDirectory === "function") {
				await this.runner.createDirectory(fullPath);
			} else if (typeof this.runner.mkdir === "function") {
				await this.runner.mkdir(fullPath);
			} else {
				keepFilePath = fullPath + "/.gitkeep";
				await this.runner.writeFile(keepFilePath, "");
				if (typeof this.runner.removeFile === "function") {
					await this.runner.removeFile(keepFilePath);
				}
			}
		}

		if (this.treeMgr !== null) {
			this.treeMgr.expandedPaths.add(fullPath);
		}
		await this.syncFromCheerpX();
	}

	/**
	 * Gets the latest content of a file from an open editor widget if available, or fileContents cache.
	 * @param {string} filePath - File path to read.
	 * @returns {string} Latest file content.
	 */
	_getLatestFileContent (filePath) {
		let widget = null;
		let editorVal = "";

		if (this.openWidgets instanceof Map && this.openWidgets.has(filePath) === true) {
			widget = this.openWidgets.get(filePath);
			if (widget !== null && widget !== undefined) {
				if (typeof widget.getValue === "function") {
					editorVal = widget.getValue();
					if (this.fileContents instanceof Map) {
						this.fileContents.set(filePath, editorVal);
					}
					return editorVal;
				}
			}
		}

		if (this.fileContents instanceof Map && this.fileContents.has(filePath) === true) {
			return this.fileContents.get(filePath);
		}
		return "";
	}

	/**
	 * Updates an already-open editor widget's content for destPath if open.
	 * @param {string} destPath - Destination file path.
	 * @param {string} content - New file content.
	 * @returns {void}
	 */
	_updateOpenEditorContent (destPath, content) {
		let widget = null;

		if (!(this.openWidgets instanceof Map)) {
			return;
		}
		if (this.openWidgets.has(destPath) === false) {
			return;
		}
		widget = this.openWidgets.get(destPath);
		if (widget === null || widget === undefined) {
			return;
		}
		if (typeof widget.setEditorContent === "function") {
			widget.setEditorContent(content, true);
		} else if (widget.editor !== null && widget.editor !== undefined && typeof widget.editor.setValue === "function") {
			widget.editor.setValue(content);
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
		let normSrc = "";
		let normDestDir = "";
		let baseName = "";
		let destPath = "";
		let exists = false;
		let shouldOverwrite = false;

		if (this.runner === null || this.runner.cx === null) {
			return;
		}
		if (this.treeMgr !== null && this.treeMgr.canTransfer(sourcePath, destDir, mode) === false) {
			return;
		}

		normSrc = sourcePath.replace(/\/+$/, "");
		normDestDir = destDir.replace(/\/+$/, "");
		baseName = normSrc.split("/").pop();
		destPath = normDestDir + "/" + baseName;

		if (normSrc === destPath) {
			return;
		}

		if (typeof this.runner.pathExists === "function") {
			exists = await this.runner.pathExists(destPath);
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
					await this.runner.removeFile(destPath);
				}
				await this.runner.copyFile(normSrc, destPath);
				if (isFolder === false) {
					this._copySingleFileCacheAndEditor(normSrc, destPath);
				} else {
					this._copyCachedEntries(normSrc, destPath, true);
				}
			} else {
				if (exists === true) {
					await this.runner.removeFile(destPath);
				}
				if (typeof this.runner.movePath === "function") {
					await this.runner.movePath(normSrc, destPath);
				} else {
					await this.runner.copyFile(normSrc, destPath);
					await this.runner.removeFile(normSrc);
				}
				this._migrateCachedAndOpenEntries(normSrc, destPath, isFolder === true);
			}

			if (this.treeMgr !== null) {
				this.treeMgr.expandedPaths.add(normDestDir);
				if (isFolder === true) {
					this.treeMgr.expandedPaths.add(destPath);
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

		content = this._getLatestFileContent(srcPath);
		if (this.fileContents instanceof Map) {
			this.fileContents.set(destPath, content);
		}
		this._updateOpenEditorContent(destPath, content);
	}

	/**
	 * Renames a file or folder from oldPath to newPath and updates open widgets and caches.
	 * @param {string} oldPath - Current path.
	 * @param {string} newPath - New path.
	 * @param {boolean} isFolder - True if target is a folder.
	 * @returns {Promise<void>}
	 */
	async renamePath (oldPath, newPath, isFolder) {
		let normOld = "";
		let normNew = "";
		let parentDir = "";

		if (this.runner === null || this.runner.cx === null) {
			return;
		}
		normOld = oldPath.replace(/\/+$/, "");
		normNew = newPath.replace(/\/+$/, "");
		if (normOld === normNew) {
			return;
		}

		this.isSyncing = true;
		try {
			if (typeof this.runner.movePath === "function") {
				await this.runner.movePath(normOld, normNew);
			} else {
				await this.runner.copyFile(normOld, normNew);
				await this.runner.removeFile(normOld);
			}
			this._migrateCachedAndOpenEntries(normOld, normNew, isFolder === true);

			parentDir = normNew.substring(0, normNew.lastIndexOf("/"));
			if (parentDir !== "" && this.treeMgr !== null) {
				this.treeMgr.expandedPaths.add(parentDir);
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

		widgetEntries = Array.from(this.openWidgets.entries());
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
				this.openWidgets.delete(key);
				this.openWidgets.set(mappedKey, widget);
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
	 * Closes an open tab for the given file path.
	 * @param {string} path - File path to close.
	 * @returns {boolean} True if closed, false if canceled.
	 */
	closeFile (path) {
		let widget = null;
		let shouldDiscard = false;
		let remaining = [];
		let nextWidget = null;

		if (!(this.openWidgets instanceof Map) || this.openWidgets.has(path) === false) {
			return false;
		}

		widget = this.openWidgets.get(path);
		if (widget !== null && widget !== undefined && widget.isDirty === true) {
			shouldDiscard = confirm(`"${path}" には保存されていない変更があります。破棄して閉じますか？`);
			if (shouldDiscard === false) {
				return false;
			}
		}

		this.openWidgets.delete(path);
		if (widget !== null && widget !== undefined) {
			widget.dispose();
		}

		if (this.activeWidget === widget) {
			this.activeWidget = null;
			remaining = Array.from (this.openWidgets.values ());
			if (remaining.length > 0) {
				nextWidget = remaining[remaining.length - 1];
				this._focusEditorWidget (nextWidget);
			}
		}

		if (this.tabMgr !== null && this.tabMgr !== undefined) {
			this.tabMgr.render();
		}
		return true;
	}

	/**
	 * Closes all open tabs except the specified keepPath.
	 * @param {string} keepPath - File path to keep open.
	 * @returns {void}
	 */
	closeOtherFiles (keepPath) {
		let keys = [];
		let i = 0;
		let k = "";
		let keepWidget = null;

		if (!(this.openWidgets instanceof Map)) {
			return;
		}

		keys = Array.from(this.openWidgets.keys());
		for (i = 0; i < keys.length; i++) {
			k = keys[i];
			if (k === keepPath) {
				continue;
			}
			this.closeFile(k);
		}

		if (this.openWidgets.has(keepPath) === true) {
			keepWidget = this.openWidgets.get(keepPath);
			this.dockPanel.activateWidget(keepWidget);
			this.activeWidget = keepWidget;
			if (keepWidget !== null && keepWidget.editor !== null && keepWidget.editor !== undefined) {
				keepWidget.editor.layout();
			}
		}

		if (this.tabMgr !== null && this.tabMgr !== undefined) {
			this.tabMgr.render();
		}
	}

	/**
	 * Manually synchronizes workspace files and refreshes the file tree.
	 * @returns {Promise<void>}
	 */
	async handleRefreshTree () {
		await this.syncFromCheerpX();
	}

	/**
	 * Collapses all folders in the file tree.
	 */
	handleCollapseAll () {
		if (this.treeMgr !== null) {
			this.treeMgr.collapseAll();
		}
	}

	/**
	 * Brings a specific editor widget to the front and updates active tab state.
	 * @param {EditorWidget} widget - Target editor widget.
	 * @returns {void}
	 */
	_focusEditorWidget (widget) {
		let allWidgets = [];
		let i = 0;
		let w = null;

		if (widget === null || widget === undefined) {
			return;
		}

		if (this.openWidgets instanceof Map) {
			allWidgets = Array.from (this.openWidgets.values ());
			for (i = 0; i < allWidgets.length; i++) {
				w = allWidgets[i];
				if (w !== null && w !== undefined && w !== widget) {
					w.hide ();
				}
			}
		}

		widget.show ();
		this.activeWidget = widget;

		if (this.dockPanel !== null && this.dockPanel !== undefined) {
			this.dockPanel.activateWidget (widget);
			this.dockPanel.update ();
		}

		if (widget.editor !== null && widget.editor !== undefined) {
			setTimeout (() => {
				if (widget.editor !== null && widget.editor !== undefined) {
					widget.editor.layout ();
					if (typeof widget.editor.focus === "function") {
						widget.editor.focus ();
					}
				}
			}, EDITOR_LAYOUT_DELAY_MS);
		}

		if (this.tabMgr !== null && this.tabMgr !== undefined) {
			this.tabMgr.render ();
		}
	}

	/**
	 * Opens a file in a Monaco editor widget inside the dock panel or activates an existing one.
	 * @param {string} path - Full file path to open.
	 */
	openFile (path) {
		let widget = null;
		let content = "";
		let fileName = "";
		let monacoLang = "";

		if (this.openWidgets.has (path)) {
			widget = this.openWidgets.get (path);
			this._focusEditorWidget (widget);
			return;
		}

		if (this.fileContents instanceof Map) {
			content = this.fileContents.get (path);
		}
		if (content === undefined) {
			content = "";
		}

		fileName = path.split ("/").pop ();
		monacoLang = this.detectLanguage (fileName);

		widget = new EditorWidget (path, content, monacoLang, fileName, this);
		this.openWidgets.set (path, widget);

		widget.title.closable = true;
		widget.disposed.connect (() => {
			this.openWidgets.delete (path);
			if (this.tabMgr !== null && this.tabMgr !== undefined) {
				this.tabMgr.render ();
			}
		});

		this.dockPanel.addWidget (widget);
		this._focusEditorWidget (widget);
	}

	/**
	 * Detects the Monaco language identifier from a file name extension.
	 * @param {string|null} fileName - Target file name.
	 * @returns {string} Monaco language ID or "plaintext".
	 */
	detectLanguage (fileName) {
		let ext = "";
		let lang = "";

		if (fileName === null) {
			return "plaintext";
		}

		ext = fileName.split(".").pop().toLowerCase();
		lang = EXT_LANG_MAP[ext];

		if (lang === undefined) {
			return "plaintext";
		}

		return lang;
	}
}

let manager = null;
manager = new WorkspaceManager();
manager.init();