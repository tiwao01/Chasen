const TOAST_DURATION_MS = 2500;

/**
 * UiHelper for app.html
 */
export class UiHelper {
	constructor () {
		this._progressDialog = null;
	}

	/**
	 * Set data-show="on" for element
	 * @param {HTMLElement} elm - target element
	 * @param {String} msg - inner message
	 * @param {Number} dms - toast duration (ms)
	 * @returns
	 */
	showToast (elm, msg = "", dms = TOAST_DURATION_MS) {
		let tId;

		if (elm === null) {
			return;
		}

		tId = elm.dataset.toastTimerId;
		if (tId !== undefined) {
			clearTimeout (Number (tId));
		}

		elm.innerText = msg;
		elm.dataset.show = "on";

		tId = setTimeout (
			() => {
				delete elm.dataset.show;
				delete elm.dataset.toastTimerId;
			},
			dms
		);

		elm.dataset.toastTimerId = String (tId);
	}

	/**
	 * Update Badge to "環境読込中"
	 * @param {HTMLElement} elm - target badge element
	 * @param {String} lang - language
	 * @returns 
	 */
	updateBadgeLoading (elm, lang = "") {
		if (elm === null) {
			return;
		}
		elm.innerText = `${lang.toUpperCase ()} 環境読込中...`;
	}

	/**
	 * Update Badge to "環境動作中"
	 * @param {HTMLElement} elm - target badge element
	 * @param {String} lang - language
	 * @returns 
	 */
	updateBadgeRunning (elm, lang = "") {
		if (elm === null) {
			return;
		}
		elm.innerText = `${lang.toUpperCase ()} 環境動作中`;
	}

	/**
	 * Update Badge to error message
	 * @param {HTMLElement} elm - target badge element
	 * @param {String} eMsg - error message
	 * @returns 
	 */
	updateBadgeError (elm, eMsg) {
		if (elm === null) {
			return;
		}
		elm.innerText = `Error: ${eMsg}`;
	}

	/**
	 * Shows a modal confirmation dialog matching the workspace modal style.
	 * @param {string} title - Modal title text.
	 * @param {string} message - Modal warning/confirmation message.
	 * @param {string} [confirmLabel="実行"] - Confirm button text.
	 * @returns {Promise<boolean>} True if user confirmed.
	 */
	showConfirmDialog (title, message, confirmLabel = "実行") {
		return new Promise((resolve) => {
			let backdrop = null;
			let dialog = null;
			let titleEl = null;
			let msgEl = null;
			let btnRow = null;
			let cancelBtn = null;
			let confirmBtn = null;
			let onKeyDown = null;
			let cleanup = null;

			backdrop = document.createElement("div");
			backdrop.className = "ws-modal-backdrop";

			dialog = document.createElement("div");
			dialog.className = "ws-modal-dialog";

			titleEl = document.createElement("div");
			titleEl.className = "ws-modal-title";
			titleEl.textContent = title;

			msgEl = document.createElement("p");
			msgEl.className = "ws-modal-message";
			msgEl.textContent = message;

			btnRow = document.createElement("div");
			btnRow.className = "ws-modal-actions";

			cleanup = () => {
				document.removeEventListener("keydown", onKeyDown);
				if (backdrop.parentNode !== null) {
					backdrop.parentNode.removeChild(backdrop);
				}
			};

			onKeyDown = (ev) => {
				if (ev.key === "Escape") {
					cleanup();
					resolve(false);
				}
			};

			cancelBtn = document.createElement("button");
			cancelBtn.type = "button";
			cancelBtn.className = "ws-modal-btn ws-modal-btn-cancel";
			cancelBtn.textContent = "キャンセル";
			cancelBtn.addEventListener("click", () => {
				cleanup();
				resolve(false);
			});

			confirmBtn = document.createElement("button");
			confirmBtn.type = "button";
			confirmBtn.className = "ws-modal-btn ws-modal-btn-danger";
			confirmBtn.textContent = confirmLabel;
			confirmBtn.addEventListener("click", () => {
				cleanup();
				resolve(true);
			});

			btnRow.appendChild(cancelBtn);
			btnRow.appendChild(confirmBtn);

			dialog.appendChild(titleEl);
			dialog.appendChild(msgEl);
			dialog.appendChild(btnRow);
			backdrop.appendChild(dialog);
			document.body.appendChild(backdrop);
			document.addEventListener("keydown", onKeyDown);
		});
	}

