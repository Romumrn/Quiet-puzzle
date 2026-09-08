# Les trente mondes, dans l'ordre de la carte.
#
# La couleur change A CHAQUE monde, sur un cycle court de dix teintes :
# rose, violet, bleu, bleu ciel, vert, jaune, doré, orange, rouge, blanc.
# Trente mondes font donc exactement trois tours, et le trentième (blanc)
# revient naturellement sur le rose du premier.
#
# Colonnes : clé, nom affiché, sujet à dessiner, palette des fleurs,
#            puis (couleur du papier en RVB, teinte HSL du monde).
#
# L'ordre de cette table est celui de `REALMS` dans src/core/levels.js et celui
# des règles `.realm:nth-child()` dans styles/main.css : les trois doivent
# rester alignés.

# Chaque teinte porte son papier (RVB) et son angle HSL. L'angle alimente `--h`
# dans REALMS : sans lui, un monde vert garderait le halo rose de l'ancienne
# organisation. Il ne touche pas aux couleurs des blocs, qui viennent de
# `palette` et restent inchangées.
ROSE   = ((248, 234, 238), 345)
VIOLET = ((240, 232, 246), 275)
BLEU   = ((228, 233, 246), 225)
CIEL   = ((226, 239, 247), 200)
VERT   = ((230, 242, 233), 145)
JAUNE  = ((247, 243, 219),  55)
DORE   = ((246, 236, 214),  40)
ORANGE = ((250, 232, 218),  25)
ROUGE  = ((250, 230, 228),   5)
BLANC  = ((246, 242, 236),  30)

MONDES = [
    # — premier tour —
    ("01", "Peaceful Sakura", "small soft pink sakura blossoms",              "dusty pink and blush pastel colours",        ROSE),
    ("02", "Wisteria Veil",   "long hanging wisteria clusters in pale mauve", "soft mauve and lavender pastel colours",     VIOLET),
    ("03", "Blue Lys",        "small pale blue lily flowers",                "powder blue and periwinkle pastel colours",  BLEU),
    ("04", "Forget Me Not",   "tiny pale sky blue forget me not flowers",    "pale sky blue pastel colours",               CIEL),
    ("05", "Eucalyptus Calm", "small round sage eucalyptus leaves",          "soft sage green pastel colours",             VERT),
    ("06", "Mimosa Sun",      "tiny round fluffy yellow mimosa flowers",     "mimosa yellow and pale wheat pastel colours",JAUNE),
    ("07", "Golden Ginkgo",   "small golden fan shaped ginkgo leaves",       "warm gold and pale amber pastel colours",    DORE),
    ("08", "Autumn Elm",      "small orange elm leaves",                     "soft orange and terracotta pastel colours",  ORANGE),
    ("09", "Winter Maple",    "small red maple leaves",                      "muted crimson and dusty rose pastel colours",ROUGE),
    ("10", "Apple Blossom",   "small white apple blossoms with pale hearts", "creamy white and soft blush pastel colours", BLANC),
    # — deuxième tour —
    ("11", "Quiet Camellia",  "small pink camellia flowers",                 "soft rose and powder pink pastel colours",   ROSE),
    ("12", "Lilac Drift",     "small lilac flower clusters",                 "soft lilac pastel colours",                  VIOLET),
    ("13", "Cornflower Blue", "small blue cornflowers",                      "cornflower blue pastel colours",             BLEU),
    ("14", "Morning Glory",   "small pale blue morning glory flowers",       "soft sky blue pastel colours",               CIEL),
    ("15", "Sage Fern",       "small delicate fern fronds",                  "pale sage and celadon pastel colours",       VERT),
    ("16", "Honey Acacia",    "small honey yellow acacia flowers",           "honey yellow and cream pastel colours",      JAUNE),
    ("17", "Amber Birch",     "small amber birch leaves",                    "amber and pale wheat pastel colours",        DORE),
    ("18", "Apricot Branch",  "small apricot coloured leaves",               "soft apricot pastel colours",                ORANGE),
    ("19", "Red Berry",       "tiny red berries on bare twigs",              "soft red and pale rose pastel colours",      ROUGE),
    ("20", "Snow Willow",     "slender willow twigs under soft snow",        "white and pale blue grey pastel colours",    BLANC),
    # — troisième tour —
    ("21", "Blush Plum",      "small deep pink plum blossoms",               "deep blush pink and soft rose pastel colours",ROSE),
    ("22", "Lavender Field",  "small lavender flower spikes",                "lavender and pale violet pastel colours",    VIOLET),
    ("23", "Blue Hydrangea",  "small blue hydrangea florets",                "soft blue and periwinkle pastel colours",    BLEU),
    ("24", "Winter Frost",    "tiny frosted buds under light snow",          "cool pale blue and white pastel colours",    CIEL),
    ("25", "Bamboo Breeze",   "slender bamboo leaves",                       "soft bamboo green pastel colours",           VERT),
    ("26", "Yellow Broom",    "small yellow broom flowers",                  "bright pale yellow pastel colours",          JAUNE),
    ("27", "Wheat Field",     "slender golden wheat ears",                   "golden wheat and pale straw pastel colours", DORE),
    ("28", "Copper Beech",    "small copper beech leaves",                   "copper and warm orange pastel colours",      ORANGE),
    ("29", "Crimson Vine",    "small crimson vine leaves",                   "crimson and dusty red pastel colours",       ROUGE),
    ("30", "Silver Mist",     "tiny silver grey seed pods",                  "silver grey and pale pearl pastel colours",  BLANC),
]
