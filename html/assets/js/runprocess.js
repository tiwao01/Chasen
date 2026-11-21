import * as CheerpX from "https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js";

export class CheerpXRunner {
	constructor (defaultOptions) {
		let mergedRunOpt = null;

		mergedRunOpt = {
			env: [
				"HOME=/root",
				"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
				"TERM=xterm-256color",
				"COLORTERM=truecolor",
				"LANG=C.UTF-8"
			],
			cwd: "/root",
			uid: 0,
			gid: 0
		};

		this.decCode = "utf-8";
		this.runOpt = mergedRunOpt;
		this.cx = null;
		this.sendFunc = null;
		this.isSilent = false;
		this.captureBuffer = "";
		this.isCapturing = false;

		if (defaultOptions !== undefined) {
			if (defaultOptions.decCode !== undefined) {
				this.decCode = defaultOptions.decCode;
			}
			if (defaultOptions.runOpt !== undefined) {
				if (defaultOptions.runOpt.env !== undefined) {
					this.runOpt.env = defaultOptions.runOpt.env;
				}
				if (defaultOptions.runOpt.cwd !== undefined) {
					this.runOpt.cwd = defaultOptions.runOpt.cwd;
				}
				if (defaultOptions.runOpt.uid !== undefined) {
					this.runOpt.uid = defaultOptions.runOpt.uid;
				}
				if (defaultOptions.runOpt.gid !== undefined) {
					this.runOpt.gid = defaultOptions.runOpt.gid;
				}
			}
		}
	}

	sendCommand (cmdStr) {
		let enc = null;
		let bytes = null;
		let i = 0;

		if (this.sendFunc === null) {
			return;
		}

		enc = new TextEncoder();
		bytes = enc.encode(cmdStr);
		for (i = 0; i < bytes.length; i++) {
			this.sendFunc(bytes[i]);
		}
	}

	async writeFile (filePath, content) {
		let enc = null;
		let bytes = null;
		let bStr = "";
		let b64 = "";
		let cmd = "";
		let i = 0;

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		enc = new TextEncoder();
		bytes = enc.encode(content);
		for (i = 0; i < bytes.length; i++) {
			bStr = bStr + String.fromCharCode(bytes[i]);
		}
		b64 = btoa(bStr);

		this.isSilent = true;
		cmd = `mkdir -p "$(dirname "${filePath}")" && echo "${b64}" | base64 -d > "${filePath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isSilent = false;
	}

	async removeFile (filePath) {
		let cmd = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `rm -rf "${filePath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isSilent = false;
	}

	async copyFile (srcPath, destPath) {
		let cmd = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.isSilent = true;
		cmd = `cp -r "${srcPath}" "${destPath}" && sync >/dev/null 2>&1`;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isSilent = false;
	}

	async execSilentOutput (cmd) {
		let result = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		this.captureBuffer = "";
		this.isCapturing = true;
		await this.cx.run("/bin/sh", ["-c", cmd], this.runOpt);
		this.isCapturing = false;
		result = this.captureBuffer;
		this.captureBuffer = "";

		return result;
	}

	async listFiles (targetDir) {
		let cmd = "";
		let rawOutput = "";
		let lines = [];
		let paths = [];
		let i = 0;
		let line = "";
		let normalizedTarget = "";

		cmd = `mkdir -p "${targetDir}" && find "${targetDir}" -mindepth 1 2>/dev/null`;
		rawOutput = await this.execSilentOutput(cmd);
		lines = rawOutput.split(/\r?\n/);
		normalizedTarget = targetDir.replace(/\/+$/, "");

		for (i = 0; i < lines.length; i++) {
			line = lines[i].trim();
			if (line !== "") {
				if (line === normalizedTarget) {
					continue;
				}
				if (line === normalizedTarget + "/") {
					continue;
				}
				paths.push(line);
			}
		}

		return paths;
	}

	async readFile (filePath) {
		let cmd = "";
		let b64 = "";
		let bStr = "";
		let bytes = null;
		let dec = null;
		let i = 0;

		cmd = `base64 "${filePath}" | tr -d '\\r\\n'`;
		b64 = await this.execSilentOutput(cmd);
		b64 = b64.trim();

		if (b64 === "") {
			return "";
		}

		try {
			bStr = atob(b64);
			bytes = new Uint8Array(bStr.length);
			for (i = 0; i < bStr.length; i++) {
				bytes[i] = bStr.charCodeAt(i);
			}
			dec = new TextDecoder(this.decCode);
			return dec.decode(bytes);
		} catch (e) {
			console.warn(`[readFile] Failed to base64 decode file: ${filePath}`, e);
			return "";
		}
	}

