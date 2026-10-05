#!/usr/bin/env python3
"""
Musique d'ambiance jouée par de VRAIS instruments — `python3 tools/music_organic.py [morceau...]`

`music.py` synthétise tout avec numpy : malgré ses huit corrections (timing,
nuances, battements, bruit de marteau…), un piano fait d'oscillateurs reste un
piano calculé. Ici, la composition est toujours écrite en code et seedée — un
même seed redonne exactement le même morceau — mais chaque note est jouée par
des échantillons d'instruments réellement enregistrés, note par note :

    piano  Upright Piano KW     piano droit, doux et boisé
    harpe  Concert Harp         harpe de concert, petite pièce (Versilian)
    hang   Hang D minor         handpan en ré mineur
    kalimba Kalimba             lamelles pincées, son rond et sautillant
    verres Glass                verres d'eau accordés, cristallins

Les trois banques viennent de FreePats (freepats.zenvoid.org), toutes sous
Creative Commons CC0 : domaine public, aucune attribution ni restriction. Elles
vivent dans tools/soundfonts/ (ignoré par git, ~100 Mo décompressées) et ne
servent qu'à fabriquer les MP3 : l'application n'embarque que le résultat.

Le hang ne sonne QUE sur ses dix notes réelles (la3 do4 ré4 mi4 fa4 sol4 la4
si♭4 do5 ré5) — ré mineur, ou fa majeur, les mêmes notes : tout est écrit en
fa majeur, et sa partie ne pioche que dans ces notes.

Chaîne : composition -> un fichier MIDI par instrument -> FluidSynth (sans sa
réverbe ni son chorus) -> mixage numpy (panoramique, niveaux) -> réverbération
de pièce et boucle sans couture de music.py -> MP3.

Prérequis : `brew install fluidsynth`, les banques dans tools/soundfonts/.

    python3 tools/music_organic.py                 la musique (audio/4-jardin.mp3)
    python3 tools/music_organic.py sons [dossier]  les six sons de sortie, au kalimba
"""

import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from music import SR, SORTIE, reverbe, boucler, pleurage, passe_haut, respiration  # noqa: E402

BANQUES = Path(__file__).resolve().parent / "soundfonts"
SF2 = {
    "piano": BANQUES / "UprightPianoKW-SF2-20220221" / "UprightPianoKW-20220221.sf2",
    "harpe": BANQUES / "ConcertHarp-SF2-20200702" / "ConcertHarp-20200702.sf2",
    "hang": BANQUES / "Hang-D-minor SF2-20220330" / "Hang-D-minor 20220330.sf2",
    "kalimba": BANQUES / "Kalimba-SF2-20190723" / "Kalimba-20190723.sf2",      # do3–do6
    "verres": BANQUES / "Glass-SF2-20191227" / "Glass-20191227.sf2",           # la4–la6
}

# --------------------------------------------------------------------------
# Hauteurs (numéros MIDI : do4 = 60)
# --------------------------------------------------------------------------

NOMS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(note: str) -> int:
    """'Bb4' -> 70. Accepte b (bémol) et # (dièse)."""
    base = NOMS[note[0]]
    reste = note[1:]
    if reste.startswith("b"):
        base, reste = base - 1, reste[1:]
    elif reste.startswith("#"):
        base, reste = base + 1, reste[1:]
    return 12 * (int(reste) + 1) + base


# Les dix notes du hang : aucune autre ne sonne.
HANG = {midi(n) for n in ("A3", "C4", "D4", "E4", "F4", "G4", "A4", "Bb4", "C5", "D5")}

# --------------------------------------------------------------------------
# Écriture MIDI (type 0, une piste) — pas de dépendance pour si peu
# --------------------------------------------------------------------------

TICKS = 480          # par noire ; le tempo est fixé à 60 BPM : 480 ticks = 1 s


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


