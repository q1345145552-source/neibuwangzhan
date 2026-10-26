"use client";
import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { getStoredAuthToken } from '@/lib/auth-storage';

type CredentialSnapshot={token:string|null;revision:number};
const serverSnapshot:CredentialSnapshot={token:null,revision:0};
let snapshot=serverSnapshot;
const listeners=new Set<()=>void>();
// Memory-only filter/page preferences. Never store responses, identity claims or business data.
const preferences=new Map<string,unknown>();
let preferenceGeneration=0;
export function clearVisualizationPreferences(){preferences.clear();preferenceGeneration++;}
function readSnapshot():CredentialSnapshot {
  if(typeof window==='undefined')return serverSnapshot;
  const token=getStoredAuthToken();
  if(token!==snapshot.token){clearVisualizationPreferences();snapshot={token,revision:snapshot.revision+1};}
  return snapshot;
}
export function notifyCredentialCheck(forceRead=false){
  const before=snapshot;readSnapshot();
  if(forceRead&&before===snapshot)snapshot={...snapshot,revision:snapshot.revision+1};
  for(const listener of listeners)listener();
}
function onCheck(){notifyCredentialCheck();}
function onReturn(){notifyCredentialCheck(true);}
function onPageShow(event:PageTransitionEvent){notifyCredentialCheck(event.persisted);}
function subscribe(listener:()=>void){
  listeners.add(listener);
  if(listeners.size===1){
    for(const name of ['storage','focus','pointerdown','keydown','submit'])window.addEventListener(name,onCheck,true);
    window.addEventListener('popstate',onReturn);
    window.addEventListener('pageshow',onPageShow);
    document.addEventListener('visibilitychange',onCheck);
  }
  return()=>{listeners.delete(listener);if(listeners.size===0){
    for(const name of ['storage','focus','pointerdown','keydown','submit'])window.removeEventListener(name,onCheck,true);
    window.removeEventListener('popstate',onReturn);window.removeEventListener('pageshow',onPageShow);document.removeEventListener('visibilitychange',onCheck);
  }};
}
/** Existing token storage only. Browser lifecycle/user actions, no polling or new auth API. */
export function useVisualizationCredential(){return useSyncExternalStore(subscribe,readSnapshot,()=>serverSnapshot);}
export function credentialStillCurrent(expected:string|null){
  if(getStoredAuthToken()===expected)return true;
  notifyCredentialCheck();return false;
}
export async function deniedNavigationRole(response:Response):Promise<string>{
  if(response.status!==403)return 'denied';
  try{const value=await response.clone().json();return value.viewerRole==='employee'||value.viewerRole==='client'?value.viewerRole:'denied';}catch{return 'denied';}
}
type PreferenceKey='overview:draft'|'overview:applied'|'delivery:draft'|'delivery:applied'|'delivery:page'|'exceptions:draft'|'exceptions:applied'|'exceptions:page';
export function useVisualizationUiState<T>(key:PreferenceKey,initial:T|(()=>T)):[T,Dispatch<SetStateAction<T>>]{
  const scope=useRef({token:getStoredAuthToken(),generation:preferenceGeneration});
  const [value,setValue]=useState<T>(()=>{
    if(typeof window!=='undefined'&&preferences.has(key))return preferences.get(key) as T;
    return typeof initial==='function'?(initial as ()=>T)():initial;
  });
  useEffect(()=>{if(scope.current.token===getStoredAuthToken()&&scope.current.generation===preferenceGeneration)preferences.set(key,value);},[key,value]);
  return [value,setValue];
}
