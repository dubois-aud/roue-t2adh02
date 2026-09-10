# La roue T2Adh02, squad tout risques

Roue de tirage au sort en HTML, CSS et JavaScript natifs. Aucune dépendance, aucune étape de build, trois fichiers à servir tels quels.

## Utilisation

Ouvrir `index.html` dans un navigateur, ou servir le dossier par http.

- ajouter un participant par le champ de saisie (Entrée ou bouton `Ajouter`)
- décocher la case d'une ligne pour sortir quelqu'un de la roue sans le supprimer
- supprimer définitivement un participant par la croix de sa ligne
- lancer la roue par le bouton central, par un clic sur la roue, ou par la barre d'espace
- `Mélanger` réordonne les secteurs, `Tout resélectionner` remet tout le monde dans la roue, `Tout effacer` vide la liste
- deux options : désélection automatique du gagnant après le tirage, et choix du son

## Sélection des participants

Deux niveaux distincts, pour ne jamais perdre une liste par accident.

- **Désélectionner** (la case de la ligne, ou le bouton `Désélectionner` de la fenêtre de résultat) : le participant reste dans la liste, grisé et barré, mais sort de la roue. Le compteur passe alors en `13 sur 14`. Le bouton `Tout resélectionner` n'apparaît que s'il y a au moins un désélectionné.
- **Supprimer** (la croix de la ligne) : le participant quitte la liste pour de bon.

L'option `Désélectionner le gagnant après le tirage` enchaîne les tirages sans doublon : chaque gagnant sort de la roue au fur et à mesure, tout en restant visible dans la liste. Les couleurs de la roue se réindexent sur les seuls participants actifs, et la pastille de chaque ligne reprend la couleur de son secteur.

## Son

Trois modes dans la liste `Son de la roue`, le choix est retenu dans le `localStorage` sous la clé `roue-des-noms.son`.

- **Musique YouTube** : une piste tirée au hasard dans la playlist se lance au démarrage de la roue, puis descend en fondu à l'arrêt, suivie du klaxon d'annonce.
- **Bloups et klaxon** : sons synthétisés avec l'API Web Audio, aucun fichier chargé. Un bloup par secteur franchi, dont la hauteur suit la vitesse de la roue, et un klaxon de clown pour le gagnant.
- **Aucun** : silence complet.

### Playlist

L'identifiant est la constante `PLAYLIST` en tête de `script.js`. Il peut aussi être surchargé sans toucher au code par le paramètre `p` dans le fragment de l'URL, à côté de la liste des noms :

```
#l=Audrey|Amine|Jean-Philippe&p=PL...
```

La lecture passe par le lecteur officiel de YouTube (IFrame Player API), chargé à la demande, uniquement quand le mode musique est actif : aucune requête vers YouTube dans les deux autres modes. Le flux reste servi par YouTube, avec ses publicités et son décompte de vues, et aucun fichier audio n'est copié dans le dépôt.

Conséquence de leurs règles d'intégration, le lecteur reste visible dans le panneau, au moins 200 pixels de côté. Un lecteur masqué serait hors des conditions d'utilisation.

Replis prévus, tous silencieux du point de vue de l'utilisateur sauf un message :

- API injoignable, bloquée par un filtrage réseau ou par un bloqueur : bascule automatique sur les bloups au bout de huit secondes
- piste dont l'intégration est refusée par l'ayant droit (codes 101 et 150) : passage à une autre piste, trois tentatives
- code 153, non documenté par YouTube, en pratique un refus d'intégration faute de référent valide : même relance, sauf en `file://` où il n'y a aucun référent, cas dans lequel la bascule sur les bloups est immédiate avec un message
- playlist introuvable ou identifiant invalide (codes 2, 5 et 100) : bascule sur les bloups

Constat de test, à connaître avant de reprendre le sujet : sur la playlist `PLLTgmcsZVRK4`, le lecteur répond « Le propriétaire de la vidéo a désactivé la lecture sur d'autres sites Web » (erreur 150). La piste `dTbaawNCJSc` a été essayée comme repli et donne le même refus, y compris dans une iframe nue reprenant le code d'intégration de YouTube, sans une ligne de ce projet. La restriction vient donc des ayants droit, pas du code, et rien ici ne peut la contourner.

Conséquence : `VIDEO_SECOURS` est laissée à `null` et le mode musique bascule sur les bloups tant qu'aucune piste jouable n'est fournie.

