import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';

/** Validates request input and throws a clean 400 error if it is invalid. */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
      .join('; ');
    throw new HttpError(400, message);
  }
  return result.data;
}