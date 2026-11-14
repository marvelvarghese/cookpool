"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NewGroupDialog } from "./new-group-dialog";

/**
 * Where Money's + Group and Add group row land (money-native MY-8). MY-9
 * replaces this page with the Add group sheet; until then it is the
 * existing New group dialog, so a group can still be made from Money.
 */
export function MoneyAddGroup() {
  const router = useRouter();
  return <NewGroupDialog open onOpenChange={(open) => !open && router.replace("/money")} />;
}
