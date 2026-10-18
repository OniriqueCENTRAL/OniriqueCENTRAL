// Essai des liens vers les applications (site/assets/deeplink.js) : node tools/deeplink.test.js
const assert = require('node:assert/strict');
const { platformOf, deviceOf, appLink } = require('../site/assets/deeplink.js');

const android = deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Instagram 300.0', false);
const iosInsta = deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0', false);
const safari = deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', false);
const desktop = deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', false);
assert.deepEqual([android.os, android.inApp, iosInsta.os, iosInsta.inApp, safari.inApp, desktop.os], ['android', true, 'ios', true, false, 'other']);

const spotify = 'https://open.spotify.com/intl-fr/artist/4tZwfgrHOc3mvqYlEYSvVi?si=abc';
assert.equal(platformOf(spotify).id, 'spotify');
assert.equal(appLink(spotify, android).href,
  'intent://open.spotify.com/intl-fr/artist/4tZwfgrHOc3mvqYlEYSvVi?si=abc#Intent;scheme=https;package=com.spotify.music;S.browser_fallback_url='
  + encodeURIComponent(spotify) + ';end');
assert.deepEqual(appLink(spotify, iosInsta), { href: 'spotify:artist:4tZwfgrHOc3mvqYlEYSvVi', fallback: spotify });
assert.deepEqual(appLink(spotify, safari), { href: spotify, fallback: null }, 'Safari : le lien https ouvre déjà l\'application');
assert.deepEqual(appLink(spotify, desktop), { href: spotify, fallback: null });

assert.equal(appLink('https://www.instagram.com/euhz/', iosInsta).href, 'instagram://user?username=euhz');
assert.equal(appLink('https://www.instagram.com/p/abc/', iosInsta).href, 'https://www.instagram.com/p/abc/', 'publication : pas de lien d\'application connu');
assert.equal(appLink('https://youtu.be/dQw4w9WgXcQ', iosInsta).href, 'youtube://www.youtube.com/watch?v=dQw4w9WgXcQ');
assert.equal(appLink('https://x.com/onirique', iosInsta).href, 'twitter://user?screen_name=onirique');
assert.equal(platformOf('https://artiste.bandcamp.com/album/x').id, 'bandcamp');
assert.equal(platformOf('https://music.youtube.com/channel/x').id, 'youtubemusic');
assert.equal(platformOf('mailto:a@b.c').id, 'mail');
assert.equal(platformOf('https://exemple.fr'), null);
assert.deepEqual(appLink('https://exemple.fr', android), { href: 'https://exemple.fr', fallback: null }, 'un site quelconque reste un lien ordinaire');
assert.deepEqual(appLink('mailto:a@b.c', android), { href: 'mailto:a@b.c', fallback: null });
console.log('liens vers les applications : conformes');
