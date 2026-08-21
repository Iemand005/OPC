(async function() {
	await system.window.loadHtml("layout.html");
	await system.window.loadStyles("styles.css");
	
	var path = "/";
	var div = document.querySelector("div");
	var update = async () => {
		div.innerHTML = "";
		document.querySelector("label").style.display = "none";
		await system.window.setTitle("Browz Files ~ " + path);
		
		var dirs = await system.fs.listDirectories(path);
		if (path != "/") dirs.unshift("..");
		for (var i = 0; i < dirs.length; i++) {
			var item = document.createElement("p");
			item.className = "item folder";
			item.innerText = dirs[i];
			item.addEventListener("click", ((dir) => async (e) => {
				path = await system.fs.getPath(path + "/" + dir);
				await update();
			})(dirs[i]));
			item.addEventListener("mousedown", ((dir) => async (e) => {
				if (e.button != 1) return;
        e.preventDefault();
				await system.fs.deletePath(path + "/" + dir);
				await update();
			})(dirs[i]));
			div.appendChild(item);
		}
		
		var files = await system.fs.listFiles(path);
		for (var i = 0; i < files.length; i++) {
			var item = document.createElement("p");
			item.className = "item";
			item.innerText = files[i];
			item.addEventListener("click", ((file) => async (e) => await system.process.start("me.flexan.terminal", ["cat", path + "/" + file, "&&", "pause"]))(files[i]));
			item.addEventListener("mousedown", ((file) => async (e) => {
				if (e.button != 1) return;
        e.preventDefault();
				await system.fs.deletePath(path + "/" + file);
				await update();
			})(files[i]));
			div.appendChild(item);
		}
		
		document.querySelector("label").style.display = "";
	};
	await update();
	
	document.querySelector("input").addEventListener("change", async (e) => {
		/* from https://stackoverflow.com/a/57272491/15390856 */
		const toBase64 = file => new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.readAsDataURL(file);
			reader.onload = () => resolve(reader.result);
			reader.onerror = reject;
		});
		
		document.querySelector("h4").innerText = "Uploading...";
		
    for (var i = 0; i < document.querySelector("input").files.length; i++) {
      var file = document.querySelector("input").files[i];
      var b64 = await toBase64(file);
      await system.fs.writeBase64(path + "/" + file.name, b64.substring(b64.indexOf(",") + 1));
    }
		
		await update();
		
		document.querySelector("h4").innerText = "Uploaded!";
		setTimeout(() => document.querySelector("h4").innerText = "Upload", 3000);
	});
})();