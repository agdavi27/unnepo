import { Suspense } from "react";
import { Shell } from "@/components/product/shell";
import { ContactsView } from "@/components/product/contacts-view";

export default function Page() {
  return (
    <Shell>
      <Suspense>
        <ContactsView />
      </Suspense>
    </Shell>
  );
}
