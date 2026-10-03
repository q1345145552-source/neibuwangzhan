export type ImportedCatalogKind = "products" | "spot_items" | "subscription_products";
export type ImportedCatalogItem = {
  key:string; kind:ImportedCatalogKind; source_id:string; sku:string; name:string;
  category:string; sub_category:string; price:number|null; currency:string|null;
  status:string; product_id:string|null;
};
export type ImportedCatalog = { captured_at:string; source:string; items:ImportedCatalogItem[]; counts:Record<ImportedCatalogKind,number> };
