import { FileTreeManager, ROOT_DIR } from "./file-tree-manager.js";

const SKIP_DELETE_CONFIRM_KEY = "workspace_skip_delete_confirm_v1";

/**
 * Extends FileTreeManager with drag-and-drop, clipboard copy/cut/paste, and context menu interactions.
 */
export class InteractiveFileTreeManager extends FileTreeManager {
	/**
	 * Creates a new InteractiveFileTreeManager instance.
	 * @param {object} mgr - Workspace manager instance providing file actions, content cache, and runner.
	 */
	constructor (mgr) {
		super (mgr);
		this.clipboard = null;
		this._dragSourceNode = null;
		this._contextMenuElm = null;
		this._deleteDialogElm = null;
	}

	/**
	 * Binds drag-and-drop, keyboard shortcut, and context menu listeners after tree initialization.
	 * @param {HTMLElement|null} treeElm - File tree container element.
	 * @returns {void}
	 */
	_onAfterInit (treeElm) {
		super._onAfterInit (treeElm);
		this._bindDragAndDrop (treeElm);
		this._bindKeyboardShortcuts (treeElm);
		this._bindContextMenu (treeElm);
	}

	/**
	 * Resolves a Wunderbaum node from a DOM event target or active node fallback.
	 * @param {EventTarget|null} target - Event target element.
	 * @returns {object|null} Resolved Wunderbaum node or null.
	 */
	_resolveContextNode (target) {
		let el = null;
		let nodeEl = null;
		let node = null;

		if (this.tree === null) {
			return null;
		}

		if (target !== null && target !== undefined && typeof target.closest === "function") {
			el = target;
			if (typeof this.tree.getNode === "function") {
				node = this.tree.getNode (el);
				if (node !== null && node !== undefined) {
					return node;
				}
				nodeEl = el.closest (".wb-node");
				if (nodeEl !== null) {
					node = this.tree.getNode (nodeEl);
					if (node !== null && node !== undefined) {
						return node;
					}
				}
			}
		}

		node = this.getActiveNodeSafe ();
		if (node !== null && node !== undefined) {
			return node;
		}

		return null;
	}

	/**
	 * Binds right-click context menu on the tree container and outside-click dismissal.
	 * @param {HTMLElement|null} treeElm - File tree container element.
	 * @returns {void}
	 */
	_bindContextMenu (treeElm) {
		let self = null;

		if (treeElm === null) {
			return;
		}
		self = this;

		treeElm.addEventListener ("contextmenu", (ev) => {
			let node = null;
			let targetPath = "";
			let isFolder = false;

			ev.preventDefault ();
			ev.stopPropagation ();

			node = self._resolveContextNode (ev.target);
			if (node !== null && node !== undefined && typeof node.setActive === "function") {
				node.setActive (true);
			}

			targetPath = self.getNodePath (node);
			if (targetPath === "") {
				targetPath = ROOT_DIR;
				isFolder = true;
			} else {
				isFolder = self.isNodeFolder (node);
			}

			self.openContextMenu (ev.clientX, ev.clientY, targetPath, isFolder, node);
		});

		document.addEventListener ("click", () => {
			self.closeContextMenu ();
		});

		document.addEventListener ("keydown", (ev) => {
			if (ev.key === "Escape") {
				self.closeContextMenu ();
				self.closeDeleteDialog ();
			}
		});
	}

	/**
	 * Closes the currently open file tree context menu if present.
	 * @returns {void}
	 */
	closeContextMenu () {
		if (this._contextMenuElm !== null && this._contextMenuElm.parentNode !== null) {
			this._contextMenuElm.parentNode.removeChild (this._contextMenuElm);
		}
		this._contextMenuElm = null;
	}

	/**
	 * Helper to create a menu button element.
	 * @param {string} label - Menu item text.
	 * @param {Function} onClick - Click handler.
	 * @param {boolean} [disabled] - Whether item is disabled.
	 * @returns {HTMLButtonElement}
	 */
	_createMenuButton (label, onClick, disabled) {
		let btn = null;
		let self = null;

		self = this;
		btn = document.createElement ("button");
		btn.type = "button";
		btn.className = "editor-tab-context-item";
		btn.textContent = label;
		if (disabled === true) {
			btn.disabled = true;
		}
		btn.addEventListener ("click", (ev) => {
			ev.stopPropagation ();
			self.closeContextMenu ();
			if (disabled !== true) {
				onClick ();
			}
		});
		return btn;
	}

