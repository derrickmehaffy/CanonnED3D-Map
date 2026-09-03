var canonnEd3d_gr = {

	//Define Categories
	systemsData: {
		categories: {
			"Guardian Ruins - (GR)": {
				"201": {
					name: "Alpha",
					color: randomColor().replace('#', '').toString()
				},
				"202": {
					name: "Beta",
					color: randomColor().replace('#', '').toString()
				},
				"203": {
					name: "Gamma",
					color: randomColor().replace('#', '').toString()
				},
				"214": {
					name: "Unknown",
					color: randomColor().replace('#', '').toString()
				}
			}
		},
		"systems": []
	},

	formatRuins: function (data) {
		const typeMap = { 'Alpha': 201, 'Beta': 202, 'Gamma': 203 };
		for (let i = 0; i < data.length; i++) {
			let s = data[i];
			let name = s["System Name"];
			if (!name || !name.trim()) continue;
			let x = parseFloat(String(s["x"]).replace(',', ''));
			let y = parseFloat(s["y"]);
			let z = parseFloat(s["z"]);
			if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
			let cat = typeMap[s["Site Type"]] || 214;
			let type = s["Site Type"] || 'Unknown';
			// One block per ruin. Several in a system share its coordinates, so
			// Ed3d merges them into one point and concatenates these — which is
			// why each carries its own site number and Bifrost link rather than
			// the system carrying one.
			let label = s["SiteId"] ? 'Ruin #' + s["SiteId"] : 'Ruin';
			let heading = s["SiteId"]
				? '<a href="https://ruins.canonn.tech/#GR' + s["SiteId"] + '">' + label + ' &#8599;</a>'
				: label;
			let where = s["Body Name"] ? ' &middot; ' + s["Body Name"] : '';
			canonnEd3d_gr.systemsData.systems.push({
				name: name,
				coords: { x: x, y: y, z: z },
				infos: heading + ' &middot; ' + type + where + '<br>',
				cat: [cat],
			});
		}
	},

	init: function () {
		fetch('https://storage.googleapis.com/canonn-downloads/guardian_ruins.json')
			.then(function (r) { return r.json(); })
			.then(function (data) {
				canonnEd3d_gr.formatRuins(data);
				document.getElementById("loading").style.display = "none";
				Ed3d.init({
					container: 'edmap',
					json: canonnEd3d_gr.systemsData,
					withFullscreenToggle: false,
					withHudPanel: true,
					hudMultipleSelect: true,
					effectScaleSystem: [20, 500],
					startAnim: false,
					showGalaxyInfos: true,
					cameraPos: [25, 14100, -12900],
					systemColor: '#FF9D00',
				});
			});
	},
};
