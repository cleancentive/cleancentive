import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { render } from 'emailmd';
import { defaultTheme, dangerTheme } from './email.theme';
import {
  magicLinkMd,
  recoveryMd,
  mergeWarningMd,
  communityMessageMd,
} from './email.templates';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const host = this.configService.get<string>('SMTP_HOST', 'localhost');
    const port = parseInt(this.configService.get<string>('SMTP_PORT', '1025'), 10);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const secure = this.configService.get<string>('SMTP_SECURE', 'false') === 'true';

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
    const { html, text } = render(magicLinkMd(link), { theme: defaultTheme });

    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: 'Your CleanCentive Magic Link',
        text,
        html,
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
      const { html, text } = render(recoveryMd(links[i]), { theme: defaultTheme });

      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: emails[i],
          subject: 'CleanCentive Account Recovery',
          text,
          html,
        });
        this.logger.log(`Recovery link sent to ${emails[i]}`);
      } catch (error) {
        this.logger.error(`Failed to send recovery link to ${emails[i]}`, error.stack);
      }
    }
  }

  async sendMergeWarning(email: string, link: string, requesterNickname: string): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const { html, text } = render(mergeWarningMd(link, requesterNickname), { theme: dangerTheme });

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: 'CleanCentive — Someone wants to merge your account',
        text,
        html,
      });
      this.logger.log(`Merge warning sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send merge warning to ${email}`, error.stack);
      throw new Error('Failed to send merge warning email');
    }
  }

  async sendCommunityMessage(
    recipients: string[],
    senderEmail: string | null,
    payload: { subject: string; preheader: string; title: string; body: string; disclosure: string },
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const uniqueRecipients = [...new Set(recipients.map((e) => e.trim().toLowerCase()).filter(Boolean))];

    if (uniqueRecipients.length === 0 && !senderEmail) {
      return;
    }

    const { html, text } = render(communityMessageMd(payload), { theme: defaultTheme });

    // Send one email: CC the sender, BCC all other recipients to keep addresses private
    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: fromAddress,
        cc: senderEmail || undefined,
        bcc: uniqueRecipients.length > 0 ? uniqueRecipients.join(', ') : undefined,
        subject: payload.subject,
        text,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send community message`, error.stack);
    }
  }
}
