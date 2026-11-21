import { FileTreeManager, ROOT_DIR } from "./file-tree-manager.js";

/**
 * Extends FileTreeManager with drag-and-drop and clipboard copy/cut/paste interactions.
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
	}

	/**
	 * Binds drag-and-drop and keyboard shortcut listeners after tree initialization.
	 * @param {HTMLElement|null} treeElm - File tree container element.
	 * @returns {void}
	 */
	_onAfterInit (treeElm) {
		super._onAfterInit (treeElm);
		this._bindDragAndDrop (treeElm);
		this._bindKeyboardShortcuts (treeElm);
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