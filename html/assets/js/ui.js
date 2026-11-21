const TOAST_DURATION_MS = 2500;

/**
 * UiHelper for app.html
 */
export class UiHelper {
	constructor () {
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
}