
export function generateRandomDelay(min = 1000, max = 3000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}