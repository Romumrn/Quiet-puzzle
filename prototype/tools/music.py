#!/usr/bin/env python3
"""
Générateur de musique d'ambiance — `python3 tools/music.py [morceau...]`

Trois morceaux ORIGINAUX dans l'esprit ambient-piano des jeux bac à sable :
lent, clairsemé, harmonie diatonique, longues résonances. Rien n'est repris
d'une œuvre existante ; la variation vient d'un tirage seedé, donc un même seed
redonne exactement le même morceau.

Tout est synthétisé avec numpy : pas de MIDI, donc pas de synthé externe, et un
contrôle total du timbre.

CE QUI REND UN SON « SYNTHÉTIQUE », ET CE QU'ON FAIT CONTRE
-----------------------------------------------------------
Un rendu par oscillateurs sonne artificiel pour des raisons identifiables. Ce
fichier les traite une par une, et c'est l'accumulation qui fait le naturel :

1. Timing trop droit      -> micro-décalages de quelques millisecondes, et un
                             léger retard sur les temps faibles.
2. Nuances plates         -> accentuation des temps forts, phrases qui
                             retombent, respiration lente sur tout le morceau.
3. Timbre figé            -> plus une note est jouée fort, plus elle est
                             brillante ; les graves n'ont pas le même spectre
                             que les aigus.
4. Justesse parfaite      -> désaccord d'unisson (2 à 3 cordes par note, d'où
                             des battements lents), plus l'étirement d'octave
                             réel des pianos.
5. Attaque propre         -> bruit de marteau, et bruit mécanique de came sur
                             la boîte à musique.
6. Espace uniforme        -> premières réflexions discrètes AVANT la traîne
                             diffuse, comme dans une vraie pièce.
7. Silence numérique      -> souffle de pièce très faible, en permanence.
8. Hauteur immobile       -> pleurage : dérive lente de la hauteur, de l'ordre
                             de deux centièmes de ton, comme une bande magnétique.

Chaque morceau boucle sans couture : la traîne de réverbération qui dépasse la
fin est repliée sur le début.

Sortie : WAV 44,1 kHz stéréo, puis MP3 si ffmpeg est présent.
"""

import subprocess
import shutil
import sys
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve, lfilter

SR = 44100
SORTIE = Path(__file__).resolve().parent.parent / "audio"

# --------------------------------------------------------------------------
# Hauteurs
# --------------------------------------------------------------------------

NOMS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def demi_tons(note: str) -> float:
    lettre, reste = note[0].upper(), note[1:]
    d = NOMS[lettre]
    while reste and reste[0] in "#b":
        d += 1 if reste[0] == "#" else -1
        reste = reste[1:]
    return d + 12 * (int(reste) - 4) - 9


def freq(note: str, transposition: float = 0.0) -> float:
    return 440.0 * 2 ** ((demi_tons(note) + transposition) / 12)


def etirement(f: float) -> float:
    """
    Étirement d'octave. Un piano n'est jamais accordé « juste » : à cause de la
    raideur des cordes, l'accordeur étire les aigus vers le haut et les graves
    vers le bas. Sans cela, l'ensemble sonne électronique.
    """
    octaves = np.log2(f / 261.63)
    cents = 2.6 * octaves * abs(octaves)
    return f * 2 ** (cents / 1200)


# --------------------------------------------------------------------------
# Filtres
# --------------------------------------------------------------------------

def passe_bas(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1.0, -a], x, axis=-1)


def passe_haut(x, fc):
    return x - passe_bas(x, fc)


# --------------------------------------------------------------------------
# Timbres
# --------------------------------------------------------------------------

def _enveloppe(n, attaque, chute, maintien=0.0):
    t = np.arange(n) / SR
    att = np.clip(t / max(attaque, 1e-4), 0, 1) ** 0.55
    dec = np.exp(-t / chute) * (1 - maintien) + maintien
    fin = np.clip((n - np.arange(n)) / (0.06 * SR), 0, 1)
    return att * dec * fin


