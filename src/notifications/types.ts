/** Abstraction for a notification delivery channel */
export interface NotificationChannel {
  /** Unique name for this channel (e.g. "email", "slack") */
  readonly name: string;

  /** Send a notification */
  send(params: NotificationParams): Promise<void>;
}

export interface NotificationParams {
  to: string[];
  subject: string;
  body: string;
}
