export class RuleViolation extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "RuleViolation";
  }
}
