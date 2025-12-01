import "../../docs/token_switcher/switcher.js";

const KEY='overlap_puzzles_v1';
  const COLORS=[['Red','--c-red'],['Orange','--c-orange'],['Yellow','--c-yellow'],['Green','--c-green'],['Mint','--c-mint'],['Cyan','--c-cyan'],['Blue','--c-blue'],['Purple','--c-purple'],['Pink','--c-pink']];
  const HEIGHTS=[['Full','full'],['Mid','mid'],['Inner','inner']];
  const DEF = await (await fetch('./examples.json')).json();


  const $=s=>document.querySelector(s);
  const els={
    tabPlay:$('#tabPlay'),tabBuild:$('#tabBuild'),panelPlay:$('#panelPlay'),panelBuild:$('#panelBuild'),
    stage:$('#stage'),grid:$('#grid'),legend:$('#legend'),meta:$('#meta'),
    prev:$('#prev'),next:$('#next'),reset:$('#reset'),
    reveal:$('#reveal'),
    success:$('#success'),sClose:$('#sClose'),sAgain:$('#sAgain'),sNext:$('#sNext'),
    pSel:$('#pSel'),pNew:$('#pNew'),pDel:$('#pDel'),pSave:$('#pSave'),pTitle:$('#pTitle'),rows:$('#rows'),wAdd:$('#wAdd'),ioTxt:$('#ioTxt'),ioExp:$('#ioExp'),ioImp:$('#ioImp'),
    bGrid:$('#bGrid'),status:$('#status'),solution:$('#solution')
  };

  const store={
    load(){try{const raw=localStorage.getItem(KEY);const v=raw?JSON.parse(raw):null;return Array.isArray(v)&&v.length?v:structuredClone(DEF)}catch{return structuredClone(DEF)}},
    save(){localStorage.setItem(KEY,JSON.stringify(puzzles))}
  };

  let puzzles=store.load();
  let pIdx=0;
  let dirty=false;
  const play={exp:[],usr:[],n:0,at:0,done:false};

  const uid=()=>`p-${Math.random().toString(16).slice(2,8)}-${Date.now().toString(16)}`;
  const cleanA=s=>(s||'').toUpperCase().replace(/[^A-Z]/g,'');
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const insets=h=>h==='mid'?[12.5,12.5]:h==='inner'?[25,25]:[0,0];
  const setDirty=(v=true)=>{dirty=!!v;els.pSave&&els.pSave.classList.toggle('is-hot',dirty)};
  const tieR=new WeakMap();
  const tr=w=>{let v=tieR.get(w);if(v==null){v=Math.random();tieR.set(w,v)}return v};

  // ---- Focus/shortcut + mobile keyboard fixes ----
  let hasInteracted=false;
  const markInteracted=()=>{hasInteracted=true};

  const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints>0);

  // Hidden input to reliably summon mobile keyboard
  const kb=document.createElement('input');
  kb.type='text';
  kb.value='';
  kb.autocomplete='off';
  kb.autocapitalize='characters';
  kb.spellcheck=false;
  kb.inputMode='text';
  kb.setAttribute('aria-hidden','true');
  kb.tabIndex=-1;
  // keep it "real" (not display:none) so iOS/Android will show keyboard when focused
  kb.style.cssText='position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;';
  (document.body||document.documentElement).appendChild(kb);

  const focusForTyping=()=>{
    if(!hasInteracted) return;
    if(!els.panelPlay || !els.panelPlay.classList.contains('is-active')) return;

    const a=document.activeElement;
    // Don't steal focus from builder inputs (or any editable element) while typing there
    if(a && a!==kb && (a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.tagName==='SELECT'||a.isContentEditable)) return;

    if(IS_TOUCH){
      try{kb.focus({preventScroll:true})}catch{kb.focus()}
      kb.value='';
    }else{
      try{els.stage.focus({preventScroll:true})}catch{els.stage.focus()}
    }
  };

  // Fallback for mobile keyboards that prefer input events
  kb.addEventListener('input',()=>{
    const v=kb.value||'';
    if(!v) return;
    for(const ch of v){
      if(/^[a-zA-Z]$/.test(ch)) write(ch.toUpperCase());
    }
    kb.value='';
  });

  function computed(p){
    const entries=(p.words||[]).map(w=>{
      const ans=cleanA(w.answer);
      const start=Math.max(0,Math.floor(+w.start||1)-1);
      const [t,b]=insets(w.height||'full');
      return {clue:(w.clue||''),ans,start,len:ans.length,color:w.color||'--c-red',t,b,r:tr(w)};
    }).filter(e=>e.len).sort((a,b)=>a.start-b.start||a.r-b.r);

    const total=Math.max(1,...entries.map(e=>e.start+e.len));
    const exp=Array.from({length:total},()=>null);
    for(const e of entries){
      for(let i=0;i<e.len;i++){
        const idx=e.start+i, ch=e.ans[i];
        if(exp[idx] && exp[idx]!==ch) return {ok:false,total,exp,entries,conf:{idx,a:exp[idx],b:ch}};
        exp[idx]=ch;
      }
    }
    const gaps=exp.map((c,i)=>c?null:i).filter(v=>v!==null);
    return {ok:true,total,exp,entries,gaps};
  }

  function setCols(n){document.documentElement.style.setProperty('--cols',String(n))}

  function renderGrid(target, model, clickable){
    target.innerHTML='';
    for(const e of model.entries){
      const d=document.createElement('div');
      d.className='range';
      d.style.setProperty('--start',e.start);
      d.style.setProperty('--len',e.len);
      d.style.setProperty('--t',e.t);
      d.style.setProperty('--b',e.b);
      d.style.setProperty('--color',`var(${e.color})`);
      d.style.setProperty('--f',getComputedStyle(document.documentElement).getPropertyValue('--fill')||'.08');
      target.appendChild(d);
    }
    for(let i=0;i<model.total;i++){
      const b=document.createElement('button');
      b.type='button';
      b.className='cell text-display-semibold-lg';
      b.dataset.i=i;
      b.disabled=!clickable;
      b.innerHTML='<span class="num"></span><span class="letter"></span>';
      target.appendChild(b);
    }
  }

  function loadPuzzle(i){
    if(!puzzles.length) return;
    pIdx=((i%puzzles.length)+puzzles.length)%puzzles.length;
    const p=puzzles[pIdx];
    const m=computed(p);
    setCols(m.total);
    play.exp=m.exp.map(c=>c||'');
    play.n=m.total;
    play.usr=Array.from({length:play.n},()=>'' );
    play.at=0;play.done=false;

    renderGrid(els.grid,m,true);
    els.legend.innerHTML=m.entries.map((e,idx)=>
      `<div class="clue text-system-semibold-sm" data-e="${idx}"><span class="sw" style="--color:var(${e.color})"></span><span>${escapeHtml(e.clue)}</span></div>`
    ).join('');

    els.meta.textContent=`${p.title||'Untitled'} • ${pIdx+1} / ${puzzles.length}`;
    updatePlayUI();
    $('#gridScroll').scrollLeft=0;
    syncBuilder();
    setDirty(false);
    closeSuccess();
  }

  function updatePlayUI(){
    const cells=els.grid.querySelectorAll('.cell');
    cells.forEach(c=>{
      const i=+c.dataset.i;
      c.querySelector('.num').textContent=i+1;
      c.querySelector('.letter').textContent=play.usr[i]||'';
      c.classList.toggle('is-active',i===play.at && !play.done);
    });
  }

  function setAt(i){play.at=clamp(i,0,play.n-1);updatePlayUI()}

  function jumpToEntry(eIdx){
    const m=computed(puzzles[pIdx]);
    const e=m.entries[eIdx];
    if(!e) return;
    let idx=e.start;
    for(let i=e.start;i<e.start+e.len;i++){ if(!play.usr[i]){idx=i;break;} }
    setAt(idx);
  }

  function write(ch){
    if(play.done) return;
    play.usr[play.at]=ch;
    if(play.at<play.n-1) play.at++;
    checkSolved();
    updatePlayUI();
  }

  function back(){
    if(play.done) return;
    if(play.usr[play.at]) play.usr[play.at]='';
    else if(play.at>0){play.at--; play.usr[play.at]='';}
    updatePlayUI();
  }

  function move(d){setAt(play.at+d)}

  function checkSolved(){
    if(!play.usr.every(Boolean)) return;
    if(play.usr.every((ch,i)=>ch===play.exp[i])){ play.done=true; openSuccess(); }
  }

  function openSuccess(){els.success.classList.add('is-open');els.sClose.focus()}
  function closeSuccess(){els.success.classList.remove('is-open')}

  function resetPlay(){ play.usr=Array.from({length:play.n},()=>'' ); play.at=0; play.done=false; updatePlayUI(); closeSuccess(); }

