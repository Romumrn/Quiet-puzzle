# Fiche Google Play — Quiet Puzzle

Document de préparation pour remplir la fiche store dans la Play Console. Les textes sont des propositions à ajuster, pas des textes finaux — les captures et le contenu obligatoire (politique de confidentialité, formulaire Data safety) restent à faire dans la console elle-même.

État au 2026-09-15 : `applicationId` = `com.romumrn.quietpuzzle`, version `1.0.0` (versionCode 1), 1000 niveaux répartis sur 50 mondes.

---

## 1. Identité de l'annonce

| Champ | Valeur proposée |
|---|---|
| Nom de l'application | Quiet Puzzle |
| Description courte (80 car. max) | Un puzzle de blocs apaisant, sans score ni chrono agressif. |
| Catégorie | Jeux > Puzzle |
| Coordonnées / e-mail développeur | romuald.mrn@outlook.fr |
| Site web | https://romumrn.github.io/Quiet-puzzle/ |
| Politique de confidentialité (URL) | à héberger — `prototype/privacy.html` / `docs/privacy.html` existent déjà dans le repo, il faut leur donner une URL publique stable (ex. via GitHub Pages, déjà utilisé pour `docs/`) |

## 2. Description longue (proposition, FR)

> Quiet Puzzle est un jeu de réflexion apaisant : pas de score à battre, pas d'adversaire, pas de pression de performance. Une grille, des blocs colorés, des portes sur les bords. Vous attrapez un bloc, vous le faites glisser, il sort du plateau quand il correspond à sa porte.
>
> La palette pastel évolue du rose au bleu-vert au fil de la progression. La musique d'ambiance, au piano et à la boîte à musique, change de caractère toutes les vingt secondes pour ne jamais devenir répétitive. Chaque bloc qui sort par sa porte fait sonner une note, un ton au-dessus de la précédente — une petite mélodie se construit à mesure que vous enchaînez les coups.
>
> Un chronomètre existe — un puzzle a besoin d'une contrainte — mais il est généreux, et peut être prolongé par une publicité récompensée.
>
> 50 mondes, 1000 niveaux. Chaque monde introduit une nouvelle mécanique : blocs qui glissent sur un seul axe, ancres qui n'avancent que vers leur porte, blocs scellés à contourner, verrous qui s'ouvrent après un certain nombre de sorties, blocs encombrants qui coûtent double à la porte, blocs bicolores hésitant entre deux sorties, clé qui ouvre tous les verrous à la fois, portes à capacité limitée.
>
> Disponible en français, anglais, espagnol, italien et chinois. Une option restitue les symboles de couleur d'origine pour les joueurs qui ne peuvent pas se fier uniquement à la couleur.

*(à traduire pour les fiches en, es, it, zh si vous voulez cibler ces marchés — les traductions du jeu existent déjà dans [i18n.js](../../prototype/src/ui/i18n.js))*

## 3. Visuels requis

| Asset | Format | Statut |
|---|---|---|
| Icône haute résolution | 512×512 PNG, 32 bits | à générer depuis `assets-src/*.svg` (ce dossier, voir AGENTS.md § App icon) |
| Image de présentation (feature graphic) | 1024×500 PNG/JPEG | **manquant** — rien dans `media/` à ce format, à créer |
| Captures d'écran téléphone | min. 2, max. 8, 320–3840px | `media/board.png`, `media/map.png`, `media/profile.png`, `media/editor.png`, `media/result.png`, `media/menu.png` (racine du repo, régénérées le 2026-09-15 par `node tools/captures.mjs`, état actuel de l'app) — 786×1704, ratio d'un téléphone courant ; vérifier dans la Play Console au moment de l'upload si un recadrage du bandeau gris haut/bas (safe-area non stylée en capture navigateur) est nécessaire |
| Vidéo promo (optionnel) | lien YouTube | `media/gameplay.gif` existe en local mais Play Console veut un lien YouTube, pas un fichier — à héberger si vous voulez l'utiliser |

## 4. Classification du contenu

Pas de violence, pas de contenu à caractère sexuel, pas de contenu généré par les utilisateurs visible publiquement (l'éditeur de niveaux sauvegarde en local/cloud perso, pas de partage public constaté dans le code). Le questionnaire IARC dans la Play Console devrait donner une classification "Tous publics" / PEGI 3 — à confirmer en le remplissant, ce formulaire ne se déduit pas du code.

## 5. Data safety (formulaire Play Console)

À déclarer d'après ce que le code fait réellement :

- **Comptes** : connexion Google (Sign-In natif, [loginScreen.js](../../prototype/src/ui/loginScreen.js)) — collecte email/identifiant.
- **Cloud sync** : sauvegarde de progression via Supabase — données de jeu associées au compte.
- **Publicité** : AdMob (rewarded + interstitial) — [admob.js](../../prototype/src/monetization/admob.js) — implique un identifiant publicitaire et le SDK Google Mobile Ads. Le consentement UMP/GDPR est déjà géré (`manageConsent()` accessible depuis Réglages → Publicité).
- **Achats intégrés** : ⚠️ **actuellement simulés**, aucun SDK de facturation réel n'est branché ([currency.js:100](../../prototype/src/monetization/currency.js#L100) — `buyPack()` crédite directement les pièces sans paiement). Si vous publiez tel quel, ne déclarez PAS d'achats intégrés réels dans la fiche — ou câblez Play Billing avant publication si vous comptez monétiser par IAP dès le lancement.
- **Analytics** : événements trackés en interne (`track()` dans `events.js`) — préciser où ils sont envoyés (Supabase uniquement, ou un service tiers ?) avant de remplir cette section.

## 6. Points à trancher avant soumission

1. **IAP simulé** : décider si on publie en l'état (les packs de pièces ne rapportent rien, c'est un choix produit valable pour un lancement) ou si on câble Play Billing avant. Pas bloquant pour la review Google, mais impacte la déclaration Data safety et le revenu.
2. **URL de politique de confidentialité** : `privacy.html` existe mais n'a pas d'URL publique dédiée trouvée — à publier (GitHub Pages déjà utilisé pour `docs/`, réutilisable).
3. **Feature graphic 1024×500** : à produire, rien d'existant à ce format.
4. **Bandeau gris sur les captures** : le haut/bas des 6 captures montre la safe-area non stylée (artefact de capture navigateur, invisible dans l'app réelle) — à recadrer si ça se voit trop à l'écran dans la Play Console.
5. **Interstitial AdMob** : encore l'ID de test Google ([admobConfig.js](../../prototype/src/monetization/admobConfig.js)) — sans effet pour la review Play Store, mais à changer avant de compter dessus en prod si un interstitiel est un jour affiché.
6. **Piste de sortie** : commencer par un test interne / fermé sur la Play Console plutôt qu'une prod directe, pour valider l'AAB signé sur un vrai appareil avant l'ouverture publique.
