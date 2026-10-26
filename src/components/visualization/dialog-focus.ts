"use client";
import { useEffect, type RefObject } from 'react';
/** Restore focus only when the original opener still belongs to the current page. */
export function useVisualizationDialog(ref:RefObject<HTMLDialogElement|null>){
  useEffect(()=>{
    const dialog=ref.current, opener=document.activeElement;
    if(dialog&&!dialog.open)dialog.showModal();
    return()=>{
      dialog?.close();
      requestAnimationFrame(()=>{if(opener instanceof HTMLElement&&opener.isConnected)opener.focus({preventScroll:true});});
    };
  },[ref]);
}
