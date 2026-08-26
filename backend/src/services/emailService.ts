import { Resend } from 'resend';
import { env } from '../config/env.js';

const FROM_EMAIL = 'VerseSEO <noreply@verseseo.com>';

function getClient(): Resend {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  return new Resend(apiKey);
}

function verificationEmailHtml(verificationUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="padding:40px 40px 24px;">
<div style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">VerseSEO</div>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a;">Verify your email address</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
Thanks for signing up for VerseSEO. Click the button below to verify your email address and get started.
</p>
<table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background-color:#2563eb;border-radius:10px;">
<a href="${verificationUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Verify Email Address</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;">
This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
</p>
</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:24px 40px 0;">
<p style="margin:0;font-size:12px;color:#94a3b8;">VerseSEO &mdash; Real crawl data, not guesses.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function passwordResetEmailHtml(resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="padding:40px 40px 24px;">
<div style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;">VerseSEO</div>
</td></tr>
<tr><td style="padding:0 40px 32px;">
<h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0f172a;">Reset your password</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#475569;">
We received a request to reset your password. Click the button below to choose a new password.
</p>
<table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
<td style="background-color:#2563eb;border-radius:10px;">
<a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Reset Password</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;">
This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
</p>
</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:24px 40px 0;">
<p style="margin:0;font-size:12px;color:#94a3b8;">VerseSEO &mdash; Real crawl data, not guesses.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const client = getClient();
  const baseUrl = env.NODE_ENV === 'production' ? 'https://verseseo.com' : 'http://localhost:4321';
  const verificationUrl = `${baseUrl}/verify-email?token=${token}`;
  await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Verify your VerseSEO account',
    html: verificationEmailHtml(verificationUrl),
    text: `Verify your email address: ${verificationUrl}`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const client = getClient();
  const baseUrl = env.NODE_ENV === 'production' ? 'https://verseseo.com' : 'http://localhost:4321';
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;
  await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject: 'Reset your VerseSEO password',
    html: passwordResetEmailHtml(resetUrl),
    text: `Reset your password: ${resetUrl}`,
  });
}
