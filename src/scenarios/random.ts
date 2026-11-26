/** Gerador pseudo-aleatório determinístico (mulberry32), para cenários repetíveis com uma seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "Alfa", "Beta", "Gama", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Sigma",
  "Omega", "Aurora", "Boreal", "Cobalto", "Dunas", "Ebano", "Fiorde", "Granito", "Horizonte", "Ilha", "Jade",
  "Kiwi", "Lagoa", "Marfim", "Nevoa", "Opala", "Prisma", "Quartzo", "Ribeira", "Savana", "Tundra", "Umbra",
];

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Nomes de pasta aleatórios e únicos entre si (Alfa, Beta2, ...). */
export function uniqueNames(rng: () => number, n: number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  while (out.length < n) {
    let name = pick(rng, WORDS);
    if (used.has(name)) name += String(1 + Math.floor(rng() * 99));
    if (used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  return out;
}
