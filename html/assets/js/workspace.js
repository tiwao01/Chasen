import { CheerpXRunner } from "./runprocess.js";
import * as monaco from "https://esm.sh/monaco-editor@0.45.0";

// Setting for monaco editor web worker
self.MonacoEnvironment = {
	getWorkerUrl: function (moduleId, label) {
		return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
			self.MonacoEnvironment = {
				baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/'
			};
			importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
		`)}`;
	}
};

// lang to language for Monaco
const LANG_CONF_MAP = {
    c: {
        language: "c",
        codePath: "assets/initial/init.c"
    }
}

async function initializeWorkspace() {
	let params = null;
	let lang = "";
    let currentConfig = null;
	let titleElm = null;
	let termElm = null;
	let editorElm = null;
	let term = null;
	let fitAddon = null;
    let editor = null;
	let runner = null;
	let imgPath = "";
	let dbName = "";
    let codeText = "";
    let response = null;

	params = new URLSearchParams (window.location.search);
	lang = params.get ("lang");

	if (lang === null) {
		lang = "c";
	}

    currentConfig = LANG_CONF_MAP[lang];
    if (currentConfig === undefined) {
        lang = "c";
        currentConfig = LANG_CONF_MAP["c"];
    }

	titleElm = document.getElementById ("title");
	termElm = document.getElementById ("terminal-container");
	editorElm = document.getElementById ("editor-container");

	titleElm.innerText = `${lang} Environment Loading...`;

    // Load inital code file.
    try {
        response = await fetch (currentConfig.codePath);
        if (response.ok) {
            codeText = await response.text ();
        }
    } catch (fetchErr) {
        console.error ("Failed to load initial code file, using default.", fetchErr);
    }

	// Init terminal.
	term = new Terminal (
        {
		    cursorBlink: true,
		    theme: {
			    background: "#000000"
		    }
	    }
    );
	fitAddon = new FitAddon.FitAddon ();
	term.loadAddon (fitAddon);
	term.open (termElm);
	fitAddon.fit ();

	// Init editor.
	editor = monaco.editor.create (
		editorElm,
		{
			value: codeText,
			language: currentConfig.language,
			theme: "vs-dark",
			automaticLayout: true
		}
	);

	// Resize
	window.addEventListener (
		"resize",
		() => {
			fitAddon.fit ();
		}
	);

	try {
		runner = new CheerpXRunner();
		imgPath = `/dist/rootfs-${lang}.ext2`;
		dbName = `cache_${lang}`;

		titleElm.innerText = `${lang} Environment Running`;
		await runner.runProcess (
            "/bin/sh",
            [],
            term,
            imgPath,
            dbName
        );
	} catch (err) {
		console.error ("Error starting workspace:", err);
		titleElm.innerText = `Error: ${err.message}`;
	}
}

initializeWorkspace ();