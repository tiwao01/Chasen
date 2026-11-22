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
			this.fitAddon.fit();
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
		if (this.fitAddon !== null) {
			this.fitAddon.fit();
		}
	}
}