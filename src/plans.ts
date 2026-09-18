export function validNumbers(
  numbers: number[],
  bonus: number,
  ballMax: number,
  bonusMax: number,
) {
  return (
    Number.isInteger(ballMax) &&
    ballMax >= 5 &&
    ballMax <= 255 &&
    Number.isInteger(bonusMax) &&
    bonusMax >= 1 &&
    bonusMax <= 255 &&
    numbers.length === 5 &&
    new Set(numbers).size === 5 &&
    numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= ballMax) &&
    Number.isInteger(bonus) &&
    bonus >= 1 &&
    bonus <= bonusMax
  );
}
/** @cc [label:correctness] bounded-random-selection
 * A random preference MUST contain five distinct, in-range main numbers and an in-range bonus.
 * Randomness MUST use rejection sampling rather than biased modular reduction.
 */
export function quickPick(
  ballMax: number,
  bonusMax: number,
  random: (array: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = (a) =>
    crypto.getRandomValues(a),
) {
  if (
    !Number.isInteger(ballMax) ||
    ballMax < 5 ||
    ballMax > 255 ||
    !Number.isInteger(bonusMax) ||
    bonusMax < 1 ||
    bonusMax > 255
  )
    throw new Error("invalidRange");
  const uniform = (max: number) => {
    const limit = 2 ** 32 - (2 ** 32 % max);
    let n: number;
    do {
      n = random(new Uint32Array(1))[0];
    } while (n >= limit);
    return n % max;
  };
  const pool = Array.from({ length: ballMax }, (_, i) => i + 1);
  for (let i = 0; i < 5; i++) {
    const j = i + uniform(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    numbers: pool.slice(0, 5).sort((a, b) => a - b),
    bonus: uniform(bonusMax) + 1,
  };
}
