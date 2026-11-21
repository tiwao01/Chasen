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
	}

	/**
	 * Creates the terminal instance, attaches the fit addon, mounts it to the DOM container,
	 * and adjusts its dimensions to fit the container.
	 * @returns {void}
	 */
	init () {
		let termElm = null;

		termElm = document.getElementById("terminal-container");
		this.term = new Terminal({ cursorBlink: true, theme: { background: "#000000" } });
		this.fitAddon = new FitAddon.FitAddon();
		this.term.loadAddon(this.fitAddon);
		this.term.open(termElm);
		this.fitAddon.fit();
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