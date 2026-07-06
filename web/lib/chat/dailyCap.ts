import { CHAT_DAILY_GLOBAL_CAP } from "@/lib/chat/config";

let dayKey = "";
let count = 0;

export function tryConsumeDailyChatSlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (dayKey !== today) {
    dayKey = today;
    count = 0;
  }
  if (count >= CHAT_DAILY_GLOBAL_CAP) return false;
  count += 1;
  return true;
}
