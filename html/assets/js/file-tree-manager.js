import * as wb from "wunderbaum";

const ROOT_DIR = "/workspace";

/**
 * Manages the file tree UI backed by Wunderbaum and synchronizes it with workspace file paths.
 */
export class FileTreeManager {
	/**
	 * Creates a new FileTreeManager instance.
	 * @param {object} mgr - Workspace manager instance providing file actions, content cache, and runner.
	 */
	constructor (mgr) {
		this.mgr = mgr;
		this.tree = null;
		this.expandedPaths = new Set ([ROOT_DIR]);
		this.lastPaths = [];
	}

	/**
	 * Resolves the display title for the root directory.
	 * @returns {string} Display title of the root directory.
	 */
	getRootTitle () {
		let name = "";

		name = ROOT_DIR.split ("/").pop ();
		if (name === "") {
			return "/";
		}
		return name;
	}

	/**
	 * Extracts the normalized path associated with a Wunderbaum node.
	 * @param {object|null|undefined} node - Wunderbaum tree node instance.
	 * @returns {string} Node file or directory path, or an empty string if unavailable.
	 */
	getNodePath (node) {
		if (node === null || node === undefined) {
			return "";
		}
		if (node.data !== null && node.data !== undefined && node.data.path !== undefined) {
			return node.data.path;
		}
		if (node.key !== undefined) {
			return node.key;
		}
		return "";
	}

	/**
	 * Resolves a Bootstrap icon class name from a file name's extension.
	 * @param {string} fileName - File name or path segment.
	 * @returns {string} Bootstrap icon CSS class list.
	 */
	getFileIcon (fileName) {
		let ext = "";
		let parts = [];

		parts = fileName.split (".");
		if (parts.length < 2) {
			return "bi bi-file-earmark-code";
		}

		ext = parts.pop ().toLowerCase ();
		if (ext === "js") {
			return "bi bi-filetype-js";
		}
		if (ext === "css") {
			return "bi bi-filetype-css";
		}
		if (ext === "json") {
			return "bi bi-filetype-json";
		}
		return "bi bi-file-earmark-code";
	}

	/**
	 * Initializes the Wunderbaum instance, dark theme variables, and tree event handlers.
	 * @returns {void}
	 */
	init () {
		let treeElm = null;
		let self = null;

		self = this;
		treeElm = document.getElementById ("file-tree-container");

		this.tree = new wb.Wunderbaum ({
			element: treeElm,
			source: [{
				title: this.getRootTitle (),
				key: ROOT_DIR,
				folder: true,
				expanded: true,
				children: [],
				data: { path: ROOT_DIR }
			}],
			types: {
				folder: { icon: "bi bi-folder" },
				folderOpen: { icon: "bi bi-folder2-open" },
				file: { icon: "bi bi-file-earmark" },
				js: { icon: "bi bi-filetype-js" },
				css: { icon: "bi bi-filetype-css" },
				json: { icon: "bi bi-filetype-json" }
			},
			init: (e) => {
				let el = null;

				if (e === null || e.tree === null || e.tree.element === null) {
					return;
				}
				el = e.tree.element;
				el.style.setProperty ("--wb-background-color", "#1e1e1e");
				el.style.setProperty ("--wb-node-text-color", "#d4d4d4");
				el.style.setProperty ("--wb-border-color", "#333333");
				el.style.setProperty ("--wb-alternate-row-color", "#252526");
				el.style.setProperty ("--wb-header-color", "#333333");
				el.style.setProperty ("--wb-bg-highlight-color", "#3794ff");
				el.style.setProperty ("--wb-focus-border-color", "#007fd4");
				el.style.setProperty ("--wb-error-color", "#f48771");
				el.style.setProperty ("--wb-grid-color", "#3c3c3c");
			},
			expand: (e) => {
				self.updateExpandedState (e.node, true);
			},
			collapse: (e) => {
				self.updateExpandedState (e.node, false);
			},
			activate: (e) => {
				let filePath = "";

				if (e.node === null || e.node === undefined) {
					return;
				}
				if (e.node.folder === true) {
					return;
				}
				if (typeof e.node.isFolder === "function") {
					if (e.node.isFolder () === true) {
						return;
					}
				}
				filePath = self.getNodePath (e.node);
				if (filePath === "" || filePath.endsWith ("/")) {
					return;
				}
				if (self.mgr.fileContents instanceof Map) {
					if (self.mgr.fileContents.has (filePath) === false) {
						return;
					}
				}
				self.mgr.openFile (filePath);
			},
			edit: {
				save: (e) => {
					return self.handleEditSave (e);
				}
			}
		});
	}

