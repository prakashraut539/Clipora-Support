/* Browser-memory text tools. No network, storage, or clipboard reads. */
(() => {
  'use strict';
  const form=document.querySelector('[data-tool]');
  if(!form)return;
  form.classList.add('js-ready');
  const input=form.querySelector('#tool-input'),output=form.querySelector('#tool-output'),status=form.querySelector('#tool-status');
  const buttons=Object.fromEntries([...form.querySelectorAll('[data-action]')].map(b=>[b.dataset.action,b]));
  let previous=null,busy=false,validResult=false,revision=0;
  const count=s=>Array.from(s).length;
  const snapshot=()=>({input:input.value,output:output.value,validResult,mode:form.querySelector('[name="join-mode"]:checked')?.value});
  function update(){
    form.querySelector('#input-count').textContent=`${count(input.value).toLocaleString('en')} characters`;
    form.querySelector('#output-count').textContent=`${count(output.value).toLocaleString('en')} characters`;
    buttons.copy.disabled=busy||!validResult||!output.value;
    buttons.clear.disabled=busy||(!input.value&&!output.value);
    buttons.undo.disabled=busy||!previous;
    buttons.convert.disabled=busy;
  }
  function changed(){revision++;validResult=false;input.removeAttribute('aria-invalid');status.textContent='Input changed. Convert again to refresh the result.';update();}
  input.addEventListener('input',changed);
  form.querySelectorAll('[name="join-mode"]').forEach(r=>r.addEventListener('change',changed));
  function normalizeLines(s,keepParagraphs){
    const text=s.replace(/\r\n?|\u2028|\u2029/g,'\n');
    const lines=text.split('\n').map(line=>line.trim());
    if(!keepParagraphs)return lines.filter(Boolean).join(' ');
    const paragraphs=[];let current=[];
    for(const line of lines){if(line)current.push(line);else if(current.length){paragraphs.push(current.join(' '));current=[];}}
    if(current.length)paragraphs.push(current.join(' '));
    return paragraphs.join('\n\n');
  }
  form.addEventListener('submit',e=>{
    e.preventDefault();if(busy)return;
    if(count(input.value)>200000){input.setAttribute('aria-invalid','true');status.textContent='This text exceeds 200,000 characters. Split it into smaller parts; your input has been kept.';input.focus();return;}
    previous=snapshot();revision++;
    output.value=form.dataset.tool==='lines'?normalizeLines(input.value,form.querySelector('[name="join-mode"]:checked').value==='paragraphs'):input.value;
    validResult=true;input.removeAttribute('aria-invalid');
    status.textContent=input.value?`Result ready. ${count(output.value).toLocaleString('en')} characters. Review before copying.`:'There is no text to convert. Paste your text or try the sample.';
    update();
  });
  buttons.sample.addEventListener('click',()=>{
    previous=snapshot();revision++;input.value=form.dataset.tool==='lines'?'Copy a useful idea\nfrom a long document.\n\nKeep this paragraph\nseparate.':'A useful idea — without the formatting.\nUnicode stays: café, नमस्ते, 日本語, 😀';output.value='';validResult=false;input.removeAttribute('aria-invalid');status.textContent='Synthetic sample loaded. Convert it to preview the result.';update();input.focus();
  });
  buttons.clear.addEventListener('click',()=>{previous=snapshot();revision++;input.value='';output.value='';validResult=false;input.removeAttribute('aria-invalid');status.textContent='Fields cleared. Undo can restore the previous step.';update();input.focus();});
  buttons.undo.addEventListener('click',()=>{
    if(!previous)return;revision++;input.value=previous.input;output.value=previous.output;validResult=previous.validResult;
    if(previous.mode)form.querySelector(`[name="join-mode"][value="${previous.mode}"]`).checked=true;
    previous=null;input.removeAttribute('aria-invalid');status.textContent='Previous step restored.';update();input.focus();
  });
  buttons.copy.addEventListener('click',async()=>{
    if(busy||!validResult||!output.value)return;
    const value=output.value,at=revision;busy=true;buttons.copy.setAttribute('aria-busy','true');status.textContent='Copying the result…';update();
    try{
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      status.textContent=at===revision?'Result copied. Paste it into your destination.':'The previous result was copied. Convert your edited input before copying again.';
    }catch{
      if(at===revision){output.focus();output.select();status.textContent='Automatic copy is unavailable. The result is selected: use Ctrl+C, Command+C or your device’s Copy command.';}
      else status.textContent='Copy was unavailable. Convert the edited input and try again, or select the result to copy manually.';
    }finally{busy=false;buttons.copy.removeAttribute('aria-busy');update();}
  });
  buttons.sample.disabled=false;
  status.textContent='Paste your text or try the sample.';
  update();
})();
