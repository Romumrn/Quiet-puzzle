"""The app's logo: a puzzle board under a sakura branch.  python3 mobile/assets-src/logo.py

Writes the SVG sources next to this file, then rasterizes them into
mobile/assets/ and media/store/ with headless Chrome:

  icon.svg             the full icon (Play Store 512, legacy launcher icon)
  icon-background.svg  adaptive icon, back layer: the pastel sky
  icon-foreground.svg  adaptive icon, front layer: board, branch, petals,
                       shrunk into the 66 % safe zone the launchers' masks keep
  splash.svg           launch screen: the foreground on the neutral #f1ecf0
                       (see AGENTS.md, "Menu colour at cold start")
  feature.html         Play Store feature graphic, 1024x500

Then, in mobile/: `npx @capacitor/assets generate --android`.

The board is the game's: an L block, three one-cell blocks, the pink one
leaving through its gate — the colours of the first world, Peaceful Sakura.
Every flower is drawn from a seeded random, so each petal differs a little and
a rerun gives the same picture.
"""

import math
import os
import random
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SPLASH_BG = '#f1ecf0'


def poly(cells, ox, oy, u, r):
    """Rounded outline of a polyomino (cells as (x,y)): convex AND concave corners rounded."""
    S=set(cells)
    # collect boundary edges, oriented clockwise
    edges={}
    for (x,y) in cells:
        if (x,y-1) not in S: edges[(x,y)]=(x+1,y)
        if (x+1,y) not in S: edges[(x+1,y)]=(x+1,y+1)
        if (x,y+1) not in S: edges[(x+1,y+1)]=(x,y+1)
        if (x-1,y) not in S: edges[(x,y+1)]=(x,y)
    start=next(iter(edges)); pts=[start]; p=edges[start]
    while p!=start: pts.append(p); p=edges[p]
    # drop collinear points
    P=[]
    n=len(pts)
    for i in range(n):
        a,b,c=pts[i-1],pts[i],pts[(i+1)%n]
        if (b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])!=0: P.append(b)
    P=[(ox+x*u,oy+y*u) for x,y in P]
    n=len(P); d=''
    for i in range(n):
        a,b,c=P[i-1],P[i],P[(i+1)%n]
        def toward(p,q,k):
            L=math.hypot(q[0]-p[0],q[1]-p[1]); return (p[0]+(q[0]-p[0])*k/L,p[1]+(q[1]-p[1])*k/L)
        s=toward(b,a,r); e=toward(b,c,r)
        d+=('M' if i==0 else 'L')+f'{s[0]:.1f} {s[1]:.1f} Q{b[0]:.1f} {b[1]:.1f} {e[0]:.1f} {e[1]:.1f} '
    return d+'Z'


SAKURA = dict(  # bg top/bottom, petal base/tip/edge, flower eye, anthers, branch, block gradients, gate
bg=('#fff3f6','#f4cdd9'), base='#ef9db2', tip='#fff4f7', edge='#e48aa2', eye='#d9577a', anther='#e7b24d', branch=('#8f5e6c','#b98795'),
                  exit=('#f9dbe2','#eda3b5','#d98899'), L=('#e3eef9','#9cc3e7','#7fa6cf'), one=('#fbf0d6','#ecd193','#d7b46c'), gate='#e98fa5', fall='#f4b6c6',
)

PETAL = "M0 0 C-17 -6 -40 -34 -34 -62 C-31 -76 -18 -88 -7 -86 L0 -74 L7 -86 C18 -88 31 -76 34 -62 C40 -34 17 -6 0 0Z"
PETAL_S = "M0 0 C-12 -5 -26 -26 -22 -44 C-20 -53 -12 -58 -5 -57 L0 -50 L5 -57 C12 -58 20 -53 22 -44 C26 -26 12 -6 0 0Z"

