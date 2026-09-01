// Every host that serves map *data*.  Asset CDNs are deliberately absent, so
// three.js and jQuery still load normally.  Canonn's cloud functions are billed
// per invocation, so the default suite must never call them.
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

// Hosts the offline suite is allowed to actually contact: assets only.
export const ALLOWED_EXTERNAL = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'maxcdn.bootstrapcdn.com',
  // Serves lib/w3data.js, the w3IncludeHTML() library every one of the 50
  // pages uses to inject its shared nav bar (<div w3-include-html="...">).
  // It is a static script, not a Canonn data endpoint — confirmed by
  // stubbing it as a DATA_HOST: the fulfilled "[]" body loads without a
  // network error, but w3IncludeHTML() is then undefined, and every page's
  // own inline `<script>w3IncludeHTML();</script>` throws
  // "ReferenceError: w3IncludeHTML is not defined", which fails the
  // suite's crash assertion. It belongs here, not in DATA_HOSTS.
  'www.w3schools.com'
];

// voyager.html is the reference page for engine-level tests: a single local
// data file, no URL parameters, no network, and withHudPanel enabled.
// Do NOT use index.html — it loads MapData-multifaction.js, which returns
// early and never calls Ed3d.init() when no ?factions= parameter is present.
export const REFERENCE_PAGE = '/voyager.html';

/**
 * Intercept every request. Data hosts are answered with an empty JSON array.
 * Returns a live record so tests can assert nothing leaked to a data host that
 * is missing from DATA_HOSTS.
 */
export async function stubDataHosts(page) {
  const record = { stubbed: [], externalContinued: [] };
  await page.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (DATA_HOSTS.includes(host)) {
      record.stubbed.push(host);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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
