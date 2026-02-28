import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Config } from '../config.js';
import type { NotificationChannel, NotificationParams } from './types.js';

export class EmailChannel implements NotificationChannel {
  readonly name = 'email';
  private transporter: Transporter;
  private from: string;
  private replyTo: string | undefined;
  private cc: string | undefined;

  constructor(config: Config) {
    this.from = config.smtpFrom;
    this.replyTo = config.smtpReplyTo;
    this.cc = config.smtpCc;
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
    });
  }

  async send(params: NotificationParams): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: params.to.join(', '),
      subject: params.subject,
      text: params.body,
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
      ...(this.cc ? { cc: this.cc } : {}),
    });
    await Bun.sleep(1_000); // Throttle to avoid SMTP rate limits
  }

  /** Verify SMTP connection is working */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }
}
