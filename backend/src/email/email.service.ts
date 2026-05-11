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
  cleanupInviteMd,
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

  async sendCleanupInvite(
    email: string,
    payload: {
      method: 'REQUEST' | 'CANCEL';
      cleanupName: string;
      when: string;
      locationName: string | null;
      cleanupLink: string;
      feedUrl: string;
      profileLink: string;
      icsContent: string;
    },
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const isCancel = payload.method === 'CANCEL';
    const title = isCancel
      ? `Cancelled: ${payload.cleanupName}`
      : `You're going: ${payload.cleanupName}`;
    const intro = isCancel
      ? `Your participation in **${payload.cleanupName}** has been removed. This event will be cancelled in your calendar.`
      : `Thanks for joining **${payload.cleanupName}**. We've attached a calendar invite so you don't miss it.`;
    const locationLine = payload.locationName ? `**Where:** ${payload.locationName}` : '';
    const subject = `${title} — ${payload.when}`;

    const { html, text } = render(
      cleanupInviteMd({
        title,
        intro,
        when: payload.when,
        locationLine,
        cleanupLink: payload.cleanupLink,
        feedUrl: payload.feedUrl,
        profileLink: payload.profileLink,
      }),
      { theme: defaultTheme },
    );

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject,
        text,
        html,
        // Inline + attached: many clients honour the inline calendar part and surface a native "Add to calendar" button.
        alternatives: [
          {
            contentType: `text/calendar; charset=utf-8; method=${payload.method}`,
            content: payload.icsContent,
          },
        ],
        attachments: [
          {
            filename: isCancel ? 'cancel.ics' : 'invite.ics',
            content: payload.icsContent,
            contentType: `text/calendar; charset=utf-8; method=${payload.method}`,
          },
        ],
      } as any);
      this.logger.log(`Cleanup ${payload.method} sent to ${email} for ${payload.cleanupName}`);
    } catch (error) {
      this.logger.error(`Failed to send cleanup ${payload.method} to ${email}`, error.stack);
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
