import { Injectable } from '@nestjs/common';

@Injectable()
export class MockEmailService {
  private sentEmails: Array<{ to: string; subject: string; content: string }> = [];

  async sendMagicLink(email: string, magicLink: string): Promise<void> {
    const emailContent = `
      CleanCentive Magic Link

      Click this link to sign in: ${magicLink}

      This link will expire in 24 hours.
    `;

    this.sentEmails.push({
      to: email,
      subject: 'Your CleanCentive Magic Link',
      content: emailContent,
    });

    console.log(`📧 MOCK EMAIL SENT to ${email}:`);
    console.log(`Subject: Your CleanCentive Magic Link`);
    console.log(`Link: ${magicLink}`);
    console.log('---');
  }

  getSentEmails() {
    return this.sentEmails;
  }

  clearEmails() {
    this.sentEmails = [];
  }
}