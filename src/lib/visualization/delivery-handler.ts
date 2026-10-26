import type { OpenSession, Session } from './handler';
import { delivery, parseDelivery } from './delivery';
export function createDeliveryGET(open:OpenSession,clock:()=>Date=()=>new Date()){return async(request:Request)=>{
 let session:Session|null=null;
 const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});
 try{session=await open(request);if(!session?.actor)return json({error:'LOGIN_REQUIRED'},401);
 // Existing order/document GETs permit both staff roles globally; client never reads this board.
 if(!['admin','employee'].includes(session.actor.role))return json({error:'FORBIDDEN'},403);
 let options;try{options=parseDelivery(new URL(request.url));}catch{return json({error:'INVALID_QUERY'},400);}
 return json({...delivery(session.reader,options,clock()),viewerRole:session.actor.role});
 }catch{return json({error:'DELIVERY_UNAVAILABLE'},503);}finally{session?.close();}
};}
