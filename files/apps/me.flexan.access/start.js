(async function() {
  var caller = await system.process.getCallerPackage();
  if (caller != "system,") return await system.process.this.kill();

  await system.window.loadStyles("styles.css");

  var args = await system.process.this.getArguments();
  if (args[0] != "app" || !args[1]?.trim()) return await system.process.this.kill();

  var name;
  try {
    name = await system.operation.getAppName(args[1]);
  } catch {}
  
  var title = document.createElement("h2");
  title.innerText = "An app is requesting access";
  document.body.appendChild(title);

  var desc = document.createElement("p");
  if (name) desc.innerText = "'" + await system.operation.getAppName(args[2]) + "' wants to edit the app '" + name + "'. Continuing with this action will give the app full edit controls over the other and can lead to risks. Trust this app?";
  else desc.innerText = "'" + await system.operation.getAppName(args[2]) + "' wants to install the app with package '" + args[1] + "'. Continuing with this action will allow the app to install a new app. Continue?";
  document.body.appendChild(desc);

  var cancel = document.createElement("button");
  cancel.innerText = "Cancel";
  cancel.onclick = async () => await system.process.this.kill();
  document.body.appendChild(cancel);

  var grant = document.createElement("button");
  grant.innerText = "Grant";
  grant.className = "grant";
  grant.onclick = async () => {
    grant.disabled = true;
    await system.operation.submit(args);
    await system.process.this.kill();
  };
  document.body.appendChild(grant);
})();