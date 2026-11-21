export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}
