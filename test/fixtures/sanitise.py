"""Turn a real Journal into a committable fixture.

    python3 test/fixtures/sanitise.py ~/Saved\\ Games/.../Journal.*.log out.log [maxlines]


Whitelist, not blocklist: only named events survive, and only named keys on
them. A blocklist is one new Frontier field away from leaking a CMDR name into
a public repo, and the parser under test reads three keys, so nothing else has
to be real.
"""
import json, sys, pathlib

# event -> keys kept. System names and coordinates are public game data.
KEEP = {
    'Fileheader':           ['timestamp', 'event', 'gameversion'],
    'FSDJump':              ['timestamp', 'event', 'StarSystem', 'StarPos', 'JumpDist'],
    'Location':             ['timestamp', 'event', 'StarSystem', 'StarPos'],
    'StartJump':            ['timestamp', 'event', 'JumpType', 'StarSystem'],
    'FSDTarget':            ['timestamp', 'event', 'Name', 'RemainingJumpsInRoute'],
    'SupercruiseEntry':     ['timestamp', 'event', 'StarSystem'],
    'SupercruiseExit':      ['timestamp', 'event', 'StarSystem', 'BodyType'],
    'FSSSignalDiscovered':  ['timestamp', 'event', 'SignalType'],
    'Scan':                 ['timestamp', 'event', 'ScanType', 'BodyName', 'StarSystem'],
    'NavRoute':             ['timestamp', 'event'],
    'NavRouteClear':        ['timestamp', 'event'],
    'Music':                ['timestamp', 'event', 'MusicTrack'],
}

def sanitise(src, dst, limit=None):
    out, jumps = [], 0
    for line in pathlib.Path(src).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        ev = j.get('event')
        if ev not in KEEP:
            continue
        out.append(json.dumps({k: j[k] for k in KEEP[ev] if k in j}))
        if ev == 'FSDJump':
            jumps += 1
        if limit and len(out) >= limit and jumps:
            break
    pathlib.Path(dst).write_text('\n'.join(out) + '\n', encoding='utf-8')
    return len(out), jumps

if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
    n, j = sanitise(src, dst, limit)
    print(f'{dst}: {n} lines, {j} FSDJump')
