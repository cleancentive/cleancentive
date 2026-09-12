import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { render } from 'emailmd';
import { type Locale } from '@cleancentive/shared';
import { getCurrentLocale } from '../common/request-context';
import { defaultTheme, dangerTheme } from './email.theme';
import { emailStrings } from './email.i18n';
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

  async sendMagicLink(
    email: string,
    link: string,
    requestMetadata?: { browser: string; location: string; requestedAt: string },
    locale: Locale = getCurrentLocale(),
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const { html, text } = render(magicLinkMd(link, requestMetadata, locale), { theme: defaultTheme });

    try {
      const info = await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: emailStrings(locale).magicLinkSubject,
        text,
        html,
      });

      this.logger.log(`Magic link sent to ${email} (Message ID: ${info.messageId})`);
    } catch (error) {
      this.logger.error(`Failed to send magic link to ${email}`, error.stack);
      throw new Error('Failed to send magic link email');
    }
  }

  async sendRecoveryLinks(
    emails: string[],
    links: string[],
    locale: Locale = getCurrentLocale(),
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');

    for (let i = 0; i < emails.length; i++) {
      const { html, text } = render(recoveryMd(links[i], locale), { theme: defaultTheme });

      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: emails[i],
          subject: emailStrings(locale).recoverySubject,
          text,
          html,
        });
        this.logger.log(`Recovery link sent to ${emails[i]}`);
      } catch (error) {
        this.logger.error(`Failed to send recovery link to ${emails[i]}`, error.stack);
      }
    }
  }

  async sendMergeWarning(
    email: string,
    link: string,
    requesterNickname: string,
    locale: Locale = getCurrentLocale(),
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const { html, text } = render(mergeWarningMd(link, requesterNickname, locale), { theme: dangerTheme });

    try {
      await this.transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: emailStrings(locale).mergeSubject,
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
    locale: Locale = getCurrentLocale(),
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');
    const isCancel = payload.method === 'CANCEL';
    const s = emailStrings(locale).cleanup;
    const title = isCancel ? s.cancelTitle(payload.cleanupName) : s.goingTitle(payload.cleanupName);
    const intro = isCancel ? s.cancelIntro(payload.cleanupName) : s.goingIntro(payload.cleanupName);
    const locationLine = payload.locationName ? s.whereLine(payload.locationName) : '';
    const subject = s.subject(title, payload.when);

    const { html, text } = render(
      cleanupInviteMd(
        {
          title,
          intro,
          when: payload.when,
          locationLine,
          cleanupLink: payload.cleanupLink,
          feedUrl: payload.feedUrl,
          profileLink: payload.profileLink,
        },
        locale,
      ),
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

  /**
   * Fan-out message, rendered in each recipient's own locale.
   *
   * Recipients carry their locale (see UserService.getNotificationRecipients) and
   * `buildPayload` is called once per distinct locale, so one send becomes one
   * message per locale group. A single bcc'd email cannot serve mixed locales,
   * which is why this takes a builder rather than a rendered payload.
   *
   * Callers whose copy is still English-only pass a constant builder; they lose
   * nothing and the template chrome still renders per recipient.
   */
  async sendCommunityMessage(
    recipients: Array<{ email: string; locale: Locale }>,
    senderEmail: string | null,
    buildPayload: (locale: Locale) => {
      subject: string;
      preheader: string;
      title: string;
      body: string;
      disclosure: string;
    },
  ): Promise<void> {
    const fromAddress = this.configService.get<string>('SMTP_FROM', 'noreply@cleancentive.local');

    const byLocale = new Map<Locale, string[]>();
    const seen = new Set<string>();
    for (const recipient of recipients) {
      const email = recipient.email?.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const group = byLocale.get(recipient.locale);
      if (group) group.push(email);
      else byLocale.set(recipient.locale, [email]);
    }

    if (byLocale.size === 0 && !senderEmail) {
      return;
    }

    // The sender is CC'd exactly once, on the group matching their own locale —
    // not once per group. With no recipients at all they still get their copy.
    const senderLocale = getCurrentLocale();
    if (senderEmail && byLocale.size === 0) {
      byLocale.set(senderLocale, []);
    }
    let senderGroup: Locale | null = senderEmail
      ? byLocale.has(senderLocale)
        ? senderLocale
        : [...byLocale.keys()][0]
      : null;

    for (const [locale, groupRecipients] of byLocale) {
      const payload = buildPayload(locale);
      const { html, text } = render(communityMessageMd(payload, locale), { theme: defaultTheme });
      const cc = senderGroup === locale ? senderEmail || undefined : undefined;
      if (cc) senderGroup = null;

      // BCC within the group keeps addresses private; separate groups never see
      // each other at all.
      try {
        await this.transporter.sendMail({
          from: fromAddress,
          to: fromAddress,
          cc,
          bcc: groupRecipients.length > 0 ? groupRecipients.join(', ') : undefined,
          subject: payload.subject,
          text,
          html,
        });
      } catch (error) {
        this.logger.error(`Failed to send community message (${locale})`, error.stack);
      }
    }
  }
}
