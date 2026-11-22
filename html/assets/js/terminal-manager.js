/**
 * Manages a xterm.js terminal instance and its fit addon.
 */
export class TerminalManager {
	/**
	 * Initializes a new TerminalManager instance with uninitialized terminal and addon references.
	 */
	constructor () {
		this.term = null;
		this.fitAddon = null;
		this._resizeObserver = null;
		this._onResizeCallbacks = [];
		this._lastCols = 0;
		this._lastRows = 0;
		this._fitTimerId = null;
	}

	/**
	 * Registers a callback invoked when terminal dimensions change.
	 * @param {function(number, number): void} callback - Receives (cols, rows).
	 * @returns {void}
	 */
	onResize (callback) {
		if (typeof callback === "function") {
			this._onResizeCallbacks.push(callback);
		}
	}

	/**
	 * Notifies registered resize callbacks if terminal dimensions changed.
	 * @returns {void}
	 */
	_emitResizeIfChanged () {
		let cols = 0;
		let rows = 0;
		let i = 0;

		if (this.term === null) {
			return;
		}
		cols = this.term.cols;
		rows = this.term.rows;
		if (cols < 10 || rows < 2) {
			return;
		}
		if (cols === this._lastCols && rows === this._lastRows) {
			return;
		}
		this._lastCols = cols;
		this._lastRows = rows;

		for (i = 0; i < this._onResizeCallbacks.length; i++) {
			this._onResizeCallbacks[i](cols, rows);
		}
	}

	/**
	 * Creates the terminal instance, attaches the fit addon, mounts it to the DOM container,
	 * observes container resizing, and adjusts its dimensions to fit the container.
	 * @returns {void}
	 */
	init () {
		let termElm = null;
		let self = null;

		self = this;
		termElm = document.getElementById("terminal-container");
		this.term = new Terminal({ cursorBlink: true, theme: { background: "#000000" } });
		this.fitAddon = new FitAddon.FitAddon();
		this.term.loadAddon(this.fitAddon);
		if (termElm !== null) {
			this.term.open(termElm);
			if (typeof this.term.onResize === "function") {
				this.term.onResize(() => {
					self._emitResizeIfChanged();
				});
			}
			this.fit();
			if (typeof ResizeObserver === "function") {
				this._resizeObserver = new ResizeObserver(() => {
					self.fit();
				});
				this._resizeObserver.observe(termElm);
			}
		}
	}

	/**
	 * Recalculates and applies terminal dimensions to fit its container if the fit addon is initialized.
	 * @returns {void}
	 */
	fit () {
		let self = null;

		self = this;
		if (this.fitAddon === null) {
			return;
		}
		if (this._fitTimerId !== null) {
			cancelAnimationFrame(this._fitTimerId);
			this._fitTimerId = null;
		}
		this._fitTimerId = requestAnimationFrame(() => {
			self._fitTimerId = null;
			if (self.fitAddon !== null) {
				self.fitAddon.fit();
				self._emitResizeIfChanged();
			}
		});
	}
}