	/**
	 * Helper to create a menu divider element.
	 * @returns {HTMLHRElement}
	 */
	_createMenuDivider () {
		let hr = null;

		hr = document.createElement ("hr");
		hr.className = "file-tree-context-divider";
		return hr;
	}

	/**
	 * Opens the file tree context menu at (x, y) for targetPath.
	 * @param {number} x - Client X coordinate.
	 * @param {number} y - Client Y coordinate.
	 * @param {string} targetPath - Target file or directory path.
	 * @param {boolean} isFolder - True if target is a folder.
	 * @param {object|null} node - Wunderbaum node if available.
	 * @returns {void}
	 */
	openContextMenu (x, y, targetPath, isFolder, node) {
		let menu = null;
		let normPath = "";
		let isRoot = false;
		let self = null;

		this.closeContextMenu ();
		self = this;
		normPath = targetPath.replace (/\/+$/, "");
		if (normPath === "") {
			normPath = ROOT_DIR;
		}
		isRoot = normPath === ROOT_DIR;

		menu = document.createElement ("div");
		menu.className = "editor-tab-context-menu file-tree-context-menu";
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;

		menu.appendChild (this._createMenuButton ("新規ファイル", async () => {
			await self.handleContextNewFile ();
		}));

		menu.appendChild (this._createMenuButton ("新規ディレクトリ", async () => {
			await self.handleContextNewFolder ();
		}));

		menu.appendChild (this._createMenuDivider ());

		menu.appendChild (this._createMenuButton ("名前の変更", () => {
			self.handleContextRename (normPath, isFolder, node);
		}, isRoot));

		menu.appendChild (this._createMenuButton ("更新", async () => {
			if (self.mgr !== null && typeof self.mgr.handleRefreshTree === "function") {
				await self.mgr.handleRefreshTree ();
			}
		}));

		menu.appendChild (this._createMenuButton ("削除", async () => {
			await self.handleContextDelete (normPath, isFolder);
		}, isRoot));

		menu.appendChild (this._createMenuDivider ());

		menu.appendChild (this._createMenuButton ("パスのコピー", async () => {
			await self.handleCopyPath (normPath, false);
		}));

		menu.appendChild (this._createMenuButton ("相対パスのコピー", async () => {
			await self.handleCopyPath (normPath, true);
		}));

		menu.appendChild (this._createMenuDivider ());

		menu.appendChild (this._createMenuButton ("ダウンロード", async () => {
			await self.handleDownloadFile (normPath, isFolder);
		}, isFolder));

		document.body.appendChild (menu);
		this._contextMenuElm = menu;
	}

	/**
	 * Prompts for a relative path from /workspace and creates a new file.
	 * @returns {Promise<void>}
	 */
	async handleContextNewFile () {
		let inputVal = "";
		let relPath = "";
		let fullPath = "";
		let parentDir = "";

		inputVal = prompt (`新規ファイルのパスを入力してください（${ROOT_DIR} からの相対パス）:`, "");
		if (inputVal === null) {
			return;
		}
		relPath = inputVal.trim ().replace (/^\/+|\/+$/g, "");
		if (relPath === "") {
			return;
		}

		fullPath = ROOT_DIR + "/" + relPath;
		if (this._isPathAlreadyExists (fullPath) === true) {
			alert (`"${fullPath}" はすでに存在します。`);
			return;
		}

		parentDir = fullPath.substring (0, fullPath.lastIndexOf ("/"));
		this._expandAncestors (parentDir);

		if (this.mgr !== null && this.mgr.syncCtrl !== null) {
			await this.mgr.syncCtrl.createFileAtPath (fullPath);
		}
	}

	/**
	 * Prompts for a relative path from /workspace and creates a new directory.
	 * @returns {Promise<void>}
	 */
	async handleContextNewFolder () {
		let inputVal = "";
		let relPath = "";
		let fullPath = "";

		inputVal = prompt (`新規ディレクトリのパスを入力してください（${ROOT_DIR} からの相対パス）:`, "");
		if (inputVal === null) {
			return;
		}
		relPath = inputVal.trim ().replace (/^\/+|\/+$/g, "");
		if (relPath === "") {
			return;
		}

		fullPath = ROOT_DIR + "/" + relPath;
		if (this._isPathAlreadyExists (fullPath) === true) {
			alert (`"${fullPath}" はすでに存在します。`);
			return;
		}

		this._expandAncestors (fullPath);

		if (this.mgr !== null && this.mgr.syncCtrl !== null) {
			await this.mgr.syncCtrl.createFolderAtPath (fullPath);
		}
	}

