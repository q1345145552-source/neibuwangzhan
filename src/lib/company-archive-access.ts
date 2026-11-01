import type Database from "better-sqlite3";
export type ArchiveUser={id?:number;name:string;role:string};
export function canAccessCompanyArchive(db:Database.Database,user:ArchiveUser,id:number):boolean {
 if(!['admin','employee'].includes(user.role))return false;
 return !!db.prepare(`SELECT 1 FROM company_archives a LEFT JOIN orders o ON o.id=a.order_id WHERE a.id=?${user.role==='admin'?'':' AND o.responsible_person=?'}`).get(...(user.role==='admin'?[id]:[id,user.name]));
}
export function canAssignArchiveOrder(db:Database.Database,user:ArchiveUser,orderId:string|null):boolean {
 return user.role==='admin'||(user.role==='employee'&&!!orderId&&!!db.prepare('SELECT 1 FROM orders WHERE id=? AND responsible_person=?').get(orderId,user.name));
}

export function canManageCompanyArchiveFiles(db:Database.Database,user:ArchiveUser,id:number):boolean {
 return canAccessCompanyArchive(db,user,id);
}
