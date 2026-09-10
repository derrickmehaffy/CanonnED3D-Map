var canonnEd3d_gs = {

	systemsData: {
		categories: {
			"Guardian Structures - (GS)": {
				"301": { name: "Lacrosse",   color: CanonnPalette.of('guardian', 0, 10).replace('#', '') },
				"302": { name: "Crossroads", color: CanonnPalette.of('guardian', 1, 10).replace('#', '') },
				"303": { name: "Fistbump",   color: CanonnPalette.of('guardian', 2, 10).replace('#', '') },
				"304": { name: "Hammerbot",  color: CanonnPalette.of('guardian', 3, 10).replace('#', '') },
				"305": { name: "Bear",       color: CanonnPalette.of('guardian', 4, 10).replace('#', '') },
				"306": { name: "Bowl",       color: CanonnPalette.of('guardian', 5, 10).replace('#', '') },
				"307": { name: "Turtle",     color: CanonnPalette.of('guardian', 6, 10).replace('#', '') },
				"308": { name: "Robolobster",color: CanonnPalette.of('guardian', 7, 10).replace('#', '') },
				"309": { name: "Squid",      color: CanonnPalette.of('guardian', 8, 10).replace('#', '') },
				"310": { name: "Stickyhand", color: CanonnPalette.of('guardian', 9, 10).replace('#', '') }
			}
		},
		systems: []
	},

	typeMap: {
		'Lacrosse':    301,
		'Crossroads':  302,
		'Fistbump':    303,
		'Hammerbot':   304,
		'Bear':        305,
		'Bowl':        306,
		'Turtle':      307,
		'Robolobster': 308,
		'Squid':       309,
		'Stickyhand':  310
	},

	formatStructures: function (data) {
		for (let i = 0; i < data.length; i++) {
			let s = data[i];
			let name = s["System Name"];
			if (!name || !name.trim()) continue;
			let x = parseFloat(String(s["x"]).replace(',', ''));
			let y = parseFloat(s["y"]);
			let z = parseFloat(s["z"]);
			if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
			let type = s["Site Type"] || 'Unknown';
			let cat = canonnEd3d_gs.typeMap[type] || 303;
			canonnEd3d_gs.systemsData.systems.push({
				name: name,
				coords: { x: x, y: y, z: z },
				infos: 'Ancient Structure (' + type + ')' + (s["Body Name"] ? '<br>' + s["Body Name"] : '') + '<br>',
				cat: [cat],
			});
		}
	},

	init: function () {
		fetch('https://storage.googleapis.com/canonn-downloads/guardian_structures.json')
			.then(function (r) { return r.json(); })
			.then(function (data) {
				canonnEd3d_gs.formatStructures(data);
				document.getElementById("loading").style.display = "none";
				Ed3d.init({
					container: 'edmap',
					json: canonnEd3d_gs.systemsData,
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
