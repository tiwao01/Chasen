import * as monaco from "monaco-editor";
import { DockPanel, Widget } from "@lumino/widgets";
import { EditorWidget } from "./editor-widget.js";

const EXT_LANG_MAP = {
	c: "c",
	h: "c",
	cpp: "cpp",
	hpp: "cpp",
	cc: "cpp",
	sh: "shell",
	bash: "shell",
	asm: "nasm",
	s: "nasm",
	inc: "nasm",
	py: "python",
	sql: "sql",
	db: "sql",
	sqlite: "sql",
	sqlite3: "sql",
	php: "php"
};

const EDITOR_LAYOUT_DELAY_MS = 50;

function registerNasmLanguage () {
	let languages = [];
	let isAlreadyRegistered = false;
	let i = 0;

	if (monaco === undefined || monaco === null || monaco.languages === undefined) {
		return;
	}

	languages = monaco.languages.getLanguages();

	for (i = 0; i < languages.length; i = i + 1) {
		if (languages[i].id === "nasm") {
			isAlreadyRegistered = true;
		}
	}

	if (isAlreadyRegistered === true) {
		return;
	}

	monaco.languages.register({ id: "nasm" });

	monaco.languages.setMonarchTokensProvider("nasm", {
		ignoreCase: true,
		registers: [
			"rax", "rbx", "rcx", "rdx", "rsi", "rdi", "rbp", "rsp",
			"r8", "r9", "r10", "r11", "r12", "r13", "r14", "r15",
			"eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp",
			"ax", "bx", "cx", "dx", "al", "ah", "bl", "bh", "cl", "ch", "dl", "dh",
			"cs", "ds", "es", "fs", "gs", "ss", "rip", "eip"
		],
		instructions: [
			"mov", "add", "sub", "mul", "imul", "div", "idiv", "inc", "dec",
			"and", "or", "xor", "not", "shl", "shr", "cmp", "test",
			"jmp", "je", "jne", "jg", "jge", "jl", "jle", "ja", "jae", "jb", "jbe",
			"call", "ret", "push", "pop", "lea", "nop", "syscall", "int", "hlt"
		],
		directives: [
			"section", "segment", "global", "extern", "bits", "default",
			"db", "dw", "dd", "dq", "dt", "resb", "resw", "resd", "resq", "equ", "times",
			"text", "data", "bss", "ascii", "asciz", "string", "byte", "word", "long", "quad"
		],
		tokenizer: {
			root: [
				[/[;#].*$/, "comment"],
				[/^[a-zA-Z_.$?][a-zA-Z0-9_.$?]*:/, "type.identifier"],
				[/%[a-zA-Z_.$?][a-zA-Z0-9_.$?]*/, {
					cases: {
						"@registers": "variable.predefined",
						"@default": "keyword.control"
					}
				}],
				[/\.[a-zA-Z_.$?][a-zA-Z0-9_.$?]*/, {
					cases: {
						"@directives": "keyword.directive",
						"@default": "keyword.directive"
					}
				}],
				[/[a-zA-Z_.$?][a-zA-Z0-9_.$?]*/, {
					cases: {
						"@registers": "variable.predefined",
						"@instructions": "keyword",
						"@directives": "keyword.directive",
						"@default": "identifier"
					}
				}],
				[/\$?-?0[xX][0-9a-fA-F]+/, "number.hex"],
				[/\$?-?[0-9a-fA-F]+[hH]\b/, "number.hex"],
				[/\$?-?[01]+[bB]\b/, "number.binary"],
				[/\$?-?\d+/, "number"],
				[/"([^"\\]|\\.)*$/, "string.invalid"],
				[/'([^'\\]|\\.)*$/, "string.invalid"],
				[/"/, "string", "@string_double"],
				[/'/, "string", "@string_single"],
				[/[\[\]\(\)]/, "@brackets"],
				[/[+\-*/:,=]/, "delimiter"]
			],
			string_double: [
				[/[^\\"]+/, "string"],
				[/\\./, "string.escape"],
				[/"/, "string", "@pop"]
			],
			string_single: [
				[/[^\\']+/, "string"],
				[/\\./, "string.escape"],
				[/'/, "string", "@pop"]
			]
		}
	});

	monaco.languages.setLanguageConfiguration("nasm", {
		comments: {
			lineComment: ";"
		},
		brackets: [
			["[", "]"],
			["(", ")"]
		],
		autoClosingPairs: [
			{ open: "[", close: "]" },
			{ open: "(", close: ")" },
			{ open: "\"", close: "\"" },
			{ open: "'", close: "'" }
		]
	});
}

/**
 * Manages Lumino DockPanel, Monaco EditorWidget instances, active focus, and tab closing.
 */
export class EditorDockManager {
	/**
	 * Creates a new EditorDockManager instance.
	 * @param {object} mgr - WorkspaceManager instance.
	 */
	constructor (mgr) {
		this.mgr = mgr;
		this.dockPanel = null;
		this.openWidgets = new Map();
		this.activeWidget = null;
	}

	/**
	 * Creates and attaches the Lumino DockPanel to the workspace container.
	 * @returns {void}
	 */
	initDockPanel () {
		let dockElm = null;

		registerNasmLanguage();
		dockElm = document.getElementById("dock-container");
		this.dockPanel = new DockPanel();
		this.dockPanel.node.style.height = "100%";
		this.dockPanel.node.style.width = "100%";
		Widget.attach(this.dockPanel, dockElm);
	}

	/**
	 * Updates dock panel layout if initialized.
	 * @returns {void}
	 */
	updateLayout () {
		if (this.dockPanel !== null && this.dockPanel !== undefined) {
			this.dockPanel.update();
		}
	}

	/**
	 * Detects the Monaco language identifier from a file name extension.
	 * @param {string|null} fileName - Target file name.
	 * @returns {string} Monaco language ID or "plaintext".
	 */
	detectLanguage (fileName) {
		let ext = "";
		let lang = "";

		if (fileName === null) {
			return "plaintext";
		}

		ext = fileName.split(".").pop().toLowerCase();
		lang = EXT_LANG_MAP[ext];

		if (lang === undefined) {
			return "plaintext";
		}

		return lang;
	}

	/**
	 * Gets the latest content of a file from an open editor widget if available, or fileContents cache.
	 * @param {string} filePath - File path to read.
	 * @returns {string} Latest file content.
	 */
	getLatestFileContent (filePath) {
		let widget = null;
		let editorVal = "";

		if (this.openWidgets instanceof Map && this.openWidgets.has(filePath) === true) {
			widget = this.openWidgets.get(filePath);
			if (widget !== null && widget !== undefined) {
				if (typeof widget.getValue === "function") {
					editorVal = widget.getValue();
					if (this.mgr !== null && this.mgr.fileContents instanceof Map) {
						this.mgr.fileContents.set(filePath, editorVal);
					}
					return editorVal;
				}
			}
		}

		if (this.mgr !== null && this.mgr.fileContents instanceof Map && this.mgr.fileContents.has(filePath) === true) {
			return this.mgr.fileContents.get(filePath);
		}
		return "";
	}

	/**
	 * Updates an already-open editor widget's content for destPath if open.
	 * @param {string} destPath - Destination file path.
	 * @param {string} content - New file content.
	 * @returns {void}
	 */
	updateOpenEditorContent (destPath, content) {
		let widget = null;

		if (!(this.openWidgets instanceof Map)) {
			return;
		}
		if (this.openWidgets.has(destPath) === false) {
			return;
		}
		widget = this.openWidgets.get(destPath);
		if (widget === null || widget === undefined) {
			return;
		}
		if (typeof widget.setEditorContent === "function") {
			widget.setEditorContent(content, true);
		} else if (widget.editor !== null && widget.editor !== undefined && typeof widget.editor.setValue === "function") {
			widget.editor.setValue(content);
		}
	}

	/**
	 * Brings a specific editor widget to the front and updates active tab state.
	 * @param {EditorWidget} widget - Target editor widget.
	 * @returns {void}
	 */
	focusEditorWidget (widget) {
		let allWidgets = [];
		let i = 0;
		let w = null;

		if (widget === null || widget === undefined) {
			return;
		}

		if (this.openWidgets instanceof Map) {
			allWidgets = Array.from(this.openWidgets.values());
			for (i = 0; i < allWidgets.length; i++) {
				w = allWidgets[i];
				if (w !== null && w !== undefined && w !== widget) {
					w.hide();
				}
			}
		}

		widget.show();
		this.activeWidget = widget;

		if (this.dockPanel !== null && this.dockPanel !== undefined) {
			this.dockPanel.activateWidget(widget);
			this.dockPanel.update();
		}

		if (widget.editor !== null && widget.editor !== undefined) {
			setTimeout(() => {
				if (widget.editor !== null && widget.editor !== undefined) {
					widget.editor.layout();
					if (typeof widget.editor.focus === "function") {
						widget.editor.focus();
					}
				}
			}, EDITOR_LAYOUT_DELAY_MS);
		}

		if (this.mgr !== null && this.mgr.tabMgr !== null && this.mgr.tabMgr !== undefined) {
			this.mgr.tabMgr.render();
		}
	}

	/**
	 * Opens a file in a Monaco editor widget inside the dock panel or activates an existing one.
	 * @param {string} path - Full file path to open.
	 * @returns {void}
	 */
	openFile (path) {
		let widget = null;
		let content = "";
		let fileName = "";
		let monacoLang = "";
		let self = null;

		registerNasmLanguage();
		self = this;
		if (this.openWidgets.has(path)) {
			widget = this.openWidgets.get(path);
			this.focusEditorWidget(widget);
			return;
		}

		if (this.mgr !== null && this.mgr.fileContents instanceof Map) {
			content = this.mgr.fileContents.get(path);
		}
		if (content === undefined) {
			content = "";
		}

		fileName = path.split("/").pop();
		monacoLang = this.detectLanguage(fileName);

		widget = new EditorWidget(path, content, monacoLang, fileName, this.mgr);
		this.openWidgets.set(path, widget);

		widget.title.closable = true;
		widget.disposed.connect(() => {
			self.openWidgets.delete(path);
			if (self.mgr !== null && self.mgr.tabMgr !== null && self.mgr.tabMgr !== undefined) {
				self.mgr.tabMgr.render();
			}
		});

		this.dockPanel.addWidget(widget);
		this.focusEditorWidget(widget);
	}

	/**
	 * Closes an open tab for the given file path.
	 * @param {string} path - File path to close.
	 * @returns {boolean} True if closed, false if canceled.
	 */
	closeFile (path) {
		let widget = null;
		let shouldDiscard = false;
		let remaining = [];
		let nextWidget = null;

		if (!(this.openWidgets instanceof Map) || this.openWidgets.has(path) === false) {
			return false;
		}

		widget = this.openWidgets.get(path);
		if (widget !== null && widget !== undefined && widget.isDirty === true) {
			shouldDiscard = confirm(`"${path}" には保存されていない変更があります。破棄して閉じますか？`);
			if (shouldDiscard === false) {
				return false;
			}
		}

		this.openWidgets.delete(path);
		if (widget !== null && widget !== undefined) {
			widget.dispose();
		}

		if (this.activeWidget === widget) {
			this.activeWidget = null;
			remaining = Array.from(this.openWidgets.values());
			if (remaining.length > 0) {
				nextWidget = remaining[remaining.length - 1];
				this.focusEditorWidget(nextWidget);
			}
		}

		if (this.mgr !== null && this.mgr.tabMgr !== null && this.mgr.tabMgr !== undefined) {
			this.mgr.tabMgr.render();
		}
		return true;
	}

	/**
	 * Closes all open tabs except the specified keepPath.
	 * @param {string} keepPath - File path to keep open.
	 * @returns {void}
	 */
	closeOtherFiles (keepPath) {
		let keys = [];
		let i = 0;
		let k = "";
		let keepWidget = null;

		if (!(this.openWidgets instanceof Map)) {
			return;
		}

		keys = Array.from(this.openWidgets.keys());
		for (i = 0; i < keys.length; i++) {
			k = keys[i];
			if (k === keepPath) {
				continue;
			}
			this.closeFile(k);
		}

		if (this.openWidgets.has(keepPath) === true) {
			keepWidget = this.openWidgets.get(keepPath);
			this.dockPanel.activateWidget(keepWidget);
			this.activeWidget = keepWidget;
			if (keepWidget !== null && keepWidget.editor !== null && keepWidget.editor !== undefined) {
				keepWidget.editor.layout();
			}
		}

		if (this.mgr !== null && this.mgr.tabMgr !== null && this.mgr.tabMgr !== undefined) {
			this.mgr.tabMgr.render();
		}
	}
}