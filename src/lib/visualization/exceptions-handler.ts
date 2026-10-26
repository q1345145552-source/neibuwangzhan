import type { OpenSession, Session } from './handler';
import { exceptions } from './exceptions';
import { parseExceptionOptions } from './exception-types';
export function createExceptionsGET(open:OpenSession,clock:()=>Date=()=>new Date()) {
  return async(request:Request)=>{
    let session:Session|null=null;
    const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Authorization'}});
    try{
      session=await open(request);if(!session?.actor)return json({error:'LOGIN_REQUIRED'},401);
      if(session.actor.role!=='admin')return json({error:'FORBIDDEN'},403);
      let options;try{options=parseExceptionOptions(new URL(request.url));}catch{return json({error:'INVALID_QUERY'},400);}
      return json(exceptions(session.reader,options,clock()));
    }catch{return json({error:'EXCEPTIONS_UNAVAILABLE'},503);}finally{session?.close();}
  };
}