	/**
	 * Prompts for a new name and renames the target item with duplicate-name guard.
	 * @param {string} targetPath - Current full path.
	 * @param {boolean} isFolder - True if target is a folder.
	 * @param {object|null} node - Target Wunderbaum node.
	 * @returns {Promise<void>}
	 */
	async handleContextRename (targetPath, isFolder, node) {
		let currentName = "";
		let newName = "";
		let parentDir = "";
		let newPath = "";

		if (targetPath === "" || targetPath === ROOT_DIR) {
			return;
		}
		currentName = targetPath.split ("/").pop ();
		newName = prompt ("新しい名前を入力してください:", currentName);
		if (newName === null) {
			return;
		}
		newName = newName.trim ();
		if (newName === "") {
			return;
		}
		if (newName.indexOf ("/") !== -1) {
			alert ("名前に '/' は使用できません。");
			return;
		}
		if (newName === currentName) {
			return;
		}

		parentDir = targetPath.substring (0, targetPath.lastIndexOf ("/"));
		newPath = parentDir + "/" + newName;

		if (this._isPathAlreadyExists (newPath) === true) {
			alert (`"${newName}" はすでに存在します。別の名前を指定してください。`);
			return;
		}

		if (node !== null && node !== undefined) {
			node.title = newName;
			node.data.path = newPath;
			node.key = newPath;
		}

		if (this.mgr !== null && typeof this.mgr.renamePath === "function") {
			await this.mgr.renamePath (targetPath, newPath, isFolder);
		}
	}

