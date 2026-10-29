// Errors that are safe to show to the client. Anything else becomes a generic 500.
export class AppError extends Error {
  constructor(status, message, { code = 'error', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, message, { code: 'bad_request', details });
export const unauthorized = (message) => new AppError(401, message, { code: 'unauthorized' });
export const notFound = (message) => new AppError(404, message, { code: 'not_found' });
export const conflict = (message, details) => new AppError(409, message, { code: 'conflict', details });
export const unprocessable = (message, details) => new AppError(422, message, { code: 'unprocessable', details });