def piano(f, duree, force=1.0, rng=None):
    """
    Piano feutré. Trois cordes par note, très légèrement désaccordées : ce sont
    leurs battements lents qui donnent l'épaisseur d'un instrument réel. La
    brillance suit la nuance — une note douce est aussi une note sourde.
    """
    rng = rng or np.random.default_rng()
    n = int(duree * SR)
    t = np.arange(n) / SR
    f = etirement(f)
    brillance = 0.55 + 0.75 * float(np.clip(force, 0, 1))
    son = np.zeros(n)

    cordes = ((-1.7 + rng.normal(0, 0.4), 0.82),
              (0.0, 1.0),
              (2.1 + rng.normal(0, 0.4), 0.78))
    n_harm = int(np.clip(15 * brillance, 5, 16))

    for cents, poids in cordes:
        fc = f * 2 ** (cents / 1200)
        for h in range(1, n_harm + 1):
            inharm = 1 + 0.00040 * h * h          # raideur de la corde
            amp = poids * force / h ** (1.72 - 0.38 * brillance)
            chute = 3.0 / (1 + 0.28 * h)          # les aiguës s'éteignent d'abord
            son += amp * np.sin(2 * np.pi * fc * h * inharm * t
                                + rng.uniform(0, 2 * np.pi)) * np.exp(-t / chute)

    marteau = rng.normal(0, 1, n) * np.exp(-t / 0.010)
    marteau = passe_bas(marteau, 1400 + 2600 * brillance) * 0.09 * force
    son = son / 2.6 + marteau
    son = passe_bas(son, 3900 + 6200 * brillance)  # feutre du marteau
    return son * _enveloppe(n, 0.007, 2.4)


def boite_a_musique(f, duree, force=1.0, rng=None, battements=True):
    """
    Boîte à musique / célesta. Deux points la rendent crédible : le bruit sec de
    la came qui pince la lame, et les partiels dédoublés à quelques centièmes de
    ton, qui battent lentement au lieu de tenir une hauteur figée.

    `battements=False` supprime ce dédoublement et aligne les phases. Réservé
    aux effets sonores : dans un son d'une seconde et demie, le battement
    déplace le maximum d'amplitude de plusieurs centaines de millisecondes et
    rend la sonie imprévisible d'un son à l'autre. Ce qui donne de la vie à une
    note tenue nuit à un signal de validation, qui doit frapper net et toujours
    de la même façon.
    """
    rng = rng or np.random.default_rng()
    n = int(duree * SR)
    t = np.arange(n) / SR
    f = etirement(f)
    if battements:
        f *= 2 ** (rng.normal(0, 2.5) / 1200)   # jamais deux fois pareil
    son = np.zeros(n)

    for ratio, amp, chute in ((1.0, 1.0, 3.4), (2.01, 0.42, 2.1),
                              (2.76, 0.22, 1.5), (5.06, 0.15, 0.9),
                              (7.71, 0.06, 0.45)):
        if not battements:
            son += amp * force * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / chute)
            continue
        for battement in (-1.0, 1.0):
            fb = f * ratio * 2 ** (battement * rng.uniform(0.6, 1.8) / 1200)
            son += amp * force * 0.5 * np.sin(2 * np.pi * fb * t
                                              + rng.uniform(0, 2 * np.pi)) * np.exp(-t / chute)

    came = rng.normal(0, 1, n) * np.exp(-t / 0.006)
    came = passe_haut(passe_bas(came, 8500), 900) * 0.20 * force
    return (son + came) * _enveloppe(n, 0.003, 3.2)


def nappe(f, duree, force=1.0, rng=None):
    """Nappe chaude : voix désaccordées, attaque lente, hauteur qui respire."""
    rng = rng or np.random.default_rng()
    n = int(duree * SR)
    t = np.arange(n) / SR
    son = np.zeros(n)
    for detune, poids in ((0.9965, 0.5), (1.0, 1.0), (1.0042, 0.5)):
        derive = 1 + 0.0015 * np.sin(2 * np.pi * rng.uniform(0.05, 0.11) * t + rng.uniform(0, 6))
        for h, ah in ((1, 1.0), (2, 0.16), (3, 0.05)):
            son += poids * ah * np.sin(2 * np.pi * f * h * detune * derive * t
                                       + rng.uniform(0, 6))
    son = passe_bas(son / 6.0, 2600)
    respiration = 1 + 0.14 * np.sin(2 * np.pi * 0.063 * t + rng.uniform(0, 6))
    return son * force * _enveloppe(n, 1.8, 10.0, maintien=0.58) * respiration


