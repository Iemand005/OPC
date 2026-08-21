(async function() {
  await system.window.loadStyles("styles.css");

  var title = document.createElement("h2");
  title.innerText = "LVOS was detected as your host";
  document.body.appendChild(title);

  var desc = document.createElement("p");
  desc.innerText = "OPC would like your permission to send commands to LVOS.";
  document.body.appendChild(desc);

  var cancel = document.createElement("button");
  cancel.innerText = "Cancel";
  cancel.onclick = async () => await system.process.this.kill();
  document.body.appendChild(cancel);

  var ok = document.createElement("button");
  ok.innerText = "OK";
  ok.className = "ok";
  ok.onclick = async () => {
    ok.disabled = true;

    await system.operation.submit([true]);
    Messenger.broadcastToParent(Messenger.types.launchOverlay, "", "virtual-opc");
    await system.operation.submit([false]);

    await system.process.this.kill();
  };
  document.body.appendChild(ok);
})();