	/**
	 * Adds or removes a node's path in the tracked expanded paths set.
	 * @param {object|null|undefined} node - Wunderbaum node that expanded or collapsed.
	 * @param {boolean} isExpanded - True if the node is now expanded, false if collapsed.
	 * @returns {void}
	 */
	updateExpandedState (node, isExpanded) {
		let nodePath = "";

		nodePath = this.getNodePath (node);
		if (nodePath === "") {
			return;
		}
		if (isExpanded === true) {
			this.expandedPaths.add (nodePath);
		}
		if (isExpanded === false) {
			this.expandedPaths.delete (nodePath);
		}
	}

	/**
	 * Collects paths of all currently expanded nodes from the Wunderbaum instance.
	 * @returns {Set<string>} Set of expanded node paths.
	 */
	captureExpandedPaths () {
		let nextExpanded = null;

		nextExpanded = new Set ();
		if (this.tree === null || this.tree.root === null) {
			return nextExpanded;
		}

		this.tree.root.visit ((node) => {
			let p = "";

			if (node.expanded === true) {
				p = this.getNodePath (node);
				if (p !== "") {
					nextExpanded.add (p);
				}
			}
		});

		return nextExpanded;
	}

	/**
	 * Rebuilds and reloads the tree from raw paths while preserving folder expansion states.
	 * @param {string[]} paths - List of file and directory paths under ROOT_DIR.
	 * @returns {void}
	 */
	reload (paths) {
		let treeData = [];

		if (this.tree === null) {
			return;
		}

		this.lastPaths = paths;
		this.expandedPaths = this.captureExpandedPaths ();
		this.expandedPaths.add (ROOT_DIR);

		treeData = this.buildTreeData (paths);
		this.tree.reload ({ source: treeData });
	}

	/**
	 * Builds hierarchical Wunderbaum node data from a flat list of paths.
	 * @param {string[]} paths - Raw file and directory paths.
	 * @returns {object[]} Root node array formatted for Wunderbaum.
	 */
	buildTreeData (paths) {
		let rootNode = null;
		let prefixRegex = null;
		let i = 0;
		let rawPath = "";
		let isDir = false;
		let relPath = "";

		rootNode = {
			title: this.getRootTitle (),
			key: ROOT_DIR,
			folder: true,
			expanded: this.expandedPaths.has (ROOT_DIR),
			icon: "bi bi-folder",
			children: [],
			data: { path: ROOT_DIR }
		};
		prefixRegex = new RegExp ("^" + ROOT_DIR + "/?");

		for (i = 0; i < paths.length; i++) {
			rawPath = paths[i];
			isDir = rawPath.endsWith ("/");
			relPath = rawPath.replace (prefixRegex, "").replace (/\/+$/, "");
			if (relPath === "") {
				continue;
			}
			this.insertPath (rootNode.children, relPath.split ("/"), isDir);
		}

		return [rootNode];
	}

