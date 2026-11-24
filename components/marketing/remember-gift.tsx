"use client";

import { useEffect } from "react";
import { rememberGift } from "@/lib/gift/pending";

/** Keeps the gift code in this browser, so it's waiting on /home however the student signs up. */
export function RememberGift({ code }: { code: string }) {
  useEffect(() => rememberGift(code), [code]);
  return null;
}
