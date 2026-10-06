(function(){
'use strict';
var WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
if(window.pdfjsLib){try{pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER;}catch(e){}}

var $=function(s){return document.querySelector(s);};
function el(tag,props){
  var e=document.createElement(tag);props=props||{};
  Object.keys(props).forEach(function(k){
    var v=props[k];
    if(k==='class')e.className=v;
    else if(k==='text')e.textContent=v;
    else if(k.indexOf('on')===0)e.addEventListener(k.slice(2),v);
    else if(v===true)e.setAttribute(k,'');
    else if(v!==false&&v!=null)e.setAttribute(k,v);
  });
  for(var i=2;i<arguments.length;i++){
    var c=arguments[i];if(c==null)continue;
    (Array.isArray(c)?c:[c]).forEach(function(x){if(x!=null)e.append(x.nodeType?x:document.createTextNode(x));});
  }
  return e;
}

var EXAMPLE=[{name:'Statement of account',rows:[
  ['Date','Description','Ref no.','Debit (PKR)','Credit (PKR)','Balance (PKR)'],
  ['01-Oct-2026','Opening balance','','','',250000],
  ['02-Oct-2026','Raast transfer, Rehman Traders','RT-48213',45000,'',205000],
  ['03-Oct-2026','Salary credit','SAL-1003','',180000,385000],
  ['05-Oct-2026','K-Electric bill payment','UB-77120',12460,'',372540],
  ['06-Oct-2026','ATM withdrawal, Clifton','ATM-5521',20000,'',352540],
  ['07-Oct-2026','Easypaisa top-up','EP-90311',5000,'',347540]]}];

var S={files:[],nextId:1,running:false,active:0,sheets:[],
  opts:{mode:'table',layout:'perPage',sens:'normal',nums:true,pageCol:false}};

/* ---------- helpers ---------- */
function fmtSize(b){return b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';}
function colLetter(i){var s='';i++;while(i>0){var m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;}
var toastT;
function toast(msg){var t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('show');},3200);}
function baseName(n){return n.replace(/\.pdf$/i,'');}

var NUM=/^\(?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?$|^\(?-?\d+(?:\.\d+)?\)?$/;
function convVal(s){
  if(!S.opts.nums)return s;
  var t=s.trim();
  if(!NUM.test(t))return s;
  var open=t.charAt(0)==='(',close=t.charAt(t.length-1)===')';
  if(open!==close)return s;
  var neg=(open&&close)||t.charAt(0)==='-';
  var digits=t.replace(/[(),\-]/g,'');
  if(/^0\d/.test(digits))return s;
  if(digits.replace('.','').length>15)return s;
  var n=parseFloat(digits);
  if(!isFinite(n))return s;
  return neg?-n:n;
}

/* ---------- text -> rows ---------- */
var SENS={tight:0.45,normal:0.8,loose:1.5};

function toLines(items,sens){
  if(!items.length)return [];
  var hs=items.map(function(i){return i.h;}).sort(function(a,b){return a-b;});
  var mh=hs[hs.length>>1]||10;
  var tol=Math.max(1.5,mh*0.4);
  var sorted=items.slice().sort(function(a,b){return b.y-a.y||a.x-b.x;});
  var rows=[];
  sorted.forEach(function(it){
    var r=rows[rows.length-1];
    if(r&&Math.abs(r.y-it.y)<=tol){r.items.push(it);r.y=(r.y*(r.items.length-1)+it.y)/r.items.length;}
    else rows.push({y:it.y,items:[it]});
  });
  var factor=SENS[sens]||0.8;
  return rows.map(function(r){
    r.items.sort(function(a,b){return a.x-b.x;});
    var cells=[],cur=null;
    r.items.forEach(function(it){
      if(!cur){cur={t:it.s,x0:it.x,x1:it.x+it.w,h:it.h};return;}
      var gap=it.x-cur.x1,thr=Math.max(it.h,cur.h)*factor;
      if(gap>thr||gap<-Math.max(it.h,cur.h)*0.15){cur.t=cur.t.trim();cells.push(cur);cur={t:it.s,x0:it.x,x1:it.x+it.w,h:it.h};}
      else{
        var sp=(gap>Math.max(it.h,cur.h)*0.12&&!/\s$/.test(cur.t)&&!/^\s/.test(it.s))?' ':'';
        cur.t+=sp+it.s;cur.x1=Math.max(cur.x1,it.x+it.w);
      }
    });
    cur.t=cur.t.trim();cells.push(cur);
    return cells.filter(function(c){return c.t!=='';});
  }).filter(function(r){return r.length>0;});
}

var CELL_NUM=/^[\(\-+]?\d[\d,]*(?:\.\d+)?[\)%]?$/;
function isNumText(t){return CELL_NUM.test(String(t).trim());}

/* The header line is the first line (within the top 5) with 3+ cells that are mostly text. */
function pickHeader(lines){
  for(var i=0;i<Math.min(5,lines.length);i++){
    var r=lines[i];
    if(r.length>=3){
      var txt=r.filter(function(c){return !isNumText(c.t);}).length;
      if(txt/r.length>=0.6)return i;
    }
  }
  return -1;
}
function countAt(map,v){var k=Math.round(v);return (map[k-1]||0)+(map[k]||0)+(map[k+1]||0);}
/* A cell lines up with its column by its left edge (text) or right edge (numbers). Pick the edge many cells share. */
function edgeOf(c,L,R){
  var cl=countAt(L,c.x0),cr=countAt(R,c.x1);
  if(cl>cr)return 'L';
  if(cr>cl)return 'R';
  return isNumText(c.t)?'R':'L';
}
function median(a){var b=a.slice().sort(function(x,y){return x-y;});return b.length?b[b.length>>1]:0;}

function detectCols(rowSets){
  var TOL=3,L={},R={},data=[],headers=[],nLines=0;
  rowSets.forEach(function(rows){
    var hi=pickHeader(rows);
    rows.forEach(function(r,i){
      if(i===hi){r.forEach(function(c){headers.push(c);});return;}
      if(r.length<2)return;
      nLines++;
      r.forEach(function(c){
        data.push(c);
        var a=Math.round(c.x0),b=Math.round(c.x1);
        L[a]=(L[a]||0)+1;R[b]=(R[b]||0)+1;
      });
    });
  });
  var anchors=data.map(function(c){var e=edgeOf(c,L,R);return {pos:e==='L'?c.x0:c.x1,e:e,c:c};})
    .sort(function(a,b){return a.pos-b.pos;});
  var groups=[];
  anchors.forEach(function(a){
    var g=groups[groups.length-1];
    if(g&&a.pos-g.last<=TOL){g.items.push(a);g.last=a.pos;}
    else groups.push({items:[a],last:a.pos});
  });
  var need=nLines<6?1:2;
  var cols=[];
  groups.forEach(function(g){
    if(g.items.length<need)return;
    var nR=g.items.filter(function(a){return a.e==='R';}).length;
    var e=nR*2>g.items.length?'R':'L';
    var pos=median(g.items.map(function(a){return a.pos;}));
    var w=median(g.items.map(function(a){return a.c.x1-a.c.x0;}));
    cols.push({pos:pos,e:e,x0:e==='L'?pos:pos-w,x1:e==='L'?pos+w:pos,n:g.items.length});
  });
  /* A header label that matches no column and sits over none gets a column of its own. */
  var extra=[];
  headers.forEach(function(h){
    var hit=cols.some(function(k){return Math.abs((k.e==='L'?h.x0:h.x1)-k.pos)<=TOL;});
    if(hit)return;
    var over=cols.concat(extra).some(function(k){return Math.min(h.x1,k.x1+2)-Math.max(h.x0,k.x0-2)>0;});
    if(!over)extra.push({pos:h.x0,e:'L',x0:h.x0,x1:h.x1,n:0});
  });
  cols=cols.concat(extra);
  if(!cols.length)cols=[{pos:0,e:'L',x0:-Infinity,x1:Infinity,n:0}];
  cols.sort(function(a,b){return (a.x0+a.x1)-(b.x0+b.x1);});
  return {cols:cols,tol:TOL};
}

function colFor(c,model,isHeader){
  var cols=model.cols,tol=model.tol,best=-1,bd=Infinity,i,k;
  for(i=0;i<cols.length;i++){
    k=cols[i];
    var d=Math.abs((k.e==='L'?c.x0:c.x1)-k.pos);
    if(d<=tol&&d<bd){bd=d;best=i;}
  }
  if(best>=0)return best;
  bd=Infinity;
  var cx=(c.x0+c.x1)/2;
  if(isHeader){
    var any=false;
    for(i=0;i<cols.length;i++){
      k=cols[i];
      if(Math.min(c.x1,k.x1+2)-Math.max(c.x0,k.x0-2)>0){
        var dc=Math.abs(cx-(k.x0+k.x1)/2);
        if(dc<bd){bd=dc;best=i;any=true;}
      }
    }
    if(any)return best;
  }
  bd=Infinity;
  var ex=isNumText(c.t)?c.x1:c.x0;
  for(i=0;i<cols.length;i++){
    k=cols[i];
    var d2=ex<k.x0?k.x0-ex:(ex>k.x1?ex-k.x1:0);
    d2=d2*1000+Math.abs(cx-(k.x0+k.x1)/2)/1000;
    if(d2<bd){bd=d2;best=i;}
  }
  return best<0?0:best;
}

function gridFrom(rows,model){
  var hi=pickHeader(rows);
  return rows.map(function(r,ri){
    var arr=new Array(model.cols.length).fill('');
    r.forEach(function(c){
      var i=colFor(c,model,ri===hi);
      arr[i]=arr[i]?arr[i]+' '+c.t:c.t;
    });
    return arr;
  });
}

function uniqueName(base,used){
  var n=base.replace(/[\[\]:*?\/\\]/g,'-').replace(/^'+|'+$/g,'').trim()||'Sheet';
  n=n.slice(0,31);
  var cand=n,k=2;
  while(used[cand.toLowerCase()]){var suf=' ('+k+')';cand=n.slice(0,31-suf.length)+suf;k++;}
  used[cand.toLowerCase()]=1;
  return cand;
}

function trimEmptyCols(rows){
  if(!rows.length)return rows;
  var n=Math.max.apply(null,rows.map(function(r){return r.length;}));
  var keep=[];
  for(var c=0;c<n;c++){if(rows.some(function(r){return r[c]!==''&&r[c]!=null;}))keep.push(c);}
  return rows.map(function(r){return keep.map(function(c){return r[c]==null?'':r[c];});});
}

function buildSheets(){
  var o=S.opts,used={},out=[];
  S.files.filter(function(f){return f.status==='done';}).forEach(function(f){
    var base=baseName(f.name);
    var perPage=f.pages.map(function(p){return {n:p.n,lines:toLines(p.items,o.sens)};});
    if(o.layout==='single'){
      var rows=[];
      if(o.mode==='table'){
        var cols=detectCols(perPage.map(function(p){return p.lines;}));
        perPage.forEach(function(p){
          gridFrom(p.lines,cols).forEach(function(r){rows.push(o.pageCol?[p.n].concat(r):r);});
        });
      }else{
        perPage.forEach(function(p){p.lines.forEach(function(r){var a=r.map(function(c){return c.t;});rows.push(o.pageCol?[p.n].concat(a):a);});});
      }
      if(rows.length)out.push({name:uniqueName(base,used),rows:finish(rows)});
    }else{
      perPage.forEach(function(p){
        if(!p.lines.length)return;
        var rows=o.mode==='table'?gridFrom(p.lines,detectCols([p.lines])):p.lines.map(function(r){return r.map(function(c){return c.t;});});
        var nm=f.pages.length===1?base:base.slice(0,24)+' p'+p.n;
        out.push({name:uniqueName(nm,used),rows:finish(rows)});
      });
    }
  });
  return out;
}
function finish(rows){
  var w=rows.map(function(r){return r.map(function(v){return typeof v==='string'?convVal(v):v;});});
  return trimEmptyCols(w);
}

/* ---------- PDF reading ---------- */
async function parseFile(f){
  f.status='reading';f.progress=0;f.error='';render();
  if(!window.pdfjsLib){f.status='error';f.error='The PDF engine could not load. Check your connection and reload.';return;}
  try{
    var buf=new Uint8Array(await f.file.arrayBuffer());
    var pdf=await pdfjsLib.getDocument({data:buf,password:f.password||undefined}).promise;
    f.pageCount=pdf.numPages;f.pages=[];
    var total=0;
    for(var n=1;n<=pdf.numPages;n++){
      var page=await pdf.getPage(n);
      var tc=await page.getTextContent();
      var items=[];
      tc.items.forEach(function(i){
        if(typeof i.str!=='string'||i.str.trim()==='')return;
        items.push({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.height)||Math.abs(i.transform[3])||10});
      });
      total+=items.length;
      f.pages.push({n:n,items:items});
      f.progress=n/pdf.numPages;
      page.cleanup();
      updateFileRow(f);
    }
    try{pdf.destroy();}catch(e){}
    if(total===0){f.status='notext';}
    else{f.status='done';}
  }catch(err){
    var nm=err&&err.name;
    if(nm==='PasswordException'){f.status='password';f.error=err.code===2?'That password is not correct.':'This PDF is password protected.';}
    else{f.status='error';f.error=nm==='InvalidPDFException'?'This file is not a valid PDF.':'Could not read this file.';}
  }
}

async function runQueue(){
  if(S.running)return;
  S.running=true;
  try{
    var next;
    while((next=S.files.find(function(f){return f.status==='queued';}))){
      await parseFile(next);
      refresh();
    }
  }finally{S.running=false;refresh();}
}

function addFiles(list){
  var added=0,skipped=0;
  Array.prototype.forEach.call(list,function(file){
    var isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
    if(!isPdf){skipped++;return;}
    var dup=S.files.some(function(f){return f.name===file.name&&f.size===file.size&&f.lm===file.lastModified;});
    if(dup)return;
    S.files.push({id:S.nextId++,file:file,name:file.name,size:file.size,lm:file.lastModified,status:'queued',progress:0,pages:[],pageCount:0,error:'',password:''});
    added++;
  });
  if(skipped)toast('Only PDF files can be added.');
  if(added){S.active=0;render();runQueue();}
}

/* ---------- rendering ---------- */
function fileSub(f){
  var rows=0;
  if(f.status==='queued')return 'Waiting';
  if(f.status==='reading')return 'Reading page '+Math.max(1,Math.min(f.pageCount||1,Math.round(f.progress*(f.pageCount||1))))+' of '+(f.pageCount||'…');
  if(f.status==='done')return f.pageCount+(f.pageCount===1?' page':' pages')+' · '+fmtSize(f.size);
  if(f.status==='notext')return 'No selectable text. This looks like a scanned PDF.';
  return f.error||'Something went wrong.';
}
function fileRow(f){
  var cls='file'+(f.status==='done'?' done':'')+((f.status==='error'||f.status==='password')?' error':'')+(f.status==='notext'?' warn':'');
  var li=el('li',{class:cls,'data-id':f.id});
  li.append(el('div',{class:'tag',text:f.status==='done'?'OK':'PDF','aria-hidden':'true'}));
  var meta=el('div',{class:'meta'},el('div',{class:'name',text:f.name,title:f.name}),el('div',{class:'sub',text:fileSub(f)}));
  if(f.status==='reading'||f.status==='queued'){meta.append(el('div',{class:'bar'},el('i',{style:'width:'+Math.round(f.progress*100)+'%'})));}
  li.append(meta);
  li.append(el('button',{class:'icon-btn',type:'button','aria-label':'Remove '+f.name,onclick:function(){removeFile(f.id);}},
    (function(){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','16');s.setAttribute('height','16');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2.2');s.setAttribute('stroke-linecap','round');var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M6 6l12 12M18 6 6 18');s.append(p);return s;})()));
  if(f.status==='password'){
    var inp=el('input',{type:'password',id:'pw-'+f.id,placeholder:'PDF password','aria-label':'Password for '+f.name,autocomplete:'off'});
    var go=function(){f.password=inp.value;f.status='queued';render();runQueue();};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')go();});
    li.append(el('div',{class:'pw'},inp,el('button',{class:'btn',type:'button',text:'Unlock',onclick:go})));
  }
  return li;
}
function updateFileRow(f){
  var li=document.querySelector('.file[data-id="'+f.id+'"]');
  if(!li)return;
  var sub=li.querySelector('.sub');if(sub)sub.textContent=fileSub(f);
  var b=li.querySelector('.bar i');if(b)b.style.width=Math.round(f.progress*100)+'%';
}
function removeFile(id){
  S.files=S.files.filter(function(f){return f.id!==id;});
  S.active=0;refresh();
}

function renderFiles(){
  var ul=$('#fileList');ul.textContent='';
  S.files.forEach(function(f){ul.append(fileRow(f));});
}

function render(){renderFiles();renderPreview();}
function refresh(){S.sheets=buildSheets();render();}

function renderPreview(){
  var live=S.sheets.length>0;
  var sheets=live?S.sheets:(S.files.length?[]:EXAMPLE);
  if(S.active>=sheets.length)S.active=0;
  var sh=sheets[S.active];
  var wrap=$('#gridwrap'),more=$('#more'),tabs=$('#tabs');
  wrap.textContent='';more.textContent='';tabs.textContent='';
  $('#dlXlsx').disabled=!live;$('#dlCsv').disabled=!live;
  var chip=$('#chip');
  chip.textContent=live?'Your data':(S.files.length?'Working':'Example');
  chip.className='chip'+(live?' live':'');
  $('#pageColWrap').classList.toggle('off',S.opts.layout!=='single');
  $('#pageCol').disabled=S.opts.layout!=='single';

  if(!sh){
    var busy=S.files.some(function(f){return f.status==='queued'||f.status==='reading';});
    $('#sheetTitle').textContent=busy?'Reading your PDF…':'Nothing to show yet';
    $('#stats').textContent='';
    wrap.append(el('div',{class:'empty'},el('div',null,el('strong',{text:busy?'Extracting text':'No table data found'}),
      busy?'This only takes a moment.':'Check the file list for details, or try Line by line extraction.')));
    return;
  }
  $('#sheetTitle').textContent=live?sh.name:sh.name+' (sample)';
  var nrows=sh.rows.length,ncols=sh.rows.reduce(function(m,r){return Math.max(m,r.length);},0);
  var st=$('#stats');st.textContent='';
  st.append(el('span',null,el('b',{text:String(nrows)}),' rows'),el('span',null,el('b',{text:String(ncols)}),' columns'),el('span',null,el('b',{text:String(sheets.length)}),sheets.length===1?' sheet':' sheets'));

  var LIMIT=300;
  var table=el('table',{class:'xl'});
  var hr=el('tr',null,el('th',{text:''}));
  for(var c=0;c<ncols;c++)hr.append(el('th',{text:colLetter(c)}));
  table.append(el('thead',null,hr));
  var tb=el('tbody');
  sh.rows.slice(0,LIMIT).forEach(function(r,i){
    var tr=el('tr',{class:i===0&&!live?'first':''},el('th',{scope:'row',text:String(i+1)}));
    for(var c=0;c<ncols;c++){
      var v=r[c];
      var isN=typeof v==='number';
      tr.append(el('td',{class:isN?'num':'',text:(v==null||v==='')?'':String(v),title:(typeof v==='string'&&v.length>40)?v:null}));
    }
    tb.append(tr);
  });
  table.append(tb);
  wrap.append(table);
  if(nrows>LIMIT)more.append(el('div',{class:'more',text:'Showing the first '+LIMIT+' of '+nrows+' rows. The download contains every row.'}));
  sheets.forEach(function(s,i){
    tabs.append(el('button',{class:'tab',role:'tab',type:'button','aria-selected':i===S.active?'true':'false',title:s.name,text:s.name,onclick:function(){S.active=i;renderPreview();}}));
  });
}

/* ---------- downloads ---------- */
var dlPromise=null;
function getDownloads(){
  if(!dlPromise){
    dlPromise=(async function(){
      try{if(window.claude&&typeof window.claude.use==='function'){return await window.claude.use('downloads');}}catch(e){}
      return null;
    })();
  }
  return dlPromise;
}
async function saveBlob(filename,blob){
  var dl=await getDownloads();
  if(dl){
    try{await dl.save({filename:filename,data:blob});toast('Saved '+filename);return;}
    catch(e){
      if(e&&e.code==='declined'){toast('Download cancelled.');return;}
      if(e&&e.code==='rate_limited'){toast('Please wait a moment and try again.');return;}
      toast('Downloads are not available in this view.');return;
    }
  }
  try{
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href);},5000);
    toast('Downloading '+filename);
  }catch(e){toast('Your browser blocked the download.');}
}

function toXlsxBlob(){
  var wb=XLSX.utils.book_new();
  S.sheets.forEach(function(s){
    var aoa=s.rows.map(function(r){return r.map(function(v){return v===''?null:v;});});
    var ws=XLSX.utils.aoa_to_sheet(aoa);
    var n=s.rows.reduce(function(m,r){return Math.max(m,r.length);},0),w=[];
    for(var c=0;c<n;c++){
      var mx=8;
      s.rows.forEach(function(r){var v=r[c];if(v!=null)mx=Math.max(mx,String(v).length+2);});
      w.push({wch:Math.min(mx,60)});
    }
    ws['!cols']=w;
    XLSX.utils.book_append_sheet(wb,ws,s.name);
  });
  var out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  return new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

$('#dlXlsx').addEventListener('click',function(){
  if(!S.sheets.length)return;
  if(!window.XLSX){toast('The Excel engine could not load. Reload the page.');return;}
  var done=S.files.filter(function(f){return f.status==='done';});
  var name=(done.length===1?baseName(done[0].name):'converted-pdfs')+'.xlsx';
  try{saveBlob(name,toXlsxBlob());}catch(e){toast('Could not build the Excel file.');}
});
$('#dlCsv').addEventListener('click',function(){
  var s=S.sheets[S.active];if(!s)return;
  if(!window.XLSX){toast('The Excel engine could not load. Reload the page.');return;}
  var ws=XLSX.utils.aoa_to_sheet(s.rows.map(function(r){return r.map(function(v){return v===''?null:v;});}));
  var csv='﻿'+XLSX.utils.sheet_to_csv(ws);
  saveBlob(s.name.replace(/[\\\/:*?"<>|]/g,'-')+'.csv',new Blob([csv],{type:'text/csv'}));
});

/* ---------- inputs ---------- */
var drop=$('#drop'),inp=$('#fileInput');
inp.addEventListener('change',function(){addFiles(inp.files);inp.value='';});
['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over');});});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over');});});
drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files)addFiles(e.dataTransfer.files);});
window.addEventListener('dragover',function(e){e.preventDefault();});
window.addEventListener('drop',function(e){e.preventDefault();});

document.querySelectorAll('input[name="mode"]').forEach(function(r){r.addEventListener('change',function(){
  S.opts.mode=r.value;
  $('#modeHint').textContent=r.value==='table'?'Aligns text into columns, like the table you see in the PDF.':'Puts each line of the PDF on its own row, with text pieces side by side.';
  S.active=0;refresh();});});
document.querySelectorAll('input[name="layout"]').forEach(function(r){r.addEventListener('change',function(){S.opts.layout=r.value;S.active=0;refresh();});});
$('#sens').addEventListener('change',function(e){S.opts.sens=e.target.value;refresh();});
$('#nums').addEventListener('change',function(e){S.opts.nums=e.target.checked;refresh();});
$('#pageCol').addEventListener('change',function(e){S.opts.pageCol=e.target.checked;refresh();});

render();
getDownloads();
})();