def defs(t):
    g = lambda id, s: f'<linearGradient id="{id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{s[0]}"/><stop offset=".45" stop-color="{s[1]}"/><stop offset="1" stop-color="{s[2]}"/></linearGradient>'
    return f'''<defs>
  <linearGradient id="bg" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="{t['bg'][0]}"/><stop offset="1" stop-color="{t['bg'][1]}"/></linearGradient>
  <radialGradient id="glow" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  {g('gExit', t['exit'])}{g('gFour', t.get('four', ('#e2f3ea','#a0d4bb','#7fb89d')))}{g('gL', t['L'])}{g('gOne', t['one'])}
  <linearGradient id="pet" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-86"><stop offset="0" stop-color="{t['base']}"/><stop offset=".3" stop-color="{t['base']}" stop-opacity=".75"/><stop offset=".7" stop-color="{t['tip']}" stop-opacity=".97"/><stop offset="1" stop-color="{t['tip']}"/></linearGradient>
  <linearGradient id="petS" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="-57"><stop offset="0" stop-color="{t['base']}"/><stop offset=".7" stop-color="{t['tip']}"/></linearGradient>
  <linearGradient id="br" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{t['branch'][1]}"/><stop offset="1" stop-color="{t['branch'][0]}"/></linearGradient>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#6a3a52" flood-opacity=".20"/></filter>
  <filter id="softS" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#6a3a52" flood-opacity=".18"/></filter>
  <filter id="fl" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#6a3a52" flood-opacity=".16"/></filter>
  <filter id="blur"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>'''

def flower(t, x, y, s, rot, rnd, open_=1.0):
    """A five-petal sakura: each petal slightly different, veins, ring of stamens."""
    out = [f'<g transform="translate({x:.1f} {y:.1f}) rotate({rot:.1f}) scale({s:.3f})" filter="url(#fl)">']
    for i in range(5):
        a = i * 72 + rnd.uniform(-7, 7)
        k = rnd.uniform(.9, 1.06) * open_
        out.append(f'<g transform="rotate({a:.1f}) scale({rnd.uniform(.94,1.04):.3f} {k:.3f})">'
                   f'<path d="{PETAL}" fill="url(#pet)" stroke="{t["edge"]}" stroke-opacity=".35" stroke-width="1.6"/>'
                   f'<path d="M0 -6 C-2 -30 -2 -50 0 -70 M0 -14 C-9 -32 -14 -46 -17 -60 M0 -14 C9 -32 14 -46 17 -60" fill="none" stroke="{t["base"]}" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/></g>')
    out.append(f'<circle r="17" fill="{t["base"]}" opacity=".9"/><circle r="9" fill="{t["eye"]}"/>')
    n = 14
    for i in range(n):
        a = math.radians(i * 360 / n + rnd.uniform(-8, 8)); L = rnd.uniform(24, 36)
        ex, ey = math.cos(a) * L, math.sin(a) * L
        out.append(f'<path d="M{math.cos(a)*7:.1f} {math.sin(a)*7:.1f} L{ex:.1f} {ey:.1f}" stroke="{t["eye"]}" stroke-width="2" stroke-linecap="round" opacity=".85"/>'
                   f'<circle cx="{ex:.1f}" cy="{ey:.1f}" r="3.6" fill="{t["anther"]}"/>')
    out.append('</g>')
    return ''.join(out)

def halfopen(t, x, y, s, rot):
    """Side view: three cupped petals and a calyx."""
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})" filter="url(#fl)">'
            f'<path d="M0 0 C-30 -8 -44 -40 -30 -66 C-20 -58 -8 -40 0 -20Z" fill="url(#petS)" transform="scale(1.3)"/>'
            f'<path d="M0 0 C30 -8 44 -40 30 -66 C20 -58 8 -40 0 -20Z" fill="url(#petS)" transform="scale(1.3)"/>'
            f'<path d="M0 0 C-18 -20 -20 -56 0 -80 C20 -56 18 -20 0 0Z" fill="url(#petS)" transform="scale(1.25)"/>'
            f'<path d="M-14 2 C-10 -10 10 -10 14 2 C8 12 -8 12 -14 2Z" fill="#9db58f"/>'
            f'<path d="M0 8 L0 30" stroke="#9db58f" stroke-width="5" stroke-linecap="round"/></g>')

def bud(t, x, y, s, rot):
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})" filter="url(#fl)">'
            f'<path d="M0 0 C-16 -12 -18 -38 0 -52 C18 -38 16 -12 0 0Z" fill="url(#petS)" stroke="{t["edge"]}" stroke-opacity=".3" stroke-width="1.5"/>'
            f'<path d="M-11 -2 C-8 -14 8 -14 11 -2 C6 8 -6 8 -11 -2Z" fill="#a3bd94"/>'
            f'<path d="M0 6 L0 26" stroke="#a3bd94" stroke-width="4" stroke-linecap="round"/></g>')