# --------------------------------------------------------------------------
# Espace et support
# --------------------------------------------------------------------------

def reverbe(stereo, duree=3.4, melange=0.40, rng=None):
    """
    Réverbération à deux étages : d'abord quelques réflexions DISCRETES sur les
    parois proches, puis la traîne diffuse. Une queue diffuse seule sonne comme
    un effet ; les premières réflexions sont ce qui situe l'instrument dans une
    pièce.
    """
    rng = rng or np.random.default_rng()
    n = int(duree * SR)
    t = np.arange(n) / SR

    ir = np.zeros((2, n))
    for retard_ms, gain in ((11, 0.55), (17, 0.42), (23, 0.36),
                            (31, 0.28), (43, 0.22), (57, 0.16)):
        for c in range(2):
            i = int((retard_ms + rng.uniform(-2.5, 2.5)) * SR / 1000)
            ir[c, i] += gain * rng.uniform(0.8, 1.0)

    # Les deux canaux partagent une base commune : deux bruits totalement
    # décorrélés donnent une image très large, mais qui s'effondre dès que le
    # signal est sommé en mono — le cas d'un haut-parleur de téléphone.
    commun = rng.normal(0, 1, n)
    for c in range(2):
        propre = rng.normal(0, 1, n)
        ir[c] += (0.72 * commun + 0.55 * propre) * np.exp(-t * 3.8) * (1 - np.exp(-t * 70))
    ir = passe_bas(ir, 3800)          # une pièce absorbe surtout les aigus

    # Normalisation par l'ENERGIE, pas par la crête. Une convolution somme des
    # milliers d'échantillons : avec une réponse normalisée en crête, le signal
    # réverbéré ressortait bien plus fort que le signal direct, si bien que
    # « 22 % de mouillé » en donnait en réalité l'essentiel. L'enveloppe des
    # sons courts montait alors au lieu de décroître.
    energie = np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    ir /= np.maximum(energie, 1e-9)

    mouille = np.stack([fftconvolve(stereo[c], ir[c])[: stereo.shape[1] + n] for c in range(2)])
    sec = np.pad(stereo, ((0, 0), (0, mouille.shape[1] - stereo.shape[1])))
    return sec * (1 - melange) + mouille * melange * 0.95


def souffle_de_piece(n, rng, niveau=0.0012):
    """
    Le silence absolu n'existe pas dans un enregistrement. Ici non plus.

    Le souffle monte jusqu'à 9 kHz : coupé trop bas, il ne remplit que le
    medium et laisse le haut du spectre totalement vide, ce qui s'entend comme
    un voile sur l'ensemble.
    """
    b = rng.normal(0, 1, (2, n))
    return passe_haut(passe_bas(b, 6500), 55) * niveau


def pleurage(x, cents=2.0, taux=0.55, rng=None):
    """
    Pleurage : la hauteur dérive lentement de deux centièmes de ton, comme sur
    une bande. C'est infime et c'est pourtant ce qui fait basculer l'oreille du
    côté « enregistré » plutôt que « calculé ».
    """
    rng = rng or np.random.default_rng()
    n = x.shape[1]
    t = np.arange(n) / SR
    lfo = (np.sin(2 * np.pi * taux * t + rng.uniform(0, 6))
           + 0.6 * np.sin(2 * np.pi * taux * 0.37 * t + rng.uniform(0, 6))) / 1.6
    pos = np.cumsum(2 ** (cents * lfo / 1200))
    pos = np.clip(pos - pos[0], 0, n - 2)
    idx = np.arange(n)
    return np.stack([np.interp(pos, idx, x[c]) for c in range(2)])


# --------------------------------------------------------------------------
# Assemblage
# --------------------------------------------------------------------------

