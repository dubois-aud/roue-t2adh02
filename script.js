/* IIFE conservee a dessein : la roue doit pouvoir s ouvrir en double-clic
   depuis le disque, et un <script type="module"> est refuse en file://. */
(function () {
  'use strict';

  const CLE_STOCKAGE = 'roue-des-noms.participants';
  const CLE_SON = 'roue-des-noms.son';
  const NOMS_PAR_DEFAUT = [
    'Audrey', 'Amine', 'Jean-Philippe', 'Stéphane', 'Céline',
    'François-Xavier', 'Benoît', 'Marie-Line', 'Valérie', 'Joshua',
    'Lynda', 'Damien', 'Mourad', 'Fabienne'
  ];
  const PALETTE = [
    '#e5484d', '#f5a524', '#3fb950', '#3b9eff',
    '#a56bff', '#ff7ab2', '#12b5a0', '#f0d000'
  ];
  const GRIS_INACTIF = '#cfc4d8';
  const LICORNES = [
    'img/konami_1.png', 'img/konami_2.png', 'img/konami_3.png', 'img/konami_4.png',
    'img/konami_5.png', 'img/konami_6.png', 'img/konami_7.png', 'img/konami_8.png'
  ];
  /* Separateur ~ : caractere non reserve de la RFC 3986, donc jamais reencode
     par un navigateur ni coupe par un client de messagerie. Le | des premiers
     liens partages ressortait tantot brut, tantot en %7C, ce qui donnait un
     seul nom tronque, ou un lien coupe au premier nom. */
  const SEPARATEUR = '~';
  const TOUR_COMPLET = Math.PI * 2;
  const DUREE_MIN = 4200;
  const DUREE_MAX = 5800;
  const MAX_PARTICIPANTS = 60;
  const LONGUEUR_NOM = 24;

  const canvas = document.getElementById('roue');
  const ctx = canvas.getContext('2d');
  const boutonCentre = document.getElementById('bouton-centre');
  const formulaire = document.getElementById('formulaire-ajout');
  const champNom = document.getElementById('champ-nom');
  const erreurAjout = document.getElementById('erreur-ajout');
  const listeNoms = document.getElementById('liste-noms');
  const compteur = document.getElementById('compteur');
  const messageVide = document.getElementById('vide');
  const resultat = document.getElementById('resultat');
  const optionDeselection = document.getElementById('option-deselection');
  const optionSon = document.getElementById('option-son');
  const boutonReselection = document.getElementById('bouton-reselection');
  const boutonMelanger = document.getElementById('bouton-melanger');
  const boutonVider = document.getElementById('bouton-vider');
  const boutonLien = document.getElementById('bouton-lien');
  const retourLien = document.getElementById('retour-lien');
  const fenetre = document.getElementById('fenetre');
  const fenetreNom = document.getElementById('fenetre-titre');
  const licorneGauche = document.getElementById('licorne-gauche');
  const licorneDroite = document.getElementById('licorne-droite');
  const fenetreDeselection = document.getElementById('fenetre-deselection');
  const fenetreFermer = document.getElementById('fenetre-fermer');

  let noms = [];
  let inactifs = [];
  let rotation = -Math.PI / 2;
  let enRotation = false;
  let gagnant = null;
  let contexteAudio = null;
  let licornesPrechargees = false;

  /* Selection : un participant desactive reste dans la liste mais sort de la
     roue. Rien n est supprime, la croix de la ligne reste le seul retrait. */

  function memeNom(a, b) {
    return a.toLowerCase() === b.toLowerCase();
  }

  function estInactif(nom) {
    return inactifs.some((n) => memeNom(n, nom));
  }

  function actifs() {
    return noms.filter((nom) => !estInactif(nom));
  }

  function basculer(nom) {
    if (enRotation) { return; }

    if (estInactif(nom)) {
      inactifs = inactifs.filter((n) => !memeNom(n, nom));
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

  /* Stockage local : en navigation privee ou stockage refuse, les deux acces
     echouent en silence et l application continue sans persistance. */

  function lireStockage(cle) {
    try {
      return localStorage.getItem(cle);
    } catch {
      return null;
    }
  }

  function ecrireStockage(cle, valeur) {
    try {
      localStorage.setItem(cle, valeur);
    } catch {
      /* rien a rattraper : la liste vit le temps de l onglet */
    }
  }

  function charger() {
    const partagee = listeDepuisUrl();
    if (partagee !== null) {
      noms = partagee;
      inactifs = inactifsDepuisUrl();
      return;
    }

    const brut = lireStockage(CLE_STOCKAGE);
    if (brut === null) {
      noms = NOMS_PAR_DEFAUT.slice();
      inactifs = [];
      return;
    }

    let valeurs = null;
    try {
      valeurs = JSON.parse(brut);
    } catch {
      valeurs = null;
    }

    // ancien format : un simple tableau de noms, tous actifs
    if (Array.isArray(valeurs)) {
      noms = assainir(valeurs);
      inactifs = [];
      return;
    }

    noms = assainir(valeurs && valeurs.noms);
    inactifs = assainirInactifs(valeurs && valeurs.inactifs);
  }

  function sauvegarder() {
    ecrireStockage(CLE_STOCKAGE, JSON.stringify({ noms, inactifs }));
  }

  function chargerSon() {
    const valeur = lireStockage(CLE_SON);
    if (valeur === null) { return; }
    /* ancien reglage : une liste a trois valeurs dont un mode musique qui
       n existe plus. Tout ce qui n etait pas le silence redevient du son. */
    optionSon.checked = valeur !== 'aucun' && valeur !== '0';
  }

  function sauvegarderSon() {
    ecrireStockage(CLE_SON, optionSon.checked ? '1' : '0');
  }

  /* Partage par l'URL : #l=<tous>&d=<deselectionnes> */

  function assainir(valeurs) {
    if (!Array.isArray(valeurs)) { return []; }

    const propres = [];
    valeurs.forEach((valeur) => {
      if (typeof valeur !== 'string') { return; }
      const nom = valeur.trim().replace(/\s+/g, ' ').slice(0, LONGUEUR_NOM);
      if (nom === '' || propres.length >= MAX_PARTICIPANTS) { return; }
      if (!propres.some((n) => memeNom(n, nom))) { propres.push(nom); }
    });
    return propres;
  }

  /* ne garde que des deselectionnes qui existent vraiment dans la liste */
  function assainirInactifs(valeurs) {
    return assainir(valeurs).filter((nom) => noms.some((n) => memeNom(n, nom)));
  }

  function encoder(valeurs) {
    // encodeURIComponent laisse ~ intact, on le protege a la main
    return valeurs
      .map((valeur) => encodeURIComponent(valeur).replace(/~/g, '%7E'))
      .join(SEPARATEUR);
  }

  function decouper(brut) {
    // | et %7C restent acceptes pour que les liens deja envoyes fonctionnent
    return brut.split(/~|\||%7C/i).map((morceau) => {
      try {
        return decodeURIComponent(morceau);
      } catch {
        return '';
      }
    });
  }

  function parametreUrl(cle) {
    const fragment = window.location.hash.replace(/^#/, '');
    const correspondance = new RegExp(`(?:^|&)${cle}=([^&]*)`).exec(fragment);
    return correspondance === null ? null : correspondance[1];
  }

  /* null quand l'URL ne porte pas de liste, tableau vide quand elle en porte une vide */
  function listeDepuisUrl() {
    const brut = parametreUrl('l');
    if (brut === null) { return null; }
    if (brut === '') { return []; }
    return assainir(decouper(brut));
  }

  function inactifsDepuisUrl() {
    const brut = parametreUrl('d');
    if (brut === null || brut === '') { return []; }
    return assainirInactifs(decouper(brut));
  }

  function fragmentComplet() {
    const fragment = `#l=${encoder(noms)}`;
    return inactifs.length > 0 ? `${fragment}&d=${encoder(inactifs)}` : fragment;
  }

  function majUrl() {
    try {
      window.history.replaceState(null, '', fragmentComplet());
    } catch {
      /* replaceState refuse en file:// sur certains navigateurs : le bouton de
         copie reconstruit le lien de son cote, donc rien de bloquant */
    }
  }

  function annoncerCopie(reussie) {
    retourLien.textContent = reussie
      ? 'Lien copié, la liste est dedans.'
      : 'Copie refusée : le lien est dans la barre d’adresse.';
    window.setTimeout(() => { retourLien.textContent = ''; }, 4000);
  }

  /* presse-papier indisponible (file://, http, vieux navigateur) : le champ
     hors ecran et execCommand restent la seule voie */
  function copierParSelection(lien) {
    const champ = document.createElement('input');
    champ.value = lien;
    champ.setAttribute('readonly', 'readonly');
    champ.style.position = 'fixed';
    champ.style.opacity = '0';
    document.body.appendChild(champ);
    champ.select();

    let copie = false;
    try {
      copie = document.execCommand('copy');
    } catch {
      copie = false;
    }
    document.body.removeChild(champ);
    return copie;
  }

  function copierLien() {
    const lien = window.location.href.split('#')[0] + fragmentComplet();

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(lien).then(
        () => annoncerCopie(true),
        () => annoncerCopie(copierParSelection(lien))
      );
      return;
    }
    annoncerCopie(copierParSelection(lien));
  }

  /* Dessin de la roue */

  function couleur(index, total) {
    const teinte = PALETTE[index % PALETTE.length];
    // evite deux secteurs voisins de meme couleur au niveau du raccord
    if (index === total - 1 && total > 1 && teinte === PALETTE[0]) {
      return PALETTE[1];
    }
    return teinte;
  }

  function dimensionner() {
    const taille = canvas.clientWidth || 560;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(taille * ratio);
    canvas.height = Math.round(taille * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    dessiner();
  }

  function dessinerRoueVide(centre, rayon, taille) {
    const message = noms.length === 0
      ? 'Ajoutez des participants'
      : 'Sélectionnez des participants';

    ctx.fillStyle = '#fdf3f8';
    ctx.beginPath();
    ctx.arc(centre, centre, rayon, 0, TOUR_COMPLET);
    ctx.fill();

    ctx.fillStyle = '#766a85';
    ctx.font = `600 ${Math.round(taille * 0.038)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, centre, centre - rayon * 0.42);
  }

  function dessiner() {
    const taille = canvas.width / (window.devicePixelRatio || 1);
    const centre = taille / 2;
    const rayon = centre - 4;
    const visibles = actifs();

    ctx.clearRect(0, 0, taille, taille);

    if (visibles.length === 0) {
      dessinerRoueVide(centre, rayon, taille);
      return;
    }

    const secteur = TOUR_COMPLET / visibles.length;

    visibles.forEach((nom, index) => {
      const debut = rotation + index * secteur;

      ctx.beginPath();
      ctx.moveTo(centre, centre);
      ctx.arc(centre, centre, rayon, debut, debut + secteur);
      ctx.closePath();
      ctx.fillStyle = couleur(index, visibles.length);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      etiquette(nom, centre, rayon, debut + secteur / 2, secteur, taille);
    });
  }

  function etiquette(texte, centre, rayon, angle, secteur, taille) {
    // le texte court du moyeu vers le bord, sans empieter sur le bouton central
    const largeurMax = rayon * 0.66;
    const policeMax = Math.max(Math.min(taille * 0.040, secteur * rayon * 0.55), 9);
    const policeMin = Math.max(policeMax * 0.6, 8);
    const poser = (police) => {
      ctx.font = `700 ${police.toFixed(1)}px "Segoe UI", Arial, sans-serif`;
    };

    ctx.save();
    ctx.translate(centre, centre);
    ctx.rotate(angle);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#12151d';

    /* un nom long rapetisse tout seul plutot que d imposer sa taille a
       toute la roue : Francois-Xavier maigrit, Amine reste lisible de loin */
    let police = policeMax;
    poser(police);
    while (police > policeMin && ctx.measureText(texte).width > largeurMax) {
      police -= 0.5;
      poser(police);
    }

    // au plancher et toujours trop long : la coupe reste le dernier recours
    let affiche = texte;
    while (affiche.length > 2 && ctx.measureText(affiche).width > largeurMax) {
      affiche = affiche.slice(0, -1);
    }
    if (affiche !== texte) { affiche = `${affiche.slice(0, -1)}…`; }

    ctx.fillText(affiche, rayon * 0.88, 0);
    ctx.restore();
  }

  /* Liste des participants */

  function creerLigne(nom, index, visibles) {
    const horsRoue = estInactif(nom);

    const caseRoue = document.createElement('input');
    caseRoue.type = 'checkbox';
    caseRoue.className = 'case';
    caseRoue.checked = !horsRoue;
    caseRoue.setAttribute('aria-label', `Inclure ${nom} dans la roue`);
    caseRoue.addEventListener('change', () => basculer(nom));

    const pastille = document.createElement('span');
    pastille.className = 'pastille';
    pastille.style.background = horsRoue
      ? GRIS_INACTIF
      : couleur(visibles.indexOf(nom), visibles.length);
    pastille.setAttribute('aria-hidden', 'true');

    const libelle = document.createElement('span');
    libelle.className = 'nom';
    libelle.textContent = nom;
    libelle.title = nom;

    const choix = document.createElement('label');
    choix.className = 'choix';
    choix.append(caseRoue, pastille, libelle);

    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'retirer';
    retirer.textContent = '×';
    retirer.setAttribute('aria-label', `Supprimer ${nom} de la liste`);
    retirer.addEventListener('click', () => supprimer(index));

    const ligne = document.createElement('li');
    ligne.className = horsRoue ? 'ligne inactif' : 'ligne';
    ligne.append(choix, retirer);
    return ligne;
  }

  function rendreListe() {
    const visibles = actifs();

    listeNoms.innerHTML = '';
    noms.forEach((nom, index) => listeNoms.appendChild(creerLigne(nom, index, visibles)));

    compteur.textContent = visibles.length === noms.length
      ? String(noms.length)
      : `${visibles.length} sur ${noms.length}`;

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
    const propre = nom.trim().replace(/\s+/g, ' ');
    if (propre === '') { return false; }

    if (noms.length >= MAX_PARTICIPANTS) {
      erreurAjout.textContent = `Maximum ${MAX_PARTICIPANTS} participants.`;
      return false;
    }

    if (noms.some((n) => memeNom(n, propre))) {
      erreurAjout.textContent = `${propre} est déjà dans la roue.`;
      return false;
    }

    erreurAjout.textContent = '';
    noms.push(propre);
    rafraichir();
    return true;
  }

  function supprimer(index) {
    if (enRotation) { return; }

    const parti = noms[index];
    noms.splice(index, 1);
    inactifs = inactifs.filter((n) => !memeNom(n, parti));
    erreurAjout.textContent = '';
    rafraichir();
  }

  /* Sons : tout est synthetise, aucun fichier a charger */

  function audio() {
    try {
      if (contexteAudio === null) {
        const Constructeur = window.AudioContext || window.webkitAudioContext;
        if (!Constructeur) { return null; }
        contexteAudio = new Constructeur();
      }
      if (contexteAudio.state === 'suspended') { contexteAudio.resume(); }
      return contexteAudio;
    } catch {
      return null;
    }
  }

  /* garde-fou commun aux deux voix : son coupe par l utilisateur, contexte
     audio refuse ou parti en cours de route, la roue tourne en silence */
  function jouer(construire) {
    if (!optionSon.checked) { return; }
    const son = audio();
    if (son === null) { return; }

    try {
      construire(son, son.currentTime);
    } catch {
      /* rien a rattraper, le son est un agrement */
    }
  }

  /* "bloup" de dessin anime, plus aigu quand la roue va vite */
  function bloup(elan) {
    jouer((son, t) => {
      const frequence = 260 + elan * 700 + Math.random() * 60;
      const oscillateur = son.createOscillator();
      const gain = son.createGain();

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
    });
  }

  /* klaxon de clown : sawtooth filtre avec un vibrato pour le tremblement */
  function klaxon(retard, frequence) {
    jouer((son, maintenant) => {
      const t = maintenant + retard;
      const duree = 0.24;

      const oscillateur = son.createOscillator();
      oscillateur.type = 'sawtooth';
      oscillateur.frequency.setValueAtTime(frequence, t);
      oscillateur.frequency.setValueAtTime(frequence, t + duree * 0.7);
      oscillateur.frequency.exponentialRampToValueAtTime(frequence * 0.72, t + duree);

      const vibrato = son.createOscillator();
      const profondeur = son.createGain();
      vibrato.frequency.setValueAtTime(7, t);
      profondeur.gain.setValueAtTime(16, t);
      vibrato.connect(profondeur);
      profondeur.connect(oscillateur.frequency);

      const filtre = son.createBiquadFilter();
      filtre.type = 'lowpass';
      filtre.frequency.setValueAtTime(1700, t);

      const gain = son.createGain();
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
    });
  }

  /* pouet pouet a l'annonce du gagnant */
  function fanfare() {
    klaxon(0, 415);
    klaxon(0.28, 330);
  }

  /* Rotation */

  function indiceGagnant(total) {
    const secteur = TOUR_COMPLET / total;
    let cible = (-Math.PI / 2 - rotation) % TOUR_COMPLET;
    if (cible < 0) { cible += TOUR_COMPLET; }
    return Math.floor(cible / secteur) % total;
  }

  function animer(visibles) {
    const secteur = TOUR_COMPLET / visibles.length;
    const depart = rotation;
    const duree = DUREE_MIN + Math.random() * (DUREE_MAX - DUREE_MIN);
    const tours = 5 + Math.floor(Math.random() * 4);
    const distance = tours * TOUR_COMPLET + Math.random() * TOUR_COMPLET;
    let debut = null;
    let dernierSecteur = null;
    let dernierBloup = 0;

    function etape(horodatage) {
      if (debut === null) { debut = horodatage; }

      const avancee = Math.min((horodatage - debut) / duree, 1);
      const lissage = 1 - Math.pow(1 - avancee, 3);
      rotation = depart + distance * lissage;

      const secteurCourant = Math.floor(rotation / secteur);
      // beaucoup de participants a pleine vitesse : on espace les bloups
      if (dernierSecteur !== null && secteurCourant !== dernierSecteur
        && horodatage - dernierBloup > 45) {
        // vitesse relative : derivee du lissage, 1 au depart et 0 a l'arrivee
        bloup(Math.pow(1 - avancee, 2));
        dernierBloup = horodatage;
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

  function tourner() {
    const visibles = actifs();
    if (enRotation || visibles.length < 2) { return; }

    enRotation = true;
    boutonCentre.disabled = true;
    boutonCentre.textContent = '...';
    resultat.textContent = '';

    // les licornes pesent lourd : la roue tourne plusieurs secondes, autant
    // s en servir pour les charger avant que la fenetre les reclame
    precharger();
    animer(visibles);
  }

  function terminer(visibles) {
    enRotation = false;
    boutonCentre.disabled = false;
    boutonCentre.textContent = 'Tourner';
    gagnant = visibles[indiceGagnant(visibles.length)];
    fanfare();

    resultat.textContent = 'Résultat : ';
    const fort = document.createElement('strong');
    fort.textContent = gagnant;
    resultat.appendChild(fort);

    fenetreNom.textContent = gagnant;
    tirerLicornes();
    fenetre.hidden = false;
    fenetreFermer.focus();
  }

  /* Fenetre de resultat */

  function precharger() {
    if (licornesPrechargees) { return; }
    licornesPrechargees = true;

    LICORNES.forEach((chemin) => {
      const image = new Image();
      image.src = chemin;
    });
  }

  /* deux licornes differentes a chaque ouverture : on tire la seconde parmi
     les places restantes, ce qui evite de retomber sur la premiere */
  function tirerLicornes() {
    const gauche = Math.floor(Math.random() * LICORNES.length);
    let droite = Math.floor(Math.random() * (LICORNES.length - 1));
    if (droite >= gauche) { droite += 1; }

    licorneGauche.src = LICORNES[gauche];
    licorneDroite.src = LICORNES[droite];
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

  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    if (ajouter(champNom.value)) { champNom.value = ''; }
    champNom.focus();
  });

  boutonCentre.addEventListener('click', tourner);
  canvas.addEventListener('click', tourner);
  boutonReselection.addEventListener('click', reselectionnerTout);
  boutonLien.addEventListener('click', copierLien);
  optionSon.addEventListener('change', sauvegarderSon);
  fenetreDeselection.addEventListener('click', deselectionnerGagnant);
  window.addEventListener('resize', dimensionner);

  boutonMelanger.addEventListener('click', () => {
    if (enRotation) { return; }
    for (let i = noms.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [noms[i], noms[j]] = [noms[j], noms[i]];
    }
    rafraichir();
  });

  boutonVider.addEventListener('click', () => {
    if (enRotation || noms.length === 0) { return; }
    noms = [];
    inactifs = [];
    erreurAjout.textContent = '';
    resultat.textContent = '';
    rafraichir();
  });

  fenetreFermer.addEventListener('click', () => {
    if (optionDeselection.checked) {
      deselectionnerGagnant();
      return;
    }
    fermerFenetre();
  });

  fenetre.addEventListener('click', (evenement) => {
    if (evenement.target === fenetre) { fermerFenetre(); }
  });

  document.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Escape' && !fenetre.hidden) {
      fermerFenetre();
      return;
    }
    if (evenement.key === ' ' && evenement.target === document.body) {
      evenement.preventDefault();
      tourner();
    }
  });

  // un lien colle dans l onglet courant change la liste sans rechargement
  window.addEventListener('hashchange', () => {
    const partagee = listeDepuisUrl();
    if (partagee === null || enRotation) { return; }

    noms = partagee;
    inactifs = inactifsDepuisUrl();
    erreurAjout.textContent = '';
    resultat.textContent = '';
    rafraichir();
  });

  charger();
  chargerSon();
  rendreListe();
  dimensionner();
  majUrl();
})();
