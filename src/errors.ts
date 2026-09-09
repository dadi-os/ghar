/** HTTP errors in the contract shape `{error: {type, message}}`. */

export class GharError extends Error {
  readonly statusCode: number;
  readonly type: string;

  constructor(statusCode: number, type: string, message: string) {
    super(message);
    this.name = "GharError";
    this.statusCode = statusCode;
    this.type = type;
  }
}