Pour vérifier si une piste candidate est intégrable, le menu de partage de YouTube ne prouve rien. La méthode fiable est de la charger dans une iframe nue : si elle affiche « Vidéo non disponible », elle ne servira dans aucun lecteur intégré. On peut aussi l'essayer sans toucher au code par le paramètre `v` de l'URL :

```
#l=Audrey|Amine&v=<identifiant>
```

La lecture est déclenchée dans le gestionnaire du clic ou de la touche qui lance la roue, ce que réclame la politique de lecture automatique des navigateurs. Au premier lancement, si le lecteur n'est pas encore prêt, un message invite à relancer la roue.

## Persistance des noms

Deux mécanismes complémentaires, tous deux sans serveur, donc compatibles avec un hébergement statique.

### localStorage

La liste est écrite dans le `localStorage` du navigateur sous la clé `roue-des-noms.participants` à chaque modification, sous la forme `{ noms, inactifs }` : les désélectionnés sont retenus eux aussi. L'ancien format, un simple tableau de noms, est encore relu, tous actifs. Le visiteur retrouve donc sa liste au rechargement et aux visites suivantes.

Portée : un navigateur, un appareil, une origine. Rien n'est envoyé sur le réseau. En navigation privée ou si le stockage est refusé, l'écriture échoue en silence et l'application continue sans persistance.

Au premier chargement, quand la clé n'existe pas encore, la roue est amorcée avec la liste par défaut définie dans `NOMS_PAR_DEFAUT` en tête de `script.js`. `Tout effacer` enregistre une liste vide, la liste par défaut ne revient pas.

### Lien partageable

La liste est aussi encodée dans le fragment de l'URL, sous la forme `#l=Audrey|Amine|Jean-Philippe` avec chaque nom passé à `encodeURIComponent`. Les désélectionnés suivent dans un second paramètre, `&d=Audrey`, et la playlist éventuelle dans un troisième, `&p=`. Le fragment est mis à jour à chaque modification via `history.replaceState`, sans polluer l'historique de navigation.

Conséquences pratiques :

- le bouton `Copier le lien de la roue` donne une URL qui reconstruit la liste à l'ouverture. C'est le moyen de retrouver une roue sur un autre appareil ou de l'envoyer à quelqu'un.
- mettre le lien en favori revient à enregistrer la liste.
- un lien reçu prend le pas sur le `localStorage` à l'ouverture, mais ne l'écrase pas tant que rien n'est modifié : recharger la page sans le fragment ramène la liste locale.
- coller un lien dans l'onglet courant met la roue à jour sans rechargement (événement `hashchange`).

Le fragment n'est jamais transmis au serveur par le navigateur : les noms restent locaux, même en usage partagé.

### Ce qui n'est pas fourni

Une liste unique commune à tous les visiteurs, synchronisée entre eux. Cela demande un service externe (Firebase, Supabase, ou une petite API), et la clé d'accès se retrouverait dans le code public de la page, donc ouverte en écriture à n'importe qui. À ajouter seulement si le besoin devient réellement collaboratif.

## Mise en ligne sur GitHub Pages

1. créer le dépôt et pousser les fichiers à la racine (`index.html`, `style.css`, `script.js`)
2. `Settings` puis `Pages`, source `Deploy from a branch`, branche `main`, dossier `/ (root)`
3. la page est publiée sur `https://<compte>.github.io/<dépôt>/` après une minute environ

Rien d'autre à prévoir : pas de `.nojekyll` (aucun dossier préfixé par un souligné), pas de chemin absolu dans le code, donc la publication dans un sous-dossier de dépôt fonctionne telle quelle.

Deux points que l'hébergement change en mieux par rapport à une ouverture en `file://` :

- l'origine devient `https://<compte>.github.io`, donc le `localStorage` est stable et propre au site, là où les pages locales partagent un même espace de stockage
- le contexte est sécurisé, donc la copie du lien passe par `navigator.clipboard`, sans le repli par sélection manuelle

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | structure de la page, roue en `canvas`, panneau des participants |
| `style.css` | mise en page sombre et responsive, la roue passe sous le panneau en dessous de 860 px |
| `script.js` | dessin de la roue, animation, liste, persistance, sons |

Voir la section `Son` pour les trois modes et le paramétrage de la playlist.
