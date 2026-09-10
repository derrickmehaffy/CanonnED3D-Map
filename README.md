# CanonnED3D-ALL-Map

The code behind [map.canonn.tech](https://map.canonn.tech) — Canonn's 3D maps
of the galaxy, and an orrery of any system Canonn holds data for.

## Running a copy

There is no build step. Serve `Source/` and open it.

```
cd Source
python -m http.server 8000
```

Then <http://localhost:8000>. Any static server will do; the test suite uses
`node test/server.mjs`, which serves the same directory on :4173.

Some pages need live data and will look empty without it — the landing page
takes a `?factions=` parameter, and several maps read Canonn's API.

## Working on it

| Read this | For |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the repository fits together: the three parts, what a page is made of, why script order matters |
| [docs/ED3D-ENGINE.md](docs/ED3D-ENGINE.md) | The galaxy-map engine — coordinates, the point cloud, batched data, selection, routes |
| [docs/ORRERY.md](docs/ORRERY.md) | The orrery — orbital elements, the clock, render-on-demand, camera flights |
| [test/README.md](test/README.md) | The test suite, and where each fixture came from |
| [DATA_SOURCES.md](DATA_SOURCES.md) · [JSON_SCHEMA.md](JSON_SCHEMA.md) | Where the data comes from and the shape it arrives in |

Each of those pages leads with the traps rather than a tour, because the traps
are what cost time. Two worth knowing before you touch anything:

- **`System.create` negates z.** Hand it game coordinates and let it do that
  once; negating first mirrors the system through the galactic plane.
- **Data arrives late and in batches.** Anything that asks a question about the
  systems on a startup timer gets the wrong answer on every map that matters.

## Tests

```
npm install
npx playwright test --project=offline
```

The offline suite intercepts every data host. Canonn's cloud functions are
billed per invocation, so it must never reach them.