	/**
	 * Inserts path segments into a target child node list, creating intermediate folders as needed.
	 * @param {object[]} children - Target child node array at the current tree level.
	 * @param {string[]} segments - Path segments relative to ROOT_DIR.
	 * @param {boolean} isDir - True if the original path ended with a trailing slash.
	 * @returns {void}
	 */
	insertPath (children, segments, isDir) {
		let i = 0;
		let k = 0;
		let seg = "";
		let isFolder = false;
		let fullPath = "";
		let existing = null;
		let node = null;
		let currentList = null;

		currentList = children;

		for (i = 0; i < segments.length; i++) {
			seg = segments[i];
			isFolder = false;
			if (i < segments.length - 1) {
				isFolder = true;
			}
			if (i === segments.length - 1 && isDir === true) {
				isFolder = true;
			}

			fullPath = ROOT_DIR + "/" + segments.slice (0, i + 1).join ("/");
			existing = null;

			for (k = 0; k < currentList.length; k++) {
				if (currentList[k].title === seg) {
					existing = currentList[k];
					break;
				}
			}

			if (existing !== null) {
				if (isFolder === true) {
					existing.folder = true;
					existing.type = "folder";
					existing.icon = "bi bi-folder";
					existing.expanded = this.expandedPaths.has (fullPath);
				}
				currentList = existing.children;
				continue;
			}

			node = {
				title: seg,
				key: fullPath,
				folder: isFolder,
				type: "file",
				icon: this.getFileIcon (seg),
				expanded: false,
				children: [],
				data: { path: fullPath }
			};
			if (isFolder === true) {
				node.type = "folder";
				node.icon = "bi bi-folder";
				node.expanded = this.expandedPaths.has (fullPath);
			}

			currentList.push (node);
			if (isFolder === true) {
				currentList = node.children;
			}
		}
	}

	/**
	 * Handles inline node rename completion by migrating cached content and runner files.
	 * @param {object} e - Wunderbaum edit save event containing `input` and `node`.
	 * @returns {Promise<boolean>} True if the rename succeeded, or false if the new name is blank.
	 */
	async handleEditSave (e) {
		let newName = "";
		let oldPath = "";
		let dirPath = "";
		let newPath = "";
		let content = "";

		newName = e.input.value.trim ();
		if (newName === "") {
			return false;
		}

		oldPath = e.node.data.path;
		dirPath = oldPath.substring (0, oldPath.lastIndexOf ("/"));
		newPath = dirPath + "/" + newName;

		content = this.mgr.fileContents.get (oldPath);
		if (content === undefined) {
			content = "";
		}

		this.mgr.fileContents.delete (oldPath);
		this.mgr.fileContents.set (newPath, content);
		e.node.data.path = newPath;
		e.node.key = newPath;

		if (this.mgr.runner !== null) {
			await this.mgr.runner.copyFile (oldPath, newPath);
			await this.mgr.runner.removeFile (oldPath);
		}

		return true;
	}
	
	/**
	 * Resolves the target directory path based on the currently active tree node.
	 * @returns {string} Target directory path (defaults to ROOT_DIR).
	 */
	getTargetDirectory () {
		let activeNode = null;
		let nodePath = "";
		let isFolder = false;
		let lastSlash = -1;

		if (this.tree === null) {
			return ROOT_DIR;
		}

		activeNode = this.tree.getActiveNode ();
		if (activeNode === null || activeNode === undefined) {
			return ROOT_DIR;
		}

		nodePath = this.getNodePath (activeNode);
		if (nodePath === "") {
			return ROOT_DIR;
		}

		isFolder = false;
		if (activeNode.folder === true) {
			isFolder = true;
		}
		if (typeof activeNode.isFolder === "function") {
			if (activeNode.isFolder () === true) {
				isFolder = true;
			}
		}

		if (isFolder === true) {
			return nodePath.replace (/\/+$/, "");
		}

		lastSlash = nodePath.lastIndexOf ("/");
		if (lastSlash <= 0) {
			return ROOT_DIR;
		}
		return nodePath.substring (0, lastSlash);
	}

	/**
	 * Collapses all subdirectories under ROOT_DIR while keeping ROOT_DIR expanded.
	 * @returns {void}
	 */
	collapseAll () {
		let treeData = [];

		if (this.tree === null) {
			return;
		}

		this.expandedPaths = new Set ([ROOT_DIR]);
		treeData = this.buildTreeData (this.lastPaths);
		this.tree.reload ({ source: treeData });
	}
}