class Partie:
    """Les notes d'un instrument, en secondes ; `ecrire` en fait un fichier MIDI."""

    def __init__(self):
        self.evenements = []   # (instant s, ordre, octets)

    def note(self, instant, hauteur, duree, velocite):
        v = int(np.clip(round(velocite), 1, 127))
        t = max(0.0, instant)
        self.evenements.append((t, 1, bytes([0x90, hauteur, v])))
        self.evenements.append((t + max(0.05, duree), 0, bytes([0x80, hauteur, 0])))

    def pedale(self, instant, enfoncee):
        self.evenements.append((max(0.0, instant), 0 if not enfoncee else 2,
                                bytes([0xB0, 64, 127 if enfoncee else 0])))

    def ecrire(self, chemin, fin):
        # Un dernier évènement après la fin laisse FluidSynth rendre les résonances.
        self.evenements.append((fin, 0, bytes([0xB0, 7, 100])))
        piste = bytearray()
        piste += _vlq(0) + bytes([0xFF, 0x51, 0x03]) + (1_000_000).to_bytes(3, "big")   # 60 BPM
        piste += _vlq(0) + bytes([0xB0, 7, 100, 0])[:3]                                   # volume
        precedent = 0
        for t, _, octets in sorted(self.evenements, key=lambda e: (e[0], e[1])):
            tick = int(round(t * TICKS))
            piste += _vlq(tick - precedent) + octets
            precedent = tick
        piste += _vlq(0) + bytes([0xFF, 0x2F, 0x00])
        entete = b"MThd" + struct.pack(">IHHH", 6, 0, 1, TICKS)
        Path(chemin).write_bytes(entete + b"MTrk" + struct.pack(">I", len(piste)) + bytes(piste))


def rendre(partie, instrument, fin, dossier):
    """Joue une partie avec la banque de l'instrument ; renvoie un tableau stéréo (2, n)."""
    import soundfile as sf
    mid = Path(dossier) / f"{instrument}.mid"
    wav = Path(dossier) / f"{instrument}.wav"
    partie.ecrire(mid, fin)
    subprocess.run([
        "fluidsynth", "-ni", "-q", "-F", str(wav), "-r", str(SR), "-O", "s16", "-g", "0.6",
        "-o", "synth.reverb.active=0", "-o", "synth.chorus.active=0",
        str(SF2[instrument]), str(mid),
    ], check=True)
    audio, sr = sf.read(wav, always_2d=True)
    assert sr == SR
    return audio.T.astype(np.float64)


def placer(stereo, pan, gain):
    """Panoramique à puissance constante sur un signal déjà stéréo."""
    gl, gr = np.sqrt(0.5 * (1 - pan)) * gain * 1.414, np.sqrt(0.5 * (1 + pan)) * gain * 1.414
    return np.stack([stereo[0] * gl, stereo[1] * gr])


# --------------------------------------------------------------------------
# Phrasé
# --------------------------------------------------------------------------

def humain(instant, rng, faible=False):
    """Quelques millisecondes d'avance ou de retard ; les temps faibles traînent un cheveu."""
    return instant + rng.normal(0, 0.010) + (0.012 if faible else 0.0)


# --------------------------------------------------------------------------
# Les morceaux
# --------------------------------------------------------------------------

