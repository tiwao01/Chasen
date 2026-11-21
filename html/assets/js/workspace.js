import { CheerpXRunner } from "./runprocess.js";
import { UiHelper } from "./ui.js";
import { DockPanel, Widget } from "@lumino/widgets";
import { EditorWidget } from "./editor-widget.js";
import { TerminalManager } from "./terminal-manager.js";
import { FileTreeManager } from "./file-tree-manager.js";

const EXT_LANG_MAP = {
	c: "c",
	h: "c",
	cpp: "cpp",
	hpp: "cpp",
	cc: "cpp",
	py: "python",
	js: "javascript",
	ts: "typescript",
	html: "html",
	css: "css",
	json: "json",
	md: "markdown",
	sh: "shell",
	bash: "shell"
};

const DEFAULT_LANG = "c";
const EDITOR_LAYOUT_DELAY_MS = 50;
const ROOT_DIR = "/workspace";
const SYNC_INTERVAL_MS = 500;
const CHEERPX_CHECK_INTERVAL_MS = 1000;

self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		let workerScript = "";
		workerScript = `
			self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
			importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
		`;
		return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerScript)}`;
	}
};

export class WorkspaceManager {
	constructor () {
		this.runner = null;
		this.dockPanel = null;
		this.openWidgets = new Map();
		this.fileContents = new Map();
		this.activeWidget = null;
		this.lang = null;
		this.ui = new UiHelper();
		this.termMgr = new TerminalManager();
		this.treeMgr = new FileTreeManager(this);
		this.isWatching = false;
	}

	async init () {
		let params = null;
		let badgeElm = null;

		params = new URLSearchParams(window.location.search);
		this.lang = params.get("lang");
		if (this.lang === null) {
			this.lang = DEFAULT_LANG;
		}

		badgeElm = document.getElementById("env-badge");
		this.ui.updateBadgeLoading(badgeElm, this.lang);

		this.termMgr.init();
		this.initDockPanel();
		this.treeMgr.init();
		this.initEventListeners();

		await this.startCheerpX(badgeElm);

		this.startInotifyWatch();
	}

	initDockPanel () {
		let dockElm = null;

		dockElm = document.getElementById("dock-container");
		this.dockPanel = new DockPanel();
		this.dockPanel.node.style.height = "100%";
		this.dockPanel.node.style.width = "100%";
		Widget.attach(this.dockPanel, dockElm);
	}

	async startCheerpX (badgeElm) {
		let imgPath = "";
		let dbName = "";
		let overrideOptions = null;
		let checkInterval = null;
		let self = null;

		try {
			this.runner = new CheerpXRunner();
			imgPath = `/dist/rootfs-${this.lang}.ext2`;
			dbName = `cache_${this.lang}`;

			this.ui.updateBadgeRunning(badgeElm, this.lang);

			overrideOptions = {
				runOpt: {
					cwd: ROOT_DIR
				}
			};

			this.runner.runProcess("/bin/sh", [], this.termMgr.term, imgPath, dbName, overrideOptions);

			self = this;
			await new Promise((resolve) => {
				checkInterval = setInterval(() => {
					if (self.runner !== null) {
						if (self.runner.cx !== null) {
							clearInterval(checkInterval);
							resolve();
						}
					}
				}, CHEERPX_CHECK_INTERVAL_MS);
			});

			await this.syncFromCheerpX();
		} catch (err) {
			console.error("Error starting CheerpX:", err);
			this.ui.updateBadgeError(badgeElm, err.message);
		}
	}

	async syncFromCheerpX () {
		let syncRes = null;
		let paths = [];
		let fileMap = null;

		if (this.runner === null) {
			return;
		}

		if (this.runner.cx === null) {
			return;
		}

		syncRes = await this.runner.syncWorkspaceFiles(ROOT_DIR);
		paths = syncRes.paths;
		fileMap = syncRes.fileMap;

		this.fileContents = fileMap;
		if (this.treeMgr !== null) {
			this.treeMgr.reload(paths);
		}
	}

	async startInotifyWatch () {
		if (this.isWatching) {
			console.log("[Watcher] Already watching");
			return;
		}

		this.isWatching = true;
		console.log("[Watcher] Watcher disabled for maximum performance and stability.");
	}

	initEventListeners () {
		let newFileElm = null;
		let self = null;

		self = this;
		newFileElm = document.getElementById("btn-new-file");
		if (newFileElm !== null) {
			newFileElm.addEventListener("click", () => {
				self.handleNewFile();
			});
		}

		window.addEventListener("resize", () => {
			self.handleResize();
		});
	}

	handleResize () {
		this.termMgr.fit();
		if (this.dockPanel !== null) {
			this.dockPanel.update();
		}
	}

	async handleNewFile () {
		let fileName = "";
		let fullPath = "";

		fileName = prompt("新規ファイル名を入力してください:");
		if (fileName === null) {
			return;
		}
		if (fileName.trim() === "") {
			return;
		}

		fullPath = ROOT_DIR + "/" + fileName;
		this.fileContents.set(fullPath, "");

		if (this.runner !== null) {
			await this.runner.writeFile(fullPath, "");
		}

		await this.syncFromCheerpX();
		this.openFile(fullPath);
	}

	openFile (path) {
		let widget = null;
		let content = "";
		let fileName = "";
		let monacoLang = "";

		if (this.openWidgets.has(path)) {
			widget = this.openWidgets.get(path);
			this.dockPanel.activateWidget(widget);
			this.activeWidget = widget;
			if (widget.editor !== null) {
				widget.editor.layout();
			}
			return;
		}

		content = this.fileContents.get(path);
		if (content === undefined) {
			content = "";
		}

		fileName = path.split("/").pop();
		monacoLang = this.detectLanguage(fileName);

		widget = new EditorWidget(path, content, monacoLang, fileName, this);
		this.openWidgets.set(path, widget);

		widget.title.closable = true;
		widget.disposed.connect(() => {
			this.openWidgets.delete(path);
		});

		this.dockPanel.addWidget(widget);
		this.dockPanel.activateWidget(widget);
		this.activeWidget = widget;

		setTimeout(() => {
			if (widget.editor !== null) {
				widget.editor.layout();
			}
		}, EDITOR_LAYOUT_DELAY_MS);
	}

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
}

let manager = null;
manager = new WorkspaceManager();
manager.init();