class Piste:
    """Mixage, avec un cache de notes : sans lui le rendu prendrait des minutes."""

    def __init__(self, duree, rng):
        self.buf = np.zeros((2, int(duree * SR) + SR * 7))
        self.rng = rng
        self._cache = {}

    def _note(self, instrument, f, duree, force, variante):
        cle = (instrument.__name__, round(f, 2), round(duree, 2), round(force, 1), variante)
        if cle not in self._cache:
            self._cache[cle] = instrument(f, duree, force, self.rng)
        return self._cache[cle]

    def jouer(self, instant, instrument, f, duree, force, pan=0.0, gain=1.0):
        # Trois rendus différents par note : la même touche n'est jamais
        # exactement le même son.
        mono = self._note(instrument, f, duree, force, int(self.rng.integers(0, 3)))
        i = max(0, int(instant * SR))
        g = float(np.clip(gain, 0, 4))
        gl, gr = np.sqrt(0.5 * (1 - pan)) * g, np.sqrt(0.5 * (1 + pan)) * g
        fin = min(i + len(mono), self.buf.shape[1])
        n = fin - i
        if n > 0:
            self.buf[0, i:fin] += mono[:n] * gl
            self.buf[1, i:fin] += mono[:n] * gr


def boucler(x, duree, fondu=2.6):
    n = int(duree * SR)
    corps = np.copy(x[:, :n])
    traine = x[:, n:]
    k = min(traine.shape[1], n)
    corps[:, :k] += traine[:, :k]
    f = int(fondu * SR)
    corps[:, :f] *= np.linspace(0.4, 1.0, f)
    corps[:, -f:] *= np.linspace(1.0, 0.6, f)
    return corps


def finaliser(x, rng, cible=0.72):
    x = passe_haut(x, 32)                  # on nettoie l'infra-grave, pas le grave
    x = x - 0.30 * passe_haut(x, 3500)     # basculement doux : on adoucit sans étouffer
    x = x + souffle_de_piece(x.shape[1], rng)
    x = pleurage(x, rng=rng)
    crete = np.abs(x).max()
    if crete > 0:
        x = x / crete * cible
    return np.tanh(x * 1.2) * 0.88


# --------------------------------------------------------------------------
# Phrasé
# --------------------------------------------------------------------------

def humaniser(instant, rng, temps, faible=False):
    """Micro-décalage. Les temps faibles arrivent un cheveu en retard."""
    return instant + rng.normal(0, 0.011) + (0.014 if faible else 0.0)


def respiration(m, mesures):
    """Nuance d'ensemble : le morceau enfle puis retombe, très lentement."""
    return 0.86 + 0.14 * np.sin(np.pi * m / max(1, mesures - 1))


# --------------------------------------------------------------------------
# Les morceaux
# --------------------------------------------------------------------------

def morceau_aube():
    """« Aube » — Fa majeur lydien, 72 BPM. Arpèges qui montent, lumineux."""
    rng = np.random.default_rng(20260904)
    bpm, mesures, transp = 72, 24, 0.0
    temps = 60 / bpm
    duree = mesures * 4 * temps

    accords = [
        (["F2", "F3", "A3", "C4", "E4"], ["F4", "A4", "C5", "E5"]),
        (["C2", "C3", "G3", "D4", "E4"], ["G4", "C5", "D5", "E5"]),
        (["D2", "D3", "A3", "C4", "F4"], ["F4", "A4", "C5", "D5"]),
        (["Bb1", "Bb2", "F3", "A3", "D4"], ["F4", "A4", "D5", "F5"]),
    ]
    p = Piste(duree + 7, rng)

    for m in range(mesures):
        t0 = m * 4 * temps
        graves, aigus = accords[m % 4]
        souffle = respiration(m, mesures)

        for note in graves[:2]:
            p.jouer(t0, nappe, freq(note, transp), 4 * temps + 2.0, 0.30, gain=0.85 * souffle)

        for pas in range(8):
            if (m % 4 == 3 and pas >= 6) or rng.random() < 0.22:
                continue
            note = aigus[pas % len(aigus)] if pas % 2 == 0 else graves[2 + pas % 3]
            f = freq(note, transp)
            force = (0.5 + 0.2 * rng.random() + (0.16 if pas == 0 else 0)) * souffle
            pan = float(np.clip(np.log2(f / 261.6) * 0.22, -0.4, 0.4))
            p.jouer(humaniser(t0 + pas * temps / 2, rng, temps, pas % 2 == 1),
                    piano, f, 3.4, force, pan=pan, gain=0.6)

        if m % 2 == 1:
            note = aigus[-1] if rng.random() < 0.5 else aigus[-2]
            p.jouer(humaniser(t0 + 2 * temps, rng, temps), piano,
                    freq(note, transp), 4.5, 0.42 * souffle, pan=0.15, gain=0.5)

    return boucler(reverbe(p.buf, 3.4, 0.66, rng), duree), duree, rng