def morceau_jardin():
    """
    « Jardin » — fa majeur, 66 BPM, environ 127 s en boucle.

    Lumineux plutôt que contemplatif : grille I–V–IV–V (fa, do, si♭, do), qui
    ne s'arrête jamais sur un accord mineur, et une mélodie PENTATONIQUE
    (fa sol la do ré) — sans demi-ton, rien ne grince ni ne s'attriste. Un
    motif de deux mesures, qui monte puis redescend, revient d'une section à
    l'autre : c'est lui qu'on retient. Les notes du hang forment aussi la gamme
    de fa majeur : il reste de la partie.

    Sept sections de cinq mesures ; chacune ajoute ou retire une voix :

        A  intro       harpe en arpèges qui montent et descendent, hang léger
        B  thème       le piano chante le motif sur la harpe
        C  kalimba     ostinato sautillant au kalimba, piano en accords, hang
        D  scintille   le piano reprend le motif plus haut, les verres d'eau
                       ajoutent des étincelles
        E  respiration piano clairsemé et verres lointains : le moment de vide
        F  variation   autre grille (si♭, fa/la, sol m7, do), le kalimba prend
                       le motif, harpe et hang autour
        G  final       tout le monde, contrechant de harpe ; finit sur do, qui
                       ramène naturellement au fa du début de la boucle
    """
    rng = np.random.default_rng(5150)
    temps = 60 / 66
    par_section = 5
    sections = [
        dict(nom="intro",   grille="claire",  piano=None,        harpe=0.90, hang=0.55, kalimba=None,       verres=0.0, contre=False, gain=1.05),
        dict(nom="theme",   grille="claire",  piano="motif",     harpe=0.65, hang=0.25, kalimba=None,       verres=0.0, contre=False, gain=0.94),
        dict(nom="kalimba", grille="claire",  piano="accords",   harpe=0.0,  hang=0.40, kalimba="ostinato", verres=0.0, contre=False, gain=0.98),
        dict(nom="scintille", grille="claire", piano="motif+",   harpe=0.45, hang=0.0,  kalimba=None,       verres=0.7, contre=False, gain=1.00),
        dict(nom="souffle", grille="claire",  piano="nu",        harpe=0.0,  hang=0.0,  kalimba=None,       verres=0.45, contre=False, gain=0.95),
        dict(nom="variation", grille="variee", piano="basse",    harpe=0.55, hang=0.35, kalimba="motif",    verres=0.0, contre=False, gain=0.96),
        dict(nom="final",   grille="claire",  piano="motif",     harpe=0.70, hang=0.35, kalimba="ostinato", verres=0.45, contre=True, gain=1.04),
    ]
    mesures = len(sections) * par_section
    duree = mesures * 4 * temps

    # basse, voicing main droite, ancre du motif, notes de hang
    grilles = {
        "claire": [
            ("F2",  ["A3", "C4", "E4", "G4"], "A4", ["F4", "A4", "C5", "C4"]),   # Fa maj9
            ("C2",  ["E3", "G3", "D4"],       "G4", ["C4", "E4", "G4", "D5"]),   # Do add9
            ("Bb1", ["D3", "F3", "A3", "C4"], "F4", ["Bb4", "D4", "F4", "D5"]),  # Si♭ maj9
            ("C2",  ["G3", "A3", "D4", "E4"], "G4", ["C4", "G4", "A4", "E4"]),   # Do 6/9
        ],
        "variee": [
            ("Bb1", ["D3", "F3", "A3", "C4"], "D5", ["D4", "F4", "Bb4"]),        # Si♭ maj9
            ("A1",  ["F3", "A3", "C4", "G4"], "C5", ["A3", "C4", "F4", "A4"]),   # Fa/la
            ("G1",  ["F3", "Bb3", "D4"],      "D5", ["G4", "Bb4", "D5", "F4"]),  # Sol m7
            ("C2",  ["E3", "G3", "D4"],       "G4", ["C4", "E4", "G4"]),         # Do add9
        ],
    }

    # La gamme du chant : fa majeur pentatonique, de do4 à do6.
    penta = [midi(n) for n in ("C4", "D4", "F4", "G4", "A4", "C5", "D5", "F5", "G5", "A5", "C6")]
    # Le motif, en pas de gamme depuis l'ancre : la première mesure monte, la
    # seconde redescend vers l'ancre. (temps dans la mesure, pas, durée)
    motif = [
        [(0.0, 0, 1.0), (1.0, 1, 0.5), (1.5, 2, 0.5), (2.0, 3, 1.5), (3.5, 2, 0.5)],
        [(0.0, 4, 1.0), (1.0, 3, 0.5), (1.5, 2, 1.0), (2.5, 1, 0.5), (3.0, 0, 1.0)],
    ]

    def chanter(partie, t0, mesure, ancre, transpo, force, souffle, decalage=0):
        base = min(range(len(penta)), key=lambda i: abs(penta[i] - midi(ancre))) + decalage
        for beat, pas, dur in motif[mesure % 2]:
            if rng.random() < 0.12 and beat > 0:
                continue                               # une note qu'on laisse respirer
            i = int(np.clip(base + pas + (1 if rng.random() < 0.15 else 0), 0, len(penta) - 1))
            fort = beat in (0.0, 2.0)
            partie.note(humain(t0 + beat * temps, rng, not fort), penta[i] + transpo, dur * temps + 0.6,
                        (force + (8 if fort else 0) + 6 * rng.random()) * souffle)

    piano, harpe, hang, kalimba, verres = Partie(), Partie(), Partie(), Partie(), Partie()

    for m in range(mesures):
        sec = sections[m // par_section]
        dans = m % par_section
        t0 = m * 4 * temps
        basse, voicing, ancre, notes_hang = grilles[sec["grille"]][m % 4]
        souffle = respiration(m, mesures) * sec["gain"]
        tons = sorted({midi(basse) + 12} | {midi(n) for n in voicing})

        piano.pedale(t0 + 0.02, False)
        piano.pedale(t0 + 0.09, True)

        # Basse de piano : à chaque bascule de section, et sous les sections qui chantent.
        if dans == 0 or sec["piano"] in ("motif", "motif+", "basse", "accords"):
            piano.note(humain(t0, rng), midi(basse), 3.4 * temps, (44 + 6 * rng.random()) * souffle)
            if sec["piano"] in ("motif", "motif+", "accords"):
                piano.note(humain(t0 + 2 * temps, rng, True), midi(basse) + 12, 2.0 * temps,
                           (32 + 5 * rng.random()) * souffle)

        if sec["piano"] == "accords":
            # Accord posé sur les temps 2 et 4, comme un pas léger.
            for beat in (1, 3):
                for k, note in enumerate(voicing):
                    piano.note(humain(t0 + beat * temps + 0.03 * k, rng, True), midi(note), 0.9 * temps,
                               (30 + 6 * rng.random()) * souffle)

        if sec["piano"] in ("motif", "motif+"):
            chanter(piano, t0, m, ancre, 12 if sec["piano"] == "motif+" else 0, 44, souffle)

        if sec["piano"] == "nu":
            for beat in sorted(rng.choice(4, size=int(rng.integers(2, 4)), replace=False)):
                note = penta[int(rng.integers(4, 9))]
                piano.note(humain(t0 + beat * temps + 0.5 * temps, rng, True), note, 3.0,
                           (34 + 8 * rng.random()) * souffle)

        if sec["harpe"]:
            # Arpège qui monte puis redescend, en croches : un mouvement de vague.
            vague = tons + [t + 12 for t in tons[1:3]]
            vague = vague + vague[-2:0:-1]
            for k in range(8):
                if rng.random() > sec["harpe"]:
                    continue
                harpe.note(humain(t0 + k * temps / 2, rng, k % 2 == 1), vague[k % len(vague)], 2.4,
                           (42 + 14 * rng.random() - 5 * (k % 2)) * souffle)

        if sec["hang"]:
            for beat in range(4):
                if rng.random() > sec["hang"] * (1.4 if beat == 0 else 0.7):
                    continue
                note = midi(notes_hang[int(rng.integers(0, len(notes_hang)))])
                assert note in HANG
                decale = 0.5 if rng.random() < 0.35 else 0.0
                hang.note(humain(t0 + (beat + decale) * temps, rng, decale > 0), note, 3.5,
                          (48 + 16 * rng.random()) * souffle)

        if sec["kalimba"] == "ostinato":
            # Deux octaves de l'accord en croches, l'aigu et le grave qui se
            # répondent, les contretemps un soupçon en retard : ça sautille.
            haut = [t for t in (n + 12 for n in tons) if 60 <= t <= 84] or tons
            bas = [t for t in tons if 48 <= t <= 72] or tons
            for k in range(8):
                note = haut[(k // 2) % len(haut)] if k % 2 == 0 else bas[(k // 2) % len(bas)]
                if rng.random() < 0.1:
                    continue
                kalimba.note(humain(t0 + k * temps / 2 + (0.025 if k % 2 else 0), rng), note, 1.2,
                             (52 - 8 * (k % 2) + 8 * rng.random()) * souffle)
        elif sec["kalimba"] == "motif":
            chanter(kalimba, t0, m, ancre, 0, 56, souffle)

        if sec["verres"]:
            # Étincelles : une ou deux notes tout en haut, qui sonnent longtemps.
            aigus = [t for t in (n + 24 for n in tons) if 69 <= t <= 93]
            aigus = [t for t in aigus if (t - midi("F4")) % 12 in (0, 2, 4, 7, 9)] or aigus
            for beat in (0.5, 2.5):
                if aigus and rng.random() < sec["verres"]:
                    verres.note(humain(t0 + beat * temps, rng, True), aigus[int(rng.integers(0, len(aigus)))],
                                3.0, (44 + 12 * rng.random()) * souffle)

        if sec["contre"] and dans % 2 == 1:
            for decale in (0.0, 2.0):
                harpe.note(humain(t0 + decale * temps, rng), penta[int(rng.integers(6, 11))], 3.2,
                           36 * souffle)

    fin = duree + 9
    with tempfile.TemporaryDirectory() as dossier:
        pistes = [
            placer(rendre(piano, "piano", fin, dossier), -0.06, 1.00),
            placer(rendre(harpe, "harpe", fin, dossier), 0.30, 0.55),
            placer(rendre(hang, "hang", fin, dossier), -0.28, 0.45),
            placer(rendre(kalimba, "kalimba", fin, dossier), 0.18, 0.62),
            placer(rendre(verres, "verres", fin, dossier), -0.36, 0.40),
        ]
    n = max(p.shape[1] for p in pistes)
    mix = sum(np.pad(p, ((0, 0), (0, n - p.shape[1]))) for p in pistes)
    return boucler(reverbe(mix, 3.4, 0.32, rng), duree), duree, rng


def finaliser(x, rng, crete=0.63):
    """
    Plus léger que celui de music.py : les échantillons ont déjà leur propre
    couleur, on ne fait que nettoyer l'infra-grave, adoucir à peine l'extrême
    aigu et poser un pleurage presque imperceptible.

    PAS de souffle de pièce : music.py en ajoute pour masquer le silence
    numérique de ses oscillateurs, mais ici les instruments sont de vrais
    enregistrements, et FluidSynth les rend à un niveau bas — la normalisation
    qui suit montait ce souffle d'une vingtaine de dB, en un bruit de fond
    nettement audible (playtest, 2026-10-05).
    """
    x = passe_haut(x, 30)
    x = x - 0.15 * passe_haut(x, 6000)
    x = pleurage(x, cents=1.2, rng=rng)
    # Limiteur doux : les crêtes des frappes de hang s'arrondissent, le reste
    # monte au niveau de « Verrière » — sans lui, le morceau sonnait 3 dB plus
    # bas en jeu que l'ancien.
    pic = np.abs(x).max()
    if pic > 0:
        x = x / pic * 1.45
    return np.tanh(x) / np.tanh(1.45) * crete


# --------------------------------------------------------------------------
# Sons de sortie des blocs
# --------------------------------------------------------------------------

# Fa majeur pentatonique, de fa4 à fa5 : la gamme du chant de « Jardin », donc
# chaque sortie tombe juste sur la musique. Les degrés 3, 4 et 6 (la, do, fa),
# que joue l'arpège de victoire (AudioManager.victory), forment l'accord de fa.
ECHELLE_SORTIE = ["F4", "G4", "A4", "C5", "D5", "F5"]


def son_sortie(degre, dossier):
    """
    Une note de kalimba, pincée franchement. Comme pour les carillons de
    music.py : traîne coupée à 1,2 s (deux sorties rapprochées ne doivent pas
    s'empiler) et sonie égalisée sur l'attaque, pas sur la crête — sinon les
    degrés aigus paraissent plus forts que les graves.
    """
    rng = np.random.default_rng(7000 + degre)
    p = Partie()
    p.note(0.0, midi(ECHELLE_SORTIE[degre]), 1.1, 92)
    sec = rendre(p, "kalimba", 2.0, dossier)
    stereo = reverbe(sec, 0.8, 0.22, rng)
    stereo = passe_haut(stereo, 70)
    stereo = stereo[:, : int(1.2 * SR)]
    fondu = int(0.15 * SR)
    stereo[:, -fondu:] *= np.linspace(1, 0, fondu) ** 1.6
    debut = stereo[:, : int(0.25 * SR)]
    rms = np.sqrt((debut ** 2).mean())
    if rms > 0:
        stereo = stereo * (0.20 / rms)
    crete = np.abs(stereo).max()
    if crete > 0.92:
        stereo = stereo / crete * 0.92
    return stereo


def rendre_sons(vers, ffmpeg, demo=True):
    """
    Les six sons, plus — pour écouter avant de remplacer — une démo : une série
    qui monte et redescend, puis la victoire. Pas de démo dans audio/ : tout ce
    dossier est embarqué dans l'application.
    """
    import soundfile as sf
    vers.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as dossier:
        sons = [son_sortie(d, dossier) for d in range(len(ECHELLE_SORTIE))]
    for d, son in enumerate(sons):
        wav = vers / f"sfx-sortie-{d + 1}.wav"
        sf.write(wav, son.T, SR, subtype="PCM_16")
        if ffmpeg:
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav),
                            "-codec:a", "libmp3lame", "-b:a", "96k", str(wav.with_suffix(".mp3"))], check=True)
            wav.unlink()
        print(f"sortie {d + 1}  {ECHELLE_SORTIE[d]:3s} -> {vers.name}/sfx-sortie-{d + 1}.mp3")

    if not demo:
        return
    # Démo : neuf sorties en chaîne (même motif que runDegree), une pause, la victoire.
    demo = np.zeros((2, int(7.5 * SR)))
    def poser(son, t, gain=1.0):
        i = int(t * SR)
        fin = min(demo.shape[1], i + son.shape[1])
        demo[:, i:fin] += son[:, : fin - i] * gain
    periode = 2 * (len(sons) - 1)
    for k in range(9):
        pas = k % periode
        poser(sons[pas if pas < len(sons) else periode - pas], 0.2 + k * 0.42)
    for i, d in enumerate((2, 3, 5)):
        poser(sons[d], 5.0 + i * 0.13, 0.9 - 0.1 * i)
    demo = demo / max(1.0, np.abs(demo).max() / 0.95)
    wav = vers / "demo-sorties.wav"
    sf.write(wav, demo.T, SR, subtype="PCM_16")
    if ffmpeg:
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav),
                        "-codec:a", "libmp3lame", "-b:a", "128k", str(wav.with_suffix(".mp3"))], check=True)
        wav.unlink()
    print(f"démo      -> {vers.name}/demo-sorties.mp3")