function revealPlay(){
  play.usr = play.exp.slice();
  play.done = true;
  updatePlayUI();
  closeSuccess();
}

  function onKey(e){
    if(els.success.classList.contains('is-open')) return;

    // Allow OS/browser shortcuts (Cmd/Ctrl + A/Z/F/R/etc)
    if(e.metaKey || e.ctrlKey) return;

    // Don't hijack builder inputs. (But DO allow the hidden kb input.)
    const t=e.target;
    if(t && t!==kb && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;

    if(e.key==='Tab') return;
    if(e.key==='Backspace'){e.preventDefault();back();return;}
    if(e.key==='ArrowLeft'){e.preventDefault();move(-1);return;}
    if(e.key==='ArrowRight'){e.preventDefault();move(1);return;}
    if(/^[a-zA-Z]$/.test(e.key)){e.preventDefault();write(e.key.toUpperCase());}
  }

  // ----- Builder -----

  function syncBuilder(){
    els.pSel.innerHTML=puzzles.map((p,i)=>`<option value="${i}" ${i===pIdx?'selected':''}>${escapeHtml(p.title||'Untitled')}</option>`).join('');
    els.pTitle.value=puzzles[pIdx]?.title||'';
    renderRows();
    renderPreview();
  }

  function renderRows(){
    const p=puzzles[pIdx];
    const ws=p.words||[];
    const order=ws.map((w,i)=>({i,s:+w.start||1,r:tr(w)})).sort((a,b)=>a.s-b.s||a.r-b.r);
    els.rows.innerHTML=order.map((o,pos)=>{
      const i=o.i,w=ws[i];
      const colorOpts=COLORS.map(([lab,val])=>`<option value="${val}" ${w.color===val?'selected':''}>${lab}</option>`).join('');
      const heightOpts=HEIGHTS.map(([lab,val])=>`<option value="${val}" ${w.height===val?'selected':''}>${lab}</option>`).join('');
      return `
        <div class="row" data-i="${i}">
          <div class="rowTop">
            <div class="left"><span class="sw" style="--color:var(${w.color||'--c-red'})"></span><span>Word ${pos+1}</span></div>
            <div class="right"><button class="pill" type="button" data-act="rm">Remove</button></div>
          </div>
          <div class="grid5">
            <div class="full">
              <label class="lab">Clue</label>
              <input class="mi" data-f="clue" value="${escapeAttr(w.clue||'')}" />
            </div>
            <div class="full">
              <label class="lab">Answer</label>
              <input class="mi" data-f="answer" value="${escapeAttr(w.answer||'')}" />
            </div>
            <div>
              <label class="lab">Start</label>
              <input class="mi" data-f="start" inputmode="numeric" value="${escapeAttr(String(w.start??1))}" />
            </div>
            <div>
              <label class="lab">Color</label>
              <select class="ms" data-f="color">${colorOpts}</select>
            </div>
            <div>
              <label class="lab">Height</label>
              <select class="ms" data-f="height">${heightOpts}</select>
            </div>
          </div>
        </div>`;
    }).join('');

    const m=computed(puzzles[pIdx]);
    if(!m.ok){
      els.status.className='status bad';
      els.status.textContent=`Conflict at column ${m.conf.idx+1}: “${m.conf.a}” vs “${m.conf.b}”.`;
    } else if(m.gaps.length){
      els.status.className='status bad';
      els.status.textContent=`Uncovered columns: ${m.gaps.slice(0,18).map(x=>x+1).join(', ')}${m.gaps.length>18?'…':''}`;
    } else {
      els.status.className='status';
      els.status.innerHTML=`Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong> • ${dirty?'Unsaved changes':'Saved'}`;
    }
  }

  function renderPreview(){
    const m=computed(puzzles[pIdx]);
    setCols(m.total);
    renderGrid(els.bGrid,m,false);
    els.bGrid.classList.add('showNums');
    const bad=m.ok?null:m.conf?.idx;

    els.bGrid.querySelectorAll('.cell').forEach(c=>{
      const i=+c.dataset.i;
      c.querySelector('.num').textContent=i+1;
      c.querySelector('.letter').textContent=m.exp[i]||'';
      c.classList.toggle('is-bad',bad===i);
    });

    els.solution.textContent=`Solution row: ${m.exp.map(c=>c||'·').join('')}`;

    if(!m.ok){
      els.status.className='status bad';
      els.status.textContent=`Conflict at column ${m.conf.idx+1}: “${m.conf.a}” vs “${m.conf.b}”.`;
    } else if(m.gaps?.length){
      els.status.className='status bad';
      els.status.textContent=`Uncovered columns: ${m.gaps.slice(0,18).map(x=>x+1).join(', ')}${m.gaps.length>18?'…':''}`;
    } else {
      els.status.className='status';
      els.status.innerHTML=`Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong> • ${dirty?'Unsaved changes':'Saved'}`;
    }
  }

  function saveAndReRender(){
    setDirty(true);
    renderRows();
    renderPreview();
  }

  // ----- Tabs -----
  function setTab(t){
    const play=t==='play';
    els.tabPlay.classList.toggle('is-active',play);
    els.tabBuild.classList.toggle('is-active',!play);
    els.panelPlay.classList.toggle('is-active',play);
    els.panelBuild.classList.toggle('is-active',!play);
    els.tabPlay.setAttribute('aria-selected',play?'true':'false');
    els.tabBuild.setAttribute('aria-selected',!play?'true':'false');
    if(play) focusForTyping();
  }

  // ----- Escaping -----
  function escapeHtml(s){return String(s).replace(/[&<>]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]))}
  function escapeAttr(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}

  // ----- Events -----

  els.pSave.addEventListener('click',()=>{
    const m=computed(puzzles[pIdx]);
    if(!m.ok){alert('Fix conflicts before saving.');return;}
    if(m.gaps?.length){alert('Cover every column (no gaps) before saving.');return;}
    store.save();
    setDirty(false);
    loadPuzzle(pIdx);
  });

  els.ioExp.addEventListener('click',async()=>{
    const t=JSON.stringify(puzzles,null,2);
    els.ioTxt.value=t;
    try{await navigator.clipboard.writeText(t)}catch{}
  });

  els.ioImp.addEventListener('click',()=>{
    try{
      const arr=JSON.parse(els.ioTxt.value||'');
      if(!Array.isArray(arr)) throw 0;
      const norm=p=>({id:String(p?.id||uid()),title:String(p?.title||'Untitled'),words:Array.isArray(p?.words)&&p.words.length?p.words.map(w=>({clue:String(w?.clue||''),answer:String(w?.answer||''),start:+w?.start||1,color:String(w?.color||'--c-red'),height:String(w?.height||'full')})):[{clue:'Clue',answer:'WORD',start:1,color:'--c-red',height:'full'}]});
      puzzles=arr.map(norm);
      store.save();
      els.ioTxt.value='';
      loadPuzzle(0);
      setTab('build');
    }catch{alert('Invalid JSON. Paste the exported puzzles JSON and try again.')}
  });

  els.tabPlay.addEventListener('click',()=>setTab('play'));
  els.tabBuild.addEventListener('click',()=>setTab('build'));

  els.stage.addEventListener('keydown',onKey);
  kb.addEventListener('keydown',onKey);

  // Only focus typing target after user interaction (prevents VS Code editor focus stealing on reload)
  els.stage.addEventListener('pointerdown',()=>{markInteracted();focusForTyping()});

  els.grid.addEventListener('click',(e)=>{
    const cell=e.target.closest('.cell');
    if(!cell) return;
    markInteracted();focusForTyping();
    setAt(+cell.dataset.i);
  });

  els.legend.addEventListener('click',(e)=>{
    const b=e.target.closest('.clue');
    if(!b) return;
    markInteracted();focusForTyping();
    jumpToEntry(+b.dataset.e);
  });

  els.prev.addEventListener('click',()=>loadPuzzle(pIdx-1));
  els.next.addEventListener('click',()=>loadPuzzle(pIdx+1));
  els.reset.addEventListener('click',resetPlay);

  els.reveal.addEventListener('click',()=>{ markInteracted(); revealPlay(); focusForTyping(); });

  els.success.addEventListener('click',(e)=>{if(e.target===els.success){markInteracted();closeSuccess();focusForTyping()}});
  els.sClose.addEventListener('click',()=>{markInteracted();closeSuccess();focusForTyping()});
  els.sAgain.addEventListener('click',()=>{markInteracted();resetPlay();focusForTyping()});
  els.sNext.addEventListener('click',()=>{markInteracted();loadPuzzle(pIdx+1)});

  els.pSel.addEventListener('change',()=>loadPuzzle(+els.pSel.value||0));
  els.pTitle.addEventListener('input',()=>{
    puzzles[pIdx].title=els.pTitle.value;
    if(els.pSel.options[pIdx]) els.pSel.options[pIdx].text=els.pTitle.value||'Untitled';
    setDirty(true);
    renderPreview();
  });

  els.pNew.addEventListener('click',()=>{
    puzzles.push({id:uid(),title:'Untitled',words:[{clue:'Clue',answer:'WORD',start:1,color:'--c-red',height:'full'}]});
    store.save();
    loadPuzzle(puzzles.length-1);
    setTab('build');
  });

  els.pDel.addEventListener('click',()=>{
    if(puzzles.length<=1) return;
    if(!confirm('Delete this puzzle?')) return;
    puzzles.splice(pIdx,1);
    store.save();
    loadPuzzle(Math.max(0,pIdx-1));
  });


