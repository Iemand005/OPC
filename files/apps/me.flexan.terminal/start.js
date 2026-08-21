(async function() {
  await system.window.loadStyles("styles.css");

  if (await system.operation.getAppSettingsProperty("TRANSPARENT_BACKGROUND") == "true") {
    await system.window.setTransparency(true);
    document.body.style.backgroundColor = "transparent";
  }

  var caller = await system.process.getCallerPackage();
  if (caller == "system,") await system.window.setTitle("Terminal (privileged)");

  var dir = "/";
  var storeRepo;

  var output = document.createElement("pre");
  document.body.appendChild(output);

  var blinker = document.createElement("span");
  blinker.className = "blinker";
  blinker.innerText = " ";

  var pressKey;
  var editLength;
  var editText = "";
  var editCallback;
  var sendUpdate = () => document.body.scrollTop = document.body.scrollHeight;
  var write = (text, dontResetInputIndex) => {
    if (blinker.parentElement) output.removeChild(blinker);
    var span = document.createElement("span");
    span.innerText = text;
    output.appendChild(span);
    if (!dontResetInputIndex && editLength != undefined) startInput(editText);
    sendUpdate();
    return span;
  };
  var writeColor = (text, bg, fg, dontResetInputIndex) => {
    var span = write(text, dontResetInputIndex);
    span.style.backgroundColor = bg;
    span.style.color = fg;
    sendUpdate();
    return span;
  };
  var erase = (amount, onlyElem) => {
    if (output.children.length == 0) return 0;
    var elem = onlyElem ?? output.lastChild;
    var removed = 0;
    sendUpdate();
    while (amount > 0) {
      var ll = elem.innerText.length - 1;
      if (ll <= 0) {
        removed++;
        if (onlyElem) {
          elem.innerText = "";
          return removed;
        }
        output.removeChild(elem);
        if (output.children.length == 0) return removed;
        elem = output.lastChild;
        amount--;
        continue;
      }
      elem.innerText = elem.innerText.substring(0, ll);
      amount--;
      removed++;
    }
    return removed;
  };
  var blink = () => {
    output.appendChild(blinker);
  };
  var startInput = (callback, allowMultiline) => {
    altRequiredOnEnter = allowMultiline ?? false;
    var hasLength = false/*editLength != undefined*/;
    editLength = 0;
    editText = hasLength ? editText : "";
    if (callback) editCallback = callback;
    blink();
  };
  var startPressKey = (callback) => {
    pressKey = (key) => {
      pressKey = undefined;
      callback(key);
    };
  };
  var altRequiredOnEnter;
  var altPressedOnEnter;
  addEventListener("keydown", (e) => {
    if (pressKey) {
      pressKey(e.key);
      sendUpdate();
    }

    if (editLength == undefined || e.ctrlKey) return;
    if (e.key.length == 1) {
      write(e.key, true);
      editText += e.key;
      editLength++;
      blink();
      sendUpdate();
      return;
    }
    if (e.key == "Backspace") {
      output.removeChild(blinker);
      if (editLength > 0) {
        editText = editText.substring(0, editText.length - erase(1));
        editLength--;
      }
      blink();
      sendUpdate();
      return;
    }
    if (e.key == "Enter") {
      altPressedOnEnter = e.altKey;
      if (altRequiredOnEnter && !altPressedOnEnter) {
        write("\n", true);
        editText += "\n";
        editLength++;
        blink();
        sendUpdate();
        return;
      }
      editLength = undefined;
      write("\n", true);
      if (editCallback) editCallback(editText);
      editText = "";
      sendUpdate();
    }
  });
  addEventListener("paste", (e) => {
    sendUpdate();
    if (editLength == undefined) return;
    var data = e.clipboardData.getData("Text");
    write(data, true);
    editText += data;
    editLength += data.length;
    blink();
  })

  var next = (callback) => {
    var cc = async (text) => {
      try {
        if (await callback(text));
      } catch (e) {
        console.log(e);
        write("An exception has occurred: " + e);
      }
      write((output.children.length > 0 ? "\n" : "") + dir + ">");
      startInput(cc);
    };
    startInput(cc);
  };
  var pfa = (arg) => { // path from argument
    return arg.startsWith("/") ? arg : (dir == "/" ? dir : dir + "/") + arg;
  };

  var exec = async (cmd) => {
    if (cmd.trim() == "") return;
    var args = cmd.match(/[^\s"']+|"([^"]*)"|'([^']*)'/g);
    cmd = args.shift();
    for (var i = 0; i < args.length; i++) args[i] = args[i].replaceAll("\"", "");

    if (cmd == "ls") {
      if (args.length == 0) {
        write([...(await system.fs.listDirectories(dir)).map((d) => d + "/"), ...(await system.fs.listFiles(dir))].join("\n"));
        return;
      }
      var path = pfa(args[0]);
      write([...(await system.fs.listDirectories(path)).map((d) => d + "/"), ...(await system.fs.listFiles(path))].join("\n"));
      return;
    }
    if (cmd == "clear") {
      output.innerHTML = "";
      return;
    }
    if (cmd == "cd") {
      if (args.length == 0) {
        write("Current directory: " + dir);
        return;
      }
      var path = await system.fs.getPath(pfa(args[0]));
      if ((!(await system.fs.exists(path)) || await system.fs.isFile(path))) {
        write("Directory not found: " + path);
        return;
      }
      dir = path;
      return;
    }
    if (cmd == "cat") {
      if (args.length == 0) {
        write("Usage: cat <file>");
        return;
      }
      var path = pfa(args[0]);
      if ((!(await system.fs.exists(path)) || await system.fs.isDir(path))) {
        write("File not found: " + path);
        return;
      }
      write(await system.fs.readString(path));
      return;
    }
    if (cmd == "mkdir") {
      if (args.length == 0) {
        write("Usage: mkdir <path>");
        return;
      }
      await system.fs.createPath(pfa(args[0]));
      return;
    }
    if (cmd == "del") {
      if (args.length == 0) {
        write("Usage: del <path>");
        return;
      }
      await system.fs.deletePath(pfa(args[0]));
      return;
    }
    if (cmd == "pause") {
      write("Press any key to resume.");
      return new Promise((r) => startPressKey(r));
    }
    if (cmd == "echo") {
      write(args.join(" "));
      return;
    }
    if (cmd == "copy" || cmd == "cp") {
      if (args.length < 2) {
        write("Usage: " + cmd + " <sourcePath> <destinationPath>");
        return;
      }
      write("Operation completed, " + await system.fs.copy(pfa(args[0]), pfa(args[1])) + " file(s) copied.");
      return;
    }
    if (cmd == "edit") {
      if (args.length == 0) {
        write("Usage: edit <filePath>");
        return;
      }
      var file = pfa(args[0]);
      
      output.innerHTML = ""; // clear screen
      write("---- Editing: " + file + " ----\n");
      var precon = "";
      try {
        precon = await system.fs.readString(file);
      } catch {}
      
      var prom = new Promise((r) => {
        var zz;
        zz = () => startInput(async (text) => {
          await system.fs.createPath(await system.fs.getParent(file));
          await system.fs.writeString(file, text);
          r();
        }, true);
        zz();

        write(precon, true);
        editText = precon;
        editLength = editText.length;
        blink();
        sendUpdate();
      });
      return prom;
    }
    if (cmd == "access") {
      if (args.length == 0) {
        write("Usage: access <appPackage>");
        return;
      }
      write("Requesting edit access to " + args[0] + "'s app directory...\n");
      write("Access " + (await system.operation.obtainAppAccess(args[0]) ? "granted." : "denied."));
      return;
    }
    if (cmd == "svc") {
      if (args.length == 0) {
        write("Usage: svc <id>");
        return;
      }
      write("Starting...\n");
      write(await system.process.startService(args[0]) ? "Started." : "Not started.");
      return;
    }
    if (cmd == "perf") {
      var perf = await system.operation.getPerformance();
      write("RAM usage: " + perf.ram.value + perf.ram.unit + "\nCPU usage: " + perf.cpu.value + perf.cpu.unit + "\nGPU usage: " + perf.gpu.value + perf.gpu.unit + "\nCPU cores: " + perf.cores.value + perf.cores.unit);
      return;
    }
    if (cmd == "sys") {
      if (args.length == 0) {
        write("Usage: sys <command> [...<args>]");
        return;
      }
      if (args[0] == "host") {
        if (args.length == 1) {
          write("Usage: sys host <url>");
          return;
        }
        await system.operation.submit([0x00, args[1]]);
        write("Host URL has been set.");
        return;
      }
      if (args[0] == "update") {
        write("Starting...\n");
        var currentVer;
        system.events.onupdateprogress = (type, value) => {
          if (type == "versionStart") {
            currentVer = value;
            return;
          }
          if (type == "isUpdating") {
            write((value ? "Updating " : "Installing ") + currentVer + "...\n");
            return;
          }
          if (type == "download") {
            write("\tDownloading " + value + "... ");
            return;
          }
          if (type == "file") {
            write("OK\n");
            return;
          }
          if (type == "directory") {
            write("\tCreating " + value + "... OK\n");
            return;
          }
          if (type == "config") {
            write("\tConfiguring... ");
            return;
          }
          if (type == "versionEnd") {
            write("OK\n\tFinished " + (value ? "updating " : "installing ") + currentVer + ".\n")
          }
        };
        await system.operation.submit([0x01]);
        system.events.onupdateprogress = null;
        write("Finished.");
        return;
      }
      if (args[0] == "taskbar") {
        if (args.length < 3) {
          write("Usage: sys taskbar add/remove <packages>");
          return;
        }
        args.shift();
        var rem = args.shift() == "remove";
        for (var i = 0; i < args.length; i++) await system.operation.submit([rem ? 0x03 : 0x02, args[i]]);
        write("Changed state of packages on taskbar.");
        return;
      }
      write("Invalid sys command.");
      return;
    }
    if (cmd == "mount") {
      if (args.length < 2) {
        write("Usage: mount (-l(oad) <path> | -e(ject) <path> [-s(ave)] | -c(reate) <path>)");
        return;
      }
      if (args[0] == "-l" || args[0] == "-load") {
        write("[mount] Waiting for valid mounting point...\n");
        var data = await system.util.loadFile();
        if (data === null) {
          write("[mount] No valid mounting point found.\n");
          return;
        }
        var path = pfa(args[1]);
        write("[mount] Mounting...\n");
        if (await system.operation.submit([0x04, path, JSON.parse(data)])) write("[mount] Mounted at " + path + ".");
        else write("[mount] Failed to mount.");
        return;
      }
      if (args[0] == "-e" || args[0] == "-eject") {
        var path = pfa(args[1]);
        write("[mount] Ejecting...\n");
        var data = await system.operation.submit([0x05, path]);
        if (!data) {
          write("[mount] Failed to eject.");
          return;
        }
        write("[mount] Ejected.");
        if (args.length == 3 && (args[2] == "-s" || args[2] == "-save")) system.util.saveFile("mntdisk.json", JSON.stringify(data));
        return;
      }
      if (args[0] == "-c" || args[0] == "-create") {
        var path = pfa(args[1]);
        write("[mount] Mounting...\n");
        if (await system.operation.submit([0x04, path, {}])) write("[mount] Mounted at " + path + ".");
        else write("[mount] Failed to mount.");
        return;
      }
      return;
    }
    if (cmd == "exit") {
      await system.process.this.kill();
      return;
    }
    if (cmd == "shutdown") {
      system.operation.shutdown();
      return;
    }
    if (cmd == "reboot") {
      system.operation.reboot();
      return;
    }
    if (cmd == "title") {
      system.window.setTitle(args.length == 0 ? "Terminal" : args.join(" "));
      return;
    }
    if (cmd == "config") {
      if (args.length < 2) {
        write("Usage: config (os | terminal) <property> [<value>]");
        return;
      }
      if (args[0] == "os") {
        if (args.length > 2) {
          await system.operation.configureSettings(args[1], args[2]);
          write("Applied system settings.");
          return;
        }
        write("Property (system): " + args[1] + "\nValue: " + JSON.stringify(await system.operation.getSettingsProperty(args[1])));
        return;
      }
      if (args[0] == "terminal") {
        if (args.length > 2) {
          await system.operation.configureAppSettings(args[1], args[2]);
          write("Applied app settings.");
          return;
        }
        write("Property (app): " + args[1] + "\nValue: " + JSON.stringify(await system.operation.getAppSettingsProperty(args[1])));
        return;
      }
      write("Not a valid settings type.");
      return;
    }
    if (cmd == "store") {
      if (args.length == 0 || (args[0] != "list" && args[0] != "fetch" && args.length == 1)) {
        write("Usage: store (repo <url> | list | (install | update | remove | run) <name | package>)");
        return;
      }
      if (args[0] == "repo") {
        storeRepo = args[1];
        write("Set repo to " + storeRepo);
        return;
      }
      if (args[0] == "fetch") {
        await system.fs.createPath("/appdata/.terminal/");
        await system.operation.downloadFile("/appdata/.terminal/catalog.json", "/store/catalog.json");
        write("Fetched catalog");
        return;
      }

      var catalog;
      
      try {
        catalog = JSON.parse(await system.fs.readString("/appdata/.terminal/catalog.json"));
      } catch (e) {
        await system.fs.createPath("/appdata/.terminal/");
        await system.operation.downloadFile("/appdata/.terminal/catalog.json", "/store/catalog.json");
        catalog = JSON.parse(await system.fs.readString("/appdata/.terminal/catalog.json"));
      }
      
      if (args[0] == "list") {
        for (var i = 0; i < catalog.length; i++) {
          var item = catalog[i];

          write((i + 1) + ". " + item[2] + " (" + item[0] + ")");
        }
        return;
      }
      if (args[0] == "install" || args[0] == "update" || args[0] == "remove" || args[0] == "run") {
        for (var i = 0; i < catalog.length; i++) {
          var item = catalog[i];

          if (item.includes(args[1])) {
            var package = item[0];

            if (!(await system.operation.obtainAppAccess(package))) return;

            var installed = await system.fs.exists("/apps/" + package);
            if (args[0] == "install" && installed) {
              write("App already installed, run: store update " + (args[1].includes(" ") ? "\"" + args[1] + "\"" : args[1]));
              return;
            } else if ((args[0] == "update" || args[0] == "run") && !installed) {
              write("App not installed, run: store install " + (args[1].includes(" ") ? "\"" + args[1] + "\"" : args[1]));
              return;
            } else if (args[0] == "remove" && !installed) {
              write("App already uninstalled");
              return;
            }

            if (args[0] == "remove") {
              await system.fs.deletePath("/apps/" + package);
              write("Uninstalled " + item[2]);
              return;
            }

            if (args[0] == "run") {
              args.shift();
              await system.process.start(package, args);
              return;
            }

            await system.fs.deletePath("/appdata/.terminal/temp_install");
            await system.fs.createPath("/appdata/.terminal/temp_install");

            var path = "/store/" + package + "/";
            await system.operation.downloadFile("/appdata/.terminal/temp_install/_files.json", path + "_files.json");

            var files = JSON.parse(await system.fs.readString("/appdata/.terminal/temp_install/_files.json"));
            for (var x = 0; x < files.length; x++) {
              await system.operation.downloadFile("/appdata/.terminal/temp_install/" + files[x], path + files[x]);
            }
            
            if (installed) {
              await system.fs.deletePath("/apps/" + package);
            }

            await system.fs.createPath("/apps/" + package);
            await system.fs.copy("/appdata/.terminal/temp_install", "/apps/" + package);
            write((installed ? "Updated " : "Installed ") + item[2]);
            return;
          }
        }

        write("Nothing in the catalog matched '" + args[1] + "'");
        return;
      }

      write("Usage: store (repo <url> | list | (install | update | remove | run) <name | package>)");
      return;
    }
    
    if (await system.fs.exists("/cmd")) {
      var regapps = await system.fs.listAll("/cmd");
      for (var i = 0; i < regapps.length; i++) {
        if (cmd == regapps[i]) {
          await system.process.startAndWait(await system.fs.readString("/cmd/" + regapps[i]), args);
          return;
        }
      }
    }

    write("Command not found: " + cmd);
  };

  var parse = async (cmd) => {
    var pp = "";
    var go = async (wr) => {
      await exec(pp.trim());
      if (wr) write(wr);
      pp = "";
    };
    for (var i = 0; i < cmd.length; i++) {
      if (cmd[i] == "&" && cmd[i + 1] == "&") {
        i++;
        await go("\n");
        continue;
      }
      if (cmd[i] == "^") i++;
      pp += cmd[i];
    }
    await go();
  };

  var entryArgs = await system.process.this.getArguments();
  if (entryArgs.length == 0) {
    write("Online Flexan.NET Terminal 1.1.0\n" + dir + ">");
    next(parse);
    return;
  }

  try {
    if (await parse(entryArgs.join(" ")));
  } catch (e) {
    console.log(e);
    write("An exception has occurred: " + e);
  }
  await system.process.this.kill();
})();