def leaf(x, y, s, rot):
    return (f'<g transform="translate({x} {y}) rotate({rot}) scale({s})"><path d="M0 0 C18 -16 50 -16 70 0 C50 16 18 16 0 0Z" fill="#b5cfa9"/>'
            f'<path d="M4 0 L64 0" stroke="#9ab88d" stroke-width="2"/></g>')

def falling(t, rnd, spots):
    out = []
    for (x, y, s) in spots:
        r = rnd.uniform(0, 360); sk = rnd.uniform(-25, 25); op = rnd.uniform(.65, 1)
        blur = ' filter="url(#blur)"' if s < .55 else ''
        out.append(f'<g transform="translate({x} {y}) rotate({r:.0f}) skewX({sk:.0f}) scale({s:.2f} {s*rnd.uniform(.7,1):.2f})" opacity="{op:.2f}"{blur}>'
                   f'<path d="{PETAL_S}" fill="url(#petS)"/></g>')
    return ''.join(out)

def branch(t):
    # tapered main branch from the left edge, a twig up, and a twig dipping to the board's corner
    return f'''<g fill="url(#br)">
  <path d="M-10 214 C 150 196 300 222 420 258 C 520 288 610 296 700 262 C 760 240 820 196 880 150 L 884 156 C 828 206 768 252 704 276 C 610 312 516 304 414 274 C 296 240 150 216 -10 236Z"/>
  <path d="M300 228 C 320 180 350 140 400 112 L404 118 C 360 148 332 186 316 234Z"/>
  <path d="M610 290 C 640 250 660 220 700 196 L704 202 C 668 228 650 258 624 296Z"/>
  <path d="M150 214 C 140 180 120 160 96 146 L100 140 C 128 154 150 178 162 214Z"/>
</g>
<g fill="{t['branch'][0]}" opacity=".5"><ellipse cx="300" cy="226" rx="7" ry="9"/><ellipse cx="610" cy="292" rx="7" ry="9"/></g>'''



def parts(t, seed=7):
    """(background, foreground) element lists, in the 1024 icon frame."""
    rnd = random.Random(seed)
    B = 600; bx, by = 212, 300; pad = 26; u = (B - 2 * pad) / 3; gx, gy = bx + pad, by + pad

    def piece(cells, fill, dx=0):
        xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
        cx = gx + (min(xs) + max(xs) + 1) * u / 2 + dx; cy = gy + (min(ys) + max(ys) + 1) * u / 2
        w = (max(xs) - min(xs) + 1) * u; h = (max(ys) - min(ys) + 1) * u
        return (f'<g transform="translate({cx:.1f} {cy:.1f}) scale({(w-16)/w:.3f} {(h-16)/h:.3f}) translate({-cx:.1f} {-cy:.1f})">'
                f'<path d="{poly(cells, gx+dx, gy, u, 54)}" fill="{fill}"/></g>')

    back = ['<rect width="1024" height="1024" fill="url(#bg)"/>', '<rect width="1024" height="1024" fill="url(#glow)"/>']
    front = [falling(t, rnd, [(120, 420, .5), (160, 760, .9), (90, 610, .7), (930, 380, .8), (900, 640, .5), (870, 880, 1.0),
                              (360, 960, .6), (600, 975, .85), (780, 70, .55), (520, 60, .45), (980, 520, .6)])]
    front.append(f'<rect x="{bx}" y="{by}" width="{B}" height="{B}" rx="120" fill="#fffafb" filter="url(#soft)"/>')
    front.append(f'<rect x="{bx+B-6}" y="{gy+u-18:.0f}" width="40" height="{u+36:.0f}" rx="20" fill="{t["gate"]}"/>')
    front.append('<g filter="url(#softS)">' + piece([(0, 1), (0, 2), (1, 2)], 'url(#gL)') + piece([(2, 2)], 'url(#gOne)')
                 + piece([(2, 1)], 'url(#gExit)', dx=52) + piece([(0, 0)], 'url(#gFour)') + '</g>')
    front.append(branch(t))
    front += [leaf(200, 220, .9, -20), leaf(470, 262, .8, 160), leaf(720, 250, .85, -40), leaf(330, 200, .7, 200)]
    front += [bud(t, 98, 146, 1.0, -55), bud(t, 880, 152, .9, 50), bud(t, 402, 114, .8, 10), halfopen(t, 700, 198, .75, 25)]
    front += [flower(t, 250, 214, .8, 10, rnd), flower(t, 520, 300, 1.25, -8, rnd), flower(t, 372, 128, .72, 30, rnd),
              flower(t, 800, 214, .9, 18, rnd), flower(t, 640, 262, .62, -25, rnd, .92)]
    front.append(falling(t, rnd, [(560, 470, .75), (430, 410, .55)]))
    return back, front


