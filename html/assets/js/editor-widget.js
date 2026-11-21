import * as monaco from "monaco-editor";
import { Widget } from "@lumino/widgets";

/**
 * Editor Widget for app.html
 */
export class EditorWidget extends Widget {
	/**
	 * Editor Widget Constructor
	 * @param {String} fp - file path
	 * @param {String} content - file content
	 * @param {String} lang - language
	 * @param {String} fn - file name
	 * @param {WorkspaceManager} mgr - workspace manager instance
	 */
	constructor (fp, content, lang, fn, mgr) {
		super();
		this.fp = fp;
		this.content = content;
		this.savedContent = content;
		this.fn = fn;
		this.lang = lang;
		this.mgr = mgr;
		this.editor = null;
		this.isDirty = false;
		this._isProgrammaticSet = false;

		this.setFlag (Widget.Flag.DisallowLayout);
		this.title.label = fn;
		this.title.closable = true;
		this.node.style.height = "100%";
		this.node.style.width = "100%";
	}

	/**
	 * Initialize Monaco Editor and register the save file action after the widget is attached
	 * @param {String} msg - Message or payload passed on attach
	 */
	onAfterAttach (msg) {
		let self = null;
		let toastElm = null;

		toastElm = document.getElementById ("toast");

		super.onAfterAttach (msg);
		self = this;

		this.editor = monaco.editor.create (this.node, {
			value: this.content,
			language: this.lang,
			theme: "vs-dark",
			automaticLayout: true
		});

		this.editor.onDidChangeModelContent (() => {
			let currentVal = "";

			if (self._isProgrammaticSet === true) {
				return;
			}
			currentVal = self.getValue ();
			self.content = currentVal;
			self.isDirty = currentVal !== self.savedContent;
			if (self.mgr !== null && self.mgr !== undefined && self.mgr.tabMgr !== null && self.mgr.tabMgr !== undefined) {
				self.mgr.tabMgr.render ();
			}
		});

		this.editor.addAction ({
			id: "save-file-action",
			label: "Save File",
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
			run: async () => {
				let code = "";

				code = self.editor.getValue ();
				self.content = code;
				self.savedContent = code;
				self.isDirty = false;
				self.mgr.fileContents.set (self.fp, code);
				await self.mgr.runner.writeFile (self.fp, code);
				if (self.mgr.tabMgr !== null && self.mgr.tabMgr !== undefined) {
					self.mgr.tabMgr.render ();
				}
				self.mgr.ui.showToast (toastElm, "ファイルを保存しました");
			}
		});
	}

	/**
	 * Updates editor value programmatically without marking dirty unless needed.
	 * @param {string} newContent - New content to set.
	 * @param {boolean} [markAsSaved=true] - True if newContent becomes the baseline saved content.
	 * @returns {void}
	 */
	setEditorContent (newContent, markAsSaved) {
		let shouldMarkSaved = true;

		if (markAsSaved !== undefined) {
			shouldMarkSaved = markAsSaved === true;
		}
		this.content = newContent;
		if (shouldMarkSaved === true) {
			this.savedContent = newContent;
			this.isDirty = false;
		}
		if (this.editor !== null && typeof this.editor.setValue === "function") {
			this._isProgrammaticSet = true;
			this.editor.setValue (newContent);
			this._isProgrammaticSet = false;
			if (shouldMarkSaved === false) {
				this.isDirty = newContent !== this.savedContent;
			}
		}
	}

	/**
	 * Register resize event
	 * @param {String} msg - Message or payload passed on resize
	 */
	onResize (msg) {
		super.onResize (msg);
		if (this.editor !== null) {
			this.editor.layout ();
		}
	}

	/**
	 * Get editor value
	 * @returns {string} Current editor text
	 */
	getValue () {
		if (this.editor !== null) {
			return this.editor.getValue ();
		}
		return "";
	}
}