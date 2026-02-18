import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const host = this.configService.get<string>('SMTP_HOST', 'localhost');
    const port = this.configService.get<number>('SMTP_PORT', 1025);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<boolean>('SMTP_SECURE', false);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      // Disable TLS for local development (Mailpit)
      tls: {
        rejectUnauthorized: false,
      },
    });

    this.logger.log(`Email service initialized with SMTP host: ${host}:${port}`);
  }

  async sendMagicLink(email: string, link: string): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');

    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: 'Your CleanCentive Magic Link',
        text: this.generatePlainTextEmail(link),
        html: this.generateHtmlEmail(link),
      });

      this.logger.log(`Magic link sent to ${email} (Message ID: ${info.messageId})`);
    } catch (error) {
      this.logger.error(`Failed to send magic link to ${email}`, error.stack);
      throw new Error('Failed to send magic link email');
    }
  }

  async sendRecoveryLinks(emails: string[], links: string[]): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');

    for (let i = 0; i < emails.length; i++) {
      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: emails[i],
          subject: 'CleanCentive Account Recovery',
          text: this.generateRecoveryPlainText(links[i]),
          html: this.generateRecoveryHtml(links[i]),
        });
        this.logger.log(`Recovery link sent to ${emails[i]}`);
      } catch (error) {
        this.logger.error(`Failed to send recovery link to ${emails[i]}`, error.stack);
      }
    }
  }

  async sendMergeWarning(email: string, link: string, requesterNickname: string): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: 'CleanCentive — Someone wants to merge your account',
        text: this.generateMergeWarningPlainText(link, requesterNickname),
        html: this.generateMergeWarningHtml(link, requesterNickname),
      });
      this.logger.log(`Merge warning sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send merge warning to ${email}`, error.stack);
      throw new Error('Failed to send merge warning email');
    }
  }

  private generateRecoveryPlainText(link: string): string {
    return `CleanCentive Account Recovery

Someone requested access to the account linked to this email address.

Click the link below to sign in:

${link}

This link will expire in 24 hours.

If you didn't request this, you can safely ignore this email.

---
CleanCentive - Environmental Cleanup Tracking
`;
  }

  private generateRecoveryHtml(link: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">CleanCentive</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Account Recovery</p>
  </div>
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Account Recovery</h2>
    <p>Someone requested access to the account linked to this email. Click below to sign in:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Sign In</a>
    </div>
    <p style="color: #666; font-size: 14px;">Or copy and paste this link:</p>
    <p style="word-break: break-all; background: white; padding: 10px; border-radius: 5px; font-size: 12px; color: #667eea;">${link}</p>
    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
    <p style="color: #999; font-size: 12px;"><strong>Security Note:</strong> This link expires in 24 hours. If you didn't request this, ignore this email.</p>
  </div>
</body>
</html>`;
  }

  private generateMergeWarningPlainText(link: string, requesterNickname: string): string {
    return `CleanCentive — Account Merge Request

WARNING: This is a sensitive action. Read carefully before clicking.

User "${requesterNickname}" has requested to merge YOUR account into theirs.

If you click the link below:
- All YOUR cleanup history and data will be transferred to "${requesterNickname}"'s account
- YOUR account will be permanently DELETED
- You will lose access to your account
- This action CANNOT be undone

Only click this link if you trust "${requesterNickname}" and intentionally want to merge your account into theirs.

${link}

This link will expire in 24 hours.

If you did NOT request this or don't recognize "${requesterNickname}", DO NOT click the link.
Someone may be trying to take over your account. You can safely ignore this email.

---
CleanCentive - Environmental Cleanup Tracking
`;
  }

  private generateMergeWarningHtml(link: string, requesterNickname: string): string {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">CleanCentive</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Account Merge Request</p>
  </div>
  <div style="background: #fef2f2; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #fecaca;">
    <div style="background: #dc2626; color: white; padding: 12px 16px; border-radius: 5px; margin-bottom: 20px; font-weight: bold;">
      WARNING: This is a sensitive and irreversible action
    </div>
    <p>User <strong>"${requesterNickname}"</strong> has requested to merge <strong>YOUR</strong> account into theirs.</p>
    <div style="background: white; border: 1px solid #fecaca; border-radius: 5px; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0; font-weight: bold; color: #dc2626;">If you click the link below:</p>
      <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
        <li>All YOUR cleanup history and data will be transferred to "${requesterNickname}"</li>
        <li>YOUR account will be <strong>permanently DELETED</strong></li>
        <li>You will <strong>lose access</strong> to your account</li>
        <li>This action <strong>CANNOT be undone</strong></li>
      </ul>
    </div>
    <p><strong>Only click if you trust "${requesterNickname}" and intentionally want to merge.</strong></p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${link}" style="display: inline-block; background: #dc2626; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Confirm Merge — Delete My Account</a>
    </div>
    <hr style="border: none; border-top: 1px solid #fecaca; margin: 30px 0;">
    <p style="color: #991b1b; font-size: 13px; font-weight: bold;">
      If you did NOT request this or don't recognize "${requesterNickname}", DO NOT click the link.<br>
      Someone may be trying to take over your account. You can safely ignore this email.
    </p>
    <p style="color: #999; font-size: 12px;">This link expires in 24 hours.</p>
  </div>
</body>
</html>`;
  }

  private generatePlainTextEmail(link: string): string {
    return `Welcome to CleanCentive!

Click the link below to sign in to your account:

${link}

This link will expire in 24 hours.

If you didn't request this email, you can safely ignore it.

---
CleanCentive - Environmental Cleanup Tracking
`;
  }

  private generateHtmlEmail(link: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your CleanCentive Magic Link</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">CleanCentive</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Environmental Cleanup Tracking</p>
  </div>
  
  <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Welcome!</h2>
    
    <p>Click the button below to sign in to your CleanCentive account:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${link}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Sign In to CleanCentive</a>
    </div>
    
    <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
    <p style="word-break: break-all; background: white; padding: 10px; border-radius: 5px; font-size: 12px; color: #667eea;">${link}</p>
    
    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
    
    <p style="color: #999; font-size: 12px; margin: 0;">
      <strong>Security Note:</strong> This link will expire in 24 hours.<br>
      If you didn't request this email, you can safely ignore it.
    </p>
  </div>
</body>
</html>
`;
  }
}