	/**
	 * Shows a ZIP upload modal supporting both drag-and-drop and standard file input.
	 * @returns {Promise<File|null>} Selected ZIP File, or null if cancelled.
	 */
	showZipDropDialog () {
		return new Promise((resolve) => {
			let backdrop = null;
			let dialog = null;
			let titleEl = null;
			let msgEl = null;
			let dropZone = null;
			let dropText = null;
			let fileInput = null;
			let chooseBtn = null;
			let btnRow = null;
			let cancelBtn = null;
			let onKeyDown = null;
			let cleanup = null;

			backdrop = document.createElement("div");
			backdrop.className = "ws-modal-backdrop";

			dialog = document.createElement("div");
			dialog.className = "ws-modal-dialog";

			titleEl = document.createElement("div");
			titleEl.className = "ws-modal-title";
			titleEl.textContent = "ZIPファイルのアップロード";

			msgEl = document.createElement("p");
			msgEl.className = "ws-modal-message";
			msgEl.textContent = "ZIPファイルを下の枠にドロップするか、ファイルを選択してください。";

			dropZone = document.createElement("div");
			dropZone.className = "ws-dropzone";

			dropText = document.createElement("div");
			dropText.textContent = "ここに .zip をドラッグ＆ドロップ";

			fileInput = document.createElement("input");
			fileInput.type = "file";
			fileInput.accept = ".zip";
			fileInput.style.display = "none";

			chooseBtn = document.createElement("button");
			chooseBtn.type = "button";
			chooseBtn.className = "ws-modal-btn ws-modal-btn-cancel";
			chooseBtn.textContent = "ファイルを選択";

			chooseBtn.addEventListener("click", () => {
				fileInput.click();
			});

			fileInput.addEventListener("change", (ev) => {
				let target = null;
				let selected = null;

				target = ev.target;
				if (target !== null && target.files !== null && target.files.length > 0) {
					selected = target.files[0];
					cleanup();
					resolve(selected);
					return;
				}
				fileInput.value = "";
			});

			dropZone.addEventListener("dragenter", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				dropZone.classList.add("is-dragover");
			});

			dropZone.addEventListener("dragover", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				if (ev.dataTransfer !== null && ev.dataTransfer !== undefined) {
					ev.dataTransfer.dropEffect = "copy";
				}
				dropZone.classList.add("is-dragover");
			});

			dropZone.addEventListener("dragleave", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				if (ev.target === dropZone || dropZone.contains(ev.target) === false) {
					dropZone.classList.remove("is-dragover");
				}
			});

			dropZone.addEventListener("drop", (ev) => {
				let dt = null;
				let droppedFile = null;

				ev.preventDefault();
				ev.stopPropagation();
				dropZone.classList.remove("is-dragover");

				dt = ev.dataTransfer;
				if (dt !== null && dt !== undefined && dt.files !== null && dt.files.length > 0) {
					droppedFile = dt.files[0];
					cleanup();
					resolve(droppedFile);
				}
			});

			btnRow = document.createElement("div");
			btnRow.className = "ws-modal-actions";

			cleanup = () => {
				document.removeEventListener("keydown", onKeyDown);
				if (backdrop.parentNode !== null) {
					backdrop.parentNode.removeChild(backdrop);
				}
			};

			onKeyDown = (ev) => {
				if (ev.key === "Escape") {
					cleanup();
					resolve(null);
				}
			};

			cancelBtn = document.createElement("button");
			cancelBtn.type = "button";
			cancelBtn.className = "ws-modal-btn ws-modal-btn-cancel";
			cancelBtn.textContent = "キャンセル";
			cancelBtn.addEventListener("click", () => {
				cleanup();
				resolve(null);
			});

			dropZone.appendChild(dropText);
			dropZone.appendChild(fileInput);
			dropZone.appendChild(chooseBtn);

			btnRow.appendChild(cancelBtn);

			dialog.appendChild(titleEl);
			dialog.appendChild(msgEl);
			dialog.appendChild(dropZone);
			dialog.appendChild(btnRow);
			backdrop.appendChild(dialog);
			document.body.appendChild(backdrop);
			document.addEventListener("keydown", onKeyDown);
		});
	}

	/**
	 * Shows a modal progress dialog with optional percentage bar and returns controller methods.
	 * @param {string} title - Progress modal title.
	 * @param {string} initialMessage - Initial status message.
	 * @returns {{update: Function, close: Function}} Progress controller.
	 */
	showProgressDialog (title, initialMessage) {
		let backdrop = null;
		let dialog = null;
		let titleEl = null;
		let wrap = null;
		let spinner = null;
		let body = null;
		let textEl = null;
		let track = null;
		let bar = null;
		let controller = null;

		if (this._progressDialog !== null && typeof this._progressDialog.close === "function") {
			this._progressDialog.close();
		}

		backdrop = document.createElement("div");
		backdrop.className = "ws-modal-backdrop";

		dialog = document.createElement("div");
		dialog.className = "ws-modal-dialog";

		titleEl = document.createElement("div");
		titleEl.className = "ws-modal-title";
		titleEl.textContent = title;

		wrap = document.createElement("div");
		wrap.className = "ws-progress-wrap";

		spinner = document.createElement("div");
		spinner.className = "ws-spinner";

		body = document.createElement("div");
		body.className = "ws-progress-body";

		textEl = document.createElement("div");
		textEl.className = "ws-progress-text";
		textEl.textContent = initialMessage;

		track = document.createElement("div");
		track.className = "ws-progress-track";

		bar = document.createElement("div");
		bar.className = "ws-progress-bar";

		track.appendChild(bar);
		body.appendChild(textEl);
		body.appendChild(track);
		wrap.appendChild(spinner);
		wrap.appendChild(body);

		dialog.appendChild(titleEl);
		dialog.appendChild(wrap);
		backdrop.appendChild(dialog);
		document.body.appendChild(backdrop);

		controller = {
			update: (message, percent) => {
				let clamped = 0;

				if (typeof message === "string" && message !== "") {
					textEl.textContent = message;
				}
				if (typeof percent === "number" && Number.isNaN(percent) === false) {
					clamped = percent;
					if (clamped < 0) {
						clamped = 0;
					}
					if (clamped > 100) {
						clamped = 100;
					}
					bar.style.width = `${clamped}%`;
				}
			},
			close: () => {
				if (backdrop.parentNode !== null) {
					backdrop.parentNode.removeChild(backdrop);
				}
				if (this._progressDialog === controller) {
					this._progressDialog = null;
				}
			}
		};

		this._progressDialog = controller;
		return controller;
	}
}