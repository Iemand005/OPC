(async function() {
	await system.window.loadHtml("index.html");
	let interval;
	
	function generate() {
		const length = +document.getElementById("lengthinput").value;
		if (length > 500000) {
			alert("Length cannot be over 500,000.")
			return
		}
		let s = "";
		const lowerUpper = [65, 97];
		for (i = 0; i < length; i++) {
			let index = Math.floor(Math.random()*26) + lowerUpper[Math.floor(Math.random()*2)];
		  s += String.fromCharCode(index);
		}
		document.getElementById("output").innerHTML = s;
	}
	
	function randomize() {
		const s = document.getElementById("monospace").textContent;
		const index = Math.floor(Math.random()*s.length);
		var result = s;
		if (Math.floor(Math.random()*20) == 0) {
			result = s.slice(0,index) + String.fromCharCode(Math.floor(Math.random()*26) + 97) + s.slice(index+1);
		}
		document.getElementById("monospace").innerHTML = result;
	}
	
	function startRandomization() {
		const s = document.getElementById("monospace").textContent;
		const index = Math.floor(Math.random()*s.length);
		const result = s.slice(0,index) + String.fromCharCode(Math.floor(Math.random()*26) + 97) + s.slice(index+1);
		document.getElementById("monospace").innerHTML = result;
		interval = setInterval(randomize, 10);
	}
	
	function stopRandomization() {
		clearInterval(interval)
		document.getElementById("monospace").innerHTML = "randity";
	}

	const randityHeader = document.getElementById("monospace");
	const submitButton = document.getElementById("submit");
  randityHeader.addEventListener("mouseenter", startRandomization);
	randityHeader.addEventListener("mouseleave", stopRandomization);
	submitButton.addEventListener("click", generate);
})()