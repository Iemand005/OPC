const settings = {};
const os = (function() {
  const processes = [];
  const hooks = {};
  const hook = (type, id, callback) => {
    let tt = hooks[type];
    if (!tt) hooks[type] = tt = [];
    let cc = tt[id];
    if (!cc) cc = tt[id] = [];
    cc.push(callback);
    return cc.length - 1;
  };
  const unhook = (type, id, index) => {
    const cc = hooks[type][id];
    cc.splice(index, 1, null);
  };
  const hashook = (type, id) => hooks[type]?.[id] != undefined;
  const callhook = (type, id, ...args) => {
    const hh = hooks[type];
    if (!hh) return;
    const cc = hh[id];
    if (!cc) return;
    for (let i = 0; i < cc.length; i++) cc[i]?.(...args);
  };
  /* https://stackoverflow.com/a/50457849/15390856 */
  const getFrameByEvent = (event) => {
    return Array.from(document.getElementsByTagName("iframe")).filter(iframe => {
      return iframe.contentWindow === event.source;
    })[0];
  };
  
  let focusedWindow;
  let globalZIndex = -1;
  let allowLvos = false;
  let optionsListener;

  return {
    initProcessListener() {
      window.addEventListener("message", async (e) => {
        const id = e.data.id;
        const type = e.data.type;
        const action = e.data.action;
        const args = e.data.args;
        
        const send = (...args) => e.source.postMessage({type: "apiResponse", args: [id, ...args]}, "*");
        const sendType = (type, ...args) => e.source.postMessage({type, args: [...args]}, "*");
        const frame = getFrameByEvent(e);
        if (!frame) {
          return;
        }

        const ctxpkg = frame.id;

        const handleError = (err, ...extra) => {
          e.source.postMessage({type: "apiFailure", args: [id, err]}, "*");
          os.log("app-connector", "Error: " + err + "\nExtra: " + extra.map((v) => JSON.stringify(v)).join(", "), 3);
        };

        if (type == "programExited") {
          callhook("programExitedAwait", this.getProcessByContext(frame)[1].id);
          return;
        }

        if (type == "operation") {
          if (action == "0") {//API:operation.downloadFile
            if (args.length <= 1) return handleError("Expected 2 arguments.");
            const url = args[0] ?? "";
            const path = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            try {
              const done = await this.operation.download(url, this.fs.raw.getPath(path));

              if (!done[0]) return handleError("Path is invalid.", done[1]);
              return send(true);
            } catch (e) {
              return handleError("Invalid URL.", e);
            }
          }
          if (action == "1") {//API:operation.obtainAppAccess
            if (args.length == 0) return handleError("Expected 1 argument.");
            const forpkg = args[0] ?? "";

            if (this.fs.checkPermission("/apps/" + forpkg, ctxpkg, "EDIT")[1] > 0) return send(true);

            const done = await this.startProcess("me.flexan.access", ["app", forpkg, ctxpkg], {id: "system,"});
            if (!done[0]) return handleError("Failed to request access.", done[1]);

            let hid;
            hid = hook("onTerminate", done[1], () => {
              unhook("onTerminate", done[1], hid);
              if (e.source) send(this.fs.checkPermission("/apps/" + forpkg, ctxpkg, "EDIT")[1] > 0);
            });
            return;
          }
          if (action == "2") {//API:operation.getAppName
            if (args.length == 0) return handleError("Expected 1 argument.");
            const pkg = args[0] ?? "";
            
            let appdata = await this.getAppdata(pkg, true);
            if (!appdata[0]) return handleError("Failed to get appdata for package.", appdata[1]);
            appdata = appdata[1];
            return send(appdata.name);
          }
          if (action == "3") {//API:operation.submit
            try {
              if (this.getProcessByContext(frame)[1].initiator?.id != "system,") return handleError("Access denied.");

              if (ctxpkg == "me.flexan.access") {
                if (args[0] == "app") {
                  this.fs.allowAppDirectoryPerm(args[2], args[1], "EDIT");
                  return send(true);
                }
              }
              if (ctxpkg == "me.flexan.lvos-connector") {
                allowLvos = args[0] ? true : false;
                return send(true);
              }
              if (ctxpkg == "me.flexan.terminal" || ctxpkg == "me.flexan.setup") {
                if (args[0] == 0x00) {
                  this.fs.createDirs("/system");
                  this.fs.writeFile("/system/host", args[1]);
                  return send(true);
                }
                if (args[0] == 0x01) {
                  if (!this.fs.exists("/system/host")[1]) return handleError("No host found.");
                  const read = this.fs.readFile("/system/host");
                  if (!read[0]) return handleError("Failed to read host.", read);

                  /* old method
                  let files = await this.operation.downloadJSON(read[1] + "/_structure.json");
                  if (!files[0]) return handleError("Failed to download from host.", files);
                  files = files[1];
                  if (typeof files != "object" || files.constructor !== Array) return handleError("Host is deceiving.");

                  for (let i = 0; i < files.length; i++) {
                    await this.operation.download(read[1] + "/" + files[i], "/" + files[i]);
                  }
                   */
                  
                  this.fs.createDirs(this.fs.raw.getPath("/system/states"));
                  this.fs.createFile("/system/states/updating", "");
                  
                  let versions = await this.operation.downloadJSON(read[1] + "/__update.json");
                  if (!versions[0]) return handleError("Failed to download from host.");
                  versions = versions[1];
                  if (typeof versions != "object" || versions.constructor === Array) return handleError("Host is deceiving.");

                  let version = null;
                  let sysver = null;
                  if (this.fs.exists("/system/sysver")[1]) {
                    sysver = this.fs.readFile("/system/sysver")[1];
                    version = versions[sysver];
                  }
                  
                  const downloadVersion = async (ver) => {
                    if (!ver) return;
                    const wasprev = version == ver && sysver != null && !versions[ver.nextVersion];
                    if (version == ver && !wasprev) return await downloadVersion(versions[ver.nextVersion]);
                    version = ver;
                    if (version.skip) return await downloadVersion(versions[version.version]);
                    try {
                      sendType("updateProgress", "versionStart", version.version);
                      sendType("updateProgress", "isUpdating", wasprev);
                      let files = wasprev ? [] : (version.install?.files ?? []);
                      let dirs = wasprev ? [] : (version.install?.directories ?? []);
                      const files2 = version.update?.files ?? [];
                      const dirs2 = version.update?.directories ?? [];
                      files = [...files, ...files2];
                      dirs = [...dirs, ...dirs2];

                      for (let i = 0; i < files.length; i++) {
                        sendType("updateProgress", "download", read[1] + "/" + files[i]);
                        await this.operation.download(read[1] + "/" + files[i], "/" + files[i]);
                        sendType("updateProgress", "file", "/" + files[i]);
                      }
                      for (let i = 0; i < dirs.length; i++) {
                        this.fs.createDirs(this.fs.raw.getPath("/" + dirs[i]));
                        sendType("updateProgress", "directory", "/" + dirs[i]);
                      }

                      sendType("updateProgress", "config");
                      if (!wasprev && version.install?.taskbar) {
                        for (let i = 0; i < version.install.taskbar.length; i++) {
                          this.taskbar.add(version.install.taskbar[i]);
                        }
                      }
                      
                      os.notifications.show(wasprev ? "Updated" : "Installed", version.version);
                      sendType("updateProgress", "versionEnd", wasprev);

                      if (!wasprev) await downloadVersion(versions[version.nextVersion]);
                    } catch {
                      return handleError("Host's format is incorrect.");
                    }
                  };

                  await downloadVersion(version ?? versions[Object.keys(versions)]);
                  if (version) this.fs.writeFile("/system/sysver", version.version);

                  this.fs.delete("/system/states/updating");
                  this.fs.createFile("/system/states/setup_finished", "");

                  return send(true);
                }
                if (args[0] == 0x02) {
                  if (args[1].includes(",")) return handleError("Package can't contain commas.");
                  this.taskbar.add(args[1]);
                  return send(true);
                }
                if (args[0] == 0x03) {
                  if (args[1].includes(",")) return handleError("Package can't contain commas.");
                  this.taskbar.remove(args[1]);
                  return send(true);
                }
                if (args[0] == 0x04) {
                  const mnt = this.fs.mount.mount(args[1], args[2]);
                  if (!mnt[0]) return handleError("Failed to mount.", mnt[1]);
                  return send(true);
                }
                if (args[0] == 0x05) {
                  const mnt = this.fs.mount.eject(args[1]);
                  if (!mnt[0]) return handleError("Failed to eject.", mnt[1]);
                  return send(mnt[1]);
                }
              }
              return handleError("Invalid operation.");
            } catch {
              return handleError("Source is untrustworthy.");
            }
          }
          if (action == "4") {//API:operation.getPerformance
            return send({ram: {unit: " MB", value: this.memory.ramUsageMB.toFixed(2)}, gpu: {unit: "% (not measured)", value: 0}, cpu: {unit: "% (not measured)", value: 0}, cores: {unit: "", value: navigator.hardwareConcurrency}});
          }
          if (action == "5") {//API:operation.shutdown
            let rb = true;

            os.notifications.show("Shutdown", "OPC will shutdown in 5 seconds. Press to cancel.", (n) => {
              n.dismiss();
              rb = false;
              s();
            });
            await new Promise((s) => setTimeout(s, 5000));
            
            if (rb) this.shutdown();
            return send(rb);
          }
          if (action == "6") {//API:operation.reboot
            let rb = true;
            
            os.notifications.show("Reboot", "OPC will reboot in 5 seconds. Press to cancel.", (n) => {
              n.dismiss();
              rb = false;
              s();
            });
            await new Promise((s) => setTimeout(s, 5000));

            if (rb) this.reboot();
            return send(rb);
          }
          if (action == "7") {//API:operation.configureSettings, API:operation.configureAppSettings
            if (args.length < 2) return handleError("Expected 2 or more arguments.");
            if (!args[0]?.trim?.() || args[0]?.includes?.("=")) return handleError("Property is invalid.");
            if (!args[1]?.trim?.() || args[1]?.includes?.("=")) return handleError("Value is invalid.");

            os.settings.update(args[0], args[1]);
            return send(true);
          }
          if (action == "8") {//API:operation.getSettingsProperty, API:operation.getAppSettingsProperty
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            return send(os.settings.get(args[0]));
          }
          if (action == "9") {//API:operation.sendLvosData
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            if (!["open", "windowSize", "launchOverlay", "readyToLaunchOverlay"].includes(args[0]?.type)) return handleError("LVOS type not allowed.");
            if (!allowLvos || window.top === window) return send(true);

            window.top.postMessage(JSON.stringify({type: args[0].type, data: args[0].data, id: args[0].id, lvos: true}), "*");
            return send(true);
          }
        }

        if (type == "window") {
          if (action == "b") {//API:window.sendNotification
            if (args.length < 2) return handleError("Expected 2 or more arguments.");
            const notifId = Math.floor(Math.random() * 1000000);
            this.notifications.show(args[0], args[1], (notification) => {
              notification.onClick = null;
              callhook("notificationCallback", notifId, notification);
            }, args[2]);
            return send(notifId);
          }
          if (action == "c") {//API:<Notification>.waitForClick
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            hook("notificationCallback", +args[0], (notification) => send(notification));
            return;
          }

          const win = frame.parentElement;
          if (win == document.body || win.classList.contains("hidden")) return action == "d" ? send(0) : handleError("No window to manage.");

          if (action == "0") {//API:window.isMinimized
            return send(win.classList.contains("windowMinimized"));
          }
          if (action == "1") {//API:window.isHidden
            return send(win.classList.contains("windowHidden"));
          }
          if (action == "2") {//API:window.minimize
            win.classList.add("windowMinimized");
            win.classList.remove("windowMaximized");
            return send(true);
          }
          if (action == "3") {//API:window.maximize
            win.classList.add("windowMaximized");
            win.classList.remove("windowMinimized");
            return send(true);
          }
          if (action == "4") {//API:window.restore
            win.classList.remove("windowMinimized");
            win.classList.remove("windowMaximized");
            return send(true);
          }
          if (action == "5") {//API:window.hide
            const count = document.querySelector("#taskbarItem-" + CSS.escape(frame.id) + " .taskbarItemCount");
            if (count && !win.classList.contains("windowHidden")) {
              const cc = +count.innerText - 1;
              count.innerText = cc;
              if (cc == 0) count.style.display = "none";
            }
            win.classList.add("windowHidden");
            return send(true);
          }
          if (action == "6") {//API:window.show
            const count = document.querySelector("#taskbarItem-" + CSS.escape(frame.id) + " .taskbarItemCount");
            if (count && win.classList.contains("windowHidden")) {
              count.style.display = "";
              count.innerText = +count.innerText + 1;
            }
            win.classList.remove("windowHidden");
            return send(true);
          }
          if (action == "7") {//API:window.close
            const process = this.getProcessByContext(frame)[1];
            os.closeWindowV2(frame, process, true);
            //if (process.windows.length == 0) return;
            return send(true);
          }
          if (action == "8") {//API:window.grabFocus
            os.focusWindow(win);
            return send(true);
          }
          if (action == "9") {//API:window.isMaximized
            return send(win.classList.contains("windowMaximized"));
          }
          if (action == "a") {//API:window.setTitle
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            win.querySelector(".windowTop p").innerText = args[0];
            return send(true);
          }
          if (action == "d") {//API:window.getState
            return send(win.classList.contains("windowHidden") ? 4 : (win.classList.contains("windowMinimized") ? 2 : (win.classList.contains("windowMaximized") ? 1 : 3)));
          }
          if (action == "e") {//API:window.setTransparency
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            if (args[0]) frame.classList.add("windowTransparent");
            else frame.classList.remove("windowTransparent");
            return send(!!args[0]);
          }
          return handleError("Unknown/unimplemented API requested.");
        }

        if (type == "process") {
          if (action == "0") {//API:<Process>.kill
            if (args.length > 0 && args[0]) {
              const process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              this.killProcess(process);
              return;
            }
            this.killProcess(this.getProcessByContext(frame)[1]);
            return;
          }
          if (action == "1") {//API:process.start
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            const pkg = args[0] ?? "";
            const done = await this.startProcess(pkg, args[1], frame);
            if (!done[0]) return handleError("Failed to start process.", done[1]);
            return send(done[1], this.getProcess(done[1])["package"]);
          }
          if (action == "2") {//API:<Process>.getArguments
            const cc = this.getProcessByContext(frame)[1];
            if (args.length > 0 && args[0]) {
              const process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              if (process != cc && process.initiator != frame) return handleError("Permission denied: Process is not (started by) the calling process.");
              return send(process.args);
            }
            return send(cc.args);
          }
          if (action == "3") {//API:process.getAll
            return send(processes.map((p) => [p.id, p["package"]]));
          }
          if (action == "4") {//API:process.startAndWait
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            const pkg = args[0] ?? "";
            const done = await this.startProcess(pkg, args[1], frame);
            if (!done[0]) return handleError("Failed to start process.", done[1]);

            let hid;
            hid = hook("onTerminate", done[1], () => {
              unhook("onTerminate", done[1], hid);
              if (e.source) send(true);
            });
            return;
          }
          if (action == "5") {//API:<Process>.getId
            if (args.length > 0 && args[0]) {
              const process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              return send(process.id);
            }
            return send(this.getProcessByContext(frame)[1].id);
          }
          if (action == "6") {//API:<Process>.getPackage
            if (args.length > 0 && args[0]) {
              const process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              return send(process["package"]);
            }
            return send(this.getProcessByContext(frame)[1]["package"]);
          }
          if (action == "7") {//API:process.getAllStarted
            return send(processes.filter((p) => p.initiator == frame).map((p) => [p.id, p["package"]]));
          }
          if (action == "8") {//API:<Process>.getCallerPackage
            return send(this.getProcessByContext(frame)[1].initiator?.id);
          }
          if (action == "9") {//API:process.startService
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            return send(os.services.run(this.getProcessByContext(frame)[1]["package"], args[0]));
          }
          return handleError("Unknown/unimplemented API requested.");
        }

        if (type == "fs") {
          const is1 = action == "1";
          if (action == "0" || is1) {//API:fs.process.readString, API:fs.process.readBase64 (is1)
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");

            const res = this.getResourceFromPackage(this.getProcessByContext(frame)[1]["package"], path);
            if (!res[0]) return handleError("Invalid resource.", res[1]);

            const contents = this.fs.readFile(res[1], is1);
            if (!contents[0]) return handleError("Resource contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "2") {//API:fs.listAll
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            const files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching files and directories.", files[1]);
            return send(files[1]);
          }
          if (action == "3") {//API:fs.getPath
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";

            try {
              const npath = this.fs.raw.getPath(path);
              return send(npath);
            } catch (e) {
              return handleError("Path is invalid.", e.toString());
            }
          }
          if (action == "4") {//API:fs.exists
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0 && this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");

            const exists = this.fs.exists(path);
            if (!exists[0]) return handleError("Path is invalid.", dir[1]);
            return send(exists[1]);
          }
          if (action == "5") {//API:fs.isDir + API:fs.isFile
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");

            const isDir = this.fs.isDir(path);
            if (!isDir[0]) return handleError("Path is invalid.", dir[1]);
            return send(isDir[1]);
          }
          if (action == "6") {//API:fs.readString
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
            if (!this.fs.exists(path)[1]) return handleError("File doesn't exist.");
  
            const contents = this.fs.readFile(path);
            if (!contents[0]) return handleError("File contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "7") {//API:fs.readBase64
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
            if (!this.fs.exists(path)[1]) return handleError("File doesn't exist.");
  
            const contents = this.fs.readFile(path, true);
            if (!contents[0]) return handleError("File contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "8") {//API:fs.createPath
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            const done = this.fs.createDirs(this.fs.raw.getPath(path));
            if (!done[0]) return handleError("Path is invalid.", done[1]);
            return send(true);
          }
          if (action == "9") {//API:fs.deletePath
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            const done = this.fs.delete(this.fs.raw.getPath(path));
            if (!done[0]) return handleError("Path is invalid.", done[1]);
            return send(true);
          }
          if (action == "a") {//API:fs.listFiles
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            const files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching files.", files[1]);
            return send(files[1].filter((p) => !this.fs.isDir(this.fs.raw.getPath(path) + "/" + p)[1]));
          }
          if (action == "b") {//API:fs.listDirectories
            if (args.length == 0) return handleError("Expected 1 argument.");
            const path = args[0] ?? "";
            const dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            const files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching directories.", files[1]);
            return send(files[1].filter((p) => this.fs.isDir(this.fs.raw.getPath(path) + "/" + p)[1]));
          }
          if (action == "c") {//API:fs.writeString
            if (args.length <= 1) return handleError("Expected 2 arguments.");
            const path = args[0] ?? "";
            const data = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            const done = this.fs.writeFile(path, data);
            if (!done[0]) return handleError("Something went wrong while writing the file.", files[1]);
            return send(done[1]);
          }
          if (action == "d") {//API:fs.writeBase64
            if (args.length <= 1) return handleError("Expected 2 arguments.");
            const path = args[0] ?? "";
            const data = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            const done = this.fs.writeFile(path, data, true);
            if (!done[0]) return handleError("Something went wrong while writing the file.", files[1]);
            return send(done[1]);
          }
          return handleError("Unknown/unimplemented API requested.");
        }
        return handleError("Unknown/unimplemented API requested.");
      }, false);
    },
    createWindow(data) {
      let context;
      const id = Math.floor(Math.random() * 100000);
      const win = document.createElement("div");
      win.className = "window";
      win.id = id;
      win.style.zIndex = ++globalZIndex;
      win.style.left = (data.startOptions?.windowX ?? 20) + "px";
      win.style.top = (data.startOptions?.windowY ?? 20) + "px";
      win.style.width = (data.startOptions?.windowWidth ?? 700) + "px";
      win.style.height = (data.startOptions?.windowHeight ?? 400) + "px";
      if (data.startOptions?.windowMode == "minimized") win.classList.add("windowMinimized");
      else if (data.startOptions?.windowMode == "maximized") win.classList.add("windowMaximized");

      os.focusWindow(win);
      win.addEventListener("mousedown", () => {
        os.focusWindow(win);
      });

      const toolbar = document.createElement("div");
      toolbar.className = "windowTop";

      let should = true;
      let drag;
      let listener;
      listener = (e) => {
        const win2 = drag[2];
        if (!document.body.contains(win)) {
          const frames = document.getElementsByTagName("iframe");
          for (let i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "";
          
          document.removeEventListener("mousemove", listener);
          return;
        }
        if (win2.classList.contains("windowMaximized")) {
          win2.classList.remove("windowMaximized");
          drag[0] = win2.clientWidth / 2;
        }
        win2.style.left = e.pageX - drag[0] + "px";
        win2.style.top = e.pageY - drag[1] + "px";
      };
      toolbar.addEventListener("mousedown", (e) => {
        if (!should) {
          should = true;
          return;
        }
        drag = [e.offsetX, e.offsetY, win];
        
        const frames = document.getElementsByTagName("iframe");
        for (let i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "none";
        
        document.addEventListener("mousemove", listener);
      });
      toolbar.addEventListener("mouseup", () => {
        drag = undefined;

        const frames = document.getElementsByTagName("iframe");
        for (let i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "";

        document.removeEventListener("mousemove", listener);
      });
      toolbar.addEventListener("dblclick", () => {
        if (win.classList.contains("windowMaximized")) win.classList.remove("windowMaximized");
        else win.classList.add("windowMaximized");
      });

      if (data.icon) {
        const toolbarIcon = document.createElement("img");
        toolbarIcon.className = "windowIcon";
        toolbarIcon.src = data.icon;
        toolbarIcon.addEventListener("click", () => {});
        toolbarIcon.addEventListener("dblclick", (e) => {e.stopPropagation()});
        toolbar.appendChild(toolbarIcon);
      }
      
      const toolbarText = document.createElement("p");
      toolbarText.innerText = data.name;
      toolbar.appendChild(toolbarText);

      const toolbarClose = document.createElement("span");
      toolbarClose.className = "windowCloseIcon";
      toolbarClose.innerText = "X";
      toolbarClose.addEventListener("mousedown", () => should = false);
      toolbarClose.addEventListener("click", () => this.closeWindowV2(context, this.getProcessByContext(context)[1], false));
      toolbarClose.addEventListener("dblclick", (e) => {e.stopPropagation()});
      toolbar.appendChild(toolbarClose);
      win.appendChild(toolbar);

      const newScript = (name) => "<script src=\"" + location.origin + location.pathname + "/" + name + "\"></script>";
      context = document.createElement("iframe");
      context.id = data["package"];
      context.className = "windowContext";
      context.addEventListener("load", async () => {
        await new Promise(r => setTimeout(r, 50));
        context.contentWindow.postMessage({type: "startScript", args: [data.executor, id, data["package"]]}, "*");
      });
      context.src = "data:text/html," + newScript("sdk.js") + (data.lvos ? newScript("lvos/messenger.js") + newScript("lvos/opc-sdk-patch.js") : "");
      win.appendChild(context);

      return [win, context];
    },
    closeWindow(/*context, process*/) {
      return [false, "Don't use."];
      // if (!process) {
      //   process = this.getProcessByContext(context);
      //   if (!process[0]) return process;
      //   process = process[1];
      // }
      
      // const win = context.parentElement;
      // win.remove();
      // process.windows.splice(process.windows.indexOf(win), 1);

      // if (process.windows.length == 0) return this.killProcess(process);

      // return [true];
    },
    closeWindowV2(ctx, process, fromOwner) {
      if (!process) {
        process = this.getProcessByContext(ctx);
        if (!process[0]) return process;
        process = process[1];
      }

      const win = ctx.parentElement;
      if (!fromOwner) {
        ctx.contentWindow.postMessage({type: "windowExit", args: [0, +win.id]}, "*");
        return;
      }
      
      win.classList.add("hidden");
      process.ghosts = process.ghosts ?? [];
      process.ghosts.push(win);
      process.windows.splice(process.windows.indexOf(win), 1);

      const count = document.querySelector("#taskbarItem-" + CSS.escape(process["package"]) + " .taskbarItemCount");
      if (count) {
        const cc = +count.innerText - 1;
        count.innerText = cc;
        if (cc == 0) count.style.display = "none";
      }
    },
    focusWindow(win) {
      if (focusedWindow != win) {
        focusedWindow = win;
        win.style.zIndex = ++globalZIndex;
      }
      
      this.taskbar.hideOptions();
    },
    getWindowById(process, id) {
      for (let i = 0; i < process.windows.length; i++) {
        if (+process.windows[i].id == id) return [true, process.windows[i]];
      }
      return [true, null];
    },
    getResourceFromPackage(pkg, relativeResourcePath, skipPackagePathCheck) {
      const checkPath = function(pp, alt) {
        if (pp.includes("/") || pp.includes("\\") || pp.trim() == "." || pp.trim() == "..") return [false, "Invalid path '" + pp + "' in package '" + pkg + "'."];
  
        const zz = os.fs.raw.getPath(alt);
        if (!os.fs.exists(zz)[1]) return [false, "Resource '" + pp + "' in package '" + pkg + "' is unresolvable."];
  
        return [true, zz];
      };
  
      let path = "/apps/" + pkg;
      if (!skipPackagePathCheck) {
        path = checkPath(pkg, path);
        if (!path[0]) return path;
        path = path[1];
      }

      const resourcePath = checkPath(relativeResourcePath, path + "/" + relativeResourcePath);
      if (!resourcePath[0]) return resourcePath;

      return [true, resourcePath[1]];
    },
    async getAppdata(pkg, skipFileResolver) {
      if (pkg?.includes(",")) return [false, "Invalid package '" + pkg + "' cannot contain a comma."];
  
      const res = this.getResourceFromPackage(pkg, "_appdata.json");
      if (!res[0]) return res;

      let appdata = this.fs.readFile(res[1]);
      if (!appdata[0]) return appdata;
      try {
        appdata = JSON.parse(appdata[1]);
      } catch {
        return [false, "No valid appdata for package '" + pkg + "'."];
      }
      if (appdata.constructor != Object) return [false, "Invalid configuration for package '" + pkg + "'."];
  
      if (!skipFileResolver) {
        if (appdata.icon) {
          let iconPath = this.getResourceFromPackage(pkg, appdata.icon, true);
          if (!iconPath[0]) return iconPath;
          iconPath = iconPath[1];
    
          const iconBlob = await this.fs.readBlob(iconPath);
          if (!iconBlob[0]) return iconBlob;
          appdata.icon = iconBlob[1];
        }
    
        let executorPath = this.getResourceFromPackage(pkg, appdata.executor, true);
        if (!executorPath[0]) return executorPath;
        executorPath = executorPath[1];
  
        const executorB64 = this.fs.readFile(executorPath, true);
        if (!executorB64[0]) return executorB64;
        appdata.executor = executorB64[1];
      }

      appdata["package"] = pkg;
  
      return [true, appdata];
    },
    async startProcess(pkg, args, initiator) {
      let id = Math.floor(Math.random() * 100000);

      try {
        const checkType = function(val, type) {
          if (val == undefined || val == null) return false;
          return typeof val != type;
        };
  
        let appdata = await this.getAppdata(pkg);
        if (!appdata[0]) return appdata;
        appdata = appdata[1];
  
        if (appdata.startOptions && (
            checkType(appdata.startOptions.windowX, "number") ||
            checkType(appdata.startOptions.windowY, "number") ||
            checkType(appdata.startOptions.windowWidth, "number") ||
            checkType(appdata.startOptions.windowHeight, "number"))) return [false, "Invalid start configuration for package '" + pkg + "'."];
        
        const process = {id, appdata, "package": pkg, args: args ?? [], initiator};
        processes.push(process);
  
        const ww = this.createWindow(appdata);
        const w = ww[0];
        process.windows = [];
        if (appdata.hasWindow) {
          process.windows.push(w);
  
          const count = document.querySelector("#taskbarItem-" + CSS.escape(pkg) + " .taskbarItemCount");
          if (count) {
            count.style.display = "";
            count.innerText = +count.innerText + 1;
          }
        } else {
          w.classList.add("hidden");
          process.ghosts = [w];
        }
        process.contexts = [ww[1]];
        document.body.appendChild(w);
      } catch {
        return [false, "Unexpected issue, uncertain state."];
      }

      return [true, id];
    },
    killProcess(process) {
      if (process.windows.length > 0) {
        for (let i = 0; i < process.windows.length; i++) process.windows[i].remove();
      }
      processes.splice(processes.indexOf(process), 1);

      callhook("onTerminate", process.id);
      os.log("os.killProcess()", "Killed process " + process.id + " '" + process.appdata.name + "'", 3);
      return [true];  
    },
    async closeProcess(process, wait) {
      const ctx = process.contexts?.[0];
      if (!ctx) return this.killProcess(process);
      const id = process.id;

      if (hashook("programExitedAwait", id) && wait) return;
      
      let ind;
      let dne = true;
      ind = hook("programExitedAwait", id, () => s(dne = unhook("programExitedAwait", id, ind)));
      ctx.contentWindow.postMessage({type: "programExit", args: []}, "*");
      if (wait) {
        await new Promise(r => setTimeout(r, 15000));
        if (dne) s(unhook("programExitedAwait", id, ind));
      }
    },
    getProcesses() {
      return [true, [...processes]];
    },
    getProcess(id) {
      for (let i = 0; i < processes.length; i++) {
        if (processes[i].id == id) return [true, processes[i]];
      }
      return [true, null];
    },
    getProcessByContext(context) {
      for (let i = 0; i < processes.length; i++) {
        const contexts = processes[i].contexts;
        for (let z = 0; z < contexts.length; z++) {
          if (contexts[z] == context) return [true, processes[i]];
        }
      }
      return [true, null];
    },
    getProcessByPackage(pkg) {
      for (let i = 0; i < processes.length; i++) {
        if (processes[i]["package"] == pkg) return [true, processes[i]];
      }
      return [true, null];
    },
    getProcessesByPackage(pkg) {
      return [true, processes.filter((process) => process["package"] == pkg)];
    },
    async shutdown(reboot) {
      document.querySelector(".notifications").classList.add("hidden");
      document.querySelector(".taskbar").classList.add("hidden");

      this.log("shutdown", "Closing processes...", 3);
      const proms = [];
      for (let i = 0; i < processes.length; i++) proms.push(this.closeProcess(processes[i]), true);
      for (let i = 0; i < proms.length; i++) await proms[i];
      
      this.log("shutdown", "Ejecting mounts...", 3);
      const mounts = this.fs.mount.getMounts();
      for (let i = 0; i < mounts.length; i++) this.fs.mount.eject(mounts[i]);

      this.log("shutdown", "Writing storage...", 3);
      this.fs.toMem();

      this.log("shutdown", "Killing timers...", 3);
      const timers = setTimeout(function(){}, 0);
      for(let i = 0; i < timers; i++) clearTimeout(i);

      this.log("shutdown", "Finished.", 3);

      if (reboot) location.reload();
      else document.write("<body style=\"background-color:black\"><pre style=\"user-select:none;color:orange;font-size:600;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background-color:black;font-size:1.6em\">It's now safe to turn off your computer.</pre></body>");
    },
    reboot() {
      return this.shutdown(true);
    },
    log(processor, text, level) { // 0 info  1 warn  2 error  3 debug
      console.trace("[" + processor + "/" + level + "] " + text);
    },
    taskbar: {
      async setup() {
        if (!os.fs.exists("/system/machine/taskbar")[1]) return [false, "Machine not prepped, no apps added to the taskbar."];
  
        const taskbar = document.querySelector(".taskbar");
        const file = os.fs.readFile("/system/machine/taskbar");
        if (!file[0]) return file;
        const apps = file[1].split(",");
  
        let err;
        for (let i = 0; i < apps.length; i++) {
          const pkg = apps[i];
          let appdata = await os.getAppdata(pkg);
          if (!appdata[0]) {
            err = appdata;
            continue;
          }
          appdata = appdata[1];
          
          const item = document.createElement("div");
          item.id = "taskbarItem-" + pkg;
          item.className = "taskbarItem";
          item.addEventListener("click", () => os.startProcess(pkg));
          item.addEventListener("contextmenu", (e) => {
            if (e.target?.closest(".taskbarItemOptions") != null) {
              return;
            }

            os.taskbar.hideOptions();
            os.taskbar.showOptions(pkg);
          });
  
          const img = document.createElement("img");
          img.className = "taskbarIcon";
          img.src = appdata.icon;
          item.appendChild(img);
  
          const itemCount = document.createElement("p");
          itemCount.className = "taskbarItemCount";
          itemCount.innerText = "0";
          itemCount.style.display = "none";
          item.appendChild(itemCount);
          taskbar.appendChild(item);
        }
  
        return err ?? [true];
      },
      add(pkg) {
        os.fs.createDirs("/system/machine");
        const files = os.fs.readFile("/system/machine/taskbar");
        if (!files[0]) files[1] = "";

        const wr = os.fs.writeFile("/system/machine/taskbar", files[1].length == 0 ? pkg : files[1] + "," + pkg);
        if (!wr[0]) return wr;

        return [true];
      },
      remove(pkg) {
        os.fs.createDirs("/system/machine");
        const files = os.fs.readFile("/system/machine/taskbar");
        if (!files[0]) return [true];

        const wr = os.fs.writeFile("/system/machine/taskbar", files[1].split(",").filter((f) => f != pkg).join(","));
        if (!wr[0]) return wr;

        return [true];
      },
      hideOptions() {
        optionsListener?.();
      },
      showOptions(pkg) {
        const item = document.querySelector("#taskbarItem-" + CSS.escape(pkg));

        const options = document.createElement("div");
        options.className = "taskbarItemOptions";
        options.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        item.appendChild(options);

        const rect = options.getBoundingClientRect();
        if (rect.x < 8) {
          options.style.left = "calc(50% + " + (8 - rect.x) + "px)";
        }

        optionsListener = (e) => {
          if (e && options.contains(e.target)) {
            return;
          }

          window.removeEventListener("mousedown", optionsListener);
          options.remove();
          optionsListener = undefined;
        };
        window.addEventListener("mousedown", optionsListener);

        let thisFocusedProcess;
        let thisFocusedWindow;
        const tasks = [
          {icon: "resources/close.svg", text: "Close window", action: () => {
            os.closeWindowV2(thisFocusedWindow.querySelector(".windowContext"), thisFocusedProcess, false);
          }},
          {icon: "resources/close.svg", text: "Kill window", action: () => {
            os.closeWindowV2(thisFocusedWindow.querySelector(".windowContext"), thisFocusedProcess, true);
          }}
        ];

        const processes = os.getProcessesByPackage(pkg);
        if (!processes[0] || processes[1].length == 0 || !processes[1].reduce((prev, curr) => prev || curr.windows.length > 0, false)) {
          const error = document.createElement("p");
          error.className = "error";
          error.innerText = !processes[0] ? "Error!" : "No processes";
          options.appendChild(error);
        } else {
          const activeLabel = document.createElement("p");
          activeLabel.innerText = "Windows";
          options.appendChild(activeLabel);

          for (let i = 0; i < processes[1].length; i++) {
            const process = processes[1][i];

            for (let x = 0; x < process.windows.length; x++) {
              const win = process.windows[x];
              if (focusedWindow == win) {
                thisFocusedProcess = process;
                thisFocusedWindow = win;
              }
              
              const box = document.createElement("div");
              box.className = "taskbarItemProcess " + (focusedWindow == win ? "focused" : "");
              box.addEventListener("click", () => {
                os.focusWindow(win);
              });
              options.appendChild(box);

              const boxIcon = document.createElement("img");
              boxIcon.src = process.appdata.icon;
              box.appendChild(boxIcon);

              const boxName = document.createElement("p");
              boxName.innerText = win.querySelector(".windowTop p").innerText;
              box.appendChild(boxName);
            }
          }
          
          if (thisFocusedProcess) {
            const tasksLabel = document.createElement("p");
            tasksLabel.innerText = "Tasks";
            options.appendChild(tasksLabel);
  
            for (let i = 0; i < tasks.length; i++) {
              const task = tasks[i];
  
              const box = document.createElement("div");
              box.className = "taskbarItemProcess";
              box.addEventListener("click", () => {
                this.hideOptions();
                task.action();
              });
              options.appendChild(box);
  
              const boxIcon = document.createElement("img");
              boxIcon.src = task.icon;
              box.appendChild(boxIcon);
  
              const boxName = document.createElement("p");
              boxName.innerText = task.text;
              box.appendChild(boxName);
            }
          }
        }
      }
    },
    services: {
      ranTypes: [],
      started: [],
      register(code) {
        this.ranTypes.push(code);
      },
      parse(text) {
        return eval(text);
      },
      run(pkg, id) {
        if (!os.fs.exists("/system/svc.registry")[1]) return false;

        const svc = os.fs.readFile("/system/svc.registry")[1];
        const registry = os.fs.parseRegistry(svc)[1];
        for (let i = 0; i < registry.length; i++) {
          if (registry[i][2] != id) continue;
    
          let file = os.fs.readFile(registry[i][0]);
          if (!file[0]) continue;

          file = file[1].replaceAll("\r\n", "\n");
          if (!file.includes("\nIE_RUN:\n")) continue;
          file = file.substring(file.indexOf("\nIE_RUN:\n") + 9);
    
          const name = registry[i][1];
          this.started.push(id);
          try {
            os.log("os-services", "<" + pkg + ":" + name + "> Running service...", 3);
            /*const result = */eval("const __package__=" + JSON.stringify(pkg) + ";const __id__=" + JSON.stringify(id) + ";" + file);
            os.log("os-services", "<" + pkg + ":" + name + "> Service is running!", 3);
            //console.log(result);
          } catch (ex) {
            os.log("os-services", "<" + pkg + ":" + name + "> Error: " + ex, 2);
          }
          return true;
        }
        return false;
      }
    },
    memory: {
      ramUsageMB: 0,
      updateRamUsage(usageInMB) {
        this.ramUsageMB = usageInMB;
        if (usageInMB > 50 && !shownRamWarning) {
          shownRamWarning = true;
          os.notifications.show("High RAM usage", "OPC is using " + this.ramUsageMB.toFixed(2) + " MB of RAM. To ensure OPC is running at optimal speed, try closing some programs.", (notification) => notification.dismiss(), null);
        }
      }
    },
    settings: {
      load() {
        if (os.fs.exists("/system/machine/settings")[1]) {
          const s = os.fs.readFile("/system/machine/settings")[1].split("\n");
          for (let i = 0; i < s.length; i++) {
            const prop = s[i].substring(0, s[i].indexOf("="));
            const val = s[i].substring(s[i].indexOf("=") + 1);
            settings[prop] = val;
          }
        }
      },
      update(prop, val) {
        settings[prop] = val;
        const txt = [];
        let app = true;
        if (os.fs.exists("/system/machine/settings")[1]) {
          const s = os.fs.readFile("/system/machine/settings")[1].split("\n");
          for (let i = 0; i < s.length; i++) {
            const pprop = s[i].substring(0, s[i].indexOf("="));
            const pval = s[i].substring(s[i].indexOf("=") + 1);
            if (pprop == prop) {
              app = false;
              txt.push(prop + "=" + val);
              continue;
            }
            txt.push(pprop + "=" + pval);
          }
        }
        if (app) txt.push(prop + "=" + val);
        os.fs.writeFile("/system/machine/settings", txt.join("\n"));
      },
      get(prop) {
        return settings[prop];
      }
    },
    notifications: {
      show(title, body, onClick, icon) {
        const panel = document.querySelector(".notifications");
        const not = document.createElement("p");
        not.innerText = title;
        let start = 0;
        let end = 0;
        const mm = (e) => end = e.pageY;
        not.onmousedown = (e) => {
          not.classList.add("select");
          start = e.pageY;
          end = e.pageY;
          window.addEventListener("mousemove", mm);
        };
        const hh = () => {
          not.classList.remove("select");
          window.removeEventListener("mousemove", mm);
          if (start - end > 60) not.classList.add("full");
          else if (start - end < -60) not.classList.remove("full");
        };
        window.addEventListener("mouseup", hh);
        not.onclick = () => {
          onClick?.({title, body, onClick, icon, dismiss: () => {
            not.onclick = null;
            window.removeEventListener("mouseup", hh);
            not.classList.add("disappear");
            setTimeout(() => not.remove(), 200);
          }});
        };
        const bod = document.createElement("span");
        bod.innerText = " " + body;
        not.appendChild(bod);

        panel.appendChild(not);
        setTimeout(() => {
          not.onclick = null;
          window.removeEventListener("mouseup", hh);
          not.classList.add("disappear");
          setTimeout(() => {
            try {
              not.remove();
            } catch {}
          }, 200);
        }, 10000);
      }
    },
    operation: {
      async download(url, path) {
        const str = await this.downloadBase64(url);
        if (!str[0]) return str;
        const parent = os.fs.getParent(path);
        if (!parent[0]) return parent;
        const dirs = os.fs.createDirs(parent[1]);
        if (!dirs[0]) return dirs;
        return os.fs.writeFile(path, str[1], true);
      },
      async downloadBase64(url) {
        /* https://stackoverflow.com/a/71604665/15390856 */
        const imageUrlToBase64 = async url => {
          const response = await fetch(url);
          const blob = await response.blob();
          return new Promise((onSuccess, onError) => {
            try {
              const reader = new FileReader();
              reader.onload = function(){onSuccess(this.result);URL.revokeObjectURL(blob)};
              reader.readAsDataURL(blob);
            } catch(e) {
              onError(e);
            }
          });
        };
  
        let err;
        const data = await imageUrlToBase64(url).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data.substring(data.indexOf(",") + 1)];
      },
      async downloadString(url) {
        let err;
        const data = await fetch(url).then((t) => t.text()).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data];
      },
      async downloadJSON(url) {
        let err;
        const data = await fetch(url).then((t) => t.json()).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data];
      }
    },
    fs: newFilesystem("Flexan.NET;onlinepc-mem", "IndexedDB", (...args) => os.log(...args))
  };
})();

const IE = {OPC: 0x01, TPI: 0x02, OPE: 0x04}; // TPI = Third-Party Installation, OPE = Owned Package Extension
const HEAD = 0x00;
const $ = (code) => os.services.register(code);

window.addEventListener("keydown", async (e) => {
  if (e.key == ":" && e.ctrlKey && e.shiftKey) console.log("Opening recovery terminal:", await os.startProcess("me.flexan.terminal", [], {id: "system,"}));
});

let shownRamWarning = false;
(async function() {
  const tryLog = (id, trigger, result) => {
    if (!result[0]) {
      os.log("os-trylogger", "<" + id + ":" + trigger + "> " + result[1], 2);
      return;
    }
    return result[1];
  };

  const entryId = "os-entry";
  
  os.log(entryId, "Loading...", 3);
  tryLog(entryId, "fs-prep", await os.fs.prep());
  tryLog(entryId, "fs-tolocal", await os.fs.toLocal());

  // if (!os.fs.exists("/apps/me.flexan.terminal/_appdata.json")[1]) {
  //   os.log(entryId, "Recovering terminal...", 3);
  //   os.fs.createDirs("/apps/me.flexan.terminal");
  //   os.fs.writeFile("/apps/me.flexan.terminal/_appdata.json", `{"name":"Recovery","package":"me.flexan.terminal","executor":"start.js","hasWindow":true}`);
  //   os.fs.writeFile("/apps/me.flexan.terminal/start.js", `(async ()=>{let m=(p)=>document.createElement(p);let c=m("pre");c.innerText="Start typing, press BACKSPACE to clear input and enter to run\\nSYS: ";document.body.appendChild(c);let i;let z=()=>{i=m("span");c.appendChild(i)};z();let d="";addEventListener("keydown",async (e)=>{if(e.key=="Backspace")i.innerText=d="";if(e.key=="Enter"){z();let a=d.match(/[^\\s"']+|"([^"]*)"|'([^']*)'/g);let y=a.shift();d="";try{if(y=="host"&&a.length>0)await system.operation.submit([0,a[0]]);else if(y=="taskbar"&&a.length>1)await system.operation.submit([a[0]=="remove"?3:2,a[1]]);else if(y=="update"){await system.operation.submit([0x01]);i.innerText="\\nFinished"}else i.innerText="\\nNot found"}catch(r){i.innerText="\\nError: "+r};i.innerText+="\\nSYS: ";z()};if(e.key.length>1||e.ctrlKey)return;d+=e.key;i.innerText=d})})()`);
  // }

  // check for corrupt update
  if (os.fs.exists("/system/states/updating")[1]) os.notifications.show("System is unstable", "An update was incorrectly installed. To fix, update again and wait until the process finishes.");

  // load settings
  os.settings.load();

  // ram clock
  if (window.performance && window.performance.memory && os.settings.get("SHOW_RAM_WARNING") != "false") {
    setInterval(() => os.memory.updateRamUsage(performance.memory.usedJSHeapSize / 1048576), 250);
  }

  // taskbar clock
  setInterval(() => {
    const now = new Date();
    document.querySelector("#taskbarTime").innerText = new Intl.DateTimeFormat("en-US", {hour: "numeric", minute: "2-digit", hour12: true}).format(now);
    document.querySelector("#taskbarDate").innerText = new Intl.DateTimeFormat("en-US", {day: "2-digit", month: "2-digit", year: "numeric"}).format(now);
  }, 100);
  
  os.initProcessListener();
  tryLog(entryId, "fs-taskbar", await os.taskbar.setup());

  if (os.fs.exists("/system/svc.registry")[1]) {
    os.log(entryId, "Starting services...", 3);
    const svc = os.fs.readFile("/system/svc.registry")[1];
    const registry = os.fs.parseRegistry(svc)[1];
    for (let i = 0; i < registry.length; i++) {
      os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Starting service...", 3);

      let file = os.fs.readFile(registry[i][0]);
      if (!file[0]) {
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Error: " + file[1], 2);
        continue;
      }
      file = file[1].replaceAll("\r\n", "\n");
      if (file.includes("\nIE_RUN:\n")) file = file.substring(0, file.indexOf("\nIE_RUN:\n"));

      try {
        /*const result = */eval(file);
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Service started!", 3);
        //console.log(result);
      } catch (ex) {
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Error: " + ex, 2);
      }
    }
  }

  if (os.fs.exists("/cfg/startup/services")[1]) {
    os.log(entryId, "Running startup services...", 3);
    const svc = os.fs.readFile("/cfg/startup/services")[1].split("\n");
    for (let i = 0; i < svc.length; i++) {
      if (svc[i].trim() == "") continue;
      os.services.run("system,", svc[i].trim());
    }
  }
  
  os.log(entryId, "Ready!", 3);

  // run setup if OS isn't configured yet
  if (!os.fs.exists("/system/states/setup_finished")[1]) {
    os.log(entryId, "Installing setup...", 3);

    const setupDisk = await os.operation.downloadJSON("setupdisk.json");
    if (setupDisk[0]) {
      os.fs.mount.mount("/apps", setupDisk[1]);
      os.startProcess("me.flexan.setup", [location.origin + (location.pathname + "/files").replace(/\/{2,}/g, "/")], {id: "system,"});
    }
  }
})();