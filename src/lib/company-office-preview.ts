import {spawn} from "node:child_process";
import {mkdtemp,mkdir,readFile,rm,stat,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {pathToFileURL} from "node:url";
let running=0;
export class OfficePreviewError extends Error {constructor(message:string,public status=422){super(message);}}
export async function convertCompanyOfficeToPdf(bytes:Buffer,extension:string,signal?:AbortSignal):Promise<Buffer>{
 if(!['doc','docx','xls','xlsx'].includes(extension))throw new OfficePreviewError('此格式不支持转换预览');
 if(['docx','xlsx'].includes(extension)&&(bytes.subarray(0,4).toString('hex')!=='504b0304'||bytes.subarray(-65557).lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]))<0))throw new OfficePreviewError('文件内容不是有效的 Word/Excel 文档，请检查是否损坏');
 if(running>=2)throw new OfficePreviewError('Office 预览转换繁忙，请稍后重试',503);
 if(signal?.aborted)throw new OfficePreviewError('预览已取消',408);
 running++;let directory:string|undefined;
 try{
  const root=process.env.OFFICE_PREVIEW_TMP_DIR||os.tmpdir();await mkdir(root,{recursive:true});directory=await mkdtemp(path.join(root,'company-preview-'));
  const input=path.join(directory,`input.${extension}`),output=path.join(directory,'output'),profile=path.join(directory,'profile');
  await mkdir(output);await mkdir(path.join(profile,'user'),{recursive:true});
  // Fresh profile, no trusted macro locations or certificates; never use the application's profile.
  await writeFile(path.join(profile,'user','registrymodifications.xcu'),'<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
  await writeFile(input,bytes,{mode:0o600});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.env.LIBREOFFICE_BIN||'soffice',[`-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir',output,input],{cwd:directory,detached:process.platform!=='win32',stdio:'ignore',shell:false,env:{NODE_ENV:process.env.NODE_ENV||'production',PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',TMPDIR:directory}});
   let finished=false,timedOut=false,cancelled=false;
   const kill=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* Already exited. */}};
   const abort=()=>{cancelled=true;kill();};
   const timer=setTimeout(()=>{timedOut=true;kill();},60000);
   const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
   child.once('error',error=>finish(new OfficePreviewError((error as NodeJS.ErrnoException).code==='ENOENT'?'服务器未安装 Office 预览组件，请联系管理员':'Office 预览转换启动失败',503)));
   child.once('close',code=>finish(cancelled?new OfficePreviewError('预览已取消',408):timedOut?new OfficePreviewError('转换超时，请下载文件查看',504):code===0?undefined:new OfficePreviewError('文件转换失败，请检查文件是否损坏或加密')));
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  const pdfPath=path.join(output,'input.pdf');
  const info=await stat(pdfPath).catch(()=>{throw new OfficePreviewError('文件无法转换为 PDF，请检查是否损坏或加密');});
  if(info.size>50*1024*1024)throw new OfficePreviewError('预览结果过大，请下载原文件查看',413);
  const pdf=await readFile(pdfPath);if(pdf.subarray(0,5).toString()!=='%PDF-')throw new OfficePreviewError('转换结果无效，请下载原文件查看');
  return pdf;
 }finally{try{if(directory)await rm(directory,{recursive:true,force:true});}finally{running--;}}
}
