export class DomainError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "NOT_FOUND" | "INVALID_INPUT" | "CONFLICT" | "RATE_LIMITED", message: string) {
    super(message);
    this.name = "DomainError";
  }
}
