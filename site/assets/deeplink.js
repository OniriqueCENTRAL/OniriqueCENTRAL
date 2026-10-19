// Liens qui ouvrent l'application de la plateforme (Spotify, Instagram, YouTube…) plutôt que son site, même depuis le
// navigateur intégré d'Instagram ou de TikTok, qui n'ouvre pas les applications tout seul :
//  - Android : un lien intent:// vers le paquet de l'application, avec le site en repli si elle n'est pas installée ;
//  - iPhone : le lien propre à l'application (spotify:, instagram://…), puis le site si rien ne s'est ouvert ; un lien
//    https ouvert dans un nouvel onglet de Safari reste dans Safari, même quand l'application est installée ;
//  - TikTok : son navigateur refuse tout lien d'application (« l'action ne peut pas être réalisée ») : le lien https
//    ordinaire, et la page explique comment l'ouvrir dans le navigateur du téléphone.
(function (root) {
  const segments = (u) => u.pathname.split("/").filter(Boolean);
  const first = (u) => segments(u)[0] || "";

  // id : le nom de l'icône (assets/icons/<id>.svg). ios(url) : le lien propre à l'application, ou rien.
  const APPS = [
    { id: "spotify", name: "Spotify", hosts: ["open.spotify.com", "spotify.link"], android: "com.spotify.music",
      ios: (u) => { const s = segments(u).filter((p) => !/^intl-/.test(p)); return /^(artist|track|album|playlist|show|episode|user|search)$/.test(s[0]) && s[1] ? `spotify:${s[0]}:${s[1]}` : null; } },
    { id: "applemusic", name: "Apple Music", hosts: ["music.apple.com"], android: "com.apple.android.music", ios: (u) => `music://${u.host}${u.pathname}${u.search}` },
    { id: "youtubemusic", name: "YouTube Music", hosts: ["music.youtube.com"], android: "com.google.android.apps.youtube.music", ios: () => null },
    { id: "youtube", name: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"], android: "com.google.android.youtube",
      ios: (u) => (u.host === "youtu.be" ? `youtube://www.youtube.com/watch?v=${first(u)}` : `youtube://www.youtube.com${u.pathname}${u.search}`) },
    { id: "instagram", name: "Instagram", hosts: ["instagram.com", "www.instagram.com"], android: "com.instagram.android",
      ios: (u) => { const s = segments(u); return s.length === 1 && !/^(p|reel|reels|stories|explore)$/.test(s[0]) ? `instagram://user?username=${s[0]}` : null; } },
    { id: "tiktok", name: "TikTok", hosts: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"], android: "com.zhiliaoapp.musically", ios: () => null },
    { id: "soundcloud", name: "SoundCloud", hosts: ["soundcloud.com", "on.soundcloud.com", "m.soundcloud.com"], android: "com.soundcloud.android", ios: () => null },
    { id: "deezer", name: "Deezer", hosts: ["deezer.com", "www.deezer.com", "link.deezer.com"], android: "deezer.android.app", ios: (u) => `deezer://www.deezer.com${u.pathname}` },
    { id: "x", name: "X", hosts: ["x.com", "twitter.com", "www.x.com", "www.twitter.com"], android: "com.twitter.android",
      ios: (u) => (segments(u).length === 1 ? `twitter://user?screen_name=${first(u)}` : null) },
    { id: "twitch", name: "Twitch", hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"], android: "tv.twitch.android.app",
      ios: (u) => (segments(u).length === 1 ? `twitch://stream/${first(u)}` : null) },
    { id: "snapchat", name: "Snapchat", hosts: ["snapchat.com", "www.snapchat.com"], android: "com.snapchat.android",
      ios: (u) => { const s = segments(u); return s[0] === "add" && s[1] ? `snapchat://add/${s[1]}` : null; } },
    { id: "facebook", name: "Facebook", hosts: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"], android: "com.facebook.katana",
      ios: (u) => `fb://facewebmodal/f?href=${encodeURIComponent(u.href)}` },
    { id: "threads", name: "Threads", hosts: ["threads.net", "www.threads.net", "threads.com", "www.threads.com"], android: "com.instagram.barcelona", ios: () => null },
    { id: "discord", name: "Discord", hosts: ["discord.gg", "discord.com"], android: "com.discord", ios: () => null },
    { id: "whatsapp", name: "WhatsApp", hosts: ["wa.me", "chat.whatsapp.com"], android: "com.whatsapp",
      ios: (u) => (u.host === "wa.me" && /^\d+$/.test(first(u)) ? `whatsapp://send?phone=${first(u)}` : null) },
    { id: "telegram", name: "Telegram", hosts: ["t.me"], android: "org.telegram.messenger", ios: (u) => (first(u) ? `tg://resolve?domain=${first(u)}` : null) },
    { id: "tidal", name: "TIDAL", hosts: ["tidal.com", "listen.tidal.com"], android: "com.aspiro.tidal", ios: () => null },
    { id: "amazonmusic", name: "Amazon Music", hosts: ["music.amazon.com", "music.amazon.fr"], android: "com.amazon.mp3", ios: () => null },
    { id: "bandcamp", name: "Bandcamp", hosts: ["bandcamp.com"], android: "com.bandcamp.android", ios: () => null, suffix: true },
    { id: "beatport", name: "Beatport", hosts: ["beatport.com", "www.beatport.com"], android: null, ios: () => null },
  ];

  const parse = (url) => { try { return new URL(url); } catch { return null; } };

  /** La plateforme d'un lien (pour son icône et son nom), ou null pour un site quelconque. */
  function platformOf(url) {
    const u = parse(url);
    if (!u) return null;
    if (u.protocol === "mailto:") return { id: "mail", name: "E-mail" };
    if (u.protocol === "tel:") return { id: "phone", name: "Téléphone" };
    const host = u.host.toLowerCase();
    return APPS.find((a) => a.hosts.includes(host) || (a.suffix && a.hosts.some((h) => host.endsWith("." + h)))) || null;
  }

  /** Le système du visiteur : android, ios, ou autre ; inApp : le navigateur intégré d'une application. */
  function deviceOf(ua, touchMac) {
    return {
      os: /Android/i.test(ua) ? "android" : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touchMac) ? "ios" : "other",
      inApp: /Instagram|FBAN|FBAV|FB_IAB|musical_ly|Bytedance|TikTok|Snapchat|Twitter|Line\//i.test(ua),
      tiktok: /musical_ly|Bytedance|TikTok|trill_/i.test(ua),
    };
  }

  /** Où envoyer le visiteur : href à ouvrir, et fallback (le site) si l'application ne s'ouvre pas. */
  function appLink(url, device) {
    const u = parse(url);
    const app = u && /^https?:$/.test(u.protocol) ? platformOf(url) : null;
    if (!app || !app.hosts || device.tiktok) return { href: url, fallback: null };
    if (device.os === "android" && app.android) {
      return { href: `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=${app.android};S.browser_fallback_url=${encodeURIComponent(u.href)};end`, fallback: null };
    }
    const scheme = device.os === "ios" ? app.ios(u) : null;
    return scheme ? { href: scheme, fallback: u.href } : { href: url, fallback: null };
  }

  /** Au clic sur un lien : l'application si possible, le site sinon. */
  function open(url) {
    const { href, fallback } = appLink(url, deviceOf(navigator.userAgent, navigator.maxTouchPoints > 1));
    if (href === url) return false; // lien ordinaire : le navigateur s'en charge
    location.href = href;
    // L'application ouverte, la page passe en arrière-plan ; restée visible, rien ne s'est ouvert : le site.
    if (fallback) setTimeout(() => { if (document.visibilityState === "visible") location.href = fallback; }, 1600);
    return true;
  }

  const api = { APPS, platformOf, deviceOf, appLink, open };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OniriqueDeepLink = api;
})(typeof window === "object" ? window : globalThis);
