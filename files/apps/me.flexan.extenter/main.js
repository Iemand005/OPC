
(async function() {
  await system.window.loadHtml("interface.html");
  await system.window.loadStyles("styles.css");
  await system.window.resolveResources();

  if (!(await system.fs.exists("/appdata/.extenter/projects"))) {
    await system.fs.createPath("/appdata/.extenter/projects");
  }
  
  var currentTab;
  var pkg = "me.yourname.projectname";
  var path = "/appdata/.extenter/projects/me.yourname.projectname";
  var files = {};
  var tabInfo = {};
  var saveProject = async () => {
    var prevclass = document.querySelector(".warning").className;
    var prevtext = document.querySelector(".warningtext").innerText;
    document.querySelector(".warning").classList.add("hidden");
    document.querySelector(".warningtext").innerText = "Saving project...";

    await system.fs.createPath(path);
    var k = Object.keys(files);
    for (var i = 0; i < k.length; i++) await system.fs.writeString(path + "/" + k[i], files[k[i]]);
    
    document.querySelector(".warning").className = prevclass;
    document.querySelector(".warningtext").innerText = prevtext;
  };

  var getIndexOf = (value, start) => value.substring(0, start).lastIndexOf("\n") + 1;
  var contra = {
    "{": "}",
    "[": "]",
    "(": ")",
    "\"": "\""
  };
  var keycontra = Object.keys(contra);
  var revcontra = keycontra.map((c) => contra[c]);
  var tabEnter;

  var his;
  var hisindex;
  var changed;
  var addhis = (value, start, end) => {
    his = his.slice(0, hisindex + 1);
    his.push([value, start, end]);
    hisindex++;
  };
  var cchange = (value, start, end) => {
    if (!changed) return;
    changed = false;
    addhis(value, start, end);
  };

  var reset = (text, pos, end) => {
    var editor = document.querySelector(".editor");
    editor.value = text;
    editor.selectionStart = editor.selectionEnd = pos;
    tabEnter = false;
    his = [];
    hisindex = -1;
    changed = false;
    addhis(text, pos, end ?? pos);
    addhis(text, pos, end ?? pos);
  };

  var ctrlS;
  var ctrlO;
  var ctrlR;
  document.querySelector(".editor").addEventListener("keydown", async function(e) {
    var start = this.selectionStart;
    var end = this.selectionEnd;

    if (e.ctrlKey && e.key == "z") {
      e.preventDefault();
      if (hisindex <= 0) return;
      var item = his[hisindex - 1];
      this.value = item[0];
      this.selectionStart = item[1];
      this.selectionEnd = item[2];
      hisindex--;
      tabEnter = false;
      changed = true;
      return;
    }
    if (e.ctrlKey && e.key == "y") {
      e.preventDefault();
      if (hisindex >= his.length - 1) return;
      hisindex++;
      var item = his[hisindex];
      this.value = item[0];
      this.selectionStart = item[1];
      this.selectionEnd = item[2];
      tabEnter = false;
      changed = true;
      return;
    }
    if (e.ctrlKey && e.key == "s") {
      ctrlS = Date.now();
      e.preventDefault();
      if (document.querySelector(".tabItem.focused.add")) return;
      files[currentTab] = this.value;
      await saveProject();
      document.querySelector(".tabItem.focused").classList.remove("unsaved");
      return;
    }
    if (e.ctrlKey && e.key == "i") {
      ctrlO = Date.now();
      e.preventDefault();
      if (!(await system.fs.exists(path))) return;
      document.getElementById("appdata").click();
      document.getElementById("appdata").classList.remove("unsaved");

      var top = document.querySelector(".top");
      var items = document.querySelectorAll(".tabItem");
      for (var i = 0; i < items.length; i++) {
        if (items[i].id == "appdata") continue;
        top.removeChild(items[i]);
      }
      reset(await system.fs.readString(path + "/_appdata.json"), 0);

      var ff = await system.fs.listFiles(path);
      for (var i = 0; i < ff.length; i++) {
        if (ff[i] == "_appdata.json" || ff[i].endsWith(".png")) continue;
        var text = await system.fs.readString(path + "/" + ff[i]);
        files[ff[i]] = text;
        tabInfo[ff[i]] = {text, start: 0, end: 0, file: ff[i], his: [], hisindex: -1, changed: false};

        var item = document.createElement("p");
        item.className = "tabItem";
        item.innerText = ff[i];
        top.appendChild(item);
        evItem(item);
      }

      var add = document.createElement("p");
      add.className = "tabItem add";
      add.innerText = "+";
      top.appendChild(add);
      evItem(add, true);
      return;
    }
    if (e.ctrlKey && e.key == "r") {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key == "b") {
      ctrlR = Date.now();
      e.preventDefault();
      await saveProject();
      if (!(await system.operation.obtainAppAccess(pkg))) return;
      await system.fs.deletePath("/apps/" + pkg);
      await system.fs.copy(path, "/apps/" + pkg);
      if (!(await system.fs.exists(path + "/icon.png"))) await system.fs.resource.copyToOutside("icon.png", "/apps/" + pkg + "/icon.png");
      await system.process.start(pkg, []);
      return;
    }
    if (e.ctrlKey && (e.key == "a" || e.key == "c")) return;
    if (e.ctrlKey && e.key == "v") {
      addhis(this.value, start, end);
      return;
    }

    if (e.key.length == 1) {
      tabEnter = false;
      if (start != end) addhis(this.value, start, end);
      if (e.key != " ") cchange(this.value, start, end);
    }
    if (e.key == "Tab") {
      e.preventDefault();
      addhis(this.value, start, end);
      if (start != end) {
        var index = getIndexOf(this.value, start);
        this.value = this.value.substring(0, index) + "\t" + this.value.substring(index);
        this.selectionStart = start + 1;
        this.selectionEnd = end + 1;
        return;
      }
      this.value = this.value.substring(0, start) + "\t" + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 1;
      return;
    }
    if ((e.key == "\"" && this.value[this.selectionStart] != "\"" && this.value[this.selectionStart - 1] != "\\") || (e.key != "\"" && keycontra.includes(e.key))) {
      e.preventDefault();
      this.value = this.value.substring(0, start) + e.key + this.value.substring(start, end) + contra[e.key] + this.value.substring(end);
      this.selectionStart = start + 1;
      this.selectionEnd = end + 1;
      tabEnter = true;
      addhis(this.value, start, end);
      return;
    }
    if (revcontra.includes(e.key) && this.value[this.selectionStart] == e.key && (e.key != "\"" || this.value[this.selectionStart - 1] != "\\")) {
      if (start != end) return;
      e.preventDefault();
      this.selectionStart = this.selectionEnd = start + 1;
      return;
    }
    if (e.key == "Backspace") {
      addhis(this.value, start, end);

      var after = keycontra.includes(this.value[start - 2]);
      if (start != end || !(keycontra.includes(this.value[start - 1]) && revcontra.includes(this.value[start])) && !(after && revcontra.includes(this.value[start - 1]))) return;
      e.preventDefault();
      this.value = this.value.substring(0, start - (after ? 2 : 1)) + this.value.substring(end + (after ? 0 : 1));
      this.selectionStart = this.selectionEnd = start - (after ? 2 : 1);
      return;
    }
    if (e.key == "Enter") {
      var index = getIndexOf(this.value, start);
      var indents = "";
      for (var i = index; i < this.value.length; i++) {
        if (this.value[i] == "\t") indents += "\t";
        else if (this.value[i] == " " && this.value[i + 1] == " ") {
          indents += "\t";
          i++;
        } else break;
      }
      e.preventDefault();
      this.value = this.value.substring(0, start) + "\n" + indents + this.value.substring(end);
      start = end = this.selectionStart = this.selectionEnd = start + 1 + indents.length;
      addhis(this.value, start, end);
      
      if (!tabEnter) return;
      tabEnter = false;
      if (start != end) return;
      this.value = this.value.substring(0, start) + "\t\n" + indents + this.value.substring(end);
      this.selectionStart = this.selectionEnd = start + 1;
      return;
    }
    if (e.key == " ") {
      addhis(this.value, start, end);
      return;
    }
  });
  document.querySelector(".editor").addEventListener("keyup", function(e) {
    if (ctrlS && e.key == "s") {
      var dist = Date.now() - ctrlS;
      ctrlS = undefined;
      if (dist < 670) return;
    }
    if (ctrlO && e.key == "o") {
      var dist = Date.now() - ctrlO;
      ctrlO = undefined;
      if (dist < 670) return;
    }
    if (ctrlR && e.key == "b") {
      var dist = Date.now() - ctrlR;
      ctrlR = undefined;
      if (dist < 670) return;
    }
    if ((e.ctrlKey && (e.key == "z" || e.key == "y" || e.key == "s")) || (e.key.length != 1 && e.key != "Enter" && e.key != "Tab" && e.key != "Backspace")) return;
    his[his.length - 1] = [this.value, this.selectionStart, this.selectionEnd];
    if (document.querySelector(".tabItem.focused.add")) return;
    document.querySelector(".tabItem.focused").classList.add("unsaved");
  });

  var evItem = (item, preventDelete) => {
    item.addEventListener("click", function() {
      document.querySelector(".editor").focus();
      if (this.classList.contains("focused")) return;
      document.querySelector(".tabItem.focused").classList.remove("focused");
      this.classList.add("focused");
      document.querySelector(".warning").classList.add("hidden");
      document.querySelector(".warningtext").innerText = "";
  
      var editor = document.querySelector(".editor");
      var previnfo = Object.keys(tabInfo).filter((k) => tabInfo[k].file == currentTab)[0];
      tabInfo[previnfo] = {text: editor.value, start: editor.selectionStart, end: editor.selectionEnd, file: currentTab, executeStart: tabInfo[previnfo]?.executeStart, checker: tabInfo[previnfo]?.checker, his, hisindex, changed};
      var prevchecker = tabInfo[previnfo].checker;
      if (prevchecker) editor.removeEventListener("keyup", prevchecker);
  
      var info = tabInfo[this.innerText];
      currentTab = info.file;
      reset(info.text, info.start, info.end);
      his = info.his;
      hisindex = info.hisindex;
      changed = info.changed;
      editor.addEventListener("keyup", info.checker);
      if (info.executeStart) info.checker();
    });
    if (!preventDelete) item.addEventListener("mousedown", async function(e) {
      if (e.button != 1) return;
      document.querySelector(".tabItem").click();

      document.querySelector(".top").removeChild(this);

      var file = tabInfo[this.innerText].file;
      delete tabInfo[this.innerText];
      delete files[file];
      await system.fs.deletePath(path + "/" + file);
      await saveProject();
    });
  }

  await system.window.setTitle("Unnamed project (" + pkg + ") - extenter");

  // appdata tab
  currentTab = "_appdata.json";
  reset(`{\n\t"name": "",\n\t"package": "me.yourname.projectname",\n\t"author": "Flexan.NET",\n\t"icon": "icon.png",\n\t"executor": "main.js",\n\t"hasWindow": true,\n\t"startOptions": {\n\t\t"windowMode": "normal"\n\t}\n}`, 12);
  tabInfo["Appdata"] = {file: currentTab, executeStart: true, checker: async (e) => {
    document.querySelector(".warning").classList.add("hidden");
    document.querySelector(".warningtext").innerText = "";
    var show = (text) => {
      document.querySelector(".warning").classList.remove("hidden");
      document.querySelector(".warningtext").innerText = text;
    };

    try {
      var o = JSON.parse(document.querySelector(".editor").value);

      if (typeof o["package"] == "undefined") return show("Invalid data: Missing 'package' (string)");
      if (typeof o["package"] != "string") return show("Invalid data: 'package' must be of type string");
      if (o["package"].includes(",") || o["package"].includes("$") || o["package"].includes(":") || o["package"].includes("\"")) return show("Invalid data: 'package' contains invalid characters");
      pkg = o["package"];
      path = "/appdata/.extenter/projects/" + pkg;

      if (typeof o.name == "undefined") return show("Invalid data: Missing 'name' (string)");
      if (typeof o.name != "string") return show("Invalid data: 'name' must be of type string");
      if (o.name.trim() == "") return show("Invalid data: 'name' cannot be empty");

      await system.window.setTitle(o.name + " (" + pkg + ") - extenter");
      
      if (typeof o.author != "undefined" && typeof o.author != "string") return show("Invalid data: 'author' must be of type string");
      
      if (typeof o.icon != "undefined" && typeof o.icon != "string") return show("Invalid data: 'icon' must be of type string");

      if (typeof o.executor == "undefined") return show("Invalid data: Missing 'executor' (string)");
      if (typeof o.executor != "string") return show("Invalid data: 'executor' must be of type string");
      
      if (typeof o.hasWindow != "undefined" && typeof o.hasWindow != "boolean") return show("Invalid data: 'hasWindow' must be of type boolean");
      
      if (typeof o.startOptions != "undefined") {
        if (typeof o.startOptions != "object" || o.startOptions.constructor == Array) return show("Invalid data: 'startOptions' must be of type JSON object");
        if (typeof o.startOptions.windowMode != "undefined" && typeof o.startOptions.windowMode != "string") return show("Invalid data: 'startOptions.windowMode' must be of type string");
        if (typeof o.startOptions.windowX != "undefined" && typeof o.startOptions.windowX != "number") return show("Invalid data: 'startOptions.windowX' must be of type number");
        if (typeof o.startOptions.windowY != "undefined" && typeof o.startOptions.windowY != "number") return show("Invalid data: 'startOptions.windowY' must be of type number");
        if (typeof o.startOptions.windowWidth != "undefined" && typeof o.startOptions.windowWidth != "number") return show("Invalid data: 'startOptions.windowWidth' must be of type number");
        if (typeof o.startOptions.windowHeight != "undefined" && typeof o.startOptions.windowHeight != "number") return show("Invalid data: 'startOptions.windowHeight' must be of type number");
      }
    } catch (e) {
      show("Invalid JSON: " + e.message);
    }
  }};
  document.querySelector(".editor").addEventListener("keyup", tabInfo["Appdata"].checker);

  // + tab
  var plusTab = {text: "", start: 0, end: 0, file: "+", checker: (e) => {
    if (e.key == "Enter") {
      var add = document.querySelector(".tabItem.add");
      var top = document.querySelector(".top");
      var file = document.querySelector(".editor").value.replace("\n", "");

      tabInfo[file] = {text: "", start: 0, end: 0, file, his: [], hisIndex: -1, changed: false};

      var item = document.createElement("p");
      item.className = "tabItem unsaved";
      item.innerText = file;
      top.appendChild(item);
      evItem(item);
      item.click();

      top.removeChild(add);
      tabInfo["+"] = plusTab;
      top.appendChild(add);
    }
  }, his: [], hisindex: -1, changed: false};
  tabInfo["+"] = plusTab;

  // misc initialization
  var items = document.querySelectorAll(".tabItem");
  for (var i = 0; i < items.length; i++) evItem(items[i], true);
})();