	async syncWorkspaceFiles (targetDir) {
		let cmd = "";
		let rawOutput = "";
		let lines = [];
		let paths = [];
		let fileMap = null;
		let i = 0;
		let line = "";
		let filePath = "";
		let content = "";
		let isDirCmd = "";
		let isDirRes = "";
		let normalizedTarget = "";

		if (this.cx === null) {
			throw new Error("CheerpX is not initialized");
		}

		fileMap = new Map();
		
		cmd = `mkdir -p "${targetDir}" && find "${targetDir}" -mindepth 1 2>/dev/null`;
		rawOutput = await this.execSilentOutput(cmd);
		
		lines = rawOutput.split(/\r?\n/);
		normalizedTarget = targetDir.replace(/\/+$/, "");

		for (i = 0; i < lines.length; i++) {
			line = lines[i];
			line = line.trim();
			if (line !== "") {
				if (line === normalizedTarget) {
					continue;
				}
				if (line === normalizedTarget + "/") {
					continue;
				}
				if (line === "/" || line === "") {
					continue;
				}

				isDirCmd = `if [ -d "${line}" ]; then echo "YES"; else echo "NO"; fi`;
				isDirRes = await this.execSilentOutput(isDirCmd);
				isDirRes = isDirRes.trim();

				if (isDirRes === "YES") {
					paths.push(line + "/");
				} else {
					paths.push(line);
				}
			}
		}

		for (i = 0; i < paths.length; i++) {
			filePath = paths[i];
			
			if (!filePath.endsWith("/")) {
				content = await this.readFile(filePath);
				fileMap.set(filePath, content);
			}
		}

		return {
			paths: paths,
			fileMap: fileMap
		};
	}

	async checkAndResetChangeFlag () {
		let cmd = "";
		let result = "";

		if (this.cx === null) {
			return false;
		}

		cmd = `if [ -f /tmp/workspace_changed ]; then rm -f /tmp/workspace_changed && echo "YES"; else echo "NO"; fi`;
		result = await this.execSilentOutput(cmd);
		result = result.trim();

		return result === "YES";
	}

	async getWorkspaceCount (targetDir) {
		let cmd = "";
		let result = "";

		if (this.cx === null) {
			return "";
		}

		cmd = `find "${targetDir}" 2>/dev/null | wc -l`;
		result = await this.execSilentOutput(cmd);
		result = result.trim();

		return result;
	}

	async runProcess (exPath, args, term, imgPath, dbName, overrideOptions) {
		let httpDev = null;
		let idbDev = null;
		let overlayDev = null;
		let dec = null;
		let enc = null;
		let currentDecCode = "";
		let currentRunOpt = null;
		let txt = "";
		let normd = "";
		let bData = null;
		let j = 0;

		currentDecCode = this.decCode;
		currentRunOpt = {
			env: this.runOpt.env,
			cwd: this.runOpt.cwd,
			uid: this.runOpt.uid,
			gid: this.runOpt.gid
		};

		if (overrideOptions !== undefined) {
			if (overrideOptions.decCode !== undefined) {
				currentDecCode = overrideOptions.decCode;
			}
			if (overrideOptions.runOpt !== undefined) {
				if (overrideOptions.runOpt.env !== undefined) {
					currentRunOpt.env = overrideOptions.runOpt.env;
				}
				if (overrideOptions.runOpt.cwd !== undefined) {
					currentRunOpt.cwd = overrideOptions.runOpt.cwd;
				}
				if (overrideOptions.runOpt.uid !== undefined) {
					currentRunOpt.uid = overrideOptions.runOpt.uid;
				}
				if (overrideOptions.runOpt.gid !== undefined) {
					currentRunOpt.gid = overrideOptions.runOpt.gid;
				}
			}
		}

		try {
			httpDev = await CheerpX.HttpBytesDevice.create(imgPath);
			idbDev = await CheerpX.IDBDevice.create(dbName);
			overlayDev = await CheerpX.OverlayDevice.create(httpDev, idbDev);

			this.cx = await CheerpX.Linux.create(
				{
					mounts: [
						{
							type: "ext2",
							path: "/",
							dev: overlayDev
						},
						{
							type: "devs",
							path: "/dev"
						}
					]
				}
			);

			dec = new TextDecoder(currentDecCode);
			this.sendFunc = this.cx.setCustomConsole(
				(buf) => {
					txt = dec.decode(
						buf,
						{
							stream: true
						}
					);
					if (this.isCapturing) {
						this.captureBuffer = this.captureBuffer + txt;
						return;
					}
					if (this.isSilent) {
						return;
					}
					normd = txt.replace(/\n/g, "\r\n");
					term.write(normd);
				},
				term.cols,
				term.rows
			);

			enc = new TextEncoder();
			term.onData(
				(str) => {
					bData = enc.encode(str);
					for (j = 0; j < bData.length; j++) {
						this.sendFunc(bData[j]);
					}
				}
			);

			await this.cx.run(exPath, args, currentRunOpt);
		} catch (err) {
			console.error("Error starting process:", err);
		}
	}
}