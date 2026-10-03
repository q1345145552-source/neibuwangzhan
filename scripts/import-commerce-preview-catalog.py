#!/usr/bin/env python3
"""Import only product catalog rows into an explicit isolated preview. Never reads/writes a remote DB."""
import argparse,json,sqlite3,hashlib,uuid
from pathlib import Path
from decimal import Decimal

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--preview-root',required=True);p.add_argument('--snapshot',required=True);g=p.add_mutually_exclusive_group(required=True);g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true');args=p.parse_args()
root=Path(args.preview_root).resolve();manifest=json.loads((root/'preview-fixture.json').read_text());database=Path(manifest['database']).resolve()
assert database==root/'synthetic.db' and root!=Path(manifest['source']).resolve(),'Only isolated preview synthetic.db is accepted'
assert database.is_file(),'Existing preview database required'
assert manifest['accounts'] and all(a.endswith('@example.test') for a in manifest['accounts']),'Synthetic preview marker required'
raw=Path(args.snapshot).read_bytes();digest=hashlib.sha256(raw).hexdigest();source=json.loads(raw)
assert source.get('read_only') is True and set(source['tables'])=={'products','spot_items','subscription_products'},'Expected read-only complete catalog export'
# Consume the actual reviewed allowlist without duplicating or broadening workflow mapping.
import re
catalog=(root/'src/lib/commerce-catalog.ts').read_text();allowed=set(re.findall(r'"([A-Z]+-[0-9]+)"',re.search(r'COMMERCE_SKUS\s*=\s*\[(.*?)\]',catalog,re.S).group(1)))
rows=[];promoted=[];skus=set()
for kind,values in source['tables'].items():
 ids=set()
 for value in values:
  assert isinstance(value,dict) and isinstance(value.get('id'),str) and value['id'] not in ids;ids.add(value['id'])
  assert isinstance(value.get('name'),str) and value['name'].strip()
  assert isinstance(value.get('status'),str)
  if 'price' in value:assert isinstance(value['price'],(int,float)) and Decimal(str(value['price'])).is_finite()
  if kind=='products':assert value['sku_code'] not in skus;skus.add(value['sku_code'])
  canonical=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
  rows.append((kind,value['id'],canonical,hashlib.sha256(canonical.encode()).hexdigest(),digest))
  if kind=='products' and value['sku_code'] in allowed:
   cents=Decimal(str(value['price']))*100
   assert value['currency']=='CNY' and cents==cents.to_integral_value() and 1<=cents<=100000000,'Supported price must be exact CNY cents'
   assert len(value['name'])<=120
   promoted.append((value,int(cents)))
assert {v['sku_code'] for v,_ in promoted}==allowed,'Complete reviewed SKU set required'
summary={'rows':len(rows),'counts':{k:len(v) for k,v in source['tables'].items()},'reviewed_checkout_skus':sorted(allowed),'snapshot_sha256':digest,'database':str(database)}
if args.check:print(json.dumps({'validated':True,**summary},ensure_ascii=False));raise SystemExit(0)
c=sqlite3.connect(database,timeout=30);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');c.execute('BEGIN IMMEDIATE')
try:
 # All unrelated tables and rows must survive byte-for-byte at the logical row level.
 def unrelated():
  names=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('commerce_products','commerce_catalog_imports','commerce_imported_catalog') ORDER BY name")]
  return {n:[tuple(r) for r in c.execute('SELECT * FROM "'+n.replace('"','""')+'" ORDER BY rowid')] for n in names}
 before=unrelated();cart_before=[dict(r) for r in c.execute('SELECT * FROM commerce_carts ORDER BY buyer_account_id')]
 c.execute('CREATE TABLE IF NOT EXISTS commerce_catalog_imports (snapshot_sha256 TEXT PRIMARY KEY,source TEXT NOT NULL,captured_at TEXT NOT NULL,counts_json TEXT NOT NULL,imported_at TEXT NOT NULL DEFAULT (datetime(\'now\')))')
 c.execute('CREATE TABLE IF NOT EXISTS commerce_imported_catalog (kind TEXT NOT NULL CHECK(kind IN (\'products\',\'spot_items\',\'subscription_products\')),source_id TEXT NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL,import_batch_id TEXT NOT NULL REFERENCES commerce_catalog_imports(snapshot_sha256),PRIMARY KEY(kind,source_id))')
 c.execute('INSERT OR IGNORE INTO commerce_catalog_imports(snapshot_sha256,source,captured_at,counts_json) VALUES (?,?,?,?)',(digest,source['source'],source['captured_at_utc'],json.dumps(summary['counts'])))
 # This table is a replaceable imported catalog, not a cart/order/ledger table.
 c.execute('DELETE FROM commerce_imported_catalog')
 c.executemany('INSERT INTO commerce_imported_catalog VALUES (?,?,?,?,?)',rows)
 changes=[]
 for value,cents in promoted:
  old=c.execute('SELECT * FROM commerce_products WHERE sku=?',(value['sku_code'],)).fetchone();active=int(value['status']=='active')
  if old:
   if (old['name'],old['price_cents'],old['currency'],old['active'])!=(value['name'],cents,'CNY',active):
    c.execute("UPDATE commerce_products SET name=?,price_cents=?,currency='CNY',active=?,revision=revision+1,updated_at=datetime('now') WHERE id=?",(value['name'],cents,active,old['id']));changes.append({'sku':value['sku_code'],'action':'updated','id':old['id']})
  else:
   id='live-'+str(uuid.uuid5(uuid.NAMESPACE_URL,source['source']+'/products/'+value['id']))
   c.execute('INSERT INTO commerce_products(id,sku,name,price_cents,currency,active) VALUES (?,?,?,?,?,?)',(id,value['sku_code'],value['name'],cents,'CNY',active));changes.append({'sku':value['sku_code'],'action':'inserted','id':id})
 assert unrelated()==before,'Unrelated data changed'
 assert [dict(r) for r in c.execute('SELECT * FROM commerce_carts ORDER BY buyer_account_id')]==cart_before
 assert not list(c.execute('PRAGMA foreign_key_check'))
 assert c.execute('SELECT count(*) FROM commerce_imported_catalog').fetchone()[0]==len(rows)
 for kind,id,payload,h,batch in rows:
  actual=c.execute('SELECT payload_json,payload_sha256 FROM commerce_imported_catalog WHERE kind=? AND source_id=?',(kind,id)).fetchone();assert tuple(actual)==(payload,h)
 c.commit();print(json.dumps({'applied':True,**summary,'commerce_product_changes':changes,'unrelated_tables_unchanged':True,'cart_and_existing_sale_snapshots_preserved':True},ensure_ascii=False))
except Exception:c.rollback();raise
finally:c.close()
