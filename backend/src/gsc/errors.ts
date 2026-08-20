export class GscUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'GscUnavailableError';
    this.reason = reason;
  }
}