els.wAdd.addEventListener('click',()=>{

  const p=puzzles[pIdx];
  p.words=p.words||[];

  const maxEnd = p.words.reduce((m,w)=>{
    const s = Math.max(1, Math.floor(+w.start || 1));            // 1-based
    const len = cleanA(w.answer).length || 4;                    // treat empty as 4 chars
    return Math.max(m, s + len - 1);                             // end position (1-based)
  }, 0);

  const nextStart = Math.max(1, maxEnd + 1);

  p.words.push({clue:'Clue',answer:'WORD',start:nextStart,color:'--c-red',height:'full'});
  saveAndReRender();
});


  els.rows.addEventListener('click',(e)=>{
    const row=e.target.closest('.row');
    const act=e.target.closest('[data-act]')?.dataset.act;
    if(!row || !act) return;
    const i=+row.dataset.i; const ws=puzzles[pIdx].words||[];
    if(act==='rm'){ws.splice(i,1);saveAndReRender();return;}
  });

  els.rows.addEventListener('input',(e)=>{
    const row=e.target.closest('.row');
    const f=e.target.dataset.f;
    if(!row || !f) return;
    const i=+row.dataset.i;
    const w=(puzzles[pIdx].words||[])[i];
    if(!w) return;
    if(f==='start') w.start=+e.target.value||1;
    else w[f]=e.target.value;
    setDirty(true);
    renderPreview();
  });

  els.rows.addEventListener('change',(e)=>{
    const row=e.target.closest('.row');
    const f=e.target.dataset.f;
    if(!row || !f) return;
    const i=+row.dataset.i;
    const w=(puzzles[pIdx].words||[])[i];
    if(!w) return;
    w[f]=e.target.value;
    setDirty(true);
    renderRows();
    renderPreview();
  });

  // Start (no auto-focus on load)
  loadPuzzle(0);
