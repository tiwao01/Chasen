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
	 * @param {WorkspaceManager} mgr - workdpace manager instance
	 */
	constructor (fp, content, lang, fn, mgr) {
		super();
		this.fp = fp;
		this.content = content;
		this.fn = fn;
		this.lang = lang;
		this.mgr = mgr;
		this.editor = null;

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

		this.editor.addAction ({
			id: "save-file-action",
			label: "Save File",
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
			run: async () => {
				let code = "";
				code = self.editor.getValue ();
				self.mgr.fileContents.set (self.fp, code);
				await self.mgr.runner.writeFile (self.fp, code);
				self.mgr.ui.showToast (toastElm, "ファイルを保存しました");
			}
		});
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
	 * @returns 
	 */
	getValue () {
		if (this.editor !== null) {
			return this.editor.getValue ();
		}
		return "";
	}
}