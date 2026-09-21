import { notFound } from "next/navigation";
import { commercePilotEnabled } from "@/lib/commerce-schema";
import { importedCatalogEnabled } from "@/lib/commerce-imported-catalog";
import { CommercePortal } from "@/components/commerce-portal";
export const dynamic = "force-dynamic";
export default function ShopPage() {
  if (!commercePilotEnabled()) notFound();
  return <CommercePortal importedCatalog={importedCatalogEnabled()} />;
}

