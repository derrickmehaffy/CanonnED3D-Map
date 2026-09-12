import zlib from 'node:zlib';

// Every host that serves map *data*. Asset CDNs are deliberately absent, so
// fonts and Font Awesome still load normally — three.js is vendored and served
// locally, and jQuery is gone. Canonn's cloud functions are billed per
// invocation, so the suite must never call them.
export const DATA_HOSTS = [
  'api.canonn.tech',
  'us-central1-canonn-api-236217.cloudfunctions.net',
  'storage.googleapis.com',
  'edastro.com',
  'dcoh.watch',
  'elitebgs.app',
  'downloads.spansh.co.uk',
  'edsm.net',
  'www.edsm.net',
  'ruins.canonn.tech',
  'signals.canonn.tech',
  'www.googletagmanager.com'
];

/* Hosts the offline suite is allowed to actually contact: assets only.
   www.w3schools.com is deliberately absent. Every page used to load
   lib/w3data.js from there for a w3IncludeHTML() nav include; that include and
   its nav are gone, and `the old nav is gone, and nothing reaches w3schools
   for it` in deadcode.spec.mjs holds the line. Listing the host here would
   silently weaken that assertion, which is the same reason cdn.jsdelivr.net
   was removed below: no page uses it, and an unused entry is a hole waiting
   for someone to fall into. */
export const ALLOWED_EXTERNAL = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'maxcdn.bootstrapcdn.com'
];

// voyager.html is the reference page for engine-level tests: a single local
// data file, no URL parameters, no network, and withHudPanel enabled.
// Do NOT use index.html — it loads MapData-multifaction.js, which returns
// early and never calls Ed3d.init() when no ?factions= parameter is present.
export const REFERENCE_PAGE = '/voyager.html';

// Most loaders on DATA_HOSTS tolerate a bare "[]" — they iterate it directly
// or check its length. A couple dereference a named property on the parsed
// body BEFORE ever touching an array, so a bare "[]" throws a TypeError that
// is never reached with a real (non-empty) API response. For those, and only
// those, stubDataHosts answers with a minimal shaped body instead of "[]" so
// the loader can run its zero-iteration path and still reach Ed3d.init().
// Every other host keeps the plain "[]" default below.
const STUB_BODIES = {
  // Source/data/MapData-Colonisation.js:594 —
  //   data = canonnEd3d_route.factionData.docs[0].faction_presence
  // factionData is this response body verbatim; "[].docs" is undefined, so
  // "[0]" throws before the (harmless, empty) faction_presence loop runs.
  'elitebgs.app': '{"docs":[{"faction_presence":[]}]}',
  // Source/data/MapData-DCOH.js:166 — data = dcohData.systems
  // dcohData is this response body verbatim; "[].systems" is undefined, so
  // the "for (i < data.length)" guard on the next line throws instead of
  // short-circuiting on a zero-length loop.
  'dcoh.watch': '{"systems":[]}'
};

/**
 * Intercept every request. Data hosts are answered with an empty JSON array
 * (or, for the couple of hosts in STUB_BODIES, a minimal shaped object their
 * loader dereferences before it would ever iterate an array — see above).
 * Returns a live record so tests can assert nothing leaked to a data host that
 * is missing from DATA_HOSTS.
 */
export async function stubDataHosts(page) {
  const record = { stubbed: [], externalContinued: [] };
  await page.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (DATA_HOSTS.includes(host)) {
      record.stubbed.push(host);
      const body = STUB_BODIES[host] ?? '[]';
      await route.fulfill({ status: 200, contentType: 'application/json', body });
      return;
    }
    if (host !== 'localhost' && host !== '127.0.0.1') {
      record.externalContinued.push(host);
    }
    await route.continue();
  });
  return record;
}

/** Poll until the map reports a visible scene. */
export async function waitForScene(page, expect, timeout = 60_000) {
  await expect
    .poll(() => page.evaluate(() => window.__ed3dTestState?.().sceneVisible ?? false), { timeout })
    .toBe(true);
}

/**
 * One horizontal row of pixels out of a PNG screenshot, as [r,g,b] triples.
 *
 * Some things can only be checked by looking at what was painted. The orrery's
 * speed slider is one: its detent mark was in the stylesheet and in the
 * computed style and still not on screen, because `accent-color` had the engine
 * painting a native track over it. Chromium renders
 * ::-webkit-slider-runnable-track but reports nothing for it through
 * getComputedStyle, so there is no way to ask — only to look.
 *
 * Decoding in the page (canvas + img.decode) hangs on a page running a
 * requestAnimationFrame loop under SwiftShader, so it happens here instead.
 * Playwright's screenshots are 8-bit, non-interlaced, RGB or RGBA depending on
 * whether the shot has any transparency; those are the shapes this reads, and
 * it throws rather than guess at anything else. zlib is in node, so this adds
 * no dependency.
 */
export function pixelRow(png, y) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let p = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('ascii', p + 4, p + 8);
    const body = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; colour = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += len + 12;
  }
  /* Colour type 2 is RGB and 6 is RGBA — Playwright drops the alpha channel
     when the shot is fully opaque, so both turn up. Anything else (palettes,
     greyscale, 16-bit, interlaced) is not what this suite produces, and
     guessing would be worse than saying so. */
  const bpp = colour === 6 ? 4 : colour === 2 ? 3 : 0;
  if (depth !== 8 || !bpp || interlace !== 0) {
    throw new Error(`pixelRow reads 8-bit RGB or RGBA only, got depth ${depth} colour ${colour}`);
  }
  if (y < 0 || y >= h) throw new Error(`row ${y} is outside a ${w}×${h} image`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  /* Every row's filter refers to the row above it, so they have to be undone
     from the top however few are wanted. */
  const out = Buffer.alloc(stride * (y + 1));
  for (let row = 0; row <= y; row++) {
    const f = raw[row * (stride + 1)];
    const src = raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride);
    const cur = out.subarray(row * stride, (row + 1) * stride);
    const prev = row ? out.subarray((row - 1) * stride, row * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (f !== 0) throw new Error('unknown PNG row filter ' + f);
      cur[i] = v & 0xff;
    }
  }

  const line = [];
  for (let x = 0; x < w; x++) {
    const i = y * stride + x * bpp;
    line.push([out[i], out[i + 1], out[i + 2]]);
  }
  return line;
}
