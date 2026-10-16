import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting later Tailwind utilities win over earlier ones.
 *
 * Plain string concatenation cannot do this: `"p-4" + " p-2"` leaves both in
 * the class list and the winner depends on stylesheet order rather than on the
 * caller's intent. twMerge resolves same-family conflicts by keeping the last.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
