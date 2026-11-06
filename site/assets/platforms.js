// Spotify, Deezer et Apple Music dans les playlists d'ONIRIQUE CLOUD (mes-sons.html) : les comptes liés, la recherche,
// les liens collés (titre, album ou playlist entière), et les titres des plateformes mêlés aux sons du CLOUD.
// Le serveur (server/src/platforms.js) relaie l'extrait officiel de 30 s de chaque titre ; l'écoute entière se fait
// sur la plateforme.
//
//   OniriquePlatforms.setup({ api, el, icon, player, changed })   api(method, path, body) → Promise ; changed() redessine
//   OniriquePlatforms.load() → Promise                            les comptes liés et les titres de toutes les playlists
//   OniriquePlatforms.mixed(p) → [{ key, track } | { key, item }] la playlist p dans son ordre (sons du CLOUD et titres)
//   OniriquePlatforms.playerItem(item)                            ce que joue le lecteur pour un titre de plateforme
//   OniriquePlatforms.row(p, item, i, onPlay)                     la ligne d'un titre de plateforme dans la playlist
//   OniriquePlatforms.order(p, keys) → Promise                    le nouvel ordre (["t12", "x5", …])
//   OniriquePlatforms.openAdd(p)                                  la fenêtre « Ajouter depuis Spotify, Deezer, Apple Music »
//   OniriquePlatforms.openAccounts()                              la même fenêtre, sur les comptes liés
(() => {
  const NAMES = { spotify: "Spotify", deezer: "Deezer", apple: "Apple Music" };
  const PROFILE_HINT = {
    deezer: "Lien de ton profil Deezer (deezer.com/fr/profile/…) : tes playlists publiques s'affichent ici.",
    spotify: "Lien de ton profil Spotify (open.spotify.com/user/…). Spotify ne publie pas la liste de tes playlists : colle le lien de celle à importer.",
    apple: "Lien de ton profil Apple Music (music.apple.com/profile/…). Pour importer une playlist, colle son lien.",
  };
  let ctx = null;
  let state = { accounts: [], items: [], positions: {} };
  const time = (s) => (s ? Math.floor(s / 60) + ":" + String(Math.round(s) % 60).padStart(2, "0") : "");

  const style = document.createElement("style");
  style.textContent = `
#platform-add { width: min(760px, calc(100vw - 24px)); }
#platform-add .pf-body { display: grid; gap: 14px; padding: 16px 18px 18px; }
#platform-add .pf-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 14px; border: 1px solid var(--line); }
#platform-add .pf-tabs button { flex: 1 1 auto; padding: 10px 12px; border: 0; border-radius: 10px; background: none; color: var(--haze); font: 500 12px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
#platform-add .pf-tabs button[aria-selected="true"] { background: var(--ember); color: #fff; }
#platform-add form { display: flex; gap: 8px; }
#platform-add input { flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.4); color: var(--mist); font: 500 15px var(--f-body); }
#platform-add .pf-list { max-height: 52vh; overflow-y: auto; }
#platform-add .pf-note { margin: 0; color: var(--haze); font-size: 13px; line-height: 1.5; }
#platform-add .pf-acc { display: grid; gap: 8px; padding: 14px 16px; }
#platform-add .pf-acc-head { display: flex; align-items: center; gap: 10px; }
#platform-add .pf-acc-head b { flex: 1; font: 700 15px var(--f-display); }
.pf-tag { flex: none; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); font: 600 10.5px/1.5 var(--f-mono); letter-spacing: .06em; color: var(--haze); white-space: nowrap; }
.trk .pf-cover { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; }
.pf-embed { position: fixed; right: 0; bottom: 0; z-index: -1; width: 300px; height: 80px; opacity: 0; pointer-events: none; overflow: hidden; }
.pf-embed[hidden] { display: none; }
.pf-search { margin-top: 16px; max-width: 420px; }
.pf-search input { width: 100%; height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.4); color: var(--mist); font: 500 15px var(--f-body); }
.pf-search input:focus { outline: none; border-color: var(--ember); }
#platform-add .pf-target { display: flex; align-items: center; gap: 10px; font: 500 12px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--haze); }
#platform-add .pf-target select { flex: 1; min-width: 0; height: 40px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0,0,0,.4); color: var(--mist); font: 500 14px var(--f-body); text-transform: none; }
.trk.pf.pf-locked b, .trk.pf.pf-locked .len { opacity: .55; }
.pf-embed iframe { display: block; border: 0; }
`;
  document.head.append(style);

  function setup(options) { ctx = options; }
  // Pour l'instant : seulement dans l'application ONIRIQUE CENTRAL, et pour les membres ONIRIQUE (le serveur refuse les autres).
  let on = false;
  // Les playlists faites de titres Spotify se voient partout, sur le site aussi : sans compte Spotify lié, leurs titres
  // sont grisés et ne se lisent pas (gardé pour les pages qui l'appellent encore).
  const hidden = () => false;
  const enabled = () => on;
  async function load() {
    if (!window.oniriqueApp) {
      // Sur le site : les titres à leur place, lus par le lecteur intégré de Spotify ; ni recherche ni ajout (application).
      on = false;
      try { state = await ctx.api("GET", "/me/platforms"); } catch { state = { accounts: [], items: [], positions: {} }; }
      return state;
    }
    if (!conf) {
      try { conf = await ctx.api("GET", "/platforms/config"); on = true; } catch { conf = { spotify: null, apple: false }; on = false; }
      await spotifyReturn();
      // Un compte Apple Music déjà connecté sur cet appareil : MusicKit se prépare, sans rien demander.
      if (conf.apple && remembered("apple")) appleKit().then((m) => { appleOn = m.isAuthorized; if (!appleOn) remember("apple", false); }).catch(() => {});
    }
    await spotifyChanged();
    try { state = await ctx.api("GET", "/me/platforms"); } catch { state = { accounts: [], items: [], positions: {} }; }
    return state;
  }

  //---------------------------------------------------------------------------- Comptes connectés et lecture entière
  // Spotify (abonnés Premium) et Apple Music (abonnés Apple Music) jouent les titres en entier dans le lecteur du CLOUD,
  // sous son interface (OniriquePlayer.engines). Sans compte, ou si la plateforme refuse, c'est l'extrait de 30 s.
  let conf = null, appleOn = false, spToken = null;
  const remembered = (name) => { try { return localStorage.getItem("onirique." + name) === "1"; } catch { return false; } };
  const remember = (name, on) => { try { on ? localStorage.setItem("onirique." + name, "1") : localStorage.removeItem("onirique." + name); } catch {} };
  const loadScript = (src) => new Promise((ok, ko) => {
    const node = document.createElement("script");
    node.src = src; node.onload = ok; node.onerror = () => ko(new Error("Le lecteur de la plateforme ne se charge pas."));
    document.head.append(node);
  });
  const once = (fn) => { let pending = null; return () => (pending ||= fn().catch((error) => { pending = null; throw error; })); };
  const spotifyAccount = () => state.accounts.find((a) => a.platform === "spotify" && a.connected);
  /** Le titre se joue-t-il en entier ici ? */
  const full = (platform) => (platform === "spotify" ? !!(conf && conf.spotify && spotifyAccount()?.premium) : platform === "apple" ? !!(conf && conf.apple && appleOn) : false);
  /** Le moteur qui joue un titre : le compte connecté (SDK, Apple), sinon, pour Spotify, son lecteur officiel intégré. */
  const engineFor = (platform) => (full(platform) ? platform : platform === "spotify" ? "spotifyEmbed" : null);

  // Spotify : connexion PKCE (le vérificateur reste dans l'onglet, le code part au serveur qui garde le compte).
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function spotifyLogin() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
    sessionStorage.setItem("onirique.spotify", JSON.stringify({ verifier, state: nonce, back: location.hash }));
    location.href = "https://accounts.spotify.com/authorize?" + new URLSearchParams({ client_id: conf.spotify.clientId, response_type: "code",
      redirect_uri: conf.spotify.redirectUri, code_challenge_method: "S256", code_challenge: challenge, scope: conf.spotify.scopes, state: nonce });
  }
  async function spotifyReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem("onirique.spotify") || "null"); } catch {}
    sessionStorage.removeItem("onirique.spotify");
    history.replaceState(null, "", location.pathname + ((saved && saved.back) || ""));
    if (!saved || saved.state !== q.get("state")) return;
    if (q.get("error")) return alert(q.get("error") === "access_denied" ? "Connexion à Spotify annulée." : "Spotify a refusé la connexion.");
    try { await ctx.api("POST", "/me/platforms/spotify/connect", { code: q.get("code"), verifier: saved.verifier }); } catch (error) { alert(error.message); }
  }
  async function spotifyAccess() {
    if (!spToken || spToken.expiresAt < Date.now() + 60_000) spToken = await ctx.api("GET", "/me/platforms/spotify/token");
    return spToken.accessToken;
  }
  // Le lecteur Spotify de cet appareil (« ONIRIQUE CLOUD » dans les appareils Spotify). Spotify peut le débrancher (une
  // autre page ou un autre appareil reprend la lecture, la connexion tombe) : il est alors recréé au titre suivant, au
  // lieu de viser un appareil disparu jusqu'à retomber sur l'extrait de 30 s.
  let devicePending = null;
  const spotifyDevice = () => (devicePending ||= newSpotifyDevice().catch((error) => { devicePending = null; throw error; }));
  function dropSpotifyDevice(stale) {
    if (stale && devicePending !== stale) return;
    const old = devicePending;
    devicePending = null;
    if (old) old.then(({ player }) => player.disconnect(), () => {});
  }
  async function newSpotifyDevice() {
    if (!window.Spotify) {
      const ready = new Promise((ok) => { window.onSpotifyWebPlaybackSDKReady = ok; });
      await loadScript("https://sdk.scdn.co/spotify-player.js");
      await ready;
    }
    const player = new window.Spotify.Player({ name: "ONIRIQUE CLOUD", volume: ctx.player.audio.volume,
      getOAuthToken: (cb) => spotifyAccess().then(cb, () => cb("")) });
    const device = await new Promise((ok, ko) => {
      player.addListener("ready", ({ device_id }) => ok(device_id));
      for (const type of ["initialization_error", "authentication_error", "account_error"]) player.addListener(type, ({ message }) => ko(new Error(message)));
      player.connect().then((done) => { if (!done) ko(new Error("Spotify n'a pas pu démarrer.")); });
      setTimeout(() => ko(new Error("Spotify ne répond pas.")), 15000);
    });
    player.addListener("player_state_changed", (st) => spotify.changed(st));
    const self = devicePending;
    player.addListener("not_ready", () => dropSpotifyDevice(self)); // débranché par Spotify : recréé au prochain titre
    return { player, device };
  }
  const spotify = {
    cur: null, fire: null, base: 0, at: 0, dur: 0, sp: true, done: false, timer: null, player: null, via: null,
    async load(item, fire) {
      if (this.via) { this.via.stop(); this.via = null; }
      Object.assign(this, { cur: item, fire, base: 0, at: performance.now(), dur: item.duration || 0, sp: true, done: false });
      drawPeaks(item);
      // Un lecteur qui vient de naître (page rechargée, retour d'une autre page) est « introuvable » quelques secondes
      // pour Spotify : on réessaie. S'il reste introuvable, il a été débranché : on le recrée une fois.
      let response = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        if (attempt) await new Promise((ok) => setTimeout(ok, 700));
        if (this.cur !== item) return true; // un autre titre a été lancé entre-temps : c'est lui qui joue
        if (attempt === 4 && response && response.status === 404) dropSpotifyDevice();
        const { player, device } = await spotifyDevice().catch(() => ({}));
        if (!device) { response = null; continue; }
        this.player = player;
        response = await fetch("https://api.spotify.com/v1/me/player/play?device_id=" + encodeURIComponent(device), { method: "PUT",
          headers: { Authorization: "Bearer " + (await spotifyAccess()), "Content-Type": "application/json" }, body: JSON.stringify({ uris: ["spotify:track:" + item.extId] }) })
          .catch(() => null);
        if (response && (response.ok || ![404, 429, 502, 503].includes(response.status))) break;
      }
      if (this.cur !== item) return true;
      if (!response || !response.ok) {
        // Le lecteur officiel intégré de Spotify (titre entier pour qui y est connecté) plutôt que l'extrait de 30 s.
        this.via = spotifyEmbed;
        return spotifyEmbed.load(item, fire).catch(() => { this.via = null; return false; });
      }
      fire("loadedmetadata");
      return true;
    },
    changed(st) {
      if (!st || !this.cur || this.via) return;
      const t = st.track_window && st.track_window.current_track;
      const id = t && ((t.linked_from && t.linked_from.id) || t.id);
      // La fin du titre : Spotify s'arrête au début, le titre passé dans « précédents ».
      if (st.paused && st.position === 0 && (st.track_window.previous_tracks || []).some((x) => ((x.linked_from && x.linked_from.id) || x.id) === this.cur.extId)) {
        if (!this.done) { this.done = true; this.sp = true; this.tick(false); this.fire("ended"); }
        return;
      }
      if (id !== this.cur.extId) return;
      const was = this.sp;
      Object.assign(this, { base: st.position / 1000, at: performance.now(), dur: st.duration / 1000 || this.dur, sp: st.paused });
      if (was !== st.paused) { this.fire(st.paused ? "pause" : "play"); if (!st.paused) this.fire("playing"); }
      this.tick(!st.paused);
    },
    tick(on) { clearInterval(this.timer); this.timer = on ? setInterval(() => this.fire && this.fire("timeupdate"), 250) : null; },
    play() { if (this.via) return this.via.play(); return this.player && this.player.resume(); },
    pause() { if (this.via) return this.via.pause(); if (this.player) this.player.pause(); },
    stop() { if (this.via) { this.via.stop(); this.via = null; } this.tick(false); if (this.player && !this.sp) this.player.pause(); this.cur = null; },
    seek(s) { if (this.via) return this.via.seek(s); if (this.player) this.player.seek(Math.round(s * 1000)); this.base = s; this.at = performance.now(); },
    get currentTime() { if (this.via) return this.via.currentTime; return this.sp ? this.base : this.base + (performance.now() - this.at) / 1000; },
    get duration() { return this.via ? this.via.duration : this.dur; },
    get paused() { return this.via ? this.via.paused : this.sp; },
    setVolume(v) { if (this.player) this.player.setVolume(v); },
  };

  // Apple Music : MusicKit, avec le jeton développeur d'ONIRIQUE ; la connexion de l'abonné reste sur cet appareil.
  const appleKit = once(async () => {
    if (!window.MusicKit || !window.MusicKit.configure) {
      const loaded = new Promise((ok) => document.addEventListener("musickitloaded", ok, { once: true }));
      await loadScript("https://js-cdn.music.apple.com/musickit/v3/musickit.js");
      if (!window.MusicKit || !window.MusicKit.configure) await loaded;
    }
    const { token } = await ctx.api("GET", "/platforms/apple/token");
    await window.MusicKit.configure({ developerToken: token, app: { name: "ONIRIQUE CLOUD", build: "1.0" } });
    const m = window.MusicKit.getInstance();
    const S = window.MusicKit.PlaybackStates;
    m.addEventListener("playbackStateDidChange", () => {
      if (!apple.fire) return;
      const st = m.playbackState;
      if (st === S.playing) { apple.fire("play"); apple.fire("playing"); }
      else if (st === S.paused || st === S.stopped) apple.fire("pause");
      else if (st === S.ended || st === S.completed) apple.fire("ended");
    });
    m.addEventListener("playbackTimeDidChange", () => apple.fire && apple.fire("timeupdate"));
    return m;
  });
  const apple = {
    cur: null, fire: null, m: null,
    async load(item, fire) {
      const m = await appleKit();
      if (!m.isAuthorized) return false;
      Object.assign(this, { cur: item, fire: null, m });
      drawPeaks(item);
      m.volume = ctx.player.audio.volume;
      await m.setQueue({ song: item.extId, startPlaying: true });
      this.fire = fire;
      fire("loadedmetadata");
      return true;
    },
    play() { return this.m && this.m.play(); },
    pause() { if (this.m) this.m.pause(); },
    stop() { const m = this.m; this.fire = null; this.cur = null; if (m) m.stop(); },
    seek(s) { if (this.m) this.m.seekToTime(s); },
    get paused() { return !this.m || this.m.playbackState !== window.MusicKit.PlaybackStates.playing; },
    get currentTime() { return (this.m && this.m.currentPlaybackTime) || 0; },
    get duration() { return (this.m && this.m.currentPlaybackDuration) || (this.cur && this.cur.duration) || 0; },
    setVolume(v) { if (this.m) this.m.volume = v; },
  };
  // Le lecteur officiel de Spotify (son IFrame API, celui que les sites intègrent) : le titre en entier pour qui est
  // connecté à Spotify sur cet appareil, son extrait sinon. Sans application développeur ni limite de comptes. Il est
  // piloté par le lecteur du CLOUD, sous son interface ; son petit lecteur reste visible pendant qu'il joue (règles de
  // Spotify).
  let embedBox = null, embedFirst = "";
  const embedController = once(async () => {
    const api = await new Promise((ok, ko) => {
      if (window.SpotifyIframeApi) return ok(window.SpotifyIframeApi);
      window.onSpotifyIframeApiReady = (a) => { window.SpotifyIframeApi = a; ok(a); };
      loadScript("https://open.spotify.com/embed/iframe-api/v1").catch(ko);
      setTimeout(() => ko(new Error("Spotify ne répond pas.")), 15000);
    });
    embedBox = document.createElement("div");
    embedBox.className = "pf-embed";
    embedBox.hidden = true;
    const slot = document.createElement("div");
    embedBox.append(slot);
    document.body.append(embedBox);
    return new Promise((ok) => api.createController(slot, { width: "100%", height: 80, uri: embedFirst }, (c) => {
      c.addListener("playback_update", (e) => spotifyEmbed.update(e.data));
      c.addListener("ready", () => { const go = embedReady; embedReady = null; if (go) go(); });
      ok(c);
    }));
  });
  // Le lecteur intégré prévient quand un titre est chargé : lancé avant, il joue encore l'ancien titre, ou l'extrait.
  let embedReady = null;
  const embedLoad = (c, uri) => new Promise((ok) => { embedReady = ok; c.loadUri(uri); setTimeout(ok, 3000); });
  const spotifyEmbed = {
    c: null, cur: null, fire: null, base: 0, at: 0, dur: 0, paused: true, started: false, done: false, timer: null,
    async load(item, fire) {
      const uri = "spotify:track:" + item.extId;
      drawPeaks(item);
      Object.assign(this, { cur: item, fire, base: 0, at: performance.now(), dur: item.duration || 0, paused: true, started: false, done: false, retries: 0, retrying: false });
      if (!embedFirst) embedFirst = uri;
      const c = this.c = await embedController();
      embedBox.hidden = false;
      await embedLoad(c, uri);
      if (this.cur !== item) return true;
      c.play();
      fire("loadedmetadata");
      return true;
    },
    /** Spotify a servi l'extrait (30 s) d'un titre plus long : sa session n'était pas encore prête, on recharge le titre. */
    async retryFull(item, at) {
      this.retries++; this.retrying = true;
      await new Promise((ok) => setTimeout(ok, 1200));
      if (this.cur !== item) { this.retrying = false; return; }
      await embedLoad(this.c, "spotify:track:" + item.extId);
      if (this.cur !== item) { this.retrying = false; return; }
      if (at > 1) this.c.seek(at);
      this.c.play();
      this.retrying = false;
    },
    update(d) {
      if (!this.cur || !d) return;
      if (d.duration && Math.abs(d.duration - 30000) < 1500 && (this.cur.duration || 0) > 40 && this.retries < 2 && !this.retrying) {
        if (this.c) this.c.pause(); // on n'entend pas l'extrait le temps de recharger le titre
        this.retryFull(this.cur, (d.position || 0) / 1000);
        return;
      }
      const was = this.paused;
      Object.assign(this, { base: (d.position || 0) / 1000, at: performance.now(), dur: (d.duration || 0) / 1000 || this.dur, paused: !!d.isPaused });
      if (!d.isPaused && d.position > 0) this.started = true;
      if (was !== this.paused) { this.fire(this.paused ? "pause" : "play"); if (!this.paused) this.fire("playing"); }
      this.tick(!this.paused);
      // La fin : Spotify s'arrête au bout du titre (ou revient au début) après l'avoir joué.
      if (this.started && !this.done && d.isPaused && d.duration && (d.position >= d.duration - 800 || d.position === 0)) {
        this.done = true; this.tick(false); this.fire("ended");
      }
    },
    tick(on) { clearInterval(this.timer); this.timer = on ? setInterval(() => this.fire && this.fire("timeupdate"), 250) : null; },
    play() { if (this.c) this.c.resume(); },
    pause() { if (this.c) this.c.pause(); },
    stop() { this.tick(false); if (this.c && !this.paused) this.c.pause(); this.cur = null; if (embedBox) embedBox.hidden = true; },
    seek(s) { if (this.c) this.c.seek(s); this.base = s; this.at = performance.now(); },
    get currentTime() { return this.paused ? this.base : Math.min(this.dur || Infinity, this.base + (performance.now() - this.at) / 1000); },
    get duration() { return this.dur; },
    setVolume() {}, // le lecteur intégré de Spotify garde son propre volume
  };
  // La forme d'onde d'un titre joué par sa plateforme : Spotify ne laisse pas lire le son entier (protégé), elle est
  // donc calculée sur son extrait officiel, étalée sur toute la durée du titre. Gardée le temps de la page.
  const peaksCache = new Map();
  // Les paroles d'un titre Spotify d'une playlist (LRCLIB, par le serveur) : le lecteur les affiche dès qu'elles arrivent.
  const lyricsCache = new Map();
  function loadLyrics(item) {
    const id = /^x(\d+)$/.exec(item.key || "");
    if (!id || item.lyrics) return;
    if (!lyricsCache.has(id[1])) lyricsCache.set(id[1], ctx.api("GET", "/me/sounds/platform-items/" + id[1] + "/lyrics").then((r) => r.lyrics || "", () => ""));
    lyricsCache.get(id[1]).then((lyrics) => {
      if (!lyrics) return;
      item.lyrics = lyrics;
      if (ctx.player.item && ctx.player.item.key === item.key) ctx.player.item.lyrics = lyrics;
    });
  }
  // Le BPM et la tonalité d'un titre Spotify (l'API de Spotify ne les donne plus) : calculés sur son extrait de 30 s,
  // comme l'outil « BPM et tonalité » (detectProd de la page). Gardés le temps de la page.
  const tagsCache = new Map(), blobCache = new Map();
  /** L'extrait de 30 s d'un titre, téléchargé une seule fois pour la forme d'onde et l'analyse. */
  const previewBlob = (url) => (blobCache.has(url) ? blobCache.get(url)
    : blobCache.set(url, fetch(url).then((r) => (r.ok ? r.blob() : null)).catch(() => null)).get(url));
  function loadTags(item) {
    if (!item.url || typeof detectProd !== "function" || item.bpm || item.musicKey) return;
    if (!tagsCache.has(item.url)) tagsCache.set(item.url, previewBlob(item.url)
      .then((blob) => (blob ? detectProd(new File([blob], "extrait")) : {})).then((found) => ({
        bpm: found.tempo && found.tempo.bpm >= 40 && found.tempo.bpm <= 300 ? Math.round(found.tempo.bpm) : 0,
        musicKey: found.key ? KEY_NAMES[found.key.tonic] + (found.key.mode === "major" ? " maj" : " min") : "",
      }), () => ({})));
    tagsCache.get(item.url).then((tags) => {
      if (!tags.bpm && !tags.musicKey) return;
      Object.assign(item, tags);
      if (ctx.player.item && ctx.player.item.key === item.key) { Object.assign(ctx.player.item, tags); ctx.player.redraw(); }
    });
  }
  function drawPeaks(item) {
    loadLyrics(item);
    loadTags(item);
    if (!item.url || (item.peaks && item.peaks.length)) return;
    if (!peaksCache.has(item.url)) peaksCache.set(item.url, previewBlob(item.url)
      .then((blob) => (blob ? window.OniriquePlayer.peaksOf(blob) : null)).then((r) => (r && r.peaks) || null).catch(() => null));
    peaksCache.get(item.url).then((peaks) => {
      if (!peaks) return;
      item.peaks = peaks;
      if (ctx.player.item && ctx.player.item.key === item.key) { ctx.player.item.peaks = peaks; ctx.player.redraw(); }
    });
  }
  /** Se connecter à Spotify sur cet appareil : sa vraie page de connexion, dans une petite fenêtre. */
  // Dans l'application ONIRIQUE CENTRAL, l'état de la connexion se lit (cookie de session de Spotify sur cet appareil).
  let spWeb = null;
  /** Un compte de la plateforme lié à ONIRIQUE (connecté, ou son profil collé). */
  const linked = (platform) => state.accounts.some((a) => a.platform === platform);
  /** Un titre se joue-t-il ici ? Sur le site, il faut un compte Spotify lié ; dans l'application, connecté sur cet appareil. */
  const playable = (x) => x.platform !== "spotify" || (window.oniriqueApp ? !(spWeb === false && !full("spotify")) : linked("spotify"));
  async function spotifyChanged() {
    if (!window.oniriqueApp) return;
    const was = spWeb;
    try { spWeb = await window.oniriqueApp.spotify(); } catch { spWeb = null; }
    if (dialog && dialog.open) draw();
    if (was !== null && was !== spWeb) ctx.changed(); // les titres Spotify de la page se débloquent (ou se bloquent)
  }
  const spotifyWebLogin = () => window.open("https://accounts.spotify.com/login?continue=" + encodeURIComponent("https://open.spotify.com/"), "spotify-login", "width=520,height=720");
  if (window.OniriquePlayer) Object.assign(window.OniriquePlayer.engines, { spotify, apple, spotifyEmbed });

  // Les playlists d'un compte connecté : Spotify par le serveur ; Apple Music (bibliothèque) par MusicKit, ici.
  async function appleLibrary() {
    const m = await appleKit();
    const r = await m.api.music("/v1/me/library/playlists", { limit: 100 });
    return (r.data.data || []).map((l) => ({ id: l.id, title: l.attributes.name, count: null,
      cover: l.attributes.artwork ? l.attributes.artwork.url.replace("{w}", "120").replace("{h}", "120") : null }));
  }
  async function appleLibraryTracks(list) {
    const m = await appleKit(), items = [];
    let next = "/v1/me/library/playlists/" + encodeURIComponent(list.id) + "/tracks";
    while (next && items.length < 200) {
      const r = await m.api.music(next, { limit: 100 });
      for (const t of r.data.data || []) {
        const a = t.attributes || {}, id = a.playParams && a.playParams.catalogId;
        if (id) items.push({ platform: "apple", id: String(id), title: a.name, artist: a.artistName, duration: Math.round((a.durationInMillis || 0) / 1000),
          cover: a.artwork ? a.artwork.url.replace("{w}", "300").replace("{h}", "300") : null, listen: null });
      }
      next = r.data.next || null;
    }
    return { kind: "playlist", platform: "apple", title: list.title, cover: list.cover, items };
  }
  const itemsOf = (pid) => state.items.filter((x) => x.projectId === pid);
  /** La playlist dans son ordre : les sons du CLOUD (à leur place) et les titres des plateformes. */
  function mixed(p) {
    const tracks = p.tracks.map((t, i) => ({ key: "t" + t.id, track: t, at: state.positions[t.id] ?? i, rank: 0 }));
    const items = itemsOf(p.id).map((x) => ({ key: "x" + x.id, item: x, at: x.position, rank: 1 }));
    return [...tracks, ...items].sort((a, b) => a.at - b.at || a.rank - b.rank);
  }
  // En entier par le compte de l'auditeur quand c'est possible, sinon l'extrait (url) ; le lecteur bascule tout seul.
  const playerItem = (x) => ({ key: "x" + x.id, id: null, trackId: null, title: x.title, artist: x.artist,
    subtitle: [x.artist, NAMES[x.platform] + (engineFor(x.platform) ? "" : " · extrait 30 s")].filter(Boolean).join(" · "), cover: x.cover, url: x.listen,
    engine: engineFor(x.platform), extId: x.extId || x.id, duration: engineFor(x.platform) ? x.duration || 0 : 30, peaks: [], comments: [], lyrics: "" });

  function row(p, x, i, onPlay) {
    const { el, icon } = ctx;
    const remove = el("button", { className: "dots", type: "button", ariaLabel: "Retirer " + x.title + " de la playlist", title: "Retirer de la playlist" }, icon("close"));
    remove.onclick = (event) => {
      event.stopPropagation();
      ctx.api("DELETE", "/me/sounds/platform-items/" + x.id).then(load).then(ctx.changed, (error) => alert(error.message));
    };
    // Le titre entier, sur sa plateforme (dans l'application ONIRIQUE CENTRAL : le navigateur ou l'application de la plateforme).
    const li = el("li", { className: "trk pf", tabIndex: 0, title: "Écouter" },
      // La pochette du titre, là où un son du CLOUD a son numéro : on voit d'un coup d'œil ce qui vient d'une plateforme.
      x.cover ? el("img", { className: "pf-cover", src: x.cover, alt: "", loading: "lazy" }) : el("span", { className: "num", textContent: String(i + 1) }),
      el("div", {}, el("div", { className: "tline" }, el("b", { textContent: x.title })),
        el("small", { textContent: [x.artist, !playable(x) ? "indisponible" : engineFor(x.platform) ? "" : "extrait 30 s"].filter(Boolean).join(" · ") })),
      el("span", { className: "badges" }, el("span", { className: "pf-tag", textContent: NAMES[x.platform] })),
      el("span", { className: "len", textContent: time(x.duration) }),
      on ? remove : el("span"));
    li.dataset.key = "x" + x.id;
    const go = () => {
      if (playable(x)) return onPlay();
      if (!window.oniriqueApp) return alert("Lie ton compte Spotify à ONIRIQUE pour écouter « " + x.title + " » : sans compte lié, les titres Spotify restent grisés.");
      // Pas de compte Spotify connecté : on propose de le connecter, sans jouer.
      if (window.confirm("Connecte ton compte Spotify pour écouter « " + x.title + " » : les titres Spotify se jouent en entier dans le lecteur du CLOUD une fois ton compte connecté.")) { openAccounts(); }
    };
    li.onclick = go;
    li.onkeydown = (event) => { if (event.key === "Enter") go(); };
    if (!playable(x)) li.classList.add("pf-locked");
    return li;
  }
  const order = (p, keys) => ctx.api("PUT", "/me/sounds/projects/" + p.id + "/mixed-order", { keys }).then(load);

  //---------------------------------------------------------------------------- La fenêtre d'ajout
  let dialog = null, target = null, tab = "search", results = [], found = null, query = "", busy = false, error = "", added = new Set(), deezerLists = null;
  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "platform-add";
    dialog.addEventListener("close", () => { if (ctx.player.item && /^x?pv/.test(ctx.player.item.key) && ctx.player.playing) ctx.player.toggle(); });
    document.body.append(dialog);
    return dialog;
  }
  function openAdd(p) { openedFromSearch = false; tab = "search"; target = p; added = new Set(itemsOf(p.id).map((x) => x.platform + ":" + x.extId)); error = ""; draw(); if (!dialog.open) dialog.showModal(); }
  function openAccounts() { openedFromSearch = false; tab = "account"; target = null; error = ""; draw(); if (!dialog.open) dialog.showModal(); }
  /** La recherche Spotify, depuis la barre du CLOUD : les titres trouvés s'ajoutent à une playlist au choix. */
  let openedFromSearch = false;
  function openSearch(q) { openedFromSearch = true; tab = "search"; target = null; error = ""; query = q || ""; results = []; draw(); if (!dialog.open) dialog.showModal(); if (query.length > 1 && conf && conf.spotify && spotifyAccount()) search("spotify", query); }
  // Les playlists du CLOUD où l'on peut ajouter (les siennes et celles où l'on collabore), et celle choisie.
  const cloudLists = () => (ctx.playlists ? ctx.playlists() : []);
  const pickTarget = (id) => { target = cloudLists().find((x) => x.id === Number(id)) || null; added = new Set(target ? itemsOf(target.id).map((x) => x.platform + ":" + x.extId) : []); };
  const imported = (l) => cloudLists().some((x) => x.id === l.importedId);
  /** Une playlist Spotify du compte devient une playlist du CLOUD, du même nom, avec tous ses titres. */
  async function importList(l) {
    busy = true; error = ""; draw();
    try {
      const r = await ctx.api("POST", "/platforms/resolve", { url: l.url });
      const { id } = await ctx.api("POST", "/me/sounds/projects", { title: (r.title || l.title || "Playlist Spotify").slice(0, 120), kind: "playlist" });
      if (r.items.length) await ctx.api("POST", "/me/sounds/projects/" + id + "/platform-items", { items: r.items.slice(0, 200) });
      // La pochette de la playlist Spotify devient celle de la playlist du CLOUD.
      if (r.cover || l.cover) await ctx.api("POST", "/me/sounds/projects/" + id + "/platform-cover", { url: r.cover || l.cover }).catch(() => {});
      await load(); await ctx.changed(true);
      l.importedId = id;
      if (ctx.open) ctx.open(id);
    } catch (e) { error = e.message; }
    busy = false; draw();
  }

  async function add(items) {
    if (!target) return;
    busy = true; draw();
    try {
      await ctx.api("POST", "/me/sounds/projects/" + target.id + "/platform-items", { items });
      for (const x of items) added.add(x.platform + ":" + x.id);
      await load(); ctx.changed();
    } catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function search(source, q) {
    busy = true; error = ""; results = []; draw();
    // Un lien Spotify collé dans la recherche : le titre, l'album ou la playlist qu'il désigne, prêts à ajouter.
    const link = /^https:\/\/(open\.spotify\.com|spotify\.link)\//.test(q);
    try { results = link ? (await ctx.api("POST", "/platforms/resolve", { url: q })).items : await ctx.api("GET", "/platforms/search?source=" + source + "&q=" + encodeURIComponent(q)); }
    catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function resolve(url) {
    busy = true; error = ""; found = null; draw();
    try { found = await ctx.api("POST", "/platforms/resolve", { url }); } catch (e) { error = e.message; }
    busy = false; draw();
  }
  async function loadDeezerLists() {
    deezerLists = null;
    if (!state.accounts.some((a) => a.platform === "deezer")) return;
    try { deezerLists = await ctx.api("GET", "/me/platforms/deezer/playlists"); } catch (e) { deezerLists = []; error = e.message; }
    draw();
  }

  // Un résultat : écouter l'extrait (un clic le lance, un second le met en pause), puis l'ajouter.
  function resultRow(x) {
    const { el, icon, player } = ctx;
    const key = "pv" + x.platform + x.id, on = player.playing && player.item && player.item.key === key, inside = added.has(x.platform + ":" + x.id);
    const listen = el("button", { className: "pick-art" + (on ? " on" : ""), type: "button", disabled: !x.listen && !engineFor(x.platform), ariaLabel: (on ? "Pause : " : "Écouter ") + x.title,
      onclick: () => { if (player.item && player.item.key === key) player.toggle(); else player.play([{ ...playerItem({ ...x, id: x.id }), key, engine: engineFor(x.platform), extId: x.id }], 0); setTimeout(draw, 300); } },
      x.cover ? el("img", { src: x.cover, alt: "" }) : el("span", { className: "cover-ph" }), el("i", {}, icon(on ? "pause" : "play")));
    return el("li", {}, el("div", { className: "item" }, listen,
      el("span", { className: "grow pick-name" }, el("b", { className: "tline", textContent: x.title }), el("small", { textContent: [x.artist, time(x.duration)].filter(Boolean).join(" · ") })),
      el("span", { className: "pf-tag", textContent: NAMES[x.platform] }),
      target ? el("button", { className: inside ? "btn btn-ghost" : "btn btn-primary", type: "button", disabled: inside || busy, textContent: inside ? "Ajouté" : "Ajouter",
        onclick: () => add([x]) }) : ""));
  }

  let ownLists = { spotify: null, apple: null };
  async function loadOwnLists(platform) {
    try { ownLists[platform] = platform === "spotify" ? await ctx.api("GET", "/me/platforms/spotify/playlists") : await appleLibrary(); }
    catch (e) { ownLists[platform] = []; error = e.message; }
    draw();
  }
  // Une liste de playlists à importer : un clic les lit, prêtes à ajouter.
  function listOf(lists, open) {
    const { el } = ctx;
    return lists === null ? el("p", { className: "pf-note", textContent: "Chargement de tes playlists…" })
      : lists.length ? el("ul", { className: "group pf-list" }, ...lists.map((l) => el("li", {}, el("button", { className: "item", type: "button", onclick: () => open(l) },
        l.cover ? el("img", { src: l.cover, alt: "", style: "width:40px;height:40px;border-radius:8px;object-fit:cover" }) : el("span", { className: "cover-ph" }),
        el("span", { className: "grow pick-name" }, el("b", { textContent: l.title }), el("small", { textContent: l.count === null ? "Bibliothèque" : l.count + " titres" })),
        el("span", { className: "pf-tag", textContent: target ? "Importer" : "Ouvrir" })))))
        : el("p", { className: "pf-note", textContent: "Aucune playlist sur ce compte." });
  }
  /** Spotify ou Apple Music branchés sur ONIRIQUE : se connecter pour de vrai, écouter en entier, importer ses playlists. */
  function connectedBox(platform) {
    const { el } = ctx;
    const a = state.accounts.find((x) => x.platform === platform);
    const on = platform === "spotify" ? !!(a && a.connected) : appleOn;
    const head = el("div", { className: "pf-acc-head" }, el("b", { textContent: platform === "spotify" ? "Spotify · accès complet" : NAMES[platform] }),
      on ? el("span", { className: "pf-tag", textContent: platform === "spotify" ? (a.premium ? "Premium · " + a.name : "Gratuit · " + a.name) : "Connecté" }) : "",
      on ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Déconnecter", onclick: async () => {
        if (platform === "spotify") { await ctx.api("DELETE", "/me/platforms/spotify").catch((e) => { error = e.message; }); spToken = null; await load(); }
        else { try { (await appleKit()).unauthorize(); } catch {} appleOn = false; remember("apple", false); }
        ownLists[platform] = null; ctx.changed(); draw();
      } }) : el("div", { className: "row", style: "gap:8px" }, window.oniriqueApp && platform === "spotify" ? el("button", { className: "btn btn-ghost", type: "button", disabled: busy,
        textContent: busy ? "En attente du navigateur…" : "Poursuivre dans le navigateur", title: "Se connecter dans ton navigateur, où tu es déjà connecté à Spotify", onclick: spotifyBrowserLogin }) : "",
        el("button", { className: "btn btn-primary", type: "button", disabled: busy, textContent: "Se connecter", onclick: async () => {
        if (platform === "spotify") return spotifyLogin();
        busy = true; error = ""; draw();
        try { const m = await appleKit(); await m.authorize(); appleOn = m.isAuthorized; remember("apple", appleOn); if (appleOn) { ctx.changed(); loadOwnLists("apple"); } }
        catch (e) { error = "Connexion à Apple Music impossible : " + e.message; }
        busy = false; draw();
      } })));
    const note = !on ? (platform === "spotify" ? "Pour les comptes invités seulement : Spotify n'en laisse inviter que 5 par ONIRIQUE. L'accès complet ajoute la recherche par nom, la liste de tes playlists et leur import en entier, privées comprises. Sans invitation, la connexion ci-dessus suffit pour écouter en entier."
      : "Connecte ton compte : tes titres Apple Music se jouent en entier ici (abonnés Apple Music), et ta bibliothèque s'importe.")
      : platform === "spotify" && !a.premium ? "Spotify ne laisse jouer les titres en entier qu'aux comptes Premium : tu entends les extraits de 30 s. Tes playlists s'importent quand même en entier."
        : "Tes titres " + NAMES[platform] + " se jouent en entier ici, mêlés à tes sons du CLOUD.";
    const box = el("div", { className: "group pf-acc" }, head, el("p", { className: "pf-note", textContent: note }));
    if (on) {
      if (ownLists[platform] === null && !busy) setTimeout(() => loadOwnLists(platform), 0);
      box.append(listOf(ownLists[platform], (l) => {
        if (platform === "spotify") { tab = "lists"; draw(); return; }
        tab = "link";
        { query = ""; busy = true; found = null; draw(); appleLibraryTracks(l).then((r) => { found = r; }, (e) => { error = e.message; }).then(() => { busy = false; draw(); }); }
      }));
    }
    return box;
  }

  function accountsPanel() {
    const { el } = ctx;
    return el("div", { className: "stack" }, ...["spotify"].map((platform) => {
      if (platform === "apple" && conf && conf.apple) return connectedBox(platform);
      // Spotify : la connexion sur l'appareil pour tout le monde (sans liste d'invités), et l'accès complet en plus pour
      // les 5 comptes que Spotify laisse inviter.
      if (platform === "spotify") {
        if (spWeb === null && window.oniriqueApp) setTimeout(spotifyChanged, 0);
        return el("div", { className: "stack" }, el("div", { className: "group pf-acc" },
          el("div", { className: "pf-acc-head" }, el("b", { textContent: "Spotify" }),
            spWeb ? el("span", { className: "pf-tag", textContent: "Connecté" }) : "",
            spWeb ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Se déconnecter", onclick: async () => { await window.oniriqueApp.spotifyLogout().catch(() => {}); spotifyChanged(); } })
              : el("button", { className: "btn btn-primary", type: "button", textContent: "Se connecter à Spotify", onclick: spotifyWebLogin })),
          el("p", { className: "pf-note", textContent: spWeb
            ? "Ton compte Spotify est connecté sur cet appareil : tes titres Spotify se jouent en entier dans le lecteur du CLOUD, mêlés à tes sons. Pour importer une playlist, colle son lien dans « Rechercher »."
            : "Connecte-toi une fois à ton compte Spotify sur cet appareil : tes titres Spotify se jouent en entier dans le lecteur du CLOUD, mêlés à tes sons (sinon, leur extrait). Pour importer une playlist, colle son lien dans « Rechercher »." })),
          conf && conf.spotify ? connectedBox(platform) : "");
      }
      const a = state.accounts.find((x) => x.platform === platform);
      const input = el("input", { type: "url", placeholder: NAMES[platform] + " : lien de ton profil", autocomplete: "off" });
      const form = el("form", { onsubmit: async (event) => {
        event.preventDefault();
        busy = true; error = ""; draw();
        try { await ctx.api("PUT", "/me/platforms/" + platform, { url: input.value }); await load(); if (platform === "deezer") await loadDeezerLists(); } catch (e) { error = e.message; }
        busy = false; draw();
      } }, input, el("button", { className: "btn btn-primary", type: "submit", disabled: busy, textContent: "Lier" }));
      const box = el("div", { className: "group pf-acc" },
        el("div", { className: "pf-acc-head" }, el("b", { textContent: NAMES[platform] }),
          a ? el("a", { className: "btn btn-ghost", href: a.url, target: "_blank", rel: "noopener", textContent: a.name }) : el("span", { className: "pf-tag", textContent: "Non lié" }),
          a ? el("button", { className: "btn btn-ghost", type: "button", textContent: "Délier", onclick: async () => {
            await ctx.api("DELETE", "/me/platforms/" + platform).catch((e) => { error = e.message; });
            await load(); if (platform === "deezer") deezerLists = null; draw();
          } }) : ""),
        a ? "" : form, el("p", { className: "pf-note", textContent: PROFILE_HINT[platform] }));
      // Les playlists publiques du compte Deezer lié : un clic les ouvre, prêtes à importer.
      if (platform === "deezer" && a) {
        box.append(deezerLists === null ? el("p", { className: "pf-note", textContent: "Chargement de tes playlists…" })
          : deezerLists.length ? el("ul", { className: "group pf-list" }, ...deezerLists.map((l) => el("li", {}, el("button", { className: "item", type: "button",
            onclick: () => { tab = "link"; query = l.url; resolve(l.url); } },
            l.cover ? el("img", { src: l.cover, alt: "", style: "width:40px;height:40px;border-radius:8px;object-fit:cover" }) : el("span", { className: "cover-ph" }),
            el("span", { className: "grow pick-name" }, el("b", { textContent: l.title }), el("small", { textContent: l.count + " titres" })),
            el("span", { className: "pf-tag", textContent: target ? "Importer" : "Ouvrir" })))))
            : el("p", { className: "pf-note", textContent: "Aucune playlist publique sur ce profil Deezer." }));
      }
      return box;
    }));
  }

  function draw() {
    const { el, icon } = ctx;
    ensureDialog();
    const api = !!(conf && conf.spotify), on = !!spotifyAccount();
    const tabs = [["search", "Rechercher"], ["lists", "Mes playlists"], ["account", "Mon compte"]];
    const tabBar = el("div", { className: "pf-tabs", role: "tablist" }, ...tabs.map(([id, label]) => el("button", { type: "button", role: "tab", ariaSelected: String(tab === id),
      onclick: () => { tab = id; error = ""; draw(); } }, label)));
    // Sans compte connecté (ou tant que Spotify n'est pas branché sur ONIRIQUE), la recherche et les playlists attendent.
    const needAccount = () => el("div", { className: "group pf-acc" },
      el("p", { className: "pf-note", textContent: "La liste de tes playlists demande l'accès complet, que Spotify réserve à 5 comptes invités. Sans lui, colle le lien d'une playlist dans « Rechercher » pour l'importer (publique ou partagée par lien)." }),
      el("div", {}, api ? el("button", { className: "btn btn-ghost", type: "button", textContent: "J'ai un compte invité", onclick: spotifyLogin }) : ""));
    // La playlist du CLOUD qui reçoit les titres : choisie ici quand la fenêtre s'ouvre depuis la barre de recherche.
    const lists = cloudLists();
    const pick = lists.length ? el("label", { className: "pf-target" }, "Ajouter à",
      el("select", { onchange: (event) => { pickTarget(event.target.value); draw(); } },
        el("option", { value: "", textContent: "Choisis une playlist du CLOUD" }),
        ...lists.map((x) => el("option", { value: String(x.id), selected: !!(target && target.id === x.id), textContent: x.title })))) : null;
    let body;
    if (tab === "account") body = accountsPanel();
    else if (tab === "lists" && (!api || !on)) body = needAccount();
    else if (tab === "lists") {
      if (ownLists.spotify === null && !busy) setTimeout(() => loadOwnLists("spotify"), 0);
      const L = ownLists.spotify;
      body = L === null ? el("p", { className: "pf-note", textContent: "Chargement de tes playlists…" })
        : L.length ? el("ul", { className: "group pf-list" }, ...L.map((l) => el("li", {}, el("div", { className: "item", style: "cursor:default" },
          l.cover ? el("img", { src: l.cover, alt: "", style: "width:44px;height:44px;border-radius:8px;object-fit:cover" }) : el("span", { className: "cover-ph" }),
          el("span", { className: "grow pick-name" }, el("b", { textContent: l.title }), el("small", { textContent: l.count + " titre" + (l.count > 1 ? "s" : "") })),
          target ? el("button", { className: "btn btn-ghost", type: "button", disabled: busy, textContent: "Ajouter ici", onclick: async () => {
            busy = true; error = ""; draw();
            try { const r = await ctx.api("POST", "/platforms/resolve", { url: l.url }); const fresh = r.items.filter((x) => !added.has(x.platform + ":" + x.id)); busy = false; if (fresh.length) await add(fresh.slice(0, 200));
              // Une playlist du CLOUD sans pochette prend celle de la playlist Spotify.
              if (r.cover || l.cover) { await ctx.api("POST", "/me/sounds/projects/" + target.id + "/platform-cover", { url: r.cover || l.cover }).catch(() => {}); ctx.changed(true); } }
            catch (e) { error = e.message; busy = false; }
            draw();
          } }) : "",
          // « Importée » tant que la playlist créée existe dans le CLOUD ; supprimée, elle se réimporte.
          el("button", { className: imported(l) ? "btn btn-ghost" : "btn btn-primary", type: "button", disabled: busy || imported(l), textContent: imported(l) ? "Importée" : "Importer dans le CLOUD",
            title: "Une playlist du même nom dans ton CLOUD, avec tous ses titres", onclick: () => importList(l) })))))
          : el("p", { className: "pf-note", textContent: "Aucune playlist sur ton compte Spotify." });
    } else {
      // Sans l'accès complet (5 comptes invités au plus), Spotify ne se cherche pas par nom : on colle un lien.
      const byName = api && on, isLink = (q) => /^https:\/\/(open\.spotify\.com|spotify\.link)\//.test(q);
      const input = el("input", { type: "search", placeholder: byName ? "Chercher sur Spotify : titre, artiste, ou un lien" : "Colle le lien Spotify d'un titre, d'un album ou d'une playlist", value: query, autocomplete: "off" });
      body = el("div", { className: "stack" },
        el("form", { onsubmit: (event) => {
          event.preventDefault(); query = input.value.trim();
          if (!byName && !isLink(query)) { error = "Colle un lien open.spotify.com : la recherche par nom demande l'accès complet (comptes invités)."; draw(); return; }
          if (query.length > 1) search("spotify", query);
        } }, input,
          el("button", { className: "btn btn-primary", type: "submit", disabled: busy, textContent: byName ? "Chercher" : "Ouvrir" })),
        openedFromSearch ? pick : null,
        // Une playlist ou un album collé : il s'importe en entier, comme une playlist du compte.
        results.length && isLink(query) && /\/(playlist|album)\//.test(query) ? el("div", {}, el("button", { className: "btn btn-primary", type: "button", disabled: busy,
          textContent: "Importer dans le CLOUD", title: "Une playlist du même nom dans ton CLOUD, avec tous ses titres", onclick: () => importList({ url: query, title: "" }) })) : null,
        results.length ? el("ul", { className: "group pf-list" }, ...results.map(resultRow))
          : el("p", { className: "pf-note", textContent: busy ? "Recherche…" : byName ? "Cherche un titre ou un artiste : écoute-le, puis ajoute-le à une playlist du CLOUD."
            : "Colle le lien d'un titre, d'un album ou d'une playlist Spotify (publique ou partagée par lien) : écoute-le, ajoute-le à une playlist du CLOUD, ou importe la playlist entière." }));
    }
    dialog.replaceChildren(
      el("div", { className: "dlg-head" }, el("b", { textContent: target && !openedFromSearch ? "Ajouter à « " + target.title + " »" : "Spotify" }),
        el("button", { className: "x", type: "button", ariaLabel: "Fermer", onclick: () => dialog.close() }, icon("close"))),
      el("div", { className: "pf-body" }, tabBar, body, error ? el("p", { className: "error", textContent: error }) : ""));
    const box = dialog.querySelector("input");
    if (box && document.activeElement !== box && tab === "search") setTimeout(() => box.focus(), 0);
  }

  // Le retour de Spotify ouvert dans le navigateur (« Poursuivre dans le navigateur ») : pas besoin d'être connecté au site.
  (async () => {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") || !/^b\./.test(q.get("state") || "")) return;
    history.replaceState(null, "", location.pathname);
    let message;
    try {
      const r = await fetch("/api/platforms/spotify/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: q.get("code"), state: q.get("state") }) });
      const d = await r.json().catch(() => ({}));
      message = r.ok ? "Spotify est connecté à ONIRIQUE. Tu peux fermer cette page et revenir dans l'application." : d.error || "Spotify a refusé la connexion.";
    } catch { message = "Spotify ne répond pas, réessaie depuis l'application."; }
    alert(message);
  })();
  /** Depuis l'application : la connexion à Spotify dans le navigateur ; l'application voit le compte arriver. */
  async function spotifyBrowserLogin() {
    try {
      const { url } = await ctx.api("POST", "/me/platforms/spotify/start");
      window.oniriqueApp.openExternal(url);
    } catch (e) { error = e.message; draw(); return; }
    error = ""; busy = true; draw();
    for (let i = 0; i < 100 && !spotifyAccount(); i++) { await new Promise((r) => setTimeout(r, 3000)); await load(); }
    busy = false; ctx.changed(); draw();
  }
  window.OniriquePlatforms = { NAMES, enabled, hidden, setup, load, spotifyChanged, playable, openSearch, itemsOf, mixed, playerItem, row, order, openAdd, openAccounts };
})();
