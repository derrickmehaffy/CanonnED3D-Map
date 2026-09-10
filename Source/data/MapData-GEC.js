// MapData-GEC.js
// Fetches GEC POIs from edastro.com and plots them on the ED3D map.
// Pin label format: Name (galMapSearch)\nSummary


var canonnEd3d_gec = {
    systemsData: {
        categories: {
            'GEC POI': {
                // subcategories will be filled below
            }
        },
        systems: [],
        routes: [],
    },

    formatData: function (data) {
        var categories = {};
        var typeToId = {};
        var colorList = [
            'f5a142', '42b0f5', '7E587E', 'E78A61', 'B1FB17', 'E67451', '6CBB3C', '85BB65', '4AA02C', 'EAC117', 'FFFF00', 'E238EC', 'CC6600', '7D0541', '98AFC7', 'EDC9AF', 'E0FFFF', 'EE9A4D', '357EC7', 'C24641', '786D5F', '6AFB92', '98FF98', '5FFB17', 'E38AAE', '7BCCB5', 'E3E4FA', 'FCDFFF', '3B9C9C', 'B5A642', 'CA226B', 'FAAFBA', '7E3517', '3BB9FF', 'B7CEEC', '728FCE', 'C48189', 'F62217', 'FFE87C', '95B9C7', 'C38EC7', '438D80', '59E817', 'EBDDE2', '4B0082', 'AF9B60', '616D7E', 'C12267', '8AFB17', 'B38481', 'CCFB5D', 'F88158', '00FF00', '2B547E', '0000A0', 'D4A017', '151B54', 'E8ADAA', 'C6DEFF', '48CCCD', 'CFECEC', '7D1B7E', 'E56717', '6495ED', 'FDD7E4', '7F525D', '7FE817', 'C85A17', '667C26', '9E7BFF', 'FBB917', 'E77471', '254117', 'EDDA74', 'F433FF', 'E9AB17', 'ECC5C0', '2B60DE', 'C48793', 'F9A7B0', 'FF2400', '737CA1', '57FEFF', 'C35817', '38ACEC', '43C6DB', 'BCC6CC', 'C04000', 'EBF4FA', '4E9258', 'E41B17', 'DEB887', 'FFE5B4', 'BDEDFF', '347C17', '461B7E', '566D7E', 'FBF6D9', '78866B', 'F535AA', 'C2B280', '8A4117', 'E55B3C', 'C6AEC7', '347235', 'FFFFCC', 'ADA96E', 'F2BB66', '4E387E', 'B2C248', 'E45E9D', 'F88017', '5EFB6E', 'FBB117', 'C7A317', '89C35C', '827B60', 'FBBBB9', 'F0F8FF', '87F717', '7F38EC', 'FF00FF', 'C68E17', '3EA055', '6698FF', 'C11B17', 'D2B9D3', 'E66C2C', 'E799A3', 'A0CFEC', 'FDEEF4', '5CB3FF', 'B4CFEC', '2B3856', 'F6358A', 'FFA62F', 'F62817', '4E8975', '9AFEFF', '157DEC', '6F4E37', '9CB071', '52D017', '87AFC7', 'C3FDB8', '7A5DC7', 'E7A1B0', '57E964', '008080', 'BCE954', '368BC1', '5E7D7E', '659EC7', '306754', 'FFEBCD', 'F660AB', '347C2C', 'E4287C', '990012', 'B87333', '348781', '614051', 'FFFFC2', '307D7E', '64E986', '15317E', '0020C2', 'FFF8C6', '306EFF', 'C25A7C', '8E35EF', '82CAFF', '657383', 'C5908E', 'CD7F32', 'FFDB58', '00FFFF', '827839', 'E6A9EC', 'AFDCEC', 'B93B8F', '77BFC7', '6AA121', 'E0B0FF', '92C7C7', '9F000F', 'F9B7FF', 'FFF5EE', 'DC381F', 'F7E7CE', '842DCE', 'C12283', '348017', '56A5EC', '151B8D', '736AFF', '99C68E', '1F45FC', '4C787E', 'C19A6B', '2554C7', 'FAAFBE', 'A1C935', 'C45AEC', 'C34A2C', 'ADDFFF', 'F778A1', '9DC209', '6A287E', 'C58917', '7E354D', '893BFF', '8C001A', '54C571', 'C8B560', '7FFFD4', '810541', '7F4E52', '3EA99F', 'CCFFFF', '4EE2EC', '571B7E', '493D26', 'E55451', 'E9CFEC', '82CAFA', 'F70D1A', '617C58', '6C2DC7', 'FFD801', '7F5217', 'FF8040', '483C32', 'FF0000', 'E18B6B', '583759', '342D7E', 'AF7817', '7D0552', 'FFF380', 'F87431', '806517', '43BFC7', '848b79', 'F75D59', 'B048B5', '78C7C7', '488AC7', 'FF7F50', '6960EC', '5E5A80', 'F52887', '966F33', '800517', 'E2A76F', 'C9BE62', 'FC6C85', 'EDE275', 'E8A317', 'F3E5AB', 'FDD017', '728C00', 'FFDFDD', 'C25283', '8BB381', '93FFE8', '7DFDFE', 'A74AC7', '7E3817', 'F87217', '9172EC', 'F5F5DC', '41A317', 'C47451', 'C12869', '4CC552', 'C8A2C8', '4CC417', 'FFCBA4', '7F462C', 'C36241', 'E56E94', '1589FF', '835C3B', 'A23BEC', '2B65EC', 'ECE5B6',
        ];
        var nextCatId = 1;
        for (var i = 0; i < data.length; i++) {
            var row = data[i];
            var type = row.type || 'Other';
            if (!typeToId[type]) {
                var catId = (nextCatId < 10 ? '0' : '') + nextCatId;
                typeToId[type] = catId;
                canonnEd3d_gec.systemsData.categories['GEC POI'][catId] = {
                    name: type,
                    color: colorList[(nextCatId - 1) % colorList.length],
                };
                nextCatId++;
            }
            var pinName = row.name + ' (' + row.galMapSearch + ')';
            var coords = row.coordinates || {};
            var poiSite = {
                name: pinName,
                cat: [typeToId[type]],
                infos: '<img src="' + (row.mainImage || '') + '" alt="' + (row.name || '') + '">' +
                    row.summary + '<br><a href="' + row.poiUrl + '" target="_blank" rel="noopener">View on edastro.com</a><br>' + '<br><hr><br>' +
                    '<i>' + (row.descriptionHtml || '') + '</i>',
                desc: row.descriptionHtml || row.description || '',
                coords: {
                    x: parseFloat(Array.isArray(coords) ? coords[0] : undefined),
                    y: parseFloat(Array.isArray(coords) ? coords[1] : undefined),
                    z: parseFloat(Array.isArray(coords) ? coords[2] : undefined),
                },
                row: row
            };
            canonnEd3d_gec.systemsData.systems.push(poiSite);
        }
    },

    init: function () {
        function loadFromLocal() {
            fetch('data/gec-all.json')
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error('Failed to fetch local gec-all.json – status ' + response.status);
                    }
                    return response.json();
                })
                .then(function (data) {
                    canonnEd3d_gec.formatData(data);
                    document.getElementById('loading').style.display = 'none';
                    Ed3d.init({
                        container: 'edmap',
                        json: canonnEd3d_gec.systemsData,
                        withFullscreenToggle: false,
                        withHudPanel: true,
                        hudMultipleSelect: true,
                        effectScaleSystem: [100, 2000], // More visible when zoomed out
                        startAnim: true,
                        showGalaxyInfos: true,
                        systemColor: '#FF9D00',
                        customHover: canonnEd3d_gec.customHover,
                        customClick: canonnEd3d_gec.customClick
                    });
                })
                .catch(function (err) {
                    console.error('GEC: error loading local gec-all.json –', err);
                    document.getElementById('loading').style.display = 'none';
                });
        }

        fetch('https://edastro.com/gec/json/all')
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Failed to fetch GEC data – status ' + response.status);
                }
                return response.json();
            })
            .then(function (data) {
                canonnEd3d_gec.formatData(data);
                document.getElementById('loading').style.display = 'none';
                Ed3d.init({
                    container: 'edmap',
                    json: canonnEd3d_gec.systemsData,
                    withFullscreenToggle: false,
                    withHudPanel: true,
                    hudMultipleSelect: true,
                    effectScaleSystem: [100, 2000], // More visible when zoomed out
                    startAnim: true,
                    showGalaxyInfos: true,
                    systemColor: '#FF9D00',
                    customHover: canonnEd3d_gec.customHover,
                    customClick: canonnEd3d_gec.customClick
                });
            })
            .catch(function (err) {
                console.error('GEC: error loading data –', err);
                // Try to load from local file if CORS or network error
                loadFromLocal();
            });
    },

    customHover: function (poi, $el) {
        // Custom hover: show name (galMapSearch) and summary
        var row = poi.row;
        var html = '<b>' + row.name + '</b> (' + row.galMapSearch + ')<br><i>' + (row.summary || '') + '</i>';
        $el.html(html);
    },

    customClick: function (poi) {
        // Custom click: show description in left panel
        var row = poi.row;
        var html = '<h2>' + row.name + ' (' + row.galMapSearch + ')</h2>';
        html += '<div>' + (row.descriptionHtml || row.description || '') + '</div>';
        html += '<hr><i>' + (row.summary || '') + '</i>';
        var details = document.getElementById('systemDetails');
        if (details) details.innerHTML = html;
    }
};

document.addEventListener('DOMContentLoaded', canonnEd3d_gec.init);