const system = (function() {
  let firstWindowId = -1;
  let referenceOwnPackage;
  window.addEventListener("message", (e) => {
    const type = e.data.type;
    const args = e.data.args;
  
    if (type == "startScript") {
      if (system) system.window.id = args[1];
      else firstWindowId = args[1];
      referenceOwnPackage = args[2];
      const script = document.createElement("script");
      script.innerHTML = atob(args[0]);
      document.head.appendChild(script);
      return;
    }
  }, false);
  
  const addWin = () => {
    window.addEventListener("focus", async () => await system.window.grabFocus());
  };
  addWin();
  
  const init = () => {
    window.addEventListener("message", async (e) => {
      const type = e.data.type;
      const args = [...e.data.args];
    
      if (type == "updateProgress") {
        system.events.onupdateprogress?.(args[0], args[1]);
        return;
      }
      if (type == "programExit") {
        console.debug("[sandbox] Got exit request.");
        await system.events.onclose?.(2);
        await system.events.onexit?.();
        console.debug("[sandbox] Exiting...");
        parent.postMessage({type: "programExited"}, "*");
        return;
      }
      if (type == "windowExit") {
        if (system.events.onclose) await system.events.onclose(args[0]);
        else await system.window.close();
        if (!system.options.runInBackground && (await system.window.getState()) == 0) await system.process.this.kill();
        return;
      }
    }, false);
    
    console.log("[sandbox] SDK loaded");
  };
  init();
  
  return (function() {
    const send = (type, action, ...args) => {
      return new Promise((rs, rj) => {
        const id = Math.floor(Math.random() * 100000000);
        const listener = (e) => {
          const type = e.data.type;
          const args = [...e.data.args];
  
          const success = type == "apiResponse";
          if (!success && type != "apiFailure") return;
          if (args.shift() != id) return;
          window.removeEventListener("message", listener);
  
          if (success) {
            rs(args);
            return;
          }
          rj(args[0]);
        };
        window.addEventListener("message", listener, false);
        parent.postMessage({id, type, action, args}, "*");
      });
    };
    const sendo = (action, ...args) => send("operation", action, ...args);
    const sendw = (action, ...args) => send("window", action, ...args);
    const sendp = (action, ...args) => send("process", action, ...args);
    const sendfs = (action, ...args) => send("fs", action, ...args);
    
    const newProcess = (id, pkg) => {
      return {
        async getId() {
          return id ?? (id = (await sendp("5", id))[0]);
        },
        async getPackage() {
          return pkg ?? (pkg = (await sendp("6", id))[0]);
        },
        async kill() {
          return (await sendp("0", id))[0];
        },
        async getArguments() {
          return (await sendp("2", id))[0];
        }
      };
    };
  
    return {
      options: {
        runInBackground: false
      },
      events: {
        onupdateprogress: null,
        onexit: null,
        onclose: null // args: [int] type of close, 0 = normal user close, 1 = force user close, 2 = process exit
      },
      util: {
        loadFile() {
          return new Promise((s, j) => {
            const input = document.createElement("input");
            input.type = "file";
            const dt = new DataTransfer();
            dt.items.add(new File([""], "test.txt", {type: "text/plain", lastModified: new Date()}));
            input.files = dt.files;
            input.onchange = (e) => {
              const file = e.target.files[0];
              if (!file) return s(null);
              const reader = new FileReader();
              reader.readAsDataURL(file);
              reader.onload = () => s(atob(reader.result.substring(reader.result.indexOf(",") + 1)));
              reader.onerror = j;
            };
            input.click();
          });
        },
        saveFile(filename, data) {
          const file = new Blob([data], {type: "application/octet-stream"});
          if (window.navigator.msSaveOrOpenBlob) {
            window.navigator.msSaveOrOpenBlob(file, filename);
            return;
          }
          const url = URL.createObjectURL(file);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);  
          }, 0);
        },
        documentWrite(html) {
          document.open();
          document.write(html);
          addWin();
          init();
        }
      },
      operation: {
        sleep(time) {
          return new Promise(r => setTimeout(r, time));
        },
        async downloadFile(path, url) {
          return (await sendo("0", url, path))[0];
        },
        async obtainAppAccess(forPackage) {
          return (await sendo("1", forPackage))[0];
        },
        async getAppName(pkg) {
          return (await sendo("2", pkg))[0];
        },
        async submit(args) {
          return (await sendo("3", ...args))[0];
        },
        async getPerformance() {
          return (await sendo("4"))[0];
        },
        async shutdown() {
          return (await sendo("5"))[0];
        },
        async reboot() {
          return (await sendo("6"))[0];
        },
        async configureSettings(property, value) {
          return (await sendo("7", property, value))[0];
        },
        async configureAppSettings(property, value) {
          return (await sendo("7", "@" + referenceOwnPackage + ":" + property, value))[0];
        },
        async getSettingsProperty(property) {
          return (await sendo("8", property))[0];
        },
        async getAppSettingsProperty(property) {
          return (await sendo("8", "@" + referenceOwnPackage + ":" + property))[0];
        },
        async sendLvosData(data) {
          return (await sendo("9", data))[0];
        }
      },
      window: {
        id: firstWindowId,
        /*
        async isMinimized() {
          return (await sendw("0"))[0];
        },
        async isMaximized() {
          return (await sendw("9"))[0];
        },
        async isHidden() {
          return (await sendw("1"))[0];
        },*/
        async getState() {
          return (await sendw("d"))[0]; // 0 = closed, 1 = maximized, 2 = minimized, 3 = normal, 4 = hidden
        },
        async minimize() {
          return (await sendw("2"))[0];
        },
        async maximize() {
          return (await sendw("3"))[0];
        },
        async restore() {
          return (await sendw("4"))[0];
        },
        async hide() {
          return (await sendw("5"))[0];
        },
        async show() {
          return (await sendw("6"))[0];
        },
        async close() {
          return (await sendw("7"))[0];
        },
        async loadHtml(relativePath) {
          document.open();
          document.write(await system.fs.resource.readString(relativePath));
          addWin();
          init();
        },
        async loadStyles(relativePath) {
          const style = document.createElement("style");
          style.innerHTML = await system.fs.resource.readString(relativePath);
          document.head.appendChild(style);
        },
        async loadScript(relativePath) {
          const script = document.createElement("script");
          script.innerHTML = await system.fs.resource.readString(relativePath);
          document.head.appendChild(script);
        },
        async resolveResources() {
          const l = document.querySelectorAll("*");
          for (let i = 0; i < l.length; i++) {
            const ff = l[i].getAttribute("resfile");
            if (!ff) continue;
            const comma = ff.indexOf(",");
            l[i].setAttribute(ff.substring(0, comma), URL.createObjectURL(await system.fs.resource.readBlob(ff.substring(comma + 1))));
          }
        },
        async fixFocus() {
          addWin();
        },
        async grabFocus() {
          return (await sendw("8"))[0];
        },
        async setTitle(title) {
          return (await sendw("a", title))[0];
        },
        async sendNotification(title, body, icon) {
          return {
            id: (await sendw("b", title, body, icon))[0],
            title,
            body,
            icon,
            async waitForClick() {
              return {...(await sendw("c", this.id))[0], id: this.id};
            }
          };
        },
        async setTransparency(transparent) {
          return (await sendw("e", transparent))[0];
        }
      },
      process: { // processes are documented in `os.js` as `<Process>`
        this: newProcess(undefined),
        async start(pkg, args) {
          return newProcess(...(await sendp("1", pkg, args)));
        },
        async startAndWait(pkg, args) {
          return (await sendp("4", pkg, args))[0];
        },
        async getAll() {
          return (await sendp("3"))[0].map((p) => newProcess(p[0], p[1]));
        },
        async getAllStarted() {
          return (await sendp("7"))[0].map((p) => newProcess(p[0], p[1]));
        },
        async getCallerPackage() {
          return (await sendp("8"))[0];
        },
        async startService(id) {
          return (await sendp("9", id))[0];
        }
      },
      fs: {
        resource: {
          async readString(relativePath) {
            return (await sendfs("0", relativePath))[0];
          },
          async readBase64(relativePath) {
            return (await sendfs("1", relativePath))[0];
          },
          async readBlob(relativePath, type = "application/octet-stream") {
            return await fetch(`data:${type};base64,${await this.readBase64(relativePath)}`).then(res => res.blob());
          },
          async copyToOutside(oldRelativePath, newAbsolutePath) {
            await system.fs.writeBase64(newAbsolutePath, await this.readBase64(oldRelativePath));
            return 1;
          }
        },
        async listAll(path) {
          return (await sendfs("2", path))[0];
        },
        async listFiles(path) {
          return (await sendfs("a", path))[0];
        },
        async listDirectories(path) {
          return (await sendfs("b", path))[0];
        },
        async getPath(path) {
          const n = decodeURIComponent(new URL("https://example.com/" + encodeURI(path)).pathname.replace(/\/+(?=\/)/g,'').replace(/\/+$/, ""));
          return n.length == 0 ? "/" : n;
          // return (await sendfs("3", path))[0];
        },
        async exists(path) {
          return (await sendfs("4", path))[0];
        },
        async getParent(path) {
          const pp = await this.getPath(path);
          return pp.substring(0, pp.lastIndexOf("/") + 1);
        },
        async isDir(path) {
          return (await sendfs("5", path))[0];
        },
        async isFile(path) {
          return !(await this.isDir(path));
        },
        async readString(path) {
          return (await sendfs("6", path))[0];
        },
        async readBase64(path) {
          return (await sendfs("7", path))[0];
        },
        async readBlob(path, type = "application/octet-stream") {
          return await fetch(`data:${type};base64,${await this.readBase64(path)}`).then(res => res.blob());
        },
        async createPath(path) {
          return (await sendfs("8", path))[0];
        },
        async deletePath(path) {
          return (await sendfs("9", path))[0];
        },
        async writeString(path, data) {
          return (await sendfs("c", path, data))[0];
        },
        async writeBase64(path, data) {
          return (await sendfs("d", path, data))[0];
        },
        async copy(oldpath, newpath) {
          if (!(await this.exists(oldpath))) return 0;
          if (await this.isDir(oldpath)) {
            await this.createPath(newpath);
            let add = 0;
            const files = await this.listFiles(oldpath);
            for (let i = 0; i < files.length; i++) await this.writeBase64(newpath + "/" + files[i], await this.readBase64(oldpath + "/" + files[i]));
            add += files.length;
            const dirs = await this.listDirectories(oldpath);
            for (let i = 0; i < dirs.length; i++) add += await this.copy(oldpath + "/" + dirs[i], newpath + "/" + dirs[i]);
            return add;
          }
          await this.writeBase64(newpath, await this.readBase64(oldpath));
          return 1;
        }
      }
    };
  })();
})();