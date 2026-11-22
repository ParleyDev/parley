---
title: Modération et sécurité
section: Gérer un serveur
summary: Garde ton serveur convivial avec AutoMod, les exclusions temporaires, les bannissements, les signalements, la protection anti-raid et les logs du serveur.
source: cef706ea7d87
---

## Gérer une personne

Fais un clic droit sur une personne (ou un appui long sur téléphone) pour ces options :

| Option | Ce qui se passe |
|---|---|
| **Exclure temporairement** | La personne peut lire mais ne peut ni publier, ni réagir, ni rejoindre le vocal, de 60 secondes à une semaine. **Retirer l'exclusion** y met fin plus tôt. |
| **Expulser** | La retire du serveur. Elle peut revenir avec une nouvelle invitation. |
| **Bannir** | La retire et l'empêche de revenir. Tu peux aussi supprimer ses messages des derniers jours, jusqu'à 7. |
| **Vue modérateur** | Son historique sur ton serveur : avertissements, exclusions temporaires et notes. Tu peux l'**Avertir**, ou la mettre en **Quarantaine** le temps d'examiner quelque chose. |

Ajoute toujours un motif. Il est conservé dans les logs du serveur, pour que le reste de l'équipe sache ce qui s'est passé.

Débannis des personnes dans **Paramètres du serveur → Bannissements**. Les membres bannis peuvent faire appel, si le serveur le permet. Les appels t'y attendent pour que tu les acceptes ou les refuses.

Pour nettoyer un flot de spam, tape `/purge 50` pour supprimer les 50 derniers messages, ou `/purge 50 @someone` pour supprimer seulement ceux de cette personne (jusqu'à 100 à la fois).

## AutoMod

**Paramètres du serveur → AutoMod** repère les problèmes automatiquement, même quand aucun modérateur n'est là. Les règles peuvent :

- **Bloquer des mots** : une liste de mots ou d'expressions. Utilise `*` comme joker.
- **Bloquer le spam de mentions** : les messages qui notifient trop de monde d'un coup.
- **Bloquer les liens** : les liens vers tous les sites sauf ceux que tu autorises.
- **Filtrer les pseudos** qui enfreignent tes règles.

Pour chaque règle, choisis ce qui se passe :

- bloquer le message, éventuellement avec un message de ta part à l'expéditeur
- envoyer une alerte dans un salon des modérateurs
- exclure temporairement la personne

Tu peux aussi exempter des rôles ou des salons, comme un salon où tes modérateurs discutent des mots interdits. Les personnes qui peuvent gérer le serveur ne sont jamais filtrées.

## Configuration de sécurité

**Paramètres du serveur → Configuration de sécurité** regroupe les grands interrupteurs :

- **Niveau de vérification** : ce qu'il faut à un nouveau venu avant de pouvoir publier. **Faible** exige un e-mail vérifié. **Moyenne** exige en plus un compte Parley de plus de 5 minutes. **Élevée** exige en plus 10 minutes sur ton serveur. Les membres qui ont un rôle en sont dispensés.
- **Protection anti-raid** : repère un afflux soudain de nouveaux comptes et alerte tes modérateurs.
- **Mettre les invitations en pause** et **Mettre en pause les MP entre membres** : des freins d'urgence pendant un raid.
- **Serveur réservé aux adultes** : coche **Tout sur ce serveur est 18+** et seuls les membres confirmés comme ayant 18 ans ou plus peuvent lire ou participer, partout sur le serveur. Pour ne restreindre que certaines zones, utilise plutôt **Salon réservé aux +18 ans** sur un salon ou une catégorie. Voir [Salons et catégories](server-settings#channels-and-categories).
- **Filtre d'images explicites** : analyse les images publiées sur le serveur. La vérification se fait dans l'appli de chaque membre, et aussi par l'instance si ses admins l'ont configurée pour ça.
- **Authentification à deux facteurs pour les modérateurs** : les modérateurs doivent avoir activé la 2FA ou ajouté une clé d'accès, pour qu'un mot de passe volé ne puisse pas être utilisé contre le serveur. L'un ou l'autre suffit, et il t'en faut un toi-même pour activer cette option.
- **Résumés IA** : active ou désactive le bouton Résumés.

## Signalements

Quand des membres utilisent **Signaler le message** ou **Signaler l'utilisateur** et cochent la case pour prévenir aussi les modérateurs de ce serveur, le signalement arrive dans **Paramètres du serveur → Signalements**. **Aller à** pour le voir dans son contexte, puis **Résoudre** ou **Ignorer**.

Les signalements concernant la sécurité d'un enfant ou des images intimes partagées sans consentement n'apparaissent jamais ici. Ils sont envoyés uniquement à l'équipe qui gère ton serveur Parley.

## Les logs du serveur

Les **Logs du serveur** enregistrent qui a changé quoi : rôles, salons, bannissements, expulsions, exclusions temporaires, messages supprimés et paramètres. Filtre par personne ou par type d'action. C'est le premier endroit où regarder quand quelque chose change et que personne ne sait pourquoi.

## Signaler à Parley

Certaines choses dépassent un seul serveur, comme les menaces, les contenus illégaux ou le spam sur de nombreux serveurs. Chaque signalement est envoyé aux admins qui gèrent ton serveur Parley. Cocher la case l'envoie aussi aux modérateurs de ce serveur.

Pour signaler, fais un clic droit sur un message et choisis **Signaler le message**, ou fais un clic droit sur une personne et choisis **Signaler l'utilisateur**. Indique ce qui ne va pas, ajoute tout ce qui peut aider, puis choisis **Envoyer le signalement**.

Certains motifs sont examinés en premier : **Menace de violence**, **Quelqu'un risque de se faire du mal**, **Images intimes partagées sans consentement**, et la plupart des choix sous **Un enfant est en danger**. Les signalements concernant la sécurité d'un enfant ou des images intimes sont envoyés uniquement à l'équipe qui gère ton serveur Parley, jamais aux modérateurs d'un serveur : la case n'est donc pas proposée pour eux.

Ce que tu signales est copié au moment où tu l'envoies : le message, les fichiers qui y sont joints et, dans un salon de serveur, ce qui a été dit juste avant et juste après. Supprimer le message ensuite ne supprime pas la copie.

> Heads up: Si tu tombes sur des images ou des vidéos à caractère sexuel d'un enfant, ne les enregistre pas, ne fais pas de capture d'écran et ne les transfère pas, même comme preuve. Signale le message et laisse-le où il est. Ton signalement conserve ce qu'il faut.

> Note: Si quelqu'un est en danger en ce moment même, appelle d'abord le numéro d'urgence local, puis fais un signalement.

Tu peux envoyer jusqu'à 10 signalements par heure. Les motifs examinés en premier ont leur propre limite, plus élevée.
