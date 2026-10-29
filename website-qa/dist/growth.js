/* Shared progressive enhancements. Only public download links are copied here. */
(() => {
  'use strict';
  const copy=document.querySelector('#copy-download-link'),field=document.querySelector('#download-link'),status=document.querySelector('#download-status');
  let copying=false;
  copy?.addEventListener('click',async()=>{
    if(copying)return;copying=true;copy.disabled=true;
    try{if(!navigator.clipboard?.writeText)throw new Error('Unavailable');await navigator.clipboard.writeText(field.value);status.textContent='Windows download link copied. Open it on your Windows PC.';}
    catch{field.hidden=false;field.focus();field.select();status.textContent='Select and copy this public download link using your device’s Copy command.';}
    finally{copying=false;copy.disabled=false;}
  });
  const video=document.querySelector('#native-walkthrough');
  video?.addEventListener('play',()=>{document.querySelector('#video-note').textContent='Actual Windows app screenshots, shown as a narrated-by-captions walkthrough. No audio.';});
})();
