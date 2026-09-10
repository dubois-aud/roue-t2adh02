(function () {
  'use strict';

  var CLE_STOCKAGE = 'roue-des-noms.participants';
  var CLE_SON = 'roue-des-noms.son';
  /* Playlist YouTube de la squad, format court des anciennes playlists.
     Surchargeable sans toucher au code par le parametre p dans l URL,
     par exemple #l=Audrey|Amine&p=PLautrechose */
  var PLAYLIST = 'PLLTgmcsZVRK4';
  /* Piste de repli prise quand la playlist refuse l integration. Laissee a null :
     dTbaawNCJSc a ete essayee et son proprietaire interdit la lecture hors de
     YouTube, verifie avec une iframe nue, donc sans rapport avec ce code.
     Mettre ici l identifiant d une piste dont l integration est ouverte, ou en
     essayer une sans toucher au code par le parametre v de l URL. */
  var VIDEO_SECOURS = null;
  var NOMS_PAR_DEFAUT = [
    'Audrey', 'Amine', 'Jean-Philippe', 'Stéphane', 'Céline',
    'François-Xavier', 'Benoît', 'Marie-Line', 'Valérie', 'Joshua',
    'Lynda', 'Damien', 'Mourad', 'Fabienne'
  ];
  var PALETTE = [
    '#e5484d', '#f5a524', '#3fb950', '#3b9eff',
    '#a56bff', '#ff7ab2', '#12b5a0', '#f0d000'
  ];
  var GRIS_INACTIF = '#3a4152';
  var TOUR_COMPLET = Math.PI * 2;
  var DUREE_MIN = 4200;
  var DUREE_MAX = 5800;
  var MAX_PARTICIPANTS = 60;

  var canvas = document.getElementById('roue');
  var ctx = canvas.getContext('2d');
  var boutonCentre = document.getElementById('bouton-centre');
  var formulaire = document.getElementById('formulaire-ajout');
  var champNom = document.getElementById('champ-nom');
  var erreurAjout = document.getElementById('erreur-ajout');
  var listeNoms = document.getElementById('liste-noms');
  var compteur = document.getElementById('compteur');
  var messageVide = document.getElementById('vide');
  var resultat = document.getElementById('resultat');
  var optionDeselection = document.getElementById('option-deselection');
  var choixSon = document.getElementById('choix-son');
  var lecteurBloc = document.getElementById('lecteur');
  var etatSon = document.getElementById('etat-son');
  var boutonReselection = document.getElementById('bouton-reselection');
  var boutonMelanger = document.getElementById('bouton-melanger');
  var boutonVider = document.getElementById('bouton-vider');
  var boutonLien = document.getElementById('bouton-lien');
  var retourLien = document.getElementById('retour-lien');
  var fenetre = document.getElementById('fenetre');
  var fenetreNom = document.getElementById('fenetre-titre');
  var fenetreDeselection = document.getElementById('fenetre-deselection');
  var fenetreFermer = document.getElementById('fenetre-fermer');

  var noms = [];
  var inactifs = [];
  var rotation = -Math.PI / 2;
  var enRotation = false;
  var gagnant = null;
  var contexteAudio = null;
  var lecteur = null;
  var lecteurPret = false;
  var apiDemandee = false;
  var minuterieApi = null;
  var essaisPiste = 0;
  var playlistActive = null;
  var videoForcee = null;
  var videoActive = null;
  var secoursTente = false;

  /* Selection : un participant desactive reste dans la liste mais sort de la
     roue. Rien n est supprime, la croix de la ligne reste le seul retrait. */

  function memeNom(a, b) {
    return a.toLowerCase() === b.toLowerCase();
  }

  function estInactif(nom) {
    return inactifs.some(function (n) { return memeNom(n, nom); });
  }

  function actifs() {
    return noms.filter(function (nom) { return !estInactif(nom); });
  }

  function basculer(nom) {
    if (enRotation) { return; }

    if (estInactif(nom)) {
      inactifs = inactifs.filter(function (n) { return !memeNom(n, nom); });
    } else {
      inactifs.push(nom);
    }
    resultat.textContent = '';
    rafraichir();
  }

  function reselectionnerTout() {
    if (enRotation || inactifs.length === 0) { return; }
    inactifs = [];
    rafraichir();
  }

  /* Partage par l'URL : #l=<tous>&d=<deselectionnes>&p=<playlist> */

  function assainir(valeurs) {
    if (!Array.isArray(valeurs)) { return []; }

    var propres = [];
    valeurs.forEach(function (valeur) {
      if (typeof valeur !== 'string') { return; }
      var nom = valeur.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (nom === '' || propres.length >= MAX_PARTICIPANTS) { return; }
      var double = propres.some(function (n) { return memeNom(n, nom); });
      if (!double) { propres.push(nom); }
    });
    return propres;
  }

  /* ne garde que des deselectionnes qui existent vraiment dans la liste */
  function assainirInactifs(valeurs) {
    return assainir(valeurs).filter(function (nom) {
      return noms.some(function (n) { return memeNom(n, nom); });
    });
  }

  function encoder(valeurs) {
    return valeurs.map(encodeURIComponent).join('|');
  }

  function decouper(brut) {
    return brut.split('|').map(function (morceau) {
      try {
        return decodeURIComponent(morceau);
      } catch (e) {
        return '';
      }
    });
  }

  function parametreUrl(cle) {
    var fragment = window.location.hash.replace(/^#/, '');
    var motif = new RegExp('(?:^|&)' + cle + '=([^&]*)');
    var correspondance = motif.exec(fragment);
    if (correspondance === null) { return null; }
    return correspondance[1];
  }

  /* null quand l'URL ne porte pas de liste, tableau vide quand elle en porte une vide */
  function listeDepuisUrl() {
    var brut = parametreUrl('l');
    if (brut === null) { return null; }
    if (brut === '') { return []; }
    return assainir(decouper(brut));
  }

  function inactifsDepuisUrl() {
    var brut = parametreUrl('d');
    if (brut === null || brut === '') { return []; }
    return assainirInactifs(decouper(brut));
  }

  function playlistDemandee() {
    var brut = parametreUrl('p');
    if (brut === null || brut === '') { return PLAYLIST; }
    try {
      return decodeURIComponent(brut);
    } catch (e) {
      return PLAYLIST;
    }
  }

  /* v force une video unique et court-circuite la playlist */
  function videoDemandee() {
    var brut = parametreUrl('v');
    if (brut === null || brut === '') { return null; }
    try {
      return decodeURIComponent(brut);
    } catch (e) {
      return null;
    }
  }

  /* la playlist passee dans l URL doit survivre a la reecriture du fragment */
  function fragmentComplet() {
    var fragment = '#l=' + encoder(noms);
    if (inactifs.length > 0) { fragment += '&d=' + encoder(inactifs); }

    var playlist = playlistDemandee();
    if (playlist !== PLAYLIST) { fragment += '&p=' + encodeURIComponent(playlist); }
    if (videoForcee !== null) { fragment += '&v=' + encodeURIComponent(videoForcee); }

    return fragment;
  }

  function majUrl() {
    try {
      window.history.replaceState(null, '', fragmentComplet());
    } catch (e) {
      /* replaceState refuse en file:// sur certains navigateurs : le bouton de
         copie reconstruit le lien de son cote, donc rien de bloquant */
    }
  }

  function lienPartage() {
    return window.location.href.split('#')[0] + fragmentComplet();
  }

  function copierLien() {
    var lien = lienPartage();

    function confirmer() {
      retourLien.textContent = 'Lien copié, la liste est dedans.';
      window.setTimeout(function () { retourLien.textContent = ''; }, 4000);
    }

    // presse-papier indisponible (http, vieux navigateur) : selection manuelle
    function secours() {
      var champ = document.createElement('input');
      champ.value = lien;
      champ.setAttribute('readonly', 'readonly');
      champ.style.position = 'fixed';
      champ.style.opacity = '0';
      document.body.appendChild(champ);
      champ.select();

      var copie = false;
      try {
        copie = document.execCommand('copy');
      } catch (e) {
        copie = false;
      }
      document.body.removeChild(champ);

      if (copie) {
        confirmer();
        return;
      }
      retourLien.textContent = 'Copie refusée : le lien est dans la barre d’adresse.';
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(lien).then(confirmer, secours);
      return;
    }
    secours();
  }

  /* Stockage local */

  function charger() {
    var partagee = listeDepuisUrl();
    if (partagee !== null) {
      noms = partagee;
      inactifs = inactifsDepuisUrl();
      return;
    }

    try {
      var brut = localStorage.getItem(CLE_STOCKAGE);
      if (brut === null) {
        noms = NOMS_PAR_DEFAUT.slice();
        inactifs = [];
        return;
      }

      var valeurs = JSON.parse(brut);
      // ancien format : un simple tableau de noms, tous actifs
      if (Array.isArray(valeurs)) {
        noms = assainir(valeurs);
        inactifs = [];
        return;
      }

      noms = assainir(valeurs && valeurs.noms);
      inactifs = assainirInactifs(valeurs && valeurs.inactifs);
    } catch (e) {
      noms = NOMS_PAR_DEFAUT.slice();
      inactifs = [];
    }
  }

  function sauvegarder() {
    try {
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify({
        noms: noms,
        inactifs: inactifs
      }));
    } catch (e) {
      /* navigation privee ou stockage refuse : on continue sans persistance */
    }
  }

  /* Couleurs */

  function couleur(index, total) {
    var teinte = PALETTE[index % PALETTE.length];
    // evite deux secteurs voisins de meme couleur au niveau du raccord
    if (index === total - 1 && total > 1 && teinte === PALETTE[0]) {
      return PALETTE[1];
    }
    return teinte;
  }

  /* Dessin de la roue */

  function dimensionner() {
    var taille = canvas.clientWidth || 560;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(taille * ratio);
    canvas.height = Math.round(taille * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dessiner();
  }

  function dessiner() {
    var ratio = window.devicePixelRatio || 1;
    var taille = canvas.width / ratio;
    var centre = taille / 2;
    var rayon = centre - 4;
    var visibles = actifs();

    ctx.clearRect(0, 0, taille, taille);

    if (visibles.length === 0) {
      var message = noms.length === 0
        ? 'Ajoutez des participants'
        : 'Sélectionnez des participants';

      ctx.fillStyle = '#171c28';
      ctx.beginPath();
      ctx.arc(centre, centre, rayon, 0, TOUR_COMPLET);
      ctx.fill();

      ctx.fillStyle = '#98a1b8';
      ctx.font = '600 ' + Math.round(taille * 0.038) + 'px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(message, centre, centre - rayon * 0.42);
      return;
    }

    var secteur = TOUR_COMPLET / visibles.length;

    for (var i = 0; i < visibles.length; i++) {
      var debut = rotation + i * secteur;
      var fin = debut + secteur;

      ctx.beginPath();
      ctx.moveTo(centre, centre);
      ctx.arc(centre, centre, rayon, debut, fin);
      ctx.closePath();
      ctx.fillStyle = couleur(i, visibles.length);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      etiquette(visibles[i], centre, rayon, debut + secteur / 2, secteur, taille);
    }
  }

  function etiquette(texte, centre, rayon, angle, secteur, taille) {
    var largeurMax = rayon * 0.62;
    var police = Math.min(taille * 0.042, secteur * rayon * 0.55);
    police = Math.max(police, 9);

    ctx.save();
    ctx.translate(centre, centre);
    ctx.rotate(angle);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(police) + 'px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#12151d';

    var affiche = texte;
    while (affiche.length > 2 && ctx.measureText(affiche).width > largeurMax) {
      affiche = affiche.slice(0, -1);
    }
    if (affiche !== texte) { affiche = affiche.slice(0, -1) + '…'; }

    ctx.fillText(affiche, rayon * 0.88, 0);
    ctx.restore();
  }

  /* Liste des participants */

  function rendreListe() {
    var visibles = actifs();
    listeNoms.innerHTML = '';

    noms.forEach(function (nom, index) {
      var horsRoue = estInactif(nom);
      var ligne = document.createElement('li');
      ligne.className = horsRoue ? 'ligne inactif' : 'ligne';

      var choix = document.createElement('label');
      choix.className = 'choix';

      var case_ = document.createElement('input');
      case_.type = 'checkbox';
      case_.className = 'case';
      case_.checked = !horsRoue;
      case_.setAttribute('aria-label', 'Inclure ' + nom + ' dans la roue');
      case_.addEventListener('change', function () { basculer(nom); });

      var pastille = document.createElement('span');
      pastille.className = 'pastille';
      pastille.style.background = horsRoue
        ? GRIS_INACTIF
        : couleur(visibles.indexOf(nom), visibles.length);
      pastille.setAttribute('aria-hidden', 'true');

      var libelle = document.createElement('span');
      libelle.className = 'nom';
      libelle.textContent = nom;
      libelle.title = nom;

      var retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'retirer';
      retirer.textContent = '×';
      retirer.setAttribute('aria-label', 'Supprimer ' + nom + ' de la liste');
      retirer.addEventListener('click', function () { supprimer(index); });

      choix.appendChild(case_);
      choix.appendChild(pastille);
      choix.appendChild(libelle);
      ligne.appendChild(choix);
      ligne.appendChild(retirer);
      listeNoms.appendChild(ligne);
    });

    compteur.textContent = visibles.length === noms.length
      ? String(noms.length)
      : visibles.length + ' sur ' + noms.length;

    messageVide.hidden = noms.length > 0;
    boutonReselection.hidden = inactifs.length === 0;
    boutonCentre.disabled = visibles.length < 2;
  }

  function rafraichir() {
    rendreListe();
    dessiner();
    sauvegarder();
    majUrl();
  }

  function ajouter(nom) {
    var propre = nom.trim().replace(/\s+/g, ' ');
    if (propre === '') { return false; }

    if (noms.length >= MAX_PARTICIPANTS) {
      erreurAjout.textContent = 'Maximum ' + MAX_PARTICIPANTS + ' participants.';
      return false;
    }

    var existe = noms.some(function (n) { return memeNom(n, propre); });
    if (existe) {
      erreurAjout.textContent = propre + ' est déjà dans la roue.';
      return false;
    }

    erreurAjout.textContent = '';
    noms.push(propre);
    rafraichir();
    return true;
  }

  function supprimer(index) {
    if (enRotation) { return; }

    var parti = noms[index];
    noms.splice(index, 1);
    inactifs = inactifs.filter(function (n) { return !memeNom(n, parti); });
    erreurAjout.textContent = '';
    rafraichir();
  }

  /* Sons : tout est synthetise, aucun fichier a charger */

  function audio() {
    try {
      if (contexteAudio === null) {
        var Constructeur = window.AudioContext || window.webkitAudioContext;
        if (!Constructeur) { return null; }
        contexteAudio = new Constructeur();
      }
      if (contexteAudio.state === 'suspended') { contexteAudio.resume(); }
      return contexteAudio;
    } catch (e) {
      return null;
    }
  }

  /* "bloup" de dessin anime, plus aigu quand la roue va vite */
  function bloup(elan) {
    if (modeSon() !== 'bloups') { return; }
    var son = audio();
    if (son === null) { return; }

    try {
      var t = son.currentTime;
      var frequence = 260 + elan * 700 + Math.random() * 60;

      var oscillateur = son.createOscillator();
      var gain = son.createGain();

      oscillateur.type = 'triangle';
      oscillateur.frequency.setValueAtTime(frequence, t);
      oscillateur.frequency.exponentialRampToValueAtTime(frequence * 0.4, t + 0.09);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

      oscillateur.connect(gain);
      gain.connect(son.destination);
      oscillateur.start(t);
      oscillateur.stop(t + 0.12);
    } catch (e) {
      /* audio indisponible : la roue tourne sans son */
    }
  }

  /* klaxon de clown : sawtooth filtre avec un vibrato pour le tremblement */
  function klaxon(retard, frequence) {
    var son = audio();
    if (son === null) { return; }

    try {
      var t = son.currentTime + retard;
      var duree = 0.24;

      var oscillateur = son.createOscillator();
      oscillateur.type = 'sawtooth';
      oscillateur.frequency.setValueAtTime(frequence, t);
      oscillateur.frequency.setValueAtTime(frequence, t + duree * 0.7);
      oscillateur.frequency.exponentialRampToValueAtTime(frequence * 0.72, t + duree);

      var vibrato = son.createOscillator();
      var profondeur = son.createGain();
      vibrato.frequency.setValueAtTime(7, t);
      profondeur.gain.setValueAtTime(16, t);
      vibrato.connect(profondeur);
      profondeur.connect(oscillateur.frequency);

      var filtre = son.createBiquadFilter();
      filtre.type = 'lowpass';
      filtre.frequency.setValueAtTime(1700, t);

      var gain = son.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
      gain.gain.setValueAtTime(0.14, t + duree * 0.75);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duree);

      oscillateur.connect(filtre);
      filtre.connect(gain);
      gain.connect(son.destination);

      oscillateur.start(t);
      vibrato.start(t);
      oscillateur.stop(t + duree + 0.02);
      vibrato.stop(t + duree + 0.02);
    } catch (e) {
      /* audio indisponible : pas de fanfare */
    }
  }

  /* pouet pouet a l'annonce du gagnant */
  function fanfare() {
    if (modeSon() === 'aucun') { return; }
    klaxon(0, 415);
    klaxon(0.28, 330);
  }

  /* Musique : lecteur YouTube officiel, le flux reste servi par YouTube.
     Aucun fichier audio n est copie dans le depot. */

  function modeSon() {
    return choixSon.value;
  }

  function replierSurBloups(message) {
    window.clearTimeout(minuterieApi);
    choixSon.value = 'bloups';
    lecteurBloc.hidden = true;
    etatSon.textContent = '';
    sauvegarderSon();
    erreurAjout.textContent = message + ', les bloups reprennent la main.';
  }

  function creerLecteur() {
    if (lecteur !== null) { return; }

    var parametres = {
      autoplay: 0,
      controls: 1,
      playsinline: 1,
      rel: 0,
      enablejsapi: 1
    };
    // YouTube veut un referent valide, sinon erreur 153 : en file:// il n y en a pas
    if (window.location.protocol !== 'file:') {
      parametres.origin = window.location.origin;
    }
    if (videoActive === null) {
      parametres.listType = 'playlist';
      parametres.list = playlistActive;
    }

    var config = {
      width: '100%',
      height: '100%',
      playerVars: parametres,
      events: {
        onReady: function () {
          lecteurPret = true;
          window.clearTimeout(minuterieApi);
          etatSon.textContent = videoActive === null
            ? 'Playlist prête, une piste au hasard à chaque lancement.'
            : 'Piste prête, elle démarre au lancement de la roue.';
        },
        onError: function (evenement) { erreurPiste(evenement.data); }
      }
    };
    if (videoActive !== null) { config.videoId = videoActive; }

    try {
      lecteur = new window.YT.Player('lecteur-youtube', config);
    } catch (e) {
      replierSurBloups('Le lecteur YouTube a refusé de démarrer');
    }
  }

  function chargerApi() {
    if (window.YT && window.YT.Player) {
      creerLecteur();
      return;
    }
    if (apiDemandee) { return; }

    apiDemandee = true;
    etatSon.textContent = 'Chargement du lecteur YouTube...';
    window.onYouTubeIframeAPIReady = creerLecteur;

    var balise = document.createElement('script');
    balise.src = 'https://www.youtube.com/iframe_api';
    balise.onerror = function () {
      replierSurBloups('Lecteur YouTube inaccessible');
    };
    document.head.appendChild(balise);

    minuterieApi = window.setTimeout(function () {
      if (!lecteurPret) {
        replierSurBloups('Lecteur YouTube injoignable (réseau ou filtrage)');
      }
    }, 8000);
  }

  /* 101 et 150 : integration refusee par l ayant droit. 153 n est pas
     documente par YouTube, en pratique un refus faute de referent valide,
     et en file:// il n y a pas de referent du tout. */
  function erreurPiste(code) {
    var refus = code === 101 || code === 150 || code === 153;

    if (code === 153 && window.location.protocol === 'file:') {
      replierSurBloups('YouTube refuse l’intégration en file:// (erreur 153), à servir par http');
      return;
    }

    if (refus) {
      /* En tirage seulement : une autre piste de la playlist a peut-etre
         l integration ouverte. Hors tirage on ne tente rien, la lecture
         automatique serait bloquee, et sans lecture aucune erreur ne
         revient, donc le compteur de tentatives resterait bloque. */
      if (videoActive === null && enRotation && essaisPiste < 3) {
        essaisPiste += 1;
        etatSon.textContent = 'Piste non intégrable, passage à la suivante.';
        pisteAuHasard();
        return;
      }

      if (!secoursTente && VIDEO_SECOURS !== null) {
        secoursTente = true;
        videoActive = VIDEO_SECOURS;
        etatSon.textContent = 'Playlist non intégrable, repli sur la piste de secours.';
        try {
          if (enRotation) {
            lecteur.loadVideoById(VIDEO_SECOURS);
          } else {
            lecteur.cueVideoById(VIDEO_SECOURS);
          }
        } catch (e) {
          replierSurBloups('Piste de secours indisponible');
        }
        return;
      }

      replierSurBloups('YouTube refuse l’intégration de cette piste (erreur ' + code + ')');
      return;
    }

    if (code === 2 || code === 5 || code === 100) {
      replierSurBloups('Playlist introuvable ou identifiant invalide');
      return;
    }
    etatSon.textContent = 'Lecture impossible sur cette piste (code ' + code + ').';
  }

  function pisteAuHasard() {
    if (lecteur === null || !lecteurPret) { return; }

    try {
      lecteur.setVolume(70);

      // piste unique, forcee par l URL ou choisie en repli : pas de tirage
      if (videoActive !== null) {
        lecteur.playVideo();
        return;
      }

      var pistes = lecteur.getPlaylist();
      if (pistes && pistes.length > 0) {
        lecteur.playVideoAt(Math.floor(Math.random() * pistes.length));
        return;
      }
      lecteur.playVideo();
    } catch (e) {
      etatSon.textContent = 'Lecture impossible pour le moment.';
    }
  }

  function musiqueDemarrer() {
    essaisPiste = 0;
    if (!lecteurPret) {
      etatSon.textContent = 'Lecteur pas encore prêt, relance la roue.';
      chargerApi();
      return;
    }
    pisteAuHasard();
  }

  /* fondu de sortie puis pouet pouet, sinon les deux se marchent dessus */
  function musiqueArreter() {
    if (lecteur === null || !lecteurPret) { return; }

    var volume = 70;
    var fondu = window.setInterval(function () {
      volume -= 10;
      try {
        if (volume <= 0) {
          window.clearInterval(fondu);
          lecteur.pauseVideo();
          lecteur.setVolume(70);
          return;
        }
        lecteur.setVolume(volume);
      } catch (e) {
        window.clearInterval(fondu);
      }
    }, 90);
  }

  function appliquerModeSon() {
    var mode = modeSon();
    lecteurBloc.hidden = mode !== 'musique';

    if (mode === 'musique') {
      playlistActive = playlistDemandee();
      videoForcee = videoDemandee();
      if (videoForcee !== null) { videoActive = videoForcee; }
      chargerApi();
      return;
    }
    if (lecteurPret && lecteur !== null) {
      try {
        lecteur.pauseVideo();
      } catch (e) {
        /* lecteur deja parti */
      }
    }
  }

  function sauvegarderSon() {
    try {
      localStorage.setItem(CLE_SON, choixSon.value);
    } catch (e) {
      /* stockage refuse : le choix ne survit pas au rechargement */
    }
  }

  function chargerSon() {
    try {
      var valeur = localStorage.getItem(CLE_SON);
      if (valeur === 'musique' || valeur === 'bloups' || valeur === 'aucun') {
        choixSon.value = valeur;
      }
    } catch (e) {
      /* on garde le choix par defaut du HTML */
    }
  }

  /* Rotation */

  function indiceGagnant(total) {
    var secteur = TOUR_COMPLET / total;
    var cible = (-Math.PI / 2 - rotation) % TOUR_COMPLET;
    if (cible < 0) { cible += TOUR_COMPLET; }
    return Math.floor(cible / secteur) % total;
  }

  function tourner() {
    var visibles = actifs();
    if (enRotation || visibles.length < 2) { return; }

    enRotation = true;
    boutonCentre.disabled = true;
    boutonCentre.textContent = '...';
    resultat.textContent = '';

    // le clic ou la touche qui declenche le tirage vaut geste utilisateur,
    // c est ce que reclame la politique de lecture automatique des navigateurs
    if (modeSon() === 'musique') { musiqueDemarrer(); }

    var secteur = TOUR_COMPLET / visibles.length;
    var depart = rotation;
    var duree = DUREE_MIN + Math.random() * (DUREE_MAX - DUREE_MIN);
    var tours = 5 + Math.floor(Math.random() * 4);
    var distance = tours * TOUR_COMPLET + Math.random() * TOUR_COMPLET;
    var debut = null;
    var dernierSecteur = null;
    var dernierBloup = 0;

    function etape(horodatage) {
      if (debut === null) { debut = horodatage; }

      var avancee = Math.min((horodatage - debut) / duree, 1);
      var lissage = 1 - Math.pow(1 - avancee, 3);
      rotation = depart + distance * lissage;

      // vitesse relative : derivee du lissage, 1 au depart et 0 a l'arrivee
      var elan = Math.pow(1 - avancee, 2);

      var secteurCourant = Math.floor(rotation / secteur);
      if (dernierSecteur !== null && secteurCourant !== dernierSecteur) {
        // beaucoup de participants a pleine vitesse : on espace les bloups
        if (horodatage - dernierBloup > 45) {
          bloup(elan);
          dernierBloup = horodatage;
        }
      }
      dernierSecteur = secteurCourant;

      dessiner();

      if (avancee < 1) {
        window.requestAnimationFrame(etape);
        return;
      }

      rotation = rotation % TOUR_COMPLET;
      dessiner();
      terminer(visibles);
    }

    window.requestAnimationFrame(etape);
  }

  function terminer(visibles) {
    enRotation = false;
    boutonCentre.disabled = false;
    boutonCentre.textContent = 'Tourner';

    gagnant = visibles[indiceGagnant(visibles.length)];

    if (modeSon() === 'musique') {
      musiqueArreter();
      window.setTimeout(fanfare, 900);
    } else {
      fanfare();
    }

    resultat.textContent = 'Résultat : ';
    var fort = document.createElement('strong');
    fort.textContent = gagnant;
    resultat.appendChild(fort);

    fenetreNom.textContent = gagnant;
    fenetre.hidden = false;
    fenetreFermer.focus();
  }

  function fermerFenetre() {
    fenetre.hidden = true;
    gagnant = null;
    champNom.focus();
  }

  /* le gagnant sort de la roue mais reste dans la liste, case decochee */
  function deselectionnerGagnant() {
    if (gagnant !== null && !estInactif(gagnant)) {
      inactifs.push(gagnant);
      rafraichir();
    }
    resultat.textContent = '';
    fermerFenetre();
  }

  /* Evenements */

  formulaire.addEventListener('submit', function (evenement) {
    evenement.preventDefault();
    if (ajouter(champNom.value)) { champNom.value = ''; }
    champNom.focus();
  });

  boutonCentre.addEventListener('click', tourner);
  canvas.addEventListener('click', tourner);

  boutonReselection.addEventListener('click', reselectionnerTout);

  boutonMelanger.addEventListener('click', function () {
    if (enRotation) { return; }
    for (var i = noms.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tampon = noms[i];
      noms[i] = noms[j];
      noms[j] = tampon;
    }
    rafraichir();
  });

  boutonVider.addEventListener('click', function () {
    if (enRotation || noms.length === 0) { return; }
    noms = [];
    inactifs = [];
    erreurAjout.textContent = '';
    resultat.textContent = '';
    rafraichir();
  });

  fenetreDeselection.addEventListener('click', deselectionnerGagnant);

  fenetreFermer.addEventListener('click', function () {
    if (optionDeselection.checked) {
      deselectionnerGagnant();
      return;
    }
    fermerFenetre();
  });

  fenetre.addEventListener('click', function (evenement) {
    if (evenement.target === fenetre) { fermerFenetre(); }
  });

  document.addEventListener('keydown', function (evenement) {
    if (evenement.key === 'Escape' && !fenetre.hidden) {
      fermerFenetre();
      return;
    }
    if (evenement.key === ' ' && evenement.target === document.body) {
      evenement.preventDefault();
      tourner();
    }
  });

  boutonLien.addEventListener('click', copierLien);

  choixSon.addEventListener('change', function () {
    erreurAjout.textContent = '';
    sauvegarderSon();
    appliquerModeSon();
  });

  // un lien colle dans l onglet courant change la liste sans rechargement
  window.addEventListener('hashchange', function () {
    var partagee = listeDepuisUrl();
    if (partagee === null || enRotation) { return; }

    noms = partagee;
    inactifs = inactifsDepuisUrl();
    erreurAjout.textContent = '';
    resultat.textContent = '';
    rafraichir();

    // le lien colle peut aussi porter une autre playlist
    if (modeSon() === 'musique' && playlistDemandee() !== playlistActive) {
      playlistActive = playlistDemandee();
      if (lecteur !== null && lecteurPret) {
        try {
          lecteur.cuePlaylist({ listType: 'playlist', list: playlistActive });
        } catch (e) {
          etatSon.textContent = 'Playlist non chargée.';
        }
      }
    }
  });

  window.addEventListener('resize', dimensionner);

  charger();
  chargerSon();
  appliquerModeSon();
  rendreListe();
  dimensionner();
  majUrl();
})();