def morceau_derive():
    """« Dérive » — La mineur, 60 BPM. Motif descendant, très clairsemé."""
    rng = np.random.default_rng(77113)
    bpm, mesures, transp = 60, 20, 0.0
    temps = 60 / bpm
    duree = mesures * 4 * temps

    accords = [
        (["A1", "A2", "E3", "G3"], ["C5", "B4", "A4", "E4"]),
        (["F1", "F2", "C3", "E3"], ["A4", "G4", "F4", "C4"]),
        (["C2", "C3", "G3", "B3"], ["E5", "D5", "C5", "G4"]),
        (["G1", "G2", "D3", "A3"], ["D5", "B4", "A4", "G4"]),
    ]
    p = Piste(duree + 9, rng)

    for m in range(mesures):
        t0 = m * 4 * temps
        graves, chute = accords[m % 4]
        souffle = respiration(m, mesures)

        for note in graves[:2]:
            p.jouer(t0, nappe, freq(note, transp), 4 * temps + 3.0, 0.34, gain=0.9 * souffle)

        instant = t0 + (0.0 if m % 2 == 0 else temps)
        for k, note in enumerate(chute):
            if rng.random() < 0.18:
                instant += temps
                continue
            f = freq(note, transp)
            force = (0.52 - 0.06 * k + 0.12 * rng.random()) * souffle
            pan = float(np.clip(0.3 - 0.16 * k, -0.4, 0.4))
            p.jouer(humaniser(instant, rng, temps), piano, f, 5.0, force, pan=pan, gain=0.62)
            instant += temps * (1.0 if rng.random() < 0.65 else 1.5)

        if m % 4 == 2:
            p.jouer(humaniser(t0 + 3 * temps, rng, temps), piano,
                    freq(graves[1], transp), 5.5, 0.3 * souffle, gain=0.45)

    return boucler(reverbe(p.buf, 4.6, 0.74, rng), duree), duree, rng


