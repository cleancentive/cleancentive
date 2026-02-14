import { Injectable } from '@nestjs/common';

@Injectable()
export class EmailService {
  async sendMagicLink(email: string, link: string): Promise<void> {
    // In development, just log the link
    // In production, integrate with SendGrid, AWS SES, etc.
    console.log(`Magic link for ${email}: ${link}`);
    
    // TODO: Implement actual email sending
    // await this.emailProvider.send({
    //   to: email,
    //   subject: 'Your magic link',
    //   html: `Click here to sign in: <a href="${link}">${link}</a>`
    // });
  }
}