def svg(t, elems, size=1024, view='0 0 1024 1024'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{view}">\n{defs(t)}\n'
            + '\n'.join(elems) + '\n</svg>\n')


def scaled(elems, k):
    """The elements shrunk by k around the frame's centre."""
    return [f'<g transform="translate(512 512) scale({k}) translate(-512 -512)">'] + elems + ['</g>']


FEATURE = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Outfit:wght@300;400&display=swap" rel="stylesheet">
<style>
  html,body{{margin:0;width:1024px;height:500px;overflow:hidden}}
  body{{background:linear-gradient(160deg,#fff3f6 0%,#f4cdd9 100%);display:flex;align-items:center;font-family:Outfit,sans-serif;color:#4a3542}}
  .art{{width:540px;height:540px;margin:24px -30px 0 -10px;flex:none}}
  h1{{font:500 76px/1 Fraunces,serif;margin:0;letter-spacing:-.015em}}
  h1 em{{font-style:normal;color:#d26f8a}}
  p{{font:300 27px/1.35 Outfit,sans-serif;margin:18px 0 0;color:#7a6070}}
</style></head><body>
<div class="art">{art}</div>
<div><h1>Quiet<br><em>Puzzle</em></h1><p>A calm block puzzle.<br>Slide. Breathe. Clear.</p></div>
</body></html>"""


def chrome():
    for name in ('google-chrome', 'chromium', 'chromium-browser'):
        if shutil.which(name):
            return name
    mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    return mac if os.path.exists(mac) else None


def shoot(src, out, w, h, transparent=False, scale=1):
    """Headless Chrome screenshot of a local file: rsvg-convert drops the filters and the blur."""
    with tempfile.TemporaryDirectory() as tmp:
        args = [chrome(), '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={tmp}',
                f'--window-size={w},{h}', f'--force-device-scale-factor={scale}', f'--screenshot={out}',
                '--virtual-time-budget=4000']  # lets the web fonts arrive
        if transparent:
            args.append('--default-background-color=00000000')
        subprocess.run(args + ['file://' + src], check=True, capture_output=True)


def main():
    t = SAKURA
    back, front = parts(t)
    sources = {
        'icon.svg': svg(t, back + front),
        'icon-background.svg': svg(t, back),
        'icon-foreground.svg': svg(t, scaled(front, .66)),
        'splash.svg': svg(t, [f'<rect width="1024" height="1024" fill="{SPLASH_BG}"/>'] + scaled(front, .5), size=1366),
    }
    for name, text in sources.items():
        open(os.path.join(HERE, name), 'w').write(text)
    art = svg(t, front).replace('width="1024" height="1024" ', 'width="540" height="540" ')
    open(os.path.join(HERE, 'feature.html'), 'w').write(FEATURE.format(art=art))

    if not chrome():
        print('SVG written; no Chrome found to rasterize them.')
        return
    assets, store = os.path.join(ROOT, 'mobile', 'assets'), os.path.join(ROOT, 'media', 'store')
    src = lambda n: os.path.join(HERE, n)
    shoot(src('icon.svg'), os.path.join(assets, 'icon.png'), 1024, 1024)
    shoot(src('icon-background.svg'), os.path.join(assets, 'icon-background.png'), 1024, 1024)
    shoot(src('icon-foreground.svg'), os.path.join(assets, 'icon-foreground.png'), 1024, 1024, transparent=True)
    for n in ('splash.png', 'splash-dark.png'):
        shoot(src('splash.svg'), os.path.join(assets, n), 1366, 1366, scale=2)
    shoot(src('icon.svg'), os.path.join(store, 'icon-512.png'), 1024, 1024, scale=.5)
    shoot(src('feature.html'), os.path.join(store, 'feature-1024x500.png'), 1024, 500)
    print('mobile/assets/ and media/store/ updated — now: cd mobile && npx @capacitor/assets generate --android')


if __name__ == '__main__':
    main()