def morceau_verriere():
    """
    « Verrière » — pentatonique, 59 BPM.

    Le morceau est bâti en CINQ SECTIONS de cinq mesures, soit une bascule
    toutes les vingt secondes environ. Chacune retire ou ajoute quelque chose
    plutôt que de broder sur la précédente : c'est le contraste qui s'entend,
    pas l'ornement.

        A  0-20 s   boîte à musique seule sur la nappe — on installe
        B  20-41 s  le piano entre dans le medium, la nappe s'ouvre à la quinte
        C  41-61 s  la boîte descend d'une octave, la couleur harmonique tourne
        D  61-81 s  la boîte se tait : respiration, piano nu
        E  81-102 s retour au complet, avec un contrechant dans l'aigu

    La section D est la plus importante : sans un moment de vide, les quatre
    autres ne s'entendent pas comme des changements.

    Registre descendu d'une tierce mineure : la mélodie vivait entre do5 et la5,
    un aigu qui devient vite perçant sur une écoute longue.
    """
    rng = np.random.default_rng(4242)
    bpm = 84 * 0.7                    # 30 % plus lent : 59 BPM
    transp = -3.0                     # descente d'une tierce mineure
    temps = 60 / bpm
    par_section = 5

    sections = [
        dict(piano=False, boite=True,  octave=0,   repos=0.34, quinte=False, contre=False, gain=0.82),
        dict(piano=True,  boite=True,  octave=0,   repos=0.26, quinte=True,  contre=False, gain=1.00),
        dict(piano=True,  boite=True,  octave=-12, repos=0.20, quinte=True,  contre=False, gain=1.00, tourne=2),
        dict(piano=True,  boite=False, octave=0,   repos=0.50, quinte=False, contre=False, gain=0.78),
        dict(piano=True,  boite=True,  octave=0,   repos=0.18, quinte=True,  contre=True,  gain=1.04, tourne=1),
    ]
    mesures = len(sections) * par_section
    duree = mesures * 4 * temps

    accords = [
        (["C2", "G2", "E3"], ["G5", "E5", "D5", "C5", "A4"]),   # Cadd9
        (["A1", "E2", "C3"], ["E5", "C5", "A4", "G4", "E4"]),   # Am7
        (["F1", "C2", "A2"], ["A5", "F5", "E5", "C5", "A4"]),   # Fmaj7
        (["G1", "D2", "B2"], ["D5", "B4", "G4", "E5", "D5"]),   # G6
    ]
    p = Piste(duree + 8, rng)

    for m in range(mesures):
        sec = sections[m // par_section]
        dans_section = m % par_section
        t0 = m * 4 * temps
        graves, cristal = accords[(m + sec.get("tourne", 0)) % 4]
        souffle = respiration(m, mesures) * sec["gain"]

        # Nappe : la quinte n'est là que dans les sections pleines.
        p.jouer(t0, nappe, freq(graves[0], transp), 4 * temps + 2.5, 0.28, gain=0.85 * souffle)
        if sec["quinte"]:
            p.jouer(t0, nappe, freq(graves[1], transp), 4 * temps + 2.5, 0.20, gain=0.72 * souffle)

        # Première mesure d'une section : une basse marque la bascule, pour que
        # le changement se lise comme voulu et non comme un accident.
        if dans_section == 0:
            p.jouer(t0, piano, freq(graves[0], transp - 12), 5.5, 0.34 * souffle, gain=0.5)

        if sec["piano"]:
            for beat in range(4):
                if rng.random() < 0.26:
                    continue
                note = graves[2] if beat % 2 == 0 else cristal[-1]
                force = (0.40 if beat == 0 else 0.30) * souffle + 0.06 * rng.random()
                p.jouer(humaniser(t0 + beat * temps, rng, temps, beat % 2 == 1),
                        piano, freq(note, transp), 3.4, force, pan=-0.08, gain=0.52)

        if sec["boite"]:
            instant = t0
            i = int(rng.integers(0, len(cristal)))
            while instant < t0 + 4 * temps:
                if rng.random() < sec["repos"]:
                    instant += temps / 2
                    continue
                f = freq(cristal[i % len(cristal)], transp + sec["octave"])
                force = (0.32 + 0.12 * rng.random()) * souffle
                pan = float(np.clip(np.log2(f / 440.0) * 0.32 + rng.uniform(-0.09, 0.09), -0.38, 0.38))
                p.jouer(humaniser(instant, rng, temps, True),
                        boite_a_musique, f, 3.8, force, pan=pan, gain=0.46)
                i += int(rng.integers(1, 3)) * (1 if rng.random() < 0.6 else -1)
                instant += temps / 2 * (1 if rng.random() < 0.7 else 2)

        # Contrechant : une ligne lente dans l'aigu, deux notes par mesure.
        if sec["contre"] and dans_section % 2 == 1:
            for k, decalage in enumerate((0.0, 2.0)):
                note = cristal[(dans_section + k) % len(cristal)]
                p.jouer(humaniser(t0 + decalage * temps, rng, temps),
                        boite_a_musique, freq(note, transp + 12), 4.2,
                        0.16 * souffle, pan=0.26, gain=0.34)

    # Au ralenti, les notes se croisent moins : on allonge la pièce pour que la
    # résonance tienne le silence entre elles.
    return boucler(reverbe(p.buf, 4.4, 0.72, rng), duree), duree, rng


# --------------------------------------------------------------------------
# Effets sonores
# --------------------------------------------------------------------------

def carillon(f, force=1.0, duree=1.0, rng=None):
    """
    Timbre dédié aux effets : même famille que la boîte à musique, mais avec sa
    propre décroissance.

    Réutiliser tel quel le timbre de la musique ne marchait pas. Ses partiels
    tiennent plus de trois secondes, ce qui est exactement ce qu'on veut pour
    une note tenue et exactement ce qu'on ne veut pas pour une validation : le
    son ne s'éteignait pas, il se faisait couper par la fin du fichier, et deux
    sorties rapprochées s'empilaient.
    """
    rng = rng or np.random.default_rng()
    n = int(duree * SR)
    t = np.arange(n) / SR
    f = etirement(f)
    son = np.zeros(n)
    for ratio, amp, chute in ((1.0, 1.0, 0.72), (2.01, 0.40, 0.42),
                              (2.76, 0.18, 0.26), (5.06, 0.09, 0.15)):
        son += amp * force * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / chute)

    came = rng.normal(0, 1, n) * np.exp(-t / 0.005)
    came = passe_haut(passe_bas(came, 9000), 1200) * 0.22 * force

    env = np.clip(t / 0.002, 0, 1) ** 0.5 * np.clip((n - np.arange(n)) / (0.04 * SR), 0, 1)
    return (son + came) * env


