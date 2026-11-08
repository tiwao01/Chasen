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

		// Override settings.
		if (defaultOptions) {
			if (defaultOptions.decCode) {
				this.decCode = defaultOptions.decCode;
			}
			if (defaultOptions.runOpt) {
				if (defaultOptions.runOpt.env) {
					this.runOpt.env = defaultOptions.runOpt.env;
				}
				if (defaultOptions.runOpt.cwd) {
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

	async runProcess (exPath, args, term, imgPath, dbName, overrideOptions) {
		let httpDev = null;
		let idbDev = null;
		let overlayDev = null;
		let cx = null;
		let dec = null;
		let enc = null;
		let snd = null;
		let currentDecCode = "";
		let currentRunOpt = null;
		let j = 0;

		currentDecCode = this.decCode;
		currentRunOpt = {
			env: this.runOpt.env,
			cwd: this.runOpt.cwd,
			uid: this.runOpt.uid,
			gid: this.runOpt.gid
		};

		// 実行時の一時的な上書き対応
		if (overrideOptions) {
			if (overrideOptions.decCode) {
				currentDecCode = overrideOptions.decCode;
			}
			if (overrideOptions.runOpt) {
				if (overrideOptions.runOpt.env) {
					currentRunOpt.env = overrideOptions.runOpt.env;
				}
				if (overrideOptions.runOpt.cwd) {
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
			httpDev = await CheerpX.HttpBytesDevice.create (imgPath);
			idbDev = await CheerpX.IDBDevice.create (dbName);
			overlayDev = await CheerpX.OverlayDevice.create (httpDev, idbDev);
			cx = await CheerpX.Linux.create (
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

			dec = new TextDecoder (currentDecCode);
			snd = cx.setCustomConsole (
				(buf) => {
					let txt = "";
					let normd = "";

					txt = dec.decode (
						buf,
						{
							stream: true
						}
					);
					normd = txt.replace (/\n/g, "\r\n");
					term.write (normd);
				},
				term.cols,
				term.rows
			);

			enc = new TextEncoder ();
			term.onData (
				(str) => {
					let bData = null;
					
					bData = enc.encode (str);
					for (j = 0; j < bData.length; j++) {
						snd (bData[j]);
					}
				}
			);

			await cx.run (exPath, args, currentRunOpt);
		} catch (err) {
			console.error ("Error starting process:", err);
		}
	}
}
