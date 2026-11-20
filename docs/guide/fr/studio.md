---
title: Studio
section: Faire de la musique
summary: Enregistre, arrange et mixe des morceaux à plusieurs dans un salon Studio d'enregistrement, en direct ou chacun à son rythme.
source: 13ae054b4cd0
---

Un salon **Studio d'enregistrement** est un espace de travail musical dans ton serveur. Chaque **projet** est un morceau, avec son propre éditeur multipiste, ses prises, ses commentaires, ses versions et sa discussion. Les membres du groupe peuvent enregistrer ensemble en direct, ou ajouter leurs parties quand ils ont le temps.

![Un projet ouvert dans le studio](shot:studio)

## Lancer un projet

Ouvre un salon Studio d'enregistrement et clique sur **Nouveau projet**. Donne-lui un nom et un tempo. Il te faut la permission **Créer des projets**.

Tu as déjà commencé un morceau ailleurs ? **Importer** ouvre les fichiers `.dawproject` de Bitwig, Studio One, Cubase et d'autres, ainsi que les fichiers `.parley-project` de Parley.

## Enregistrer

1. Règle ton audio dans le panneau **Audio** : ta sortie et la **Latence d'enregistrement**. Clique sur **Mesurer** pour que tes prises soient bien calées sur le temps.
2. Ajoute une piste : **audio** pour un micro ou un instrument, ou **MIDI** avec un synthé, une batterie ou un sampler intégrés.
3. Arme la piste et lance l'enregistrement. **Enregistrer le groupe** enregistre tous les membres de la session depuis la tête de lecture ; **Enregistrer seul** n'enregistre que toi. Une prise peut durer jusqu'à 30 minutes.

Pas de clavier MIDI ? Joue des notes avec les touches de ton ordinateur : de <kbd>A</kbd> à <kbd>K</kbd> pour les touches blanches, et <kbd>Z</kbd> et <kbd>X</kbd> pour changer d'octave.

## Arranger et éditer

| Touches | Effet |
|---|---|
| <kbd>Space</kbd> | Lecture ou arrêt |
| <kbd>Home</kbd> | Retour au début |
| <kbd>L</kbd> | Activer ou désactiver la boucle |
| <kbd>S</kbd> | Couper le clip à la tête de lecture |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Dupliquer |
| <kbd>Q</kbd> | Quantifier (aligner les notes sur la grille) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Annuler / rétablir |
| <kbd>Tab</kbd> | Passer de l'arrangement à la table de mixage |

Double-clique sur un clip MIDI pour ouvrir le **piano roll**. Il y a aussi un métronome et un décompte, des marqueurs, des changements de tempo et des pistes d'automation pour le volume et les effets.

Dans la **table de mixage**, chaque piste a un volume, un panoramique, un solo, une coupure, des effets et des envois.

## Effets

Chaque piste, chaque bus et le master ont un rack d'effets : égaliseur, filtre, compresseur, gate, limiteur, reverb, délai, saturation et chorus. Clique sur **+ Effet** pour en ajouter un. Les effets s'appliquent de haut en bas ; survoles-en un pour le déplacer ou le retirer.

![Les fenêtres d'effet de l'égaliseur et du compresseur d'une guitare et d'un filtre de basse, ouvertes côte à côte pendant la lecture du morceau](shot:studio-effects)

Clique sur un effet pour ouvrir sa fenêtre. Tu peux ouvrir autant de fenêtres que tu veux et les placer n'importe où ; clique sur une fenêtre pour la mettre au premier plan. Chaque fenêtre montre ce que fait l'effet :

- **EQ** et **filtre** : la courbe de fréquences sur le spectre du son. Fais glisser les points de la courbe pour la modeler. Sur le filtre, fais glisser vers le haut ou le bas pour plus ou moins de résonance, ou utilise la molette.
- **Compressor**, **gate** et **limiter** : le niveau en entrée face au niveau en sortie, un point qui montre où se situe ton son en ce moment, le niveau des dernières secondes, et de combien il est réduit.
- **Reverb** : la forme de la queue. **Délai** : chaque écho qui s'estompe. **Saturation** : la courbe de distorsion, avec le son avant et après. **Chorus** : la modulation.

Pendant la lecture, les visualisations et les vumètres **Entrée** et **Sortie** bougent avec le son.

Pour changer un réglage :

- Fais glisser un bouton vers le haut ou le bas. Maintiens <kbd>Shift</kbd> pour un réglage fin.
- Utilise la molette ou les flèches du clavier.
- Tape une valeur sous le bouton, comme `2.5k` ou `25%`.
- Double-clique sur un bouton pour revenir à sa valeur par défaut.

Le bouton marche/arrêt dans la barre de titre de la fenêtre désactive et réactive l'effet. La flèche réinitialise tous ses réglages.

