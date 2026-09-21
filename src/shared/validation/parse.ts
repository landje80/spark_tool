import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/** Valideert invoer en gooit een VALIDATION_ERROR met alleen pad + boodschap (nooit de ingevoerde waarden). */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Ongeldige invoer',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
