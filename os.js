const settings = {};
const os = (function() {
  var processes = [];
  var hooks = {};
  var hook = (type, id, callback) => {
    var tt = hooks[type];
    if (!tt) hooks[type] = tt = [];
    var cc = tt[id];
    if (!cc) cc = tt[id] = [];
    cc.push(callback);
    return cc.length - 1;
  };
  var unhook = (type, id, index) => {
    var cc = hooks[type][id];
    cc.splice(index, 1, null);
  };
  var hashook = (type, id) => hooks[type]?.[id] != undefined;
  var callhook = (type, id, ...args) => {
    var hh = hooks[type];
    if (!hh) return;
    var cc = hh[id];
    if (!cc) return;
    for (var i = 0; i < cc.length; i++) cc[i]?.(...args);
  };
  /* https://stackoverflow.com/a/50457849/15390856 */
  var getFrameByEvent = (event) => {
    return Array.from(document.getElementsByTagName("iframe")).filter(iframe => {
      return iframe.contentWindow === event.source;
    })[0];
  };
  
  var focusedWindow;
  var globalZIndex = -1;
  var allowLvos = false;
  var optionsListener;

  return {
    initProcessListener() {
      window.addEventListener("message", async (e) => {
        var id = e.data.id;
        var type = e.data.type;
        var action = e.data.action;
        var args = e.data.args;
        
        var send = (...args) => e.source.postMessage({type: "apiResponse", args: [id, ...args]}, "*");
        var sendType = (type, ...args) => e.source.postMessage({type, args: [...args]}, "*");
        var frame = getFrameByEvent(e);
        if (!frame) {
          return;
        }

        var ctxpkg = frame.id;

        var handleError = (err, ...extra) => {
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
            var url = args[0] ?? "";
            var path = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            try {
              var done = await this.operation.download(url, this.fs.raw.getPath(path));
            } catch (e) {
              return handleError("Invalid URL.", e);
            }
            if (!done[0]) return handleError("Path is invalid.", done[1]);
            return send(true);
          }
          if (action == "1") {//API:operation.obtainAppAccess
            if (args.length == 0) return handleError("Expected 1 argument.");
            var forpkg = args[0] ?? "";

            if (this.fs.checkPermission("/apps/" + forpkg, ctxpkg, "EDIT")[1] > 0) return send(true);

            var done = await this.startProcess("me.flexan.access", ["app", forpkg, ctxpkg], {id: "system,"});
            if (!done[0]) return handleError("Failed to request access.", done[1]);

            var hid = hook("onTerminate", done[1], () => {
              unhook("onTerminate", done[1], hid);
              if (e.source) send(this.fs.checkPermission("/apps/" + forpkg, ctxpkg, "EDIT")[1] > 0);
            });
            return;
          }
          if (action == "2") {//API:operation.getAppName
            if (args.length == 0) return handleError("Expected 1 argument.");
            var pkg = args[0] ?? "";
            
            var appdata = await this.getAppdata(pkg, true);
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
                  var read = this.fs.readFile("/system/host");
                  if (!read[0]) return handleError("Failed to read host.", read);

                  /* old method
                  var files = await this.operation.downloadJSON(read[1] + "/_structure.json");
                  if (!files[0]) return handleError("Failed to download from host.", files);
                  files = files[1];
                  if (typeof files != "object" || files.constructor !== Array) return handleError("Host is deceiving.");

                  for (var i = 0; i < files.length; i++) {
                    await this.operation.download(read[1] + "/" + files[i], "/" + files[i]);
                  }
                   */
                  
                  this.fs.createDirs(this.fs.raw.getPath("/system/states"));
                  this.fs.createFile("/system/states/updating", "");
                  
                  var versions = await this.operation.downloadJSON(read[1] + "/__update.json");
                  if (!versions[0]) return handleError("Failed to download from host.", files);
                  versions = versions[1];
                  if (typeof versions != "object" || versions.constructor === Array) return handleError("Host is deceiving.");

                  var version = null;
                  var sysver = null;
                  if (this.fs.exists("/system/sysver")[1]) {
                    sysver = this.fs.readFile("/system/sysver")[1];
                    version = versions[sysver];
                  }
                  
                  var downloadVersion = async (ver) => {
                    if (!ver) return;
                    var wasprev = version == ver && sysver != null && !versions[ver.nextVersion];
                    if (version == ver && !wasprev) return await downloadVersion(versions[ver.nextVersion]);
                    version = ver;
                    if (version.skip) return await downloadVersion(versions[version.version]);
                    try {
                      sendType("updateProgress", "versionStart", version.version);
                      sendType("updateProgress", "isUpdating", wasprev);
                      var files = wasprev ? [] : (version.install?.files ?? []);
                      var dirs = wasprev ? [] : (version.install?.directories ?? []);
                      var files2 = version.update?.files ?? [];
                      var dirs2 = version.update?.directories ?? [];
                      files = [...files, ...files2];
                      dirs = [...dirs, ...dirs2];

                      for (var i = 0; i < files.length; i++) {
                        sendType("updateProgress", "download", read[1] + "/" + files[i]);
                        await this.operation.download(read[1] + "/" + files[i], "/" + files[i]);
                        sendType("updateProgress", "file", "/" + files[i]);
                      }
                      for (var i = 0; i < dirs.length; i++) {
                        this.fs.createDirs(this.fs.raw.getPath("/" + dirs[i]));
                        sendType("updateProgress", "directory", "/" + dirs[i]);
                      }

                      sendType("updateProgress", "config");
                      if (!wasprev && version.install?.taskbar) {
                        for (var i = 0; i < version.install.taskbar.length; i++) {
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
                  var mnt = this.fs.mount.mount(args[1], args[2]);
                  if (!mnt[0]) return handleError("Failed to mount.", mnt[1]);
                  return send(true);
                }
                if (args[0] == 0x05) {
                  var mnt = this.fs.mount.eject(args[1]);
                  if (!mnt[0]) return handleError("Failed to eject.", mnt[1]);
                  return send(mnt[1]);
                }
              }
              return handleError("Invalid operation.");
            } catch (e) {
              return handleError("Source is untrustworthy.");
            }
          }
          if (action == "4") {//API:operation.getPerformance
            return send({ram: {unit: " MB", value: this.memory.ramUsageMB.toFixed(2)}, gpu: {unit: "% (not measured)", value: 0}, cpu: {unit: "% (not measured)", value: 0}, cores: {unit: "", value: navigator.hardwareConcurrency}});
          }
          if (action == "5") {//API:operation.shutdown
            var rb = true;
            await new Promise(async (s, j) => {
              os.notifications.show("Shutdown", "OPC will shutdown in 5 seconds. Press to cancel.", (n) => {
                n.dismiss();
                rb = false;
                s();
              });
              await new Promise(() => setTimeout(s, 5000));
            });
            if (rb) this.shutdown();
            return send(rb);
          }
          if (action == "6") {//API:operation.reboot
            var rb = true;
            await new Promise(async (s, j) => {
              os.notifications.show("Reboot", "OPC will reboot in 5 seconds. Press to cancel.", (n) => {
                n.dismiss();
                rb = false;
                s();
              });
              await new Promise(() => setTimeout(s, 5000));
            });
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
            var id = Math.floor(Math.random() * 1000000);
            this.notifications.show(args[0], args[1], (notification) => {
              notification.onClick = null;
              callhook("notificationCallback", id, notification);
            }, args[2]);
            return send(id);
          }
          if (action == "c") {//API:<Notification>.waitForClick
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            hook("notificationCallback", +args[0], (notification) => send(notification));
            return;
          }

          var win = frame.parentElement;
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
            var count = document.querySelector("#taskbarItem-" + CSS.escape(frame.id) + " .taskbarItemCount");
            if (count && !win.classList.contains("windowHidden")) {
              var cc = +count.innerText - 1;
              count.innerText = cc;
              if (cc == 0) count.style.display = "none";
            }
            win.classList.add("windowHidden");
            return send(true);
          }
          if (action == "6") {//API:window.show
            var count = document.querySelector("#taskbarItem-" + CSS.escape(frame.id) + " .taskbarItemCount");
            if (count && win.classList.contains("windowHidden")) {
              count.style.display = "";
              count.innerText = +count.innerText + 1;
            }
            win.classList.remove("windowHidden");
            return send(true);
          }
          if (action == "7") {//API:window.close
            var process = this.getProcessByContext(frame)[1];
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
              var process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              this.killProcess(process);
              return;
            }
            this.killProcess(this.getProcessByContext(frame)[1]);
            return;
          }
          if (action == "1") {//API:process.start
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            var package = args[0] ?? "";
            var done = await this.startProcess(package, args[1], frame);
            if (!done[0]) return handleError("Failed to start process.", done[1]);
            return send(done[1], this.getProcess(done[1]).package);
          }
          if (action == "2") {//API:<Process>.getArguments
            var cc = this.getProcessByContext(frame)[1];
            if (args.length > 0 && args[0]) {
              var process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              if (process != cc && process.initiator != frame) return handleError("Permission denied: Process is not (started by) the calling process.");
              return send(process.args);
            }
            return send(cc.args);
          }
          if (action == "3") {//API:process.getAll
            return send(processes.map((p) => [p.id, p.package]));
          }
          if (action == "4") {//API:process.startAndWait
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            var package = args[0] ?? "";
            var done = await this.startProcess(package, args[1], frame);
            if (!done[0]) return handleError("Failed to start process.", done[1]);
            var hid = hook("onTerminate", done[1], () => {
              unhook("onTerminate", done[1], hid);
              if (e.source) send(true);
            });
            return;
          }
          if (action == "5") {//API:<Process>.getId
            if (args.length > 0 && args[0]) {
              var process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              return send(process.id);
            }
            return send(this.getProcessByContext(frame)[1].id);
          }
          if (action == "6") {//API:<Process>.getPackage
            if (args.length > 0 && args[0]) {
              var process = this.getProcess(args[0])[1];
              if (!process) return handleError("Process not found.");
              return send(process.package);
            }
            return send(this.getProcessByContext(frame)[1].package);
          }
          if (action == "7") {//API:process.getAllStarted
            return send(processes.filter((p) => p.initiator == frame).map((p) => [p.id, p.package]));
          }
          if (action == "8") {//API:<Process>.getCallerPackage
            return send(this.getProcessByContext(frame)[1].initiator?.id);
          }
          if (action == "9") {//API:process.startService
            if (args.length == 0) return handleError("Expected 1 or more arguments.");
            return send(os.services.run(this.getProcessByContext(frame)[1].package, args[0]));
          }
          return handleError("Unknown/unimplemented API requested.");
        }

        if (type == "fs") {
          var is1 = action == "1";
          if (action == "0" || is1) {//API:fs.process.readString, API:fs.process.readBase64 (is1)
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");

            var res = this.getResourceFromPackage(this.getProcessByContext(frame)[1].package, path);
            if (!res[0]) return handleError("Invalid resource.", res[1]);

            var contents = this.fs.readFile(res[1], is1);
            if (!contents[0]) return handleError("Resource contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "2") {//API:fs.listAll
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            var files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching files and directories.", files[1]);
            return send(files[1]);
          }
          if (action == "3") {//API:fs.getPath
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";

            try {
              var npath = this.fs.raw.getPath(path);
              return send(npath);
            } catch (e) {
              return handleError("Path is invalid.", e.toString());
            }
          }
          if (action == "4") {//API:fs.exists
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0 && this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");

            var exists = this.fs.exists(path);
            if (!exists[0]) return handleError("Path is invalid.", dir[1]);
            return send(exists[1]);
          }
          if (action == "5") {//API:fs.isDir + API:fs.isFile
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");

            var isDir = this.fs.isDir(path);
            if (!isDir[0]) return handleError("Path is invalid.", dir[1]);
            return send(isDir[1]);
          }
          if (action == "6") {//API:fs.readString
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
            if (!this.fs.exists(path)[1]) return handleError("File doesn't exist.");
  
            var contents = this.fs.readFile(path);
            if (!contents[0]) return handleError("File contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "7") {//API:fs.readBase64
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (dir[1]) return handleError("Path is a directory.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
            if (!this.fs.exists(path)[1]) return handleError("File doesn't exist.");
  
            var contents = this.fs.readFile(path, true);
            if (!contents[0]) return handleError("File contains invalid contents.", contents[1]);
            return send(contents[1]);
          }
          if (action == "8") {//API:fs.createPath
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            var done = this.fs.createDirs(this.fs.raw.getPath(path));
            if (!done[0]) return handleError("Path is invalid.", done[1]);
            return send(true);
          }
          if (action == "9") {//API:fs.deletePath
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            var done = this.fs.delete(this.fs.raw.getPath(path));
            if (!done[0]) return handleError("Path is invalid.", done[1]);
            return send(true);
          }
          if (action == "a") {//API:fs.listFiles
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            var files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching files.", files[1]);
            return send(files[1].filter((p) => !this.fs.isDir(this.fs.raw.getPath(path) + "/" + p)[1]));
          }
          if (action == "b") {//API:fs.listDirectories
            if (args.length == 0) return handleError("Expected 1 argument.");
            var path = args[0] ?? "";
            var dir = this.fs.isDir(path);
            if (!dir[0]) return handleError("Path is invalid.", dir[1]);
            if (!dir[1]) return handleError("Path is a file.");
            if (this.fs.checkPermission(path, ctxpkg)[1] <= 0) return handleError("Permission denied for access path.");
  
            var files = this.fs.getFiles(path);
            if (!files[0]) return handleError("Something went wrong while fetching directories.", files[1]);
            return send(files[1].filter((p) => this.fs.isDir(this.fs.raw.getPath(path) + "/" + p)[1]));
          }
          if (action == "c") {//API:fs.writeString
            if (args.length <= 1) return handleError("Expected 2 arguments.");
            var path = args[0] ?? "";
            var data = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            var done = this.fs.writeFile(path, data);
            if (!done[0]) return handleError("Something went wrong while writing the file.", files[1]);
            return send(done[1]);
          }
          if (action == "d") {//API:fs.writeBase64
            if (args.length <= 1) return handleError("Expected 2 arguments.");
            var path = args[0] ?? "";
            var data = args[1] ?? "";
            if (this.fs.checkPermission(path, ctxpkg, "EDIT")[1] <= 0) return handleError("Permission denied for access path.");
  
            var done = this.fs.writeFile(path, data, true);
            if (!done[0]) return handleError("Something went wrong while writing the file.", files[1]);
            return send(done[1]);
          }
          return handleError("Unknown/unimplemented API requested.");
        }
        return handleError("Unknown/unimplemented API requested.");
      }, false);
    },
    createWindow(data) {
      var context;
      var id = Math.floor(Math.random() * 100000);
      var win = document.createElement("div");
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

      var toolbar = document.createElement("div");
      toolbar.className = "windowTop";

      var should = true;
      var drag;
      toolbar.addEventListener("mousedown", (e) => {
        if (!should) {
          should = true;
          return;
        }
        drag = [e.offsetX, e.offsetY, win];
        
        var frames = document.getElementsByTagName("iframe");
        for (var i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "none";
        
        document.addEventListener("mousemove", listener);
      });
      var listener = (e) => {
        var win2 = drag[2];
        if (!document.body.contains(win)) {
          var frames = document.getElementsByTagName("iframe");
          for (var i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "";
          
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
      toolbar.addEventListener("mouseup", (e) => {
        drag = undefined;

        var frames = document.getElementsByTagName("iframe");
        for (var i = 0; i < frames.length; i++) frames[i].style.pointerEvents = frames[i].style.userSelect = "";

        document.removeEventListener("mousemove", listener);
      });
      toolbar.addEventListener("dblclick", (e) => {
        if (win.classList.contains("windowMaximized")) win.classList.remove("windowMaximized");
        else win.classList.add("windowMaximized");
      });

      if (data.icon) {
        var toolbarIcon = document.createElement("img");
        toolbarIcon.className = "windowIcon";
        toolbarIcon.src = data.icon;
        toolbarIcon.addEventListener("click", (e) => {});
        toolbarIcon.addEventListener("dblclick", (e) => {e.stopPropagation()});
        toolbar.appendChild(toolbarIcon);
      }
      
      var toolbarText = document.createElement("p");
      toolbarText.innerText = data.name;
      toolbar.appendChild(toolbarText);

      var toolbarClose = document.createElement("span");
      toolbarClose.className = "windowCloseIcon";
      toolbarClose.innerText = "X";
      toolbarClose.addEventListener("mousedown", (e) => should = false);
      toolbarClose.addEventListener("click", (e) => this.closeWindowV2(context, this.getProcessByContext(context)[1], false));
      toolbarClose.addEventListener("dblclick", (e) => {e.stopPropagation()});
      toolbar.appendChild(toolbarClose);
      win.appendChild(toolbar);

      var newScript = (name) => "<script src=\"" + location.origin + location.pathname + "/" + name + "\"></script>";
      context = document.createElement("iframe");
      context.id = data.package;
      context.className = "windowContext";
      context.addEventListener("load", async () => {
        await new Promise(r => setTimeout(r, 50));
        context.contentWindow.postMessage({type: "startScript", args: [data.executor, id, data.package]}, "*");
      });
      context.src = "data:text/html," + newScript("sdk.js") + (data.lvos ? newScript("lvos/messenger.js") + newScript("lvos/opc-sdk-patch.js") : "");
      win.appendChild(context);

      return [win, context];
    },
    closeWindow(context, process) {
      return [false, "Don't use."];
      if (!process) {
        process = this.getProcessByContext(context);
        if (!process[0]) return process;
        process = process[1];
      }
      
      var win = context.parentElement;
      document.body.removeChild(win);
      process.windows.splice(process.windows.indexOf(win), 1);

      if (process.windows.length == 0) return this.killProcess(process);

      return [true];
    },
    closeWindowV2(ctx, process, fromOwner) {
      if (!process) {
        process = this.getProcessByContext(ctx);
        if (!process[0]) return process;
        process = process[1];
      }

      var win = ctx.parentElement;
      if (!fromOwner) {
        ctx.contentWindow.postMessage({type: "windowExit", args: [0, +win.id]}, "*");
        return;
      }
      
      win.classList.add("hidden");
      process.ghosts = process.ghosts ?? [];
      process.ghosts.push(win);
      process.windows.splice(process.windows.indexOf(win), 1);

      var count = document.querySelector("#taskbarItem-" + CSS.escape(process.package) + " .taskbarItemCount");
      if (count) {
        var cc = +count.innerText - 1;
        count.innerText = cc;
        if (cc == 0) count.style.display = "none";
      }
    },
    focusWindow(win) {
      if (focusedWindow != win) {
        focusedWindow = win;
        win.style.zIndex = ++globalZIndex;
      }
      
      optionsListener?.();
    },
    getWindowById(process, id) {
      for (var i = 0; i < process.windows.length; i++) {
        if (+process.windows[i].id == id) return [true, process.windows[i]];
      }
      return [true, null];
    },
    getResourceFromPackage(package, relativeResourcePath, skipPackagePathCheck) {
      var checkPath = function(pp, alt) {
        if (pp.includes("/") || pp.includes("\\") || pp.trim() == "." || pp.trim() == "..") return [false, "Invalid path '" + pp + "' in package '" + package + "'."];
  
        var zz = os.fs.raw.getPath(alt);
        if (!os.fs.exists(zz)[1]) return [false, "Resource '" + pp + "' in package '" + package + "' is unresolvable."];
  
        return [true, zz];
      };
  
      var path = "/apps/" + package;
      if (!skipPackagePathCheck) {
        path = checkPath(package, path);
        if (!path[0]) return path;
        path = path[1];
      }

      var resourcePath = checkPath(relativeResourcePath, path + "/" + relativeResourcePath);
      if (!resourcePath[0]) return resourcePath;

      return [true, resourcePath[1]];
    },
    async getAppdata(package, skipFileResolver) {
      if (package?.includes(",")) return [false, "Invalid package '" + package + "' cannot contain a comma."];
  
      var res = this.getResourceFromPackage(package, "_appdata.json");
      if (!res[0]) return res;

      var appdata = this.fs.readFile(res[1]);
      if (!appdata[0]) return appdata;
      try {
        appdata = JSON.parse(appdata[1]);
      } catch {
        return [false, "No valid appdata for package '" + package + "'."];
      }
      if (appdata.constructor != Object) return [false, "Invalid configuration for package '" + package + "'."];
  
      if (!skipFileResolver) {
        if (appdata.icon) {
          var iconPath = this.getResourceFromPackage(package, appdata.icon, true);
          if (!iconPath[0]) return iconPath;
          iconPath = iconPath[1];
    
          var iconBlob = await this.fs.readBlob(iconPath);
          if (!iconBlob[0]) return iconBlob;
          appdata.icon = iconBlob[1];
        }
    
        var executorPath = this.getResourceFromPackage(package, appdata.executor, true);
        if (!executorPath[0]) return executorPath;
        executorPath = executorPath[1];
  
        var executorB64 = this.fs.readFile(executorPath, true);
        if (!executorB64[0]) return executorB64;
        appdata.executor = executorB64[1];
      }

      appdata.package = package;
  
      return [true, appdata];
    },
    async startProcess(package, args, initiator) {
      try {
        var checkType = function(val, type) {
          if (val == undefined || val == null) return false;
          return typeof val != type;
        };
  
        var appdata = await this.getAppdata(package);
        if (!appdata[0]) return appdata;
        appdata = appdata[1];
  
        if (appdata.startOptions && (
            checkType(appdata.startOptions.windowX, "number") ||
            checkType(appdata.startOptions.windowY, "number") ||
            checkType(appdata.startOptions.windowWidth, "number") ||
            checkType(appdata.startOptions.windowHeight, "number"))) return [false, "Invalid start configuration for package '" + package + "'."];
        
        var id = Math.floor(Math.random() * 100000);
        var process = {id, appdata, package, args: args ?? [], initiator};
        processes.push(process);
  
        var ww = this.createWindow(appdata);
        var w = ww[0];
        process.windows = [];
        if (appdata.hasWindow) {
          process.windows.push(w);
  
          var count = document.querySelector("#taskbarItem-" + CSS.escape(package) + " .taskbarItemCount");
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
      } catch (e) {
        return [false, "Unexpected issue, uncertain state."];
      }

      return [true, id];
    },
    killProcess(process) {
      if (process.windows.length > 0) {
        for (var i = 0; i < process.windows.length; i++) document.body.removeChild(process.windows[i]);
      }
      processes.splice(processes.indexOf(process), 1);

      callhook("onTerminate", process.id);
      os.log("os.killProcess()", "Killed process " + process.id + " '" + process.appdata.name + "'", 3);
      return [true];  
    },
    closeProcess(process, wait) {
      var ctx = process.contexts?.[0];
      if (!ctx) return this.killProcess(process);
      var id = process.id;

      if (hashook("programExitedAwait", id) && wait) return;
      return new Promise(async (s, j) => {
        var ind;
        var dne = true;
        ind = hook("programExitedAwait", id, () => s(dne = unhook("programExitedAwait", id, ind)));
        ctx.contentWindow.postMessage({type: "programExit", args: []}, "*");
        if (wait) {
          await new Promise(r => setTimeout(r, 15000));
          if (dne) s(unhook("programExitedAwait", id, ind));
        }
      });
    },
    getProcesses() {
      return [true, [...processes]];
    },
    getProcess(id) {
      for (var i = 0; i < processes.length; i++) {
        if (processes[i].id == id) return [true, processes[i]];
      }
      return [true, null];
    },
    getProcessByContext(context) {
      for (var i = 0; i < processes.length; i++) {
        var contexts = processes[i].contexts;
        for (var z = 0; z < contexts.length; z++) {
          if (contexts[z] == context) return [true, processes[i]];
        }
      }
      return [true, null];
    },
    getProcessByPackage(package) {
      for (var i = 0; i < processes.length; i++) {
        if (processes[i].package == package) return [true, processes[i]];
      }
      return [true, null];
    },
    getProcessesByPackage(package) {
      return [true, processes.filter((process) => process.package == package)];
    },
    async shutdown(reboot) {
      document.querySelector(".notifications").classList.add("hidden");
      document.querySelector(".taskbar").classList.add("hidden");

      this.log("shutdown", "Closing processes...", 3);
      var proms = [];
      for (var i = 0; i < processes.length; i++) proms.push(this.closeProcess(processes[i]), true);
      for (var i = 0; i < proms.length; i++) await proms[i];
      
      this.log("shutdown", "Ejecting mounts...", 3);
      var mounts = this.fs.mount.getMounts();
      for (var i = 0; i < mounts.length; i++) this.fs.mount.eject(mounts[i]);

      this.log("shutdown", "Writing storage...", 3);
      this.fs.toMem();

      this.log("shutdown", "Killing timers...", 3);
      var timers = setTimeout(function(){}, 0);
      for(var i = 0; i < timers; i++) clearTimeout(i);

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
  
        var taskbar = document.querySelector(".taskbar");
        var file = os.fs.readFile("/system/machine/taskbar");
        if (!file[0]) return file;
        var apps = file[1].split(",");
  
        var err;
        for (var i = 0; i < apps.length; i++) {
          var package = apps[i];
          var appdata = await os.getAppdata(package);
          if (!appdata[0]) {
            err = appdata;
            continue;
          }
          appdata = appdata[1];
          
          var item = document.createElement("div");
          item.id = "taskbarItem-" + package;
          item.className = "taskbarItem";
          item.addEventListener("click", ((app) => () => os.startProcess(app))(package));
          item.addEventListener("contextmenu", ((app) => () => os.taskbar.showOptions(app))(package));
  
          var img = document.createElement("img");
          img.className = "taskbarIcon";
          img.src = appdata.icon;
          item.appendChild(img);
  
          var itemCount = document.createElement("p");
          itemCount.className = "taskbarItemCount";
          itemCount.innerText = "0";
          itemCount.style.display = "none";
          item.appendChild(itemCount);
          taskbar.appendChild(item);
        }
  
        return err ?? [true];
      },
      add(package) {
        os.fs.createDirs("/system/machine");
        var files = os.fs.readFile("/system/machine/taskbar");
        if (!files[0]) files[1] = "";

        var wr = os.fs.writeFile("/system/machine/taskbar", files[1].length == 0 ? package : files[1] + "," + package);
        if (!wr[0]) return wr;

        return [true];
      },
      remove(package) {
        os.fs.createDirs("/system/machine");
        var files = os.fs.readFile("/system/machine/taskbar");
        if (!files[0]) return [true];

        var wr = os.fs.writeFile("/system/machine/taskbar", files[1].split(",").filter((f) => f != package).join(","));
        if (!wr[0]) return wr;

        return [true];
      },
      showOptions(package) {
        var item = document.querySelector("#taskbarItem-" + CSS.escape(package));

        var options = document.createElement("div");
        options.className = "taskbarItemOptions";
        options.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        item.appendChild(options);

        var rect = options.getBoundingClientRect();
        if (rect.x < 8) {
          options.style.left = "calc(50% + " + (8 - rect.x) + "px)";
        }

        optionsListener = (e) => {
          if (e && options.contains(e.target)) {
            return;
          }

          window.removeEventListener("mousedown", optionsListener);
          item.removeChild(options);
          optionsListener = undefined;
        };
        window.addEventListener("mousedown", optionsListener);


        var processes = os.getProcessesByPackage(package);
        if (!processes[0] || processes[1].length == 0) {
          var error = document.createElement("p");
          error.className = "error";
          error.innerText = !processes[0] ? "Error!" : "No processes";
          options.appendChild(error);
        } else {
          var activeLabel = document.createElement("p");
          activeLabel.innerText = "Windows";
          options.appendChild(activeLabel);

          for (var i = 0; i < processes[1].length; i++) {
            var process = processes[1][i];

            for (var x = 0; x < process.windows.length; x++) {
              var win = process.windows[x];
              
              var box = document.createElement("div");
              box.className = "taskbarItemProcess " + (focusedWindow == win ? "focused" : "");
              box.addEventListener("click", ((win) => () => {
                os.focusWindow(win);
              })(win));
              options.appendChild(box);

              var boxIcon = document.createElement("img");
              boxIcon.src = process.appdata.icon;
              box.appendChild(boxIcon);

              var boxName = document.createElement("p");
              boxName.innerText = win.querySelector(".windowTop p").innerText;
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
      run(package, id) {
        if (!os.fs.exists("/system/svc.registry")[1]) return false;

        var svc = os.fs.readFile("/system/svc.registry")[1];
        var registry = os.fs.parseRegistry(svc)[1];
        for (var i = 0; i < registry.length; i++) {
          if (registry[i][2] != id) continue;
    
          var file = os.fs.readFile(registry[i][0]);
          if (!file[0]) continue;

          file = file[1].replaceAll("\r\n", "\n");
          if (!file.includes("\nIE_RUN:\n")) continue;
          file = file.substring(file.indexOf("\nIE_RUN:\n") + 9);
    
          var name = registry[i][1];
          this.started.push(id);
          try {
            os.log("os-services", "<" + package + ":" + name + "> Running service...", 3);
            var result = eval("const __package__=" + JSON.stringify(package) + ";const __id__=" + JSON.stringify(id) + ";" + file);
            os.log("os-services", "<" + package + ":" + name + "> Service is running!", 3);
            //console.log(result);
          } catch (ex) {
            os.log("os-services", "<" + package + ":" + name + "> Error: " + ex, 2);
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
          var s = os.fs.readFile("/system/machine/settings")[1].split("\n");
          for (var i = 0; i < s.length; i++) {
            var prop = s[i].substring(0, s[i].indexOf("="));
            var val = s[i].substring(s[i].indexOf("=") + 1);
            settings[prop] = val;
          }
        }
      },
      update(prop, val) {
        settings[prop] = val;
        var txt = [];
        var app = true;
        if (os.fs.exists("/system/machine/settings")[1]) {
          var s = os.fs.readFile("/system/machine/settings")[1].split("\n");
          for (var i = 0; i < s.length; i++) {
            var pprop = s[i].substring(0, s[i].indexOf("="));
            var pval = s[i].substring(s[i].indexOf("=") + 1);
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
        var panel = document.querySelector(".notifications");
        var not = document.createElement("p");
        not.innerText = title;
        var start = 0;
        var end = 0;
        var mm = (e) => end = e.pageY;
        not.onmousedown = (e) => {
          not.classList.add("select");
          start = e.pageY;
          end = e.pageY;
          window.addEventListener("mousemove", mm);
        };
        var hh = () => {
          not.classList.remove("select");
          window.removeEventListener("mousemove", mm);
          if (start - end > 60) not.classList.add("full");
          else if (start - end < -60) not.classList.remove("full");
        }
        window.addEventListener("mouseup", hh);
        not.onclick = () => {
          onClick?.({title, body, onClick, icon, dismiss: () => {
            not.onclick = null;
            window.removeEventListener("mouseup", hh);
            not.classList.add("disappear");
            setTimeout(() => panel.removeChild(not), 200);
          }});
        };
        var bod = document.createElement("span");
        bod.innerText = " " + body;
        not.appendChild(bod);

        panel.appendChild(not);
        setTimeout(() => {
          not.onclick = null;
          window.removeEventListener("mouseup", hh);
          not.classList.add("disappear");
          setTimeout(() => {
            try {
              panel.removeChild(not)
            } catch {}
          }, 200);
        }, 10000);
      }
    },
    operation: {
      async download(url, path) {
        var str = await this.downloadBase64(url);
        if (!str[0]) return str;
        var parent = os.fs.getParent(path);
        if (!parent[0]) return parent;
        var dirs = os.fs.createDirs(parent[1]);
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
  
        var err;
        var data = await imageUrlToBase64(url).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data.substring(data.indexOf(",") + 1)];
      },
      async downloadString(url) {
        var err;
        var data = await fetch(url).then((t) => t.text()).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data];
      },
      async downloadJSON(url) {
        var err;
        var data = await fetch(url).then((t) => t.json()).catch((e) => err = e);
        if (err) return [false, err];
        return [true, data];
      }
    },
    fs: newFilesystem("Flexan.NET;onlinepc-mem", (...args) => os.log(...args))
  };
})();

const IE = {OPC: 0x01, TPI: 0x02, OPE: 0x04}; // TPI = Third-Party Installation, OPE = Owned Package Extension
const HEAD = 0x00;
const $ = (code) => os.services.register(code);

window.addEventListener("keydown", async (e) => {
  if (e.key == ":" && e.ctrlKey && e.shiftKey) console.log("Opening recovery terminal:", await os.startProcess("me.flexan.terminal", [], {id: "system,"}));
});

var shownRamWarning = false;
(async function() {
  var tryLog = (id, trigger, result) => {
    if (!result[0]) {
      os.log("os-trylogger", "<" + id + ":" + trigger + "> " + result[1], 2);
      return;
    }
    return result[1];
  };

  var entryId = "os-entry";
  
  os.log(entryId, "Loading...", 3);
  tryLog(entryId, "fs-prep", os.fs.prep());
  tryLog(entryId, "fs-tolocal", os.fs.toLocal());

  // if (!os.fs.exists("/apps/me.flexan.terminal/_appdata.json")[1]) {
  //   os.log(entryId, "Recovering terminal...", 3);
  //   os.fs.createDirs("/apps/me.flexan.terminal");
  //   os.fs.writeFile("/apps/me.flexan.terminal/_appdata.json", `{"name":"Recovery","package":"me.flexan.terminal","executor":"start.js","hasWindow":true}`);
  //   os.fs.writeFile("/apps/me.flexan.terminal/start.js", `(async ()=>{var m=(p)=>document.createElement(p);var c=m("pre");c.innerText="Start typing, press BACKSPACE to clear input and enter to run\\nSYS: ";document.body.appendChild(c);var i;var z=()=>{i=m("span");c.appendChild(i)};z();var d="";addEventListener("keydown",async (e)=>{if(e.key=="Backspace")i.innerText=d="";if(e.key=="Enter"){z();var a=d.match(/[^\\s"']+|"([^"]*)"|'([^']*)'/g);var y=a.shift();d="";try{if(y=="host"&&a.length>0)await system.operation.submit([0,a[0]]);else if(y=="taskbar"&&a.length>1)await system.operation.submit([a[0]=="remove"?3:2,a[1]]);else if(y=="update"){await system.operation.submit([0x01]);i.innerText="\\nFinished"}else i.innerText="\\nNot found"}catch(r){i.innerText="\\nError: "+r};i.innerText+="\\nSYS: ";z()};if(e.key.length>1||e.ctrlKey)return;d+=e.key;i.innerText=d})})()`);
  // }

  // check for corrupt update
  if (os.fs.exists("/system/states/updating")[1]) os.notifications.show("System is unstable", "An update was incorrectly installed. To fix, update again and wait until the process finishes.");

  // load settings
  os.settings.load();

  // ram clock
  if (window.performance && window.performance.memory && os.settings.get("SHOW_RAM_WARNING") != "false") {
    //if (performance.memory.usedJSHeapSize / 1048576 > 20) shownRamWarning = true;
    setInterval(() => os.memory.updateRamUsage(performance.memory.usedJSHeapSize / 1048576), 250);
  }
  //setInterval(() => shownRamWarning = false, 300000);
  
  os.initProcessListener();
  tryLog(entryId, "fs-taskbar", await os.taskbar.setup());

  if (os.fs.exists("/system/svc.registry")[1]) {
    os.log(entryId, "Starting services...", 3);
    var svc = os.fs.readFile("/system/svc.registry")[1];
    var registry = os.fs.parseRegistry(svc)[1];
    for (var i = 0; i < registry.length; i++) {
      os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Starting service...", 3);

      var file = os.fs.readFile(registry[i][0]);
      if (!file[0]) {
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Error: " + file[1], 2);
        continue;
      }
      file = file[1].replaceAll("\r\n", "\n");
      if (file.includes("\nIE_RUN:\n")) file = file.substring(0, file.indexOf("\nIE_RUN:\n"));

      try {
        var result = eval(file);
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Service started!", 3);
        //console.log(result);
      } catch (ex) {
        os.log("os-services", "<" + entryId + ":" + registry[i][1] + "> Error: " + ex, 2);
      }
    }
  }

  if (os.fs.exists("/cfg/startup/services")[1]) {
    os.log(entryId, "Running startup services...", 3);
    var svc = os.fs.readFile("/cfg/startup/services")[1].split("\n");
    for (var i = 0; i < svc.length; i++) {
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