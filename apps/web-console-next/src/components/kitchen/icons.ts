import {
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
  type LucideIcon,
} from "lucide-react";

/** The lucide icons the kitchen nav model names (nav.ts), resolved for rendering. */
export const KITCHEN_ICONS: Record<string, LucideIcon> = {
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
};

export function kitchenIcon(name: string): LucideIcon {
  return KITCHEN_ICONS[name] ?? Plus;
}
