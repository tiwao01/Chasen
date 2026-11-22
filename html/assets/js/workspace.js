import { CheerpXRunner } from "./runprocess.js";
import { UiHelper } from "./ui.js";
import { TerminalManager } from "./terminal-manager.js";
import { InteractiveFileTreeManager } from "./interactive-file-tree-manager.js";
import { TabManager } from "./tab-manager.js";
import { EditorDockManager } from "./editor-dock-manager.js";
import { WorkspaceSyncController } from "./workspace-sync-controller.js";

const DEFAULT_LANG = "c";
const ROOT_DIR = "/workspace";
const CHEERPX_CHECK_INTERVAL_MS = 1000;

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
		this.lang = null;
		this.ui = new UiHelper();
		this.termMgr = new TerminalManager();
		this.treeMgr = new InteractiveFileTreeManager(this);
		this.tabMgr = new TabManager(this);
		this.editorMgr = new EditorDockManager(this);
		this.syncCtrl = new WorkspaceSyncController(this);
	}

	/**
	 * Returns open editor widgets map.
	 * @returns {Map<string, object>}
	 */
	get openWidgets () {
		return this.editorMgr.openWidgets;
	}

	/**
	 * Returns currently active editor widget.
	 * @returns {object|null}
	 */
	get activeWidget () {
		return this.editorMgr.activeWidget;
	}

	/**
	 * Returns cached workspace file contents map.
	 * @returns {Map<string, string>}
	 */
	get fileContents () {
		return this.syncCtrl.fileContents;
	}

	/**
	 * Sets cached workspace file contents map.
	 * @param {Map<string, string>} val - File contents map.
	 */
	set fileContents (val) {
		this.syncCtrl.fileContents = val;
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
				self.syncCtrl.recordTerminalInput(Date.now());
			});
		}

		this.editorMgr.initDockPanel();
		this.tabMgr.init();
		this.treeMgr.init();
		this.initEventListeners();

		await this.startCheerpX(badgeElm);

		await this.syncCtrl.startInotifyWatch();
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
					self.syncCtrl.handleWorkspaceChangeSignal();
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

			await this.syncCtrl.syncFromCheerpX();
		} catch (err) {
			console.error("Error starting CheerpX:", err);
			this.ui.updateBadgeError(badgeElm, err.message);
		}
	}

	/**
	 * Registers DOM and window event listeners for workspace actions and layout updates.
	 * @returns {void}
	 */
	initEventListeners () {
		let newFileElm = null;
		let newFolderElm = null;
		let refreshElm = null;
		let collapseElm = null;
		let self = null;
		let exportElm = null;
		let importElm = null;

		self = this;
		newFileElm = document.getElementById("btn-new-file");
		if (newFileElm !== null) {
			newFileElm.addEventListener("click", () => {
				self.syncCtrl.handleNewFile();
			});
		}

		newFolderElm = document.getElementById("btn-new-folder");
		if (newFolderElm !== null) {
			newFolderElm.addEventListener("click", () => {
				self.syncCtrl.handleNewFolder();
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

		exportElm = document.getElementById("btn-export-chasen");
		if (exportElm !== null) {
			exportElm.addEventListener("click", async () => {
				await self.syncCtrl.exportWorkspaceToZip();
			});
		}

		importElm = document.getElementById("btn-import-chasen");
		if (importElm !== null) {
			importElm.addEventListener("click", async () => {
				let selectedFile = null;

				if (self.ui !== null && typeof self.ui.showZipDropDialog === "function") {
					selectedFile = await self.ui.showZipDropDialog();
				}
				if (selectedFile !== null && selectedFile !== undefined) {
					await self.syncCtrl.importWorkspaceFromZip(selectedFile);
				}
			});
		}

		window.addEventListener("resize", () => {
			self.handleResize();
		});
	}

	/**
	 * Updates terminal fit and dock panel layout on window resize.
	 * @returns {void}
	 */
	handleResize () {
		this.termMgr.fit();
		this.editorMgr.updateLayout();
	}

	/**
	 * Manually synchronizes workspace files and refreshes the file tree.
	 * @returns {Promise<void>}
	 */
	async handleRefreshTree () {
		await this.syncCtrl.syncFromCheerpX();
	}

	/**
	 * Collapses all folders in the file tree.
	 * @returns {void}
	 */
	handleCollapseAll () {
		if (this.treeMgr !== null) {
			this.treeMgr.collapseAll();
		}
	}

	/**
	 * Opens a file in an editor widget or activates an existing tab.
	 * @param {string} path - Full file path to open.
	 * @returns {void}
	 */
	openFile (path) {
		this.editorMgr.openFile(path);
	}

	/**
	 * Closes an open tab for the given file path.
	 * @param {string} path - File path to close.
	 * @returns {boolean}
	 */
	closeFile (path) {
		return this.editorMgr.closeFile(path);
	}

	/**
	 * Closes all open tabs except keepPath.
	 * @param {string} keepPath - File path to keep open.
	 * @returns {void}
	 */
	closeOtherFiles (keepPath) {
		this.editorMgr.closeOtherFiles(keepPath);
	}

	/**
	 * Copies or moves a file or folder into destDir.
	 * @param {"copy"|"move"} mode - Operation mode.
	 * @param {string} sourcePath - Source path.
	 * @param {string} destDir - Target directory path.
	 * @param {boolean} isFolder - True if folder.
	 * @returns {Promise<void>}
	 */
	async transferItem (mode, sourcePath, destDir, isFolder) {
		await this.syncCtrl.transferItem(mode, sourcePath, destDir, isFolder);
	}

	/**
	 * Renames a file or folder from oldPath to newPath.
	 * @param {string} oldPath - Current path.
	 * @param {string} newPath - New path.
	 * @param {boolean} isFolder - True if folder.
	 * @returns {Promise<void>}
	 */
	async renamePath (oldPath, newPath, isFolder) {
		await this.syncCtrl.renamePath(oldPath, newPath, isFolder);
	}
}

let manager = null;
manager = new WorkspaceManager();
manager.init();