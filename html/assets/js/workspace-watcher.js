const WORKSPACE_CHANGE_MARKER = "__CX_WS_CHANGED__";

/**
 * Watches a workspace directory inside CheerpX and filters change markers from console output.
 */
export class WorkspaceWatcher {
	/**
	 * Creates a new WorkspaceWatcher instance.
	 * @param {object} runner - CheerpXRunner instance.
	 * @param {Function|null} [onWorkspaceChange] - Callback invoked when workspace changes are detected.
	 */
	constructor (runner, onWorkspaceChange) {
		this.runner = runner;
		this.onWorkspaceChange = null;
		this._lineCarry = "";

		if (typeof onWorkspaceChange === "function") {
			this.onWorkspaceChange = onWorkspaceChange;
		}
	}

	/**
	 * Sets or updates the workspace change callback.
	 * @param {Function|null} callback - Callback function.
	 * @returns {void}
	 */
	setOnWorkspaceChange (callback) {
		if (typeof callback === "function") {
			this.onWorkspaceChange = callback;
		} else {
			this.onWorkspaceChange = null;
		}
	}

	/**
	 * Filters workspace change markers out of console text and triggers callback.
	 * @param {string} chunk - Decoded console output chunk.
	 * @returns {string} Chunk with marker lines removed.
	 */
	consumeChangeMarkers (chunk) {
		let combined = "";
		let endsWithNewline = false;
		let parts = [];
		let tail = "";
		let cleanTail = "";
		let filtered = [];
		let i = 0;
		let rawLine = "";
		let cleanLine = "";
		let hasChanged = false;
		let strippedAnyMarker = false;
		let result = "";

		if (typeof chunk !== "string" || chunk === "") {
			if (this._lineCarry === "") {
				return "";
			}
		}

		combined = this._lineCarry + chunk;
		this._lineCarry = "";
		combined = combined.replace(/\r\n/g, "\n");
		endsWithNewline = combined.endsWith("\n");
		parts = combined.split("\n");

		if (endsWithNewline === false) {
			tail = parts.pop();
			if (tail === undefined) {
				tail = "";
			}
			cleanTail = tail.replace(/\r/g, "");
			if (cleanTail === WORKSPACE_CHANGE_MARKER || (cleanTail.startsWith("__CX_") && WORKSPACE_CHANGE_MARKER.startsWith(cleanTail))) {
				this._lineCarry = cleanTail;
			} else {
				filtered.push(cleanTail);
			}
		}

		for (i = 0; i < parts.length; i++) {
			if (endsWithNewline === true && i === parts.length - 1 && parts[i] === "") {
				continue;
			}
			rawLine = parts[i];
			cleanLine = rawLine.replace(/\r/g, "");
			if (cleanLine === WORKSPACE_CHANGE_MARKER) {
				hasChanged = true;
				strippedAnyMarker = true;
			} else {
				filtered.push(cleanLine);
			}
		}

		if (hasChanged === true) {
			if (typeof this.onWorkspaceChange === "function") {
				this.onWorkspaceChange();
			}
		}

		if (filtered.length === 0) {
			if (endsWithNewline === true && strippedAnyMarker === false) {
				return "\n";
			}
			return "";
		}

		result = filtered.join("\n");
		if (endsWithNewline === true) {
			result = result + "\n";
		}

		return result;
	}

	/**
	 * Starts a background watcher loop inside CheerpX for targetDir.
	 * @param {string} targetDir - Directory path to watch.
	 * @returns {Promise<void>}
	 */
	async startWorkspaceWatcher (targetDir) {
		let watchCmd = "";
		let runOpt = null;

		if (this.runner === null || this.runner.cx === null) {
			return;
		}

		runOpt = {
			env: this.runner.runOpt.env,
			cwd: targetDir,
			uid: this.runner.runOpt.uid,
			gid: this.runner.runOpt.gid
		};

		watchCmd = [
			`mkdir -p "${targetDir}"`,
			`prev_snap=""`,
			`while true; do`,
			`  cur_snap=$(find "${targetDir}" -printf '%y %p %T@ %s\n' 2>/dev/null || ls -laR "${targetDir}" 2>/dev/null)`,
			`  if [ "$cur_snap" != "$prev_snap" ]; then`,
			`    prev_snap="$cur_snap"`,
			`    echo "${WORKSPACE_CHANGE_MARKER}"`,
			`  fi`,
			`  sleep 1.5`,
			`done`
		].join("\n");

		this.runner.cx.run("/bin/sh", ["-c", watchCmd], runOpt).catch((err) => {
			console.warn("[Watcher] Watch loop ended:", err);
		});
	}
}