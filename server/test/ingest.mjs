import assert from 'node:assert/strict';
import { checkedUrl } from '../src/ingest.js';

for (const bad of ['file:///etc/passwd', '--exec=calc', 'ftp://93.184.216.34/a', 'http://user:pw@93.184.216.34/', 'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:10.0.0.1]/', 'http://169.254.169.254/latest', 'http://192.168.1.1/', '', null]) {
  await assert.rejects(checkedUrl(bad), `acceptée à tort : ${bad}`);
}
assert.equal(await checkedUrl(' https://93.184.216.34/a.mp3?x=1;rm -rf '), 'https://93.184.216.34/a.mp3?x=1;rm%20-rf');
console.log('ingest : ok');
