/**
 * Manages the editor tab bar UI including scrolling, selection, context menu,
 * unsaved indicator, and duplicate file name disambiguation.
 */
export class TabManager {
	/**
	 * Creates a new TabManager instance.
	 * @param {object} mgr - WorkspaceManager instance.
	 */
	constructor (mgr) {
		this.mgr = mgr;
		this.container = null;
		this._contextMenuElm = null;
	}

	/**
	 * Initializes the tab bar element and global listeners.
	 * @returns {void}
	 */
	init () {
		let self = null;

		self = this;
		this.container = document.getElementById ("editor-tab-bar");
		if (this.container === null) {
			return;
		}

		this.container.addEventListener ("wheel", (ev) => {
			if (ev.deltaY !== 0 && Math.abs (ev.deltaY) >= Math.abs (ev.deltaX)) {
				ev.preventDefault ();
				self.container.scrollLeft = self.container.scrollLeft + ev.deltaY;
			}
		}, { passive: false });

		document.addEventListener ("click", () => {
			self.closeContextMenu ();
		});
	}

	/**
	 * Computes the display label for each open file path.
	 * Uses full path when multiple open tabs share the same file name.
	 * @returns {Map<string, string>} Map of filePath to display title.
	 */
	_computeDisplayLabels () {
		let nameCounts = null;
		let labels = null;
		let entries = [];
		let i = 0;
		let fp = "";
		let widget = null;
		let fileName = "";
		let count = 0;

		nameCounts = new Map ();
		labels = new Map ();

		if (!(this.mgr.openWidgets instanceof Map)) {
			return labels;
		}

		entries = Array.from (this.mgr.openWidgets.entries ());
		for (i = 0; i < entries.length; i++) {
			fp = entries[i][0];
			widget = entries[i][1];
			fileName = fp.split ("/").pop ();
			if (widget !== null && widget !== undefined && typeof widget.fn === "string" && widget.fn !== "") {
				fileName = widget.fn;
			}
			count = nameCounts.get (fileName);
			if (count === undefined) {
				count = 0;
			}
			nameCounts.set (fileName, count + 1);
		}

		for (i = 0; i < entries.length; i++) {
			fp = entries[i][0];
			widget = entries[i][1];
			fileName = fp.split ("/").pop ();
			if (widget !== null && widget !== undefined && typeof widget.fn === "string" && widget.fn !== "") {
				fileName = widget.fn;
			}
			count = nameCounts.get (fileName);
			if (count !== undefined && count > 1) {
				labels.set (fp, fp);
			} else {
				labels.set (fp, fileName);
			}
		}

		return labels;
	}

	/**
	 * Renders all open tabs in the tab bar.
	 * @returns {void}
	 */
	render () {
		let labels = null;
		let entries = [];
		let i = 0;
		let fp = "";
		let widget = null;
		let tabElm = null;
		let dirtyIcon = null;
		let titleSpan = null;
		let closeBtn = null;
		let displayTitle = "";
		let self = null;

		if (this.container === null) {
			return;
		}

		self = this;
		this.container.innerHTML = "";

		if (!(this.mgr.openWidgets instanceof Map) || this.mgr.openWidgets.size === 0) {
			return;
		}

		labels = this._computeDisplayLabels ();
		entries = Array.from (this.mgr.openWidgets.entries ());

		for (i = 0; i < entries.length; i++) {
			let currentPath = "";

			fp = entries[i][0];
			widget = entries[i][1];
			currentPath = fp;
			displayTitle = labels.get (currentPath);
			if (displayTitle === undefined) {
				displayTitle = currentPath.split ("/").pop ();
			}

			tabElm = document.createElement ("div");
			tabElm.className = "editor-tab";
			if (this.mgr.activeWidget === widget) {
				tabElm.classList.add ("active");
			}
			tabElm.title = currentPath;
			tabElm.setAttribute ("role", "tab");

			tabElm.addEventListener ("click", () => {
				self.mgr.openFile (currentPath);
			});

			tabElm.addEventListener ("contextmenu", (ev) => {
				ev.preventDefault ();
				ev.stopPropagation ();
				self.openContextMenu (ev.clientX, ev.clientY, currentPath);
			});

			if (widget !== null && widget !== undefined && widget.isDirty === true) {
				dirtyIcon = document.createElement ("span");
				dirtyIcon.className = "material-symbols-outlined editor-tab-dirty";
				dirtyIcon.textContent = "circle";
				dirtyIcon.title = "未保存の変更があります";
				tabElm.appendChild (dirtyIcon);
			}

			titleSpan = document.createElement ("span");
			titleSpan.className = "editor-tab-title";
			titleSpan.textContent = displayTitle;
			tabElm.appendChild (titleSpan);

			closeBtn = document.createElement ("button");
			closeBtn.type = "button";
			closeBtn.className = "material-symbols-outlined editor-tab-close";
			closeBtn.textContent = "close";
			closeBtn.title = "閉じる";
			closeBtn.addEventListener ("click", (ev) => {
				ev.stopPropagation ();
				self.mgr.closeFile (currentPath);
			});
			tabElm.appendChild (closeBtn);

			this.container.appendChild (tabElm);
		}
	}

	/**
	 * Opens the tab context menu with "閉じる" and "その他を閉じる".
	 * @param {number} x - Client X coordinate.
	 * @param {number} y - Client Y coordinate.
	 * @param {string} targetPath - File path of the right-clicked tab.
	 * @returns {void}
	 */
	openContextMenu (x, y, targetPath) {
		let menu = null;
		let closeItem = null;
		let closeOthersItem = null;
		let self = null;

		this.closeContextMenu ();
		self = this;

		menu = document.createElement ("div");
		menu.className = "editor-tab-context-menu";
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;

		closeItem = document.createElement ("button");
		closeItem.type = "button";
		closeItem.className = "editor-tab-context-item";
		closeItem.textContent = "閉じる";
		closeItem.addEventListener ("click", (ev) => {
			ev.stopPropagation ();
			self.closeContextMenu ();
			self.mgr.closeFile (targetPath);
		});

		closeOthersItem = document.createElement ("button");
		closeOthersItem.type = "button";
		closeOthersItem.className = "editor-tab-context-item";
		closeOthersItem.textContent = "その他を閉じる";
		closeOthersItem.addEventListener ("click", (ev) => {
			ev.stopPropagation ();
			self.closeContextMenu ();
			self.mgr.closeOtherFiles (targetPath);
		});

		menu.appendChild (closeItem);
		menu.appendChild (closeOthersItem);
		document.body.appendChild (menu);
		this._contextMenuElm = menu;
	}

	/**
	 * Closes the currently open tab context menu if present.
	 * @returns {void}
	 */
	closeContextMenu () {
		if (this._contextMenuElm !== null && this._contextMenuElm.parentNode !== null) {
			this._contextMenuElm.parentNode.removeChild (this._contextMenuElm);
		}
		this._contextMenuElm = null;
	}
}