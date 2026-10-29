import { badRequest } from './errors.js';

export function requireText(value, field, { max = 100 } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest(`${field} must be at most ${max} characters`);
  }
  return trimmed;
}

// Returns null when the value is missing or blank, so callers can clear optional fields.
export function optionalText(value, field, { max = 100 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, { max });
}

export function requireInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${field} must be a whole number between ${min} and ${max}`);
  }
  return value;
}

export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw badRequest(`${field} must be true or false`);
  }
  return value;
}

export function requireOneOf(value, field, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowedValues.join(', ')}`);
  }
  return value;
}

// Route parameters arrive as strings.
export function parseId(raw, field = 'id') {
  const text = String(raw);
  if (!/^[1-9][0-9]{0,14}$/.test(text)) {
    throw badRequest(`${field} must be a positive whole number`);
  }
  return Number(text);
}

export function requireObject(value, field = 'request body') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`${field} must be a JSON object`);
  }
  return value;
}

// Only paths inside the served media folder may be stored as logo paths.
export function optionalMediaPath(value, field) {
  const text = optionalText(value, field, { max: 200 });
  if (text === null) return null;
  if (!text.startsWith('/media/') || text.includes('..') || text.includes('\\')) {
    throw badRequest(`${field} must start with /media/ and must not contain ".."`);
  }
  return text;
}