> Tip: Ouvre le même effet sur deux pistes côte à côte, comme l'égaliseur de la guitare et le filtre de la basse, et lance le morceau. Tu vois où chacune se place et tu peux faire de la place pour l'autre.

### Exemples

Ces exemples partent des réglages par défaut d'un effet. Lance le morceau pendant que tu travailles, idéalement avec la **Boucle** activée, pour que les fenêtres montrent ton son.

**Nettoyer le bas du spectre d'une guitare ou d'une voix.** Ajoute un **EQ**. Fais glisser le point **C** de la courbe vers la droite jusqu'à ce que **Coupe-bas** indique environ `90 Hz` ; le grondement en dessous disparaît, et le spectre derrière la courbe montre ce que tu as retiré. Fais glisser le point **M** vers environ `2.5k` et monte-le de quelques dB pour faire ressortir la partie.

**Homogénéiser une voix.** Ajoute un **Compressor**. Règle le **Ratio** sur `4:1`, puis baisse le **Seuil** en regardant le point sur la courbe : quand les mots forts dépassent le coude, le vumètre **GR** montre de combien ils sont réduits. Vise environ 3 à 6 dB sur les mots les plus forts, puis monte le **Gain de compensation** d'à peu près autant pour que la partie soit aussi forte qu'avant.

**Faire un balayage de filtre.** Ajoute un **Filter** sur une piste de synthé ou de batterie et choisis **Passe-bas**. Fais glisser lentement le point de la courbe de droite à gauche pendant la lecture : le son s'assombrit à mesure que la fréquence de coupure descend. Fais glisser le point vers le haut ou le bas, ou utilise la molette dessus, pour changer la **Résonance** : plus il y en a, plus le pic à la fréquence de coupure est marqué et sonne. Pour intégrer le balayage au morceau, enregistre-le avec une [piste d'automation](#arranging-and-editing).

**Empêcher une piste bruyante de souffler entre les notes.** Ajoute un **Gate** en premier dans le rack. Regarde le voyant : il indique **OPEN** pendant que la partie joue et **CLOSED** dans les silences. Monte le **Seuil** jusqu'à ce qu'il se ferme dans les silences tout en restant ouvert sur les notes les plus douces que tu veux garder.

**Placer une partie dans une pièce.** Ajoute une **Reverb** et règle le **Mixage** sur environ `20%`. Un **Déclin** plus long donne un espace plus grand ; une **Tonalité** plus basse assombrit la queue, qui se place alors derrière le son sec.

**Contenir les crêtes sur tout le mixage.** Ajoute un **Limiter** sur le **Master** et laisse le **Plafond** à `-1 dB`. La fenêtre montre à quelle fréquence les moments les plus forts sont retenus ; s'il travaille tout le temps, baisse plutôt les pistes.

## Travailler en groupe

- **Groupe** : chacun est **Ingénieur** (peut tout modifier) ou **Artiste** (enregistre ses propres parties). **Protéger cette piste** empêche les autres de modifier ta partie.
- **Sessions** : un ingénieur clique sur **Lancer la session** pour travailler ensemble en direct. Tout le monde entend ce que chacun joue.
- **Prises** : chaque enregistrement est conservé. Choisis la meilleure avec **Utiliser la prise**.
- **Commentaires** : laisse des notes à un moment du morceau, comme « la batterie traîne ici », et **Résous**-les une fois traitées.
- **Versions** : **Enregistrer une version** avant les gros changements, et **Restaurer** si la direction prise ne te plaît pas.

Les auditeurs qui ne font pas partie du groupe peuvent quand même écouter le morceau, suivre l'avancée et commenter.

Tu as perdu ta connexion ? Continue à travailler. Tes modifications sont enregistrées et envoyées dès que tu es de nouveau en ligne.

## Travailler ailleurs

Un projet continue de jouer, et une prise continue de s'enregistrer, quand tu vas dans une discussion ou un autre salon. Pendant ce temps, une carte au-dessus de ton nom en bas à gauche affiche le projet, s'il **Joue** ou est en **Enregistrement**, et le temps. Elle s'affiche aussi pendant que tu es dans le salon vocal du projet. Sa ligne dans la liste des salons affiche des barres qui bougent pendant la lecture et un point rouge pendant l'enregistrement.

- Clique sur le nom du projet sur la carte pour y revenir.
- Arrête ou lance la lecture depuis la carte. La lecture reprend là où tu t'étais arrêté.
- Arrête la prise depuis la carte, si tu pouvais l'arrêter dans le projet.
- Tu as fini ? Arrête-le, puis clique sur **✕** pour fermer la carte.

## Partager le résultat

Le panneau **Exporter** permet :

- d'exporter le mixage en WAV, FLAC ou MP3
- d'exporter les **stems** (chaque piste séparément, en zip)
- de **Publier le mixage dans un salon** pour que tout le monde l'écoute
- d'enregistrer le projet en `.dawproject` pour l'ouvrir dans une autre appli de musique
