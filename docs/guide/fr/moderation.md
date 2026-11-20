---
title: Modération et sécurité
section: Gérer un serveur
summary: Garde ton serveur convivial avec AutoMod, les exclusions temporaires, les bannissements, les signalements, la protection anti-raid et les logs du serveur.
source: ede402610205
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
- **Filtre d'images explicites** : analyse les images publiées sur le serveur.
- **Authentification à deux facteurs pour les modérateurs** : les modérateurs doivent avoir activé la 2FA ou ajouté une clé d'accès, pour qu'un mot de passe volé ne puisse pas être utilisé contre le serveur. L'un ou l'autre suffit, et il t'en faut un toi-même pour activer cette option.
- **Résumés IA** : active ou désactive le bouton Résumés.

## Signalements

Quand des membres utilisent **Signaler le message** ou **Signaler l'utilisateur** et cochent la case pour prévenir aussi les modérateurs de ce serveur, le signalement arrive dans **Paramètres du serveur → Signalements**. **Aller à** pour le voir dans son contexte, puis **Résoudre** ou **Ignorer**.

## Les logs du serveur

Les **Logs du serveur** enregistrent qui a changé quoi : rôles, salons, bannissements, expulsions, exclusions temporaires, messages supprimés et paramètres. Filtre par personne ou par type d'action. C'est le premier endroit où regarder quand quelque chose change et que personne ne sait pourquoi.

## Signaler à Parley

Certaines choses dépassent un seul serveur, comme les menaces, les contenus illégaux ou le spam sur de nombreux serveurs. Chaque signalement est envoyé aux admins qui gèrent ton serveur Parley. Cocher la case l'envoie aussi aux modérateurs de ce serveur.