MORCEAUX = {
    "4-jardin": ("Jardin", morceau_jardin, "piano · harpe · hang · kalimba · verres"),
}


def main():
    import soundfile as sf

    if not shutil.which("fluidsynth"):
        sys.exit("fluidsynth introuvable : brew install fluidsynth")
    manquantes = [str(p) for p in SF2.values() if not p.exists()]
    if manquantes:
        sys.exit("banques manquantes (voir la docstring) :\n  " + "\n  ".join(manquantes))

    ffmpeg = shutil.which("ffmpeg")
    args = sys.argv[1:]
    # `sons [dossier]` : les sons de sortie, dans audio/ ou dans le dossier
    # donné (pour écouter avant de remplacer ceux du jeu).
    if args and args[0] == "sons":
        vers = Path(args[1]).resolve() if len(args) > 1 else SORTIE
        rendre_sons(vers, ffmpeg, demo=vers != SORTIE)
        return
    for slug in args or list(MORCEAUX):
        if slug not in MORCEAUX:
            print(f"inconnu : {slug} (disponibles : {', '.join(MORCEAUX)})")
            continue
        titre, faire, note = MORCEAUX[slug]
        audio, duree, rng = faire()
        audio = finaliser(audio, rng)
        wav = SORTIE / f"{slug}.wav"
        sf.write(wav, audio.T, SR, subtype="PCM_16")
        ligne = f"{titre:10s} {duree:5.1f}s  {note}  ->  {wav.name}"
        if ffmpeg:
            mp3 = SORTIE / f"{slug}.mp3"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav),
                            "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)], check=True)
            wav.unlink()
            ligne = ligne.replace(wav.name, f"{mp3.name} ({mp3.stat().st_size / 1024:.0f} Ko)")
        print(ligne)


if __name__ == "__main__":
    main()
