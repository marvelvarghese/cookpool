import {
  CircleUserRound,
  CookingPot,
  HandCoins,
  House,
  Plus,
  Receipt,
  Refrigerator,
  ShoppingBasket,
  UserPlus,
  UsersRound,
  Utensils,
  Wallet,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";

// The boards' own tab glyphs (RvMoney, RvKitchenB; cookpool-revamp RV-23), drawn
// on lucide's 24 px grid so they take the same size and stroke props.
/** Kitchen: a jar with its lid and a label line. */
const KitchenJar = createLucideIcon("KitchenJar", [
  ["path", { d: "M8 3h8M7 6h10M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M9 12h6", key: "jar" }],
]);
/** Money: the striped card. */
const MoneyCard = createLucideIcon("MoneyCard", [
  ["path", { d: "M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM3 10h18M15.5 14.5h2", key: "card" }],
]);
/** You: the plain person, no circle round it. */
const PlainPerson = createLucideIcon("PlainPerson", [
  ["path", { d: "M12 4.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM5 20.5c0-3.7 3.1-6.2 7-6.2s7 2.5 7 6.2", key: "person" }],
]);

/** The lucide icons the kitchen nav model names (nav.ts), resolved for rendering. */
export const KITCHEN_ICONS: Record<string, LucideIcon> = {
  CircleUserRound,
  CookingPot,
  HandCoins,
  House,
  KitchenJar,
  MoneyCard,
  PlainPerson,
  Plus,
  Receipt,
  Refrigerator,
  ShoppingBasket,
  UserPlus,
  UsersRound,
  Utensils,
  Wallet,
};

export function kitchenIcon(name: string): LucideIcon {
  return KITCHEN_ICONS[name] ?? Plus;
}
