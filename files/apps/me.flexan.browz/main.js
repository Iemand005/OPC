(async function() {
  await system.window.loadHtml("browser.html");
  await system.window.loadStyles("browser.css");
  await system.window.resolveResources();
  document.body.style = "";
  
  var proxy = document.getElementById("--browz-settings-proxy").value = "https://browz.netlify.app/";

  document.getElementById("--browz-content").src = proxy + "browz-reset-settings";

  document.getElementById("--browz-search").addEventListener("click", async () => {
    await system.window.setTitle("Browz");
    document.getElementById("--browz-content").src = proxy + "browz-set-cookie/" + document.getElementById("--browz-url-input").value;
  });
  addEventListener("message", async (e) => {
    if (typeof e.data != "string") return;
    if (!e.data.startsWith("browz:")) return;
    var data = e.data.substring(6);
    var comma = data.indexOf(",")
    var type = data.substring(0, comma);
    var val = data.substring(comma + 1);
    if (type == "title" || type == "newtitle") {
      await system.window.setTitle("Browz ~ " + val);
      return;
    }
    if (type == "bigjs") {
      document.getElementById("--browz-alert-file").innerText = val;
      document.getElementById("--browz-alert-dialog").classList.remove("--browz-hidden");
      return;
    }
    if (type == "url" || type == "hash") {
      document.getElementById("--browz-url-input").value = val;
      return;
    }
  }, true);

  document.getElementById("--browz-dialog-ok").addEventListener("click", () => document.getElementById("--browz-alert-dialog").classList.add("--browz-hidden"));

  var changed;
  var state;
  document.getElementById("--browz-settings").addEventListener("click", () => {
    if (document.getElementById("--browz-settings-dialog").classList.contains("--browz-hidden")) document.getElementById("--browz-settings-dialog").classList.remove("--browz-hidden");
    else document.getElementById("--browz-settings-dialog").classList.add("--browz-hidden");
  });
  document.getElementById("--browz-settings-bigjs").addEventListener("click", () => {
    changed = true;
    state = !state;
    if (state) document.getElementById("--browz-settings-bigjs").classList.add("--browz-disabled");
    else document.getElementById("--browz-settings-bigjs").classList.remove("--browz-disabled");
    document.getElementById("--browz-settings-bigjs").innerText = state ? "Disable" : "Enable";
  });
  document.getElementById("--browz-settings-apply").addEventListener("click", async () => {
    proxy = document.getElementById("--browz-settings-proxy").value;
    document.getElementById("--browz-settings-dialog").classList.add("--browz-hidden");

    if (changed) {
      changed = false;
      await system.window.setTitle("Browz");
      document.getElementById("--browz-content").src = proxy + "browz-set-setting/big=" + state;
    }
  });
})();