import nodemailer from 'nodemailer';
import { config } from './config.js';

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

export async function sendMail(to, subject, text, replyTo) {
  const message = { from: `ONIRIQUE <${config.mailFrom}>`, to, subject, text, replyTo };
  if (testing) outbox.push(message);
  return transport.sendMail(message);
}