def sfx_sortie(degre: int):
    """
    Validation quand un bloc quitte la grille.

    Le son MONTE d'un degré à chaque bloc sorti d'affilée, sur la pentatonique
    du morceau, et revient au premier degré après une pause. Un son unique
    répété devient vite lassant, alors qu'une suite qui monte transforme un
    enchaînement en progression : c'est la récompense qui s'entend, pas
    seulement l'action.
    """
    rng = np.random.default_rng(9000 + degre)
    echelle = ["C5", "D5", "E5", "G5", "A5", "C6"]
    transp = -3.0                    # même transposition que « Verrière »
    f = freq(echelle[degre % len(echelle)], transp)

    duree = 1.05
    n = int(duree * SR)
    corps = np.zeros(n)

    note = carillon(f, 0.9, duree, rng)
    corps += note[:n]

    # Paillette à l'octave, en retrait et très légèrement en retard : elle donne
    # le côté cristallin sans rendre le son agressif.
    paillette = carillon(f * 2, 0.16, duree * 0.5, rng)
    d = int(0.028 * SR)
    fin = min(n, d + len(paillette))
    corps[d:fin] += paillette[: fin - d]

    stereo = reverbe(np.stack([corps, corps]), 0.7, 0.30, rng)
    stereo = passe_haut(stereo, 60)

    # On coupe la traîne : un effet de jeu doit libérer la place tout de suite,
    # sinon deux sorties rapprochées s'empilent en bouillie.
    utile = int(1.2 * SR)
    stereo = stereo[:, :utile]
    fondu = int(0.12 * SR)
    stereo[:, -fondu:] *= np.linspace(1, 0, fondu) ** 1.6

    # Égalisation au niveau PERÇU, pas à la crête : normaliser sur le pic
    # laissait les six degrés à des sonies très différentes, l'aigu paraissant
    # bien plus fort que le grave à crête égale.
    debut = stereo[:, : int(0.25 * SR)]
    rms = np.sqrt((debut ** 2).mean())
    if rms > 0:
        stereo = stereo * (0.20 / rms)
    crete = np.abs(stereo).max()
    if crete > 0.92:
        stereo = stereo / crete * 0.92
    return stereo


def rendre_sfx(sf_mod, ffmpeg):
    """Six degrés : cinq marches plus l'octave, qui couronne une longue série."""
    for degre in range(6):
        audio = sfx_sortie(degre)
        nom = f"sfx-sortie-{degre + 1}"
        wav = SORTIE / f"{nom}.wav"
        sf_mod.write(wav, audio.T, SR, subtype="PCM_16")
        ligne = f"{'sortie ' + str(degre + 1):10s} {audio.shape[1] / SR:5.2f}s  degré {degre + 1}/6  ->  {wav.name}"
        if ffmpeg:
            mp3 = SORTIE / f"{nom}.mp3"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav),
                            "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3)], check=True)
            ligne += f" + {mp3.name} ({mp3.stat().st_size / 1024:.0f} Ko)"
        print(ligne)


MORCEAUX = {
    "1-aube": ("Aube", morceau_aube, "Fa majeur lydien · 72 BPM · lumineux"),
    "2-derive": ("Dérive", morceau_derive, "La mineur · 60 BPM · contemplatif"),
    "3-verriere": ("Verrière", morceau_verriere, "Sol pentatonique · 59 BPM · aérien"),
}


def main():
    import soundfile as sf

    demandes = sys.argv[1:] or (list(MORCEAUX) + ["sfx"])
    SORTIE.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")

    if "sfx" in demandes:
        rendre_sfx(sf, ffmpeg)
        demandes = [d for d in demandes if d != "sfx"]

    for slug in demandes:
        if slug not in MORCEAUX:
            print(f"inconnu : {slug} (disponibles : {', '.join(MORCEAUX)}, sfx)")
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
            ligne += f" + {mp3.name} ({mp3.stat().st_size / 1024:.0f} Ko)"
        print(ligne)


if __name__ == "__main__":
    main()
