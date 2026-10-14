import nodemailer from 'nodemailer';
import { config } from './config.js';
import { renderEmail, textToBlocks } from './mailtemplate.js';

// SMTP_HOST=test : rien n'est envoyé, les messages sont gardés dans `outbox` (tests automatiques).
const testing = config.smtpHost === 'test';
const transport = testing
  ? nodemailer.createTransport({ jsonTransport: true })
  : config.smtpHost && nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
  });

export const mailEnabled = !!transport;
export const outbox = [];

/**
 * Envoie un e-mail depuis l'adresse d'ONIRIQUE. Il part en deux versions : le texte simple, et sa mise en page à la
 * charte (mailtemplate.js), faite à partir du texte si `options.html` n'est pas fourni.
 * options : { html, buttonLabel (le bouton d'une adresse seule sur sa ligne), eyebrow, headers }
 */
export async function sendMail(to, subject, text, replyTo, options = {}) {
  const html = options.html ?? renderEmail({
    title: subject.replace(/\s+—\s+ONIRIQUE$/, ''),
    preheader: String(text).split('\n').find((line) => line.trim() && !/^Bonjour/.test(line)) || '',
    eyebrow: options.eyebrow || 'ONIRIQUE',
    blocks: textToBlocks(text, options.buttonLabel),
  });
  const message = { from: `ONIRIQUE <${config.mailFrom}>`, to, subject, text, html, replyTo, headers: options.headers };
  if (testing) outbox.push(message);
  return transport.sendMail(message);
}
