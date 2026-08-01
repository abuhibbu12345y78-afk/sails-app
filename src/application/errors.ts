export class DomainError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}
