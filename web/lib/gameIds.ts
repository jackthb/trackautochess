import Sqids from "sqids";

const sqids = new Sqids({ minLength: 8 });

export function encodeGameId(id: number): string {
  return sqids.encode([id]);
}

export function decodeGameId(slug: string): number | null {
  const nums = sqids.decode(slug);
  return nums.length === 1 ? nums[0] : null;
}

export function isEncodedGameId(id: string): boolean {
  return !/^\d+$/.test(id);
}

export function gamePath(id: number): string {
  return `/games/${encodeGameId(id)}`;
}