	/**
	 * Checks whether a file or directory path already exists in known tree paths or fileContents.
	 * @param {string} candidatePath - Full path without trailing slash.
	 * @returns {boolean}
	 */
	_isPathAlreadyExists (candidatePath) {
		let normCand = "";
		let i = 0;
		let p = "";

		normCand = candidatePath.replace (/\/+$/, "");
		if (normCand === ROOT_DIR) {
			return true;
		}

		if (this.mgr !== null && this.mgr.fileContents instanceof Map) {
			if (this.mgr.fileContents.has (normCand) === true) {
				return true;
			}
		}

		if (Array.isArray (this.lastPaths) === true) {
			for (i = 0; i < this.lastPaths.length; i++) {
				p = this.lastPaths[i].replace (/\/+$/, "");
				if (p === normCand) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Adds targetDir and all its ancestor directories under ROOT_DIR to expandedPaths.
	 * @param {string} targetDir - Directory path to expand ancestors for.
	 * @returns {void}
	 */
	_expandAncestors (targetDir) {
		let rel = "";
		let parts = [];
		let cur = "";
		let i = 0;

		if (targetDir === "" || targetDir === ROOT_DIR) {
			this.expandedPaths.add (ROOT_DIR);
			return;
		}
		if (targetDir.startsWith (ROOT_DIR + "/") === false) {
			return;
		}

		this.expandedPaths.add (ROOT_DIR);
		rel = targetDir.substring (ROOT_DIR.length + 1);
		parts = rel.split ("/");
		cur = ROOT_DIR;
		for (i = 0; i < parts.length; i++) {
			if (parts[i] === "") {
				continue;
			}
			cur = cur + "/" + parts[i];
			this.expandedPaths.add (cur);
		}
	}

	/**
	 * Deletes targetPath after showing a confirmation dialog (unless suppressed).
	 * @param {string} targetPath - Full path to delete.
	 * @param {boolean} isFolder - True if target is a folder.
	 * @returns {Promise<void>}
	 */
	async handleContextDelete (targetPath, isFolder) {
		let skipConfirm = false;
		let confirmed = false;

		if (targetPath === "" || targetPath === ROOT_DIR) {
			return;
		}

		try {
			skipConfirm = localStorage.getItem (SKIP_DELETE_CONFIRM_KEY) === "1";
		} catch (e) {
			skipConfirm = false;
		}

		if (skipConfirm === true) {
			confirmed = true;
		} else {
			confirmed = await this._showDeleteConfirmDialog (targetPath, isFolder);
		}

		if (confirmed === false) {
			return;
		}

		if (this.mgr !== null && this.mgr.syncCtrl !== null) {
			await this.mgr.syncCtrl.deletePath (targetPath, isFolder);
		}
	}

	/**
	 * Closes the custom delete confirmation modal if open.
	 * @returns {void}
	 */
	closeDeleteDialog () {
		if (this._deleteDialogElm !== null && this._deleteDialogElm.parentNode !== null) {
			this._deleteDialogElm.parentNode.removeChild (this._deleteDialogElm);
		}
		this._deleteDialogElm = null;
	}

	/**
	 * Shows a modal confirmation dialog with a "次回から表示しない" checkbox.
	 * @param {string} targetPath - Path to delete.
	 * @param {boolean} isFolder - True if folder.
	 * @returns {Promise<boolean>} True if user confirmed deletion.
	 */
	_showDeleteConfirmDialog (targetPath, isFolder) {
		let self = null;

		self = this;
		this.closeDeleteDialog ();

		return new Promise ((resolve) => {
			let backdrop = null;
			let dialog = null;
			let titleEl = null;
			let msgEl = null;
			let checkWrap = null;
			let checkbox = null;
			let checkLabel = null;
			let btnRow = null;
			let cancelBtn = null;
			let deleteBtn = null;
			let kindLabel = "";

			if (isFolder === true) {
				kindLabel = "ディレクトリ";
			} else {
				kindLabel = "ファイル";
			}

			backdrop = document.createElement ("div");
			backdrop.className = "ws-modal-backdrop";

			dialog = document.createElement ("div");
			dialog.className = "ws-modal-dialog";

			titleEl = document.createElement ("div");
			titleEl.className = "ws-modal-title";
			titleEl.textContent = `${kindLabel}の削除`;

			msgEl = document.createElement ("p");
			msgEl.className = "ws-modal-message";
			msgEl.textContent = `"${targetPath}" を削除しますか？この操作は元に戻せません。`;

			checkWrap = document.createElement ("label");
			checkWrap.className = "ws-modal-checkbox-row";

			checkbox = document.createElement ("input");
			checkbox.type = "checkbox";

			checkLabel = document.createElement ("span");
			checkLabel.textContent = "次回からこの確認ダイアログを表示しない";

			checkWrap.appendChild (checkbox);
			checkWrap.appendChild (checkLabel);

			btnRow = document.createElement ("div");
			btnRow.className = "ws-modal-actions";

			cancelBtn = document.createElement ("button");
			cancelBtn.type = "button";
			cancelBtn.className = "ws-modal-btn ws-modal-btn-cancel";
			cancelBtn.textContent = "キャンセル";
			cancelBtn.addEventListener ("click", () => {
				self.closeDeleteDialog ();
				resolve (false);
			});

			deleteBtn = document.createElement ("button");
			deleteBtn.type = "button";
			deleteBtn.className = "ws-modal-btn ws-modal-btn-danger";
			deleteBtn.textContent = "削除";
			deleteBtn.addEventListener ("click", () => {
				if (checkbox.checked === true) {
					try {
						localStorage.setItem (SKIP_DELETE_CONFIRM_KEY, "1");
					} catch (e) {
						// Ignore storage quota/permission errors
					}
				}
				self.closeDeleteDialog ();
				resolve (true);
			});

			btnRow.appendChild (cancelBtn);
			btnRow.appendChild (deleteBtn);

			dialog.appendChild (titleEl);
			dialog.appendChild (msgEl);
			dialog.appendChild (checkWrap);
			dialog.appendChild (btnRow);
			backdrop.appendChild (dialog);
			document.body.appendChild (backdrop);
			this._deleteDialogElm = backdrop;
		});
	}

	/**
	 * Copies either the full path or the /workspace-relative path to the clipboard.
	 * @param {string} targetPath - Full path.
	 * @param {boolean} relative - True to copy path relative to ROOT_DIR.
	 * @returns {Promise<void>}
	 */
	async handleCopyPath (targetPath, relative) {
		let copyText = "";
		let toastElm = null;

		copyText = targetPath;
		if (relative === true) {
			if (targetPath === ROOT_DIR) {
				copyText = ".";
			} else if (targetPath.startsWith (ROOT_DIR + "/")) {
				copyText = targetPath.substring (ROOT_DIR.length + 1);
			}
		}

		try {
			if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText (copyText);
			} else {
				this._fallbackCopyText (copyText);
			}
			toastElm = document.getElementById ("toast");
			if (toastElm !== null && this.mgr !== null && this.mgr.ui !== null) {
				this.mgr.ui.showToast (toastElm, `コピーしました: ${copyText}`);
			}
		} catch (e) {
			console.error ("Failed to copy path:", e);
		}
	}

	/**
	 * Fallback clipboard copy for non-secure or restricted contexts.
	 * @param {string} text - Text to copy.
	 * @returns {void}
	 */
	_fallbackCopyText (text) {
		let ta = null;

		ta = document.createElement ("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild (ta);
		ta.select ();
		document.execCommand ("copy");
		document.body.removeChild (ta);
	}

	/**
	 * Downloads a file from the workspace to the browser.
	 * @param {string} targetPath - Full file path.
	 * @param {boolean} isFolder - True if folder.
	 * @returns {Promise<void>}
	 */
	async handleDownloadFile (targetPath, isFolder) {
		let content = "";
		let blob = null;
		let url = "";
		let anchor = null;
		let fileName = "";

		if (isFolder === true || targetPath === ROOT_DIR) {
			return;
		}

		if (this.mgr !== null && this.mgr.editorMgr !== null && typeof this.mgr.editorMgr.getLatestFileContent === "function") {
			content = this.mgr.editorMgr.getLatestFileContent (targetPath);
		} else if (this.mgr !== null && this.mgr.fileContents instanceof Map && this.mgr.fileContents.has (targetPath) === true) {
			content = this.mgr.fileContents.get (targetPath);
		} else if (this.mgr !== null && this.mgr.runner !== null && typeof this.mgr.runner.readFile === "function") {
			content = await this.mgr.runner.readFile (targetPath);
		}

		if (content === undefined || content === null) {
			content = "";
		}

		fileName = targetPath.split ("/").pop ();
		if (fileName === "") {
			fileName = "download.txt";
		}

		blob = new Blob ([content], { type: "application/octet-stream" });
		url = URL.createObjectURL (blob);
		anchor = document.createElement ("a");
		anchor.href = url;
		anchor.download = fileName;
		document.body.appendChild (anchor);
		anchor.click ();
		document.body.removeChild (anchor);
		setTimeout (() => {
			URL.revokeObjectURL (url);
		}, 1000);
	}

	/**
	 * Binds HTML5 drag-and-drop listeners on the tree container for moving files and folders.
	 * @param {HTMLElement|null} treeElm - File tree container element.
	 * @returns {void}
	 */
	_bindDragAndDrop (treeElm) {
		let self = null;

		if (treeElm === null) {
			return;
		}
		self = this;
		treeElm.draggable = true;

		treeElm.addEventListener ("dragstart", (ev) => {
			let node = null;
			let srcPath = "";

			if (self.tree === null || typeof self.tree.getNode !== "function") {
				return;
			}
			node = self.tree.getNode (ev.target);
			srcPath = self.getNodePath (node);
			if (srcPath === "" || srcPath === ROOT_DIR) {
				ev.preventDefault ();
				return;
			}
			self._dragSourceNode = node;
			if (ev.dataTransfer !== null && ev.dataTransfer !== undefined) {
				ev.dataTransfer.effectAllowed = "move";
				ev.dataTransfer.setData ("text/plain", srcPath);
			}
		});

		treeElm.addEventListener ("dragover", (ev) => {
			let targetNode = null;
			let destDir = "";
			let srcPath = "";

			if (self._dragSourceNode === null) {
				return;
			}
			srcPath = self.getNodePath (self._dragSourceNode);
			targetNode = self.tree.getNode (ev.target);
			destDir = self.resolveDirectoryFromNode (targetNode);

			if (self.canTransfer (srcPath, destDir) === true) {
				ev.preventDefault ();
				if (ev.dataTransfer !== null && ev.dataTransfer !== undefined) {
					ev.dataTransfer.dropEffect = "move";
				}
			}
		});

		treeElm.addEventListener ("drop", async (ev) => {
			let targetNode = null;
			let destDir = "";
			let srcNode = null;
			let srcPath = "";
			let isFolder = false;

			if (self._dragSourceNode === null) {
				return;
			}
			ev.preventDefault ();
			srcNode = self._dragSourceNode;
			self._dragSourceNode = null;

			srcPath = self.getNodePath (srcNode);
			isFolder = self.isNodeFolder (srcNode);
			targetNode = self.tree.getNode (ev.target);
			destDir = self.resolveDirectoryFromNode (targetNode);

			if (self.canTransfer (srcPath, destDir) === false) {
				return;
			}

			await self.mgr.transferItem ("move", srcPath, destDir, isFolder);
		});

		treeElm.addEventListener ("dragend", () => {
			self._dragSourceNode = null;
		});
	}

	/**
	 * Copies the active node path into the internal clipboard for the given mode.
	 * @param {"copy"|"move"} mode - Operation mode.
	 * @returns {void}
	 */
	_stageActiveNodeToClipboard (mode) {
		let activeNode = null;
		let nodePath = "";
		let isFolder = false;

		activeNode = this.getActiveNodeSafe ();
		nodePath = this.getNodePath (activeNode);
		if (nodePath === "" || nodePath === ROOT_DIR) {
			return;
		}
		isFolder = this.isNodeFolder (activeNode);
		this.setClipboard (mode, nodePath, isFolder);
	}

	/**
	 * Binds Ctrl/Cmd + C / X / V shortcuts for copying and moving selected tree items.
	 * @param {HTMLElement|null} treeElm - File tree container element.
	 * @returns {void}
	 */
	_bindKeyboardShortcuts (treeElm) {
		let self = null;

		if (treeElm === null) {
			return;
		}
		self = this;
		if (treeElm.tabIndex < 0) {
			treeElm.tabIndex = 0;
		}

		treeElm.addEventListener ("keydown", async (ev) => {
			let hasMod = false;
			let key = "";
			let targetDir = "";

			hasMod = ev.ctrlKey === true || ev.metaKey === true;
			if (hasMod === false) {
				return;
			}

			key = ev.key.toLowerCase ();
			if (key === "c") {
				ev.preventDefault ();
				self._stageActiveNodeToClipboard ("copy");
				return;
			}

			if (key === "x") {
				ev.preventDefault ();
				self._stageActiveNodeToClipboard ("move");
				return;
			}

			if (key === "v") {
				ev.preventDefault ();
				if (self.clipboard === null) {
					return;
				}
				targetDir = self.getTargetDirectory ();
				if (self.canTransfer (self.clipboard.sourcePath, targetDir, self.clipboard.mode) === false) {
					return;
				}
				await self.mgr.transferItem (
					self.clipboard.mode,
					self.clipboard.sourcePath,
					targetDir,
					self.clipboard.isFolder
				);
				if (self.clipboard !== null && self.clipboard.mode === "move") {
					self.clipboard = null;
				}
			}
		});
	}

	/**
	 * Stores a copy or move operation in the internal tree clipboard.
	 * @param {"copy"|"move"} mode - Operation mode.
	 * @param {string} sourcePath - Source file or directory path.
	 * @param {boolean} isFolder - True if sourcePath is a folder.
	 * @returns {void}
	 */
	setClipboard (mode, sourcePath, isFolder) {
		let normPath = "";

		normPath = sourcePath.replace (/\/+$/, "");
		if (normPath === "" || normPath === ROOT_DIR) {
			return;
		}
		this.clipboard = {
			mode: mode,
			sourcePath: normPath,
			isFolder: isFolder === true
		};
	}

	/**
	 * Validates whether sourcePath can be copied or moved into targetDir.
	 * @param {string} sourcePath - Source file or directory path.
	 * @param {string} targetDir - Destination directory path.
	 * @param {"copy"|"move"} [mode="move"] - Operation mode.
	 * @returns {boolean} True if transfer is valid.
	 */
	canTransfer (sourcePath, targetDir, mode) {
		let normSrc = "";
		let normDest = "";
		let opMode = "";

		if (sourcePath === "" || targetDir === "") {
			return false;
		}
		normSrc = sourcePath.replace (/\/+$/, "");
		normDest = targetDir.replace (/\/+$/, "");
		opMode = mode;
		if (opMode === undefined) {
			opMode = "move";
		}

		if (normSrc === "" || normSrc === ROOT_DIR) {
			return false;
		}
		if (normDest === "") {
			return false;
		}
		if (normSrc === normDest) {
			return false;
		}
		if (opMode === "move" && normDest.startsWith (normSrc + "/")) {
			return false;
		}
		return true;
	}
}