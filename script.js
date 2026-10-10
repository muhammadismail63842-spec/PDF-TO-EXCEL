(function(){
'use strict';
/* ===== ENGINE:BEGIN (pure functions: no DOM, no network) ===== */
var SENS={tight:0.45,normal:0.8,loose:1.5};

function median(a){var b=a.slice().sort(function(x,y){return x-y;});return b.length?b[b.length>>1]:0;}
function baseName(n){return String(n).replace(/\.pdf$/i,'');}
function colLetter(i){var s='';i++;while(i>0){var m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;}

/* ---------- 1. text items -> lines of cells ----------
   An item is {s,x,y,w,h}: text, left edge, baseline (y grows upwards), width, font height. */
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
      if(!cur){cur={t:it.s,x0:it.x,x1:it.x+it.w,h:it.h,parts:[it]};return;}
      var gap=it.x-cur.x1,thr=Math.max(it.h,cur.h)*factor;
      if(gap>thr||gap<-Math.max(it.h,cur.h)*0.15){cur.t=cur.t.trim();cells.push(cur);cur={t:it.s,x0:it.x,x1:it.x+it.w,h:it.h,parts:[it]};}
      else{
        var sp=(gap>Math.max(it.h,cur.h)*0.12&&!/\s$/.test(cur.t)&&!/^\s/.test(it.s))?' ':'';
        cur.t+=sp+it.s;cur.x1=Math.max(cur.x1,it.x+it.w);cur.parts.push(it);
      }
    });
    cur.t=cur.t.trim();cells.push(cur);
    var kept=cells.filter(function(c){return c.t!=='';});
    kept.y=r.y;kept.h=mh;
    return kept;
  }).filter(function(r){return r.length>0;});
}

var NUMLIKE=/^[\(\-−+]?(?:(?:rs\.?|pkr|inr|usd|eur|gbp|aed|sar)\s*|[$€£¥₹]\s*)?[\(\-−]?\d[\d.,]*\)?\s*%?$/i;
function isNumText(t){return NUMLIKE.test(String(t).trim());}

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
  /* Match each header label to a data column. Headers are often centred, so first try an exact edge
     match, then the closest centre. A column takes one header. */
  var hmap=new Map(),taken=new Set();
  function assignBest(cands){
    cands.sort(function(a,b){return a.d-b.d;});
    cands.forEach(function(x){
      if(hmap.has(x.h)||taken.has(x.k))return;
      hmap.set(x.h,x.k);taken.add(x.k);
    });
  }
  var cand=[];
  headers.forEach(function(h){cols.forEach(function(k){
    var d=Math.abs((k.e==='L'?h.x0:h.x1)-k.pos);
    if(d<=TOL)cand.push({h:h,k:k,d:d});
  });});
  assignBest(cand);
  cand=[];
  headers.forEach(function(h){
    if(hmap.has(h))return;
    cols.forEach(function(k){
      var d=Math.abs((h.x0+h.x1)/2-(k.x0+k.x1)/2);
      var lim=Math.max(70,((h.x1-h.x0)+(k.x1-k.x0))/2+30);
      if(d<=lim)cand.push({h:h,k:k,d:d});
    });
  });
  assignBest(cand);
  /* A header with no free column: join the column it sits over, or get a column of its own (e.g. an Image column). */
  var extra=[];
  headers.forEach(function(h){
    if(hmap.has(h))return;
    var best=null,bd=Infinity;
    cols.forEach(function(k){
      if(Math.min(h.x1,k.x1+2)-Math.max(h.x0,k.x0-2)>0){
        var d=Math.abs((h.x0+h.x1)/2-(k.x0+k.x1)/2);
        if(d<bd){bd=d;best=k;}
      }
    });
    if(!best){best={pos:h.x0,e:'L',x0:h.x0,x1:h.x1,n:0};extra.push(best);}
    hmap.set(h,best);
  });
  cols=cols.concat(extra);
  if(!cols.length)cols=[{pos:0,e:'L',x0:-Infinity,x1:Infinity,n:0}];
  cols.sort(function(a,b){return (a.x0+a.x1)-(b.x0+b.x1);});
  if(cols.length>80)cols=cols.slice(0,80);
  return {cols:cols,tol:TOL,hmap:hmap};
}

function colFor(c,model,isHeader){
  var cols=model.cols,tol=model.tol,best=-1,bd=Infinity,i,k;
  if(isHeader&&model.hmap&&model.hmap.has(c)){var hi2=cols.indexOf(model.hmap.get(c));if(hi2>=0)return hi2;}
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

function joinParts(parts){
  var t=parts[0].s,prev=parts[0];
  for(var i=1;i<parts.length;i++){
    var p=parts[i],gap=p.x-(prev.x+prev.w);
    t+=((gap>Math.max(p.h,prev.h)*0.12&&!/\s$/.test(t)&&!/^\s/.test(p.s))?' ':'')+p.s;
    prev=p;
  }
  return t.trim();
}
/* "Plastic 30" where 30 really is the quantity: its right edge sits on a numeric column, so move it there. */
function splitTail(r,model){
  var out=[];
  r.forEach(function(c){
    var parts=c.parts;
    if(!parts||parts.length<2||isNumText(c.t)){out.push(c);return;}
    var tails=[];
    while(parts.length>1){
      var last=parts[parts.length-1];
      var ok=isNumText(last.s)&&model.cols.some(function(k){return k.e==='R'&&Math.abs((last.x+last.w)-k.pos)<=model.tol+1;});
      if(!ok)break;
      tails.unshift({t:last.s.trim(),x0:last.x,x1:last.x+last.w,h:last.h,parts:[last]});
      parts=parts.slice(0,-1);
    }
    if(!tails.length){out.push(c);return;}
    out.push({t:joinParts(parts),x0:c.x0,x1:parts[parts.length-1].x+parts[parts.length-1].w,h:c.h,parts:parts});
    tails.forEach(function(t){out.push(t);});
  });
  return out;
}

/* lines -> grid rows (arrays of strings); each row keeps y and h of its line */
function gridFrom(rows,model,hiOverride){
  var hi=hiOverride==null?pickHeader(rows):hiOverride;
  return rows.map(function(r,ri){
    var arr=new Array(model.cols.length).fill('');
    (ri===hi?r:splitTail(r,model)).forEach(function(c){
      var i=colFor(c,model,ri===hi);
      arr[i]=arr[i]?arr[i]+' '+c.t:c.t;
    });
    arr.y=r.y;arr.h=r.h;
    return arr;
  });
}

/* ---------- 2. several tables, repeated headers, wrapped text ---------- */
function lineKey(l){return l.map(function(c){return c.t;}).join('|').toLowerCase().replace(/\d+/g,'#').replace(/\s+/g,' ').trim();}
function hasNumCell(l){return l.some(function(c){return isNumText(c.t);});}
var PAGENUM_RE=/^(?:page\s*)?#\s*(?:of|\/)\s*#$|^page\s*#$/;

/* Multi-page tables: drop the table header repeated on later pages, and page headers/footers that repeat.
   Lines with numbers in them (totals) are never dropped as page furniture. */
function dropRepeats(pages){
  if(pages.length<2)return pages;
  var h0=pickHeader(pages[0].lines),K0=h0>=0?lineKey(pages[0].lines[h0]):null;
  var counts={},cand=[];
  pages.forEach(function(p){
    var L=p.lines,seen={},ids=[],i,idx=[];
    for(i=0;i<Math.min(2,L.length);i++)idx.push(i);
    for(i=Math.max(2,L.length-2);i<L.length;i++)idx.push(i);
    idx.forEach(function(i){
      var k=lineKey(L[i]);
      if(!k||(hasNumCell(L[i])&&!PAGENUM_RE.test(k)))return;
      ids.push([i,k]);seen[k]=1;
    });
    Object.keys(seen).forEach(function(k){counts[k]=(counts[k]||0)+1;});
    cand.push(ids);
  });
  var need=Math.max(2,Math.ceil(pages.length*0.6));
  return pages.map(function(p,pi){
    var drop={};
    cand[pi].forEach(function(e){
      if(PAGENUM_RE.test(e[1]))drop[e[0]]=1;
      else if(pi>0&&counts[e[1]]>=need)drop[e[0]]=1;
    });
    if(pi>0&&K0){var h=pickHeader(p.lines);if(h>=0&&lineKey(p.lines[h])===K0)drop[h]=1;}
    return {n:p.n,lines:p.lines.filter(function(l,i){return !drop[i];})};
  });
}

/* Split a page into blocks wherever the vertical gap is much bigger than the usual line spacing. */
function segmentBlocks(lines){
  if(lines.length<8)return [lines];
  var gaps=[],i;
  for(i=1;i<lines.length;i++)gaps.push(lines[i-1].y-lines[i].y);
  var med=median(gaps),h=median(lines.map(function(l){return l.h||10;}));
  var thr=Math.max(med*3,h*3.5);
  var out=[],cur=[lines[0]];
  for(i=1;i<lines.length;i++){
    if(lines[i-1].y-lines[i].y>thr){out.push(cur);cur=[];}
    cur.push(lines[i]);
  }
  out.push(cur);
  return out;
}
function colMatch(a,b){
  if(a.e===b.e&&Math.abs(a.pos-b.pos)<=4)return true;
  return Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)>0&&Math.abs((a.x0+a.x1)/2-(b.x0+b.x1)/2)<=8;
}
function compatible(m1,m2){
  var small=m1.cols.length<=m2.cols.length?m1:m2,big=small===m1?m2:m1;
  return small.cols.every(function(k){return big.cols.some(function(j){return colMatch(k,j);});});
}
/* Group blocks into tables: blocks whose columns fit each other share one column model. */
function buildTables(blocks){
  var tables=[];
  blocks.forEach(function(b){
    if(b.lines.length<3)return;
    var m=detectCols([b.lines]),t=null,i;
    for(i=0;i<tables.length;i++){if(compatible(m,tables[i].model)){t=tables[i];break;}}
    if(!t){t={lines:[],model:m};tables.push(t);}
    else if(m.cols.length>t.model.cols.length)t.model=m;
    t.lines.push.apply(t.lines,b.lines);b.table=t;
  });
  if(!tables.length){
    var all=[];blocks.forEach(function(b){all.push.apply(all,b.lines);});
    tables.push({lines:all,model:null});
    blocks.forEach(function(b){b.table=tables[0];});
  }
  var main=tables.reduce(function(a,b){return b.lines.length>a.lines.length?b:a;});
  blocks.forEach(function(b){if(!b.table){b.table=main;main.lines.push.apply(main.lines,b.lines);}});
  tables.forEach(function(t){t.model=detectCols([t.lines]);});
  return tables;
}

/* Wrapped text: a line with a single text cell, close above/below a real row, is part of that row's cell. */
function joinWrapped(g,model){
  var n=g.length,i;
  function nz(row){var c=0;for(var k=0;k<row.length;k++)if(row[k]!=='')c++;return c;}
  function single(row){var idx=-1,cnt=0;for(var k=0;k<row.length;k++)if(row[k]!==''){cnt++;idx=k;}return cnt===1?idx:-1;}
  var anchor=g.map(function(r){return nz(r)>=2;});
  var colOf=g.map(function(r,i){return anchor[i]?-1:single(r);});
  var att=new Array(n).fill(-1),pre=new Array(n).fill(false);
  function okTarget(a,c,fi){var v=g[a][c];return v===''||!isNumText(v);}
  function eligible(i){
    if(anchor[i])return false;
    var c=colOf[i];if(c<0)return false;
    var col=model.cols[c];
    return !!col&&col.e==='L'&&!isNumText(g[i][c]);
  }
  for(i=0;i<n;i++){ // pass 1: attach downwards (continuation lines)
    if(!eligible(i)||i===0)continue;
    var h=g[i].h||10,tight=1.35*h,c=colOf[i];
    var a=anchor[i-1]?i-1:(att[i-1]>=0&&!pre[i-1]?att[i-1]:-1);
    if(a<0||g[i-1].y-g[i].y>=tight||!okTarget(a,c))continue;
    if(i<n-1&&anchor[i+1]&&g[i].y-g[i+1].y<g[i-1].y-g[i].y&&okTarget(i+1,c))continue; // closer to the next row
    att[i]=a;
  }
  for(i=n-1;i>=0;i--){ // pass 2: attach upwards (lines above their row)
    if(att[i]>=0||!eligible(i)||i===n-1)continue;
    var h2=g[i].h||10,tight2=1.35*h2,c2=colOf[i];
    var a2=anchor[i+1]?i+1:(att[i+1]>=0&&pre[i+1]?att[i+1]:-1);
    if(a2<0||g[i].y-g[i+1].y>=tight2||!okTarget(a2,c2))continue;
    att[i]=a2;pre[i]=true;
  }
  var out=[],map=new Array(n),outIdx=new Array(n).fill(-1);
  for(i=0;i<n;i++){
    if(att[i]>=0)continue;
    var row=g[i].slice();row.y=g[i].y;row.h=g[i].h;
    outIdx[i]=out.length;out.push(row);
  }
  var frags={};
  for(i=0;i<n;i++){if(att[i]>=0){(frags[att[i]]=frags[att[i]]||[]).push(i);}}
  Object.keys(frags).forEach(function(a){
    var ai=+a,row=out[outIdx[ai]],byCol={};
    frags[a].forEach(function(fi){(byCol[colOf[fi]]=byCol[colOf[fi]]||[]).push(fi);});
    Object.keys(byCol).forEach(function(cs){
      var c=+cs,parts=[];
      byCol[cs].forEach(function(fi){if(pre[fi])parts.push([g[fi].y,g[fi][c]]);});
      if(row[c]!=='')parts.push([g[ai].y,row[c]]);
      byCol[cs].forEach(function(fi){if(!pre[fi])parts.push([g[fi].y,g[fi][c]]);});
      parts.sort(function(p,q){return q[0]-p[0];});
      row[c]=parts.map(function(p){return p[1];}).join(' ');
    });
  });
  for(i=0;i<n;i++)map[i]=att[i]>=0?outIdx[att[i]]:outIdx[i];
  return {rows:out,map:map};
}

/* Lay out pages: tables found, columns by X, rows by Y. Returns rows plus the bookkeeping other steps need. */
function layoutPages(pages,o,single){
  var blocks=[],srcs=[],lineBase=[];
  pages.forEach(function(p,pi){
    srcs.push({n:p.n,lines:p.lines,rowMap:new Array(p.lines.length)});
    var at=0;
    segmentBlocks(p.lines).forEach(function(bl){blocks.push({pi:pi,at:at,lines:bl});at+=bl.length;});
  });
  if(o.mode==='lines'){ /* line by line: one column model for everything, no table splitting */
    var all=[];blocks.forEach(function(b){all.push.apply(all,b.lines);});
    var one={lines:all,model:detectCols([all])};
    blocks.forEach(function(b){b.table=one;});
  }else buildTables(blocks);
  var rows=[],rowPage=[],hdr=[],prev=null,seen=[];
  blocks.forEach(function(b){
    if(prev&&b.table!==prev&&rows.length){rows.push([]);rowPage.push(0);}
    prev=b.table;
    var hi=seen.indexOf(b.table)>=0?-1:pickHeader(b.lines);seen.push(b.table);
    var g=gridFrom(b.lines,b.table.model,hi),map;
    if(o.wrap&&o.mode==='table'){var j=joinWrapped(g,b.table.model);g=j.rows;map=j.map;}
    else map=g.map(function(_,i){return i;});
    var base=rows.length;
    g.forEach(function(r){rows.push(r);rowPage.push(pages[b.pi].n);});
    b.lines.forEach(function(_,i){srcs[b.pi].rowMap[b.at+i]=base+map[i];});
    if(hi>=0)hdr.push(base+map[hi]);
  });
  if(single&&o.pageCol){
    var hs={};hdr.forEach(function(r){hs[r]=1;});
    rows=rows.map(function(r,i){return r.length?[hs[i]?'Page':rowPage[i]].concat(r):r;});
  }
  return {rows:rows,hdr:hdr,srcs:srcs};
}

function trimEmptyCols(rows){
  if(!rows.length)return rows;
  var n=Math.max.apply(null,rows.map(function(r){return r.length;}));
  var keep=[];
  for(var c=0;c<n;c++){if(rows.some(function(r){return r[c]!==''&&r[c]!=null;}))keep.push(c);}
  return rows.map(function(r){return keep.map(function(c){return r[c]==null?'':r[c];});});
}
function uniqueName(base,used){
  var n=String(base).replace(/[\u0000-\u001F]/g,'').replace(/[\[\]:*?\/\\]/g,'-').replace(/^'+|'+$/g,'').trim()||'Sheet';
  n=n.slice(0,31).replace(/^'+|'+$/g,'').trim()||'Sheet';
  if(n.toLowerCase()==='history')n='History 1';
  var cand=n,k=2;
  while(used[cand.toLowerCase()]){var suf=' ('+k+')';cand=n.slice(0,31-suf.length)+suf;k++;}
  used[cand.toLowerCase()]=1;
  return cand;
}

/* ---------- 3. numbers, currency, percent, dates ----------
   A converted cell is either a plain number (no special format) or {v:number, z:excelFormat}. */
var CUR_NAMES={'rs':'Rs. ','rs.':'Rs. ','pkr':'PKR ','inr':'INR ','usd':'USD ','eur':'EUR ','gbp':'GBP ','aed':'AED ','sar':'SAR '};
var CUR_PREFIX_RE=/^(?:(rs\.?|pkr|inr|usd|eur|gbp|aed|sar)\s*|([$€£¥₹])\s*)/i;
var CUR_SUFFIX_RE=/\s+(rs\.?|pkr|inr|usd|eur|gbp|aed|sar)$/i;
function zeros(n){return n>0?new Array(n+1).join('0'):'';}
function parseNumber(str){
  var t=String(str).replace(/[   ]/g,' ').trim();
  if(!t||t.length>40)return null;
  var neg=false,pct=false,cur='',m;
  if(t.charAt(0)==='('&&t.charAt(t.length-1)===')'){neg=true;t=t.slice(1,-1).trim();}
  if(/^[-−]/.test(t)){if(neg)return null;neg=true;t=t.slice(1).trim();}
  m=CUR_PREFIX_RE.exec(t);
  if(m){cur=m[2]?'"'+m[2]+'"':'"'+CUR_NAMES[m[1].toLowerCase()]+'"';t=t.slice(m[0].length).trim();}
  if(/^[-−]/.test(t)){if(neg)return null;neg=true;t=t.slice(1).trim();}
  if(!cur){m=CUR_SUFFIX_RE.exec(t);if(m){cur='"'+CUR_NAMES[m[1].toLowerCase()]+'"';t=t.slice(0,t.length-m[0].length).trim();}}
  if(t.charAt(t.length-1)==='%'){if(cur)return null;pct=true;t=t.slice(0,-1).trim();}
  var v,dec=0,grouped=false;
  if(/^\d+$/.test(t)){
    if(t.length>1&&t.charAt(0)==='0')return null;
    if(t.length>=10&&!cur&&!pct)return null;
    if(t.length>15)return null;
    v=+t;
  }else if(/^\d+\.\d+$/.test(t)){
    var ip=t.split('.')[0];
    if(ip.length>1&&ip.charAt(0)==='0')return null;
    if(t.replace('.','').length>15)return null;
    v=parseFloat(t);dec=t.split('.')[1].length;
  }else if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)){
    v=parseFloat(t.replace(/,/g,''));grouped=true;dec=t.indexOf('.')>=0?t.split('.')[1].length:0;
  }else if(/^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(t)){
    v=parseFloat(t.replace(/,/g,''));grouped=true;dec=t.indexOf('.')>=0?t.split('.')[1].length:0;
  }else if(/^\d{1,3}(\.\d{3})+,\d+$/.test(t)){
    v=parseFloat(t.replace(/\./g,'').replace(',','.'));grouped=true;dec=t.split(',')[1].length;
  }else if(/^\d+,\d{1,2}$/.test(t)){
    v=parseFloat(t.replace(',','.'));dec=t.split(',')[1].length;
  }else return null;
  if(!isFinite(v))return null;
  if(pct){v=Number((v/100).toPrecision(12));}
  if(neg)v=-v;
  var z='';
  if(pct)z=dec?'0.'+zeros(dec)+'%':'0%';
  else if(grouped||cur)z=(cur?cur:'')+'#,##0'+(dec?'.'+zeros(dec):'');
  else if(dec)z='0.'+zeros(dec);
  return z?{v:v,z:z}:v;
}

var MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
var MONTH_FULL={january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12,sept:9};
function monthOf(name){
  var s=name.toLowerCase();
  if(s.length===3)return MONTHS[s]||0;
  return MONTH_FULL[s]||0;
}
function daysIn(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function serial(y,m,d){
  if(y<1900||y>2200||m<1||m>12||d<1||d>daysIn(y,m))return null;
  return Math.round(Date.UTC(y,m-1,d)/86400000)+25569;
}
function fullYear(s){var y=+s;if(s.length===2)y+=y<70?2000:1900;return y;}
var DATE_Z='dd-mmm-yyyy';
var NUMDATE_RE=/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}|\d{2})$/;
/* d/m/y or m/d/y? Decide per column: any value with a first part above 12 means day first, and so on. Default day first. */
function dateOrderFor(values){
  var dmy=false,mdy=false;
  values.forEach(function(v){
    var m=NUMDATE_RE.exec(String(v).trim());if(!m)return;
    if(+m[1]>12)dmy=true;
    if(+m[2]>12)mdy=true;
  });
  return mdy&&!dmy?'mdy':'dmy';
}
function parseDate(str,order){
  var t=String(str).trim(),m,y,mo,d,s;
  if(t.length<6||t.length>24)return null;
  if((m=/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/.exec(t))){s=serial(+m[1],+m[2],+m[3]);}
  else if((m=/^(\d{1,2})(?:st|nd|rd|th)?[-\s\/.]+([A-Za-z]{3,9})\.?[-\s\/.,]+(\d{4}|\d{2})$/.exec(t))){mo=monthOf(m[2]);if(!mo)return null;s=serial(fullYear(m[3]),mo,+m[1]);}
  else if((m=/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(t))){mo=monthOf(m[1]);if(!mo)return null;s=serial(+m[3],mo,+m[2]);}
  else if((m=NUMDATE_RE.exec(t))){
    y=fullYear(m[3]);
    if(order==='mdy'){mo=+m[1];d=+m[2];}else{d=+m[1];mo=+m[2];}
    s=serial(y,mo,d);
  }
  return s==null?null:{v:s,z:DATE_Z};
}

var TEXT_COL_RE=/\b(phone|mobile|tel|telephone|cell|cnic|nic|iban|barcode|sku|zip|postal|pin|code|ref|reference|serial|voucher|cheque|check|id)\b|\b(invoice|order|account|acct|po|bill|receipt)\s*(no|#|num|number|id)\b/i;

/* Turn text cells into numbers and dates. Header rows are left alone. IDs, phone numbers and codes stay text. */
function convertCells(rows,hdrRows,o){
  if(!o.nums&&!o.dates)return rows;
  var hs={};hdrRows.forEach(function(r){hs[r]=1;});
  var firstHdr=hdrRows.length?Math.min.apply(null,hdrRows):-1;
  var n=rows.reduce(function(m,r){return Math.max(m,r.length);},0);
  for(var c=0;c<n;c++){
    var head=firstHdr>=0&&typeof rows[firstHdr][c]==='string'?rows[firstHdr][c]:'';
    var textOnly=TEXT_COL_RE.test(head);
    var order='dmy';
    if(o.dates){
      var vals=[];
      for(var r0=0;r0<rows.length;r0++){if(!hs[r0]&&typeof rows[r0][c]==='string')vals.push(rows[r0][c]);}
      order=dateOrderFor(vals);
    }
    for(var r=0;r<rows.length;r++){
      if(hs[r])continue;
      var v=rows[r][c];
      if(typeof v!=='string'||v==='')continue;
      var cv=null;
      if(o.dates)cv=parseDate(v,order);
      if(!cv&&o.nums&&!textOnly)cv=parseNumber(v);
      if(cv!=null)rows[r][c]=cv;
    }
  }
  return rows;
}

/* Display text of any cell, the way Excel would show it. */
function groupInt(s){return s.replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function serialToParts(v){var d=new Date(Math.round((v-25569)*86400000));return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()};}
var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pad2(n){return n<10?'0'+n:''+n;}
function cellDisp(c){
  if(c==null||c==='')return '';
  if(typeof c==='number')return String(c);
  if(typeof c==='string')return c;
  var v=c.v,z=c.z||'';
  if(z===DATE_Z){var p=serialToParts(v);return pad2(p.d)+'-'+MON3[p.m-1]+'-'+p.y;}
  var m=/^(?:"([^"]*)")?(#,##0|0)(?:\.(0+))?(%?)$/.exec(z);
  if(!m)return String(v);
  var dec=m[3]?m[3].length:0,pct=m[4]==='%',x=pct?v*100:v;
  var s=Math.abs(x).toFixed(dec);
  if(m[2]==='#,##0'){var pp=s.split('.');s=groupInt(pp[0])+(pp[1]?'.'+pp[1]:'');}
  return (x<0?'-':'')+(m[1]||'')+s+(pct?'%':'');
}
function cellIsNumeric(c){return typeof c==='number'||(c!=null&&typeof c==='object');}
function cellLen(c){return cellDisp(c).length;}

/* ---------- 4. pictures ---------- */
function mulM(a,b){
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
          a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
function imageMatrices(fnArray,argsArray,OPS){
  var ctm=[1,0,0,1,0,0],stack=[],out=[],imgOps={};
  [OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintJpegXObject].forEach(function(k){if(k!=null)imgOps[k]=1;});
  for(var i=0;i<fnArray.length;i++){
    var fn=fnArray[i],a=argsArray[i];
    if(fn===OPS.save)stack.push(ctm.slice());
    else if(fn===OPS.restore){if(stack.length)ctm=stack.pop();}
    else if(fn===OPS.transform){if(a&&a.length>=6)ctm=mulM(ctm,a);}
    else if(fn===OPS.paintFormXObjectBegin){stack.push(ctm.slice());if(a&&a[0])ctm=mulM(ctm,a[0]);}
    else if(fn===OPS.paintFormXObjectEnd){if(stack.length)ctm=stack.pop();}
    else if(imgOps[fn])out.push(ctm.slice());
  }
  return out;
}
/* A picture is drawn into the unit square. Return its box on the canvas (pixels) and in page units (y up, like text). */
function boxFromCtm(m,toVp,sc,pageH){
  var cxs=[],cys=[];
  [[0,0],[1,0],[0,1],[1,1]].forEach(function(p){
    var v=toVp(m[0]*p[0]+m[2]*p[1]+m[4],m[1]*p[0]+m[3]*p[1]+m[5]);cxs.push(v[0]);cys.push(v[1]);
  });
  var mn=function(a){return Math.min.apply(null,a);},mx=function(a){return Math.max.apply(null,a);};
  var cx0=mn(cxs),cx1=mx(cxs),cy0=mn(cys),cy1=mx(cys);
  return {cx0:cx0,cy0:cy0,cx1:cx1,cy1:cy1,uw:(cx1-cx0)/sc,uh:(cy1-cy0)/sc,uy:pageH-((cy0+cy1)/2)/sc};
}
function keepBox(b,pageW,pageH){
  if(b.uw<8||b.uh<8)return false;
  if(b.uw*b.uh>=0.85*pageW*pageH)return false;
  return true;
}
function assignImages(lines,imgs){
  var res={};
  if(!lines.length||!imgs.length)return res;
  var ys=lines.map(function(l){return (l.y||0)+(l.h||0)*0.3;});
  var gaps=[];
  for(var i=1;i<ys.length;i++)gaps.push(Math.abs(ys[i-1]-ys[i]));
  var spacing=median(gaps);
  imgs.forEach(function(img){
    var best=-1,bd=Infinity;
    ys.forEach(function(y,i){var d=Math.abs(y-img.uy);if(d<bd){bd=d;best=i;}});
    var lim=Math.max(img.uh*0.6,spacing*0.75,6);
    if(best<0||bd>lim)return;
    var cur=res[best];
    if(!cur||img.w*img.h>cur.w*cur.h)res[best]=img;
  });
  return res;
}
function findImageCol(rows){
  for(var i=0;i<Math.min(6,rows.length);i++){
    for(var c=0;c<rows[i].length;c++){
      var v=rows[i][c];
      if(typeof v==='string'&&/^(images?|photos?|pictures?|pics?|imgs?)$/i.test(v.trim()))return c;
    }
  }
  return -1;
}
function looksHeader(r){
  var t=r.filter(function(v){return v!==''&&v!=null;});
  if(t.length<3)return false;
  return t.filter(function(v){return typeof v==='string'&&!isNumText(v);}).length/t.length>=0.6;
}
/* Decide which picture goes in which row of a sheet. imgsOf(src) returns the pictures found on that page. */
function planPictures(sheet,imgsOf){
  var byRow={};
  (sheet.srcs||[]).forEach(function(src){
    var imgs=imgsOf(src);
    if(!imgs||!imgs.length)return;
    var m=assignImages(src.lines,imgs);
    Object.keys(m).forEach(function(k){
      var row=src.rowMap[+k];
      if(row==null)return;
      var cur=byRow[row];
      if(!cur||m[k].w*m[k].h>cur.w*cur.h)byRow[row]=m[k];
    });
  });
  var items=Object.keys(byRow).map(function(r){return {row:+r,img:byRow[r]};});
  if(!items.length)return null;
  var rows=sheet.rows,col=findImageCol(rows),hdr=sheet.hdrRows||[];
  if(col<0){
    var first=hdr.length?Math.min.apply(null,hdr):-1;
    rows=rows.map(function(r,i){return r.length?[i===first||(first<0&&i===0&&looksHeader(r))?'Image':''].concat(r):r;});
    col=0;
  }
  return {rows:rows,col:col,items:items};
}
/* ===== ENGINE:END ===== */
/* ===== XLSX:BEGIN (own writer: no libraries, no network) ===== */
var XL_MAX_ROWS=1048576,XL_MAX_COLS=16384,XL_MAX_CELL=32767,XL_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var enc=new TextEncoder();

var CRC_T=(function(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(u8){var c=0xFFFFFFFF;for(var i=0;i<u8.length;i++)c=CRC_T[(c^u8[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}

async function deflateRaw(u8){
  if(typeof CompressionStream==='undefined')return null;
  try{
    var cs=new CompressionStream('deflate-raw');
    var w=cs.writable.getWriter();w.write(u8);w.close();
    var buf=await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
  }catch(e){return null;}
}
function u16(n){return [n&255,(n>>>8)&255];}
function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}

/* files: [{name, data:Uint8Array, store:boolean}] -> Blob (zip). Parts are kept as separate chunks, never one giant copy. */
async function zipFiles(files,mime){
  var parts=[],central=[],off=0;
  for(var i=0;i<files.length;i++){
    var f=files[i],raw=f.data,crc=crc32(raw),comp=null,method=0;
    if(!f.store&&raw.length>64){comp=await deflateRaw(raw);if(comp&&comp.length<raw.length)method=8;else comp=null;}
    var body=method===8?comp:raw,nm=enc.encode(f.name);
    var lh=new Uint8Array([].concat(u32(0x04034b50),u16(20),u16(0x0800),u16(method),u16(0),u16(0x21),u32(crc),u32(body.length),u32(raw.length),u16(nm.length),u16(0)));
    parts.push(lh,nm,body);
    central.push(new Uint8Array([].concat(u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(method),u16(0),u16(0x21),u32(crc),u32(body.length),u32(raw.length),u16(nm.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off))),nm);
    off+=lh.length+nm.length+body.length;
  }
  var cdSize=0;central.forEach(function(c){cdSize+=c.length;});
  var end=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cdSize),u32(off),u16(0)));
  return new Blob(parts.concat(central,[end]),{type:mime||'application/zip'});
}

/* ---- XML helpers ---- */
function xmlEsc(s){
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dataUrlToBytes(u){
  var i=u.indexOf(','),b=atob(u.slice(i+1)),a=new Uint8Array(b.length);
  for(var k=0;k<b.length;k++)a[k]=b.charCodeAt(k);
  return a;
}

/* Style table: 0 plain, 1 header, 2 long text (wrap), then one per number format. */
function makeStyles(){
  var fmts=[],fmtId={};
  function xfFor(z){
    if(!(z in fmtId)){fmtId[z]=fmts.length;fmts.push(z);}
    return 3+fmtId[z];
  }
  function xml(){
    var nf=fmts.map(function(z,i){return '<numFmt numFmtId="'+(164+i)+'" formatCode="'+xmlEsc(z)+'"/>';}).join('');
    var xfs='<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'+
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'+
      fmts.map(function(z,i){return '<xf numFmtId="'+(164+i)+'" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>';}).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      (fmts.length?'<numFmts count="'+fmts.length+'">'+nf+'</numFmts>':'')+
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'+
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill></fills>'+
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'+
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
      '<cellXfs count="'+(3+fmts.length)+'">'+xfs+'</cellXfs>'+
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
  return {xfFor:xfFor,xml:xml};
}

function cellRef(c,r){return colLetter(c)+(r+1);}

/* One sheet to XML. sheet: {name, rows, hdrRows, pic?:{col,items:[{row,img}]} } */
function sheetXml(sh,styles,warn,pic){
  var rows=sh.rows,hs={},i,c;
  (sh.hdrRows||[]).forEach(function(r){hs[r]=1;});
  var nRows=Math.min(rows.length,XL_MAX_ROWS);
  if(rows.length>XL_MAX_ROWS)warn.push('Sheet "'+sh.name+'" has more than 1,048,576 rows. Extra rows were left out.');
  var nCols=0;
  for(i=0;i<nRows;i++)if(rows[i].length>nCols)nCols=rows[i].length;
  if(nCols>XL_MAX_COLS){warn.push('Sheet "'+sh.name+'" has more than 16,384 columns. Extra columns were left out.');nCols=XL_MAX_COLS;}
  var widths=new Array(nCols).fill(8);
  var rowHt={};
  if(pic){
    pic.items.forEach(function(it){
      var k=Math.min(1,400/it.img.h),hpt=it.img.h*k,wpx=it.img.w*k*96/72;
      rowHt[it.row]=Math.max(rowHt[it.row]||0,Math.min(409,hpt+8));
      if(pic.col<nCols)widths[pic.col]=Math.max(widths[pic.col],Math.min(255,(wpx+12)/7));
    });
  }
  var out=[];
  for(i=0;i<nRows;i++){
    var r=rows[i],cells=[],isH=!!hs[i],len=Math.min(r.length,nCols);
    for(c=0;c<len;c++){
      var v=r[c];
      if(v===''||v==null)continue;
      var ref=cellRef(c,i),L;
      if(typeof v==='number'){
        if(!isFinite(v))continue;
        cells.push('<c r="'+ref+'"><v>'+v+'</v></c>');L=String(v).length;
      }else if(typeof v==='object'){
        if(!isFinite(v.v))continue;
        cells.push('<c r="'+ref+'" s="'+styles.xfFor(v.z)+'"><v>'+v.v+'</v></c>');L=cellLen(v);
      }else{
        var s=String(v);
        if(s.length>XL_MAX_CELL){s=s.slice(0,XL_MAX_CELL);if(!warn.some(function(w){return w.indexOf('32,767')>=0;}))warn.push('Some cells were longer than 32,767 characters and were cut.');}
        var st=isH?1:(s.length>60?2:0);
        cells.push('<c r="'+ref+'"'+(st?' s="'+st+'"':'')+' t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(s)+'</t></is></c>');
        L=s.length;
      }
      var w=Math.min(60,L+2);
      if(w>widths[c])widths[c]=w;
    }
    var attrs=' r="'+(i+1)+'"';
    if(rowHt[i])attrs+=' ht="'+rowHt[i].toFixed(1)+'" customHeight="1"';
    if(cells.length||rowHt[i])out.push('<row'+attrs+'>'+cells.join('')+'</row>');
  }
  var firstHdr=(sh.hdrRows&&sh.hdrRows.length)?Math.min.apply(null,sh.hdrRows):-1;
  var view='<sheetViews><sheetView workbookViewId="0"'+(sh.tabSelected?' tabSelected="1"':'')+'>';
  if(firstHdr>=0&&firstHdr<20)view+='<pane ySplit="'+(firstHdr+1)+'" topLeftCell="A'+(firstHdr+2)+'" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A'+(firstHdr+2)+'" sqref="A'+(firstHdr+2)+'"/>';
  view+='</sheetView></sheetViews>';
  var cols='';
  if(nCols){cols='<cols>'+widths.map(function(w,k){return '<col min="'+(k+1)+'" max="'+(k+1)+'" width="'+w.toFixed(1)+'" customWidth="1"/>';}).join('')+'</cols>';}
  var dim=nRows&&nCols?'<dimension ref="A1:'+cellRef(nCols-1,nRows-1)+'"/>':'<dimension ref="A1"/>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    dim+view+'<sheetFormatPr defaultRowHeight="15"/>'+cols+'<sheetData>'+out.join('')+'</sheetData>'+(pic?'<drawing r:id="rId1"/>':'')+'</worksheet>';
}

function drawingXml(pic,nImgStart){
  var EMU=9525,parts=[];
  pic.items.forEach(function(it,k){
    var kk=Math.min(1,400/it.img.h),wpx=it.img.w*kk*96/72,hpx=it.img.h*kk*96/72;
    var rowPt=Math.min(409,it.img.h*kk+8),yOff=Math.round(4*12700);
    parts.push('<xdr:oneCellAnchor><xdr:from><xdr:col>'+pic.col+'</xdr:col><xdr:colOff>'+Math.round(0.04*7*EMU)+'</xdr:colOff><xdr:row>'+it.row+'</xdr:row><xdr:rowOff>'+yOff+'</xdr:rowOff></xdr:from>'+
      '<xdr:ext cx="'+Math.round(wpx*EMU)+'" cy="'+Math.round(hpx*EMU)+'"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+(k+2)+'" name="Picture '+(k+1)+'"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>'+
      '<xdr:blipFill><a:blip r:embed="rId'+(k+1)+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+Math.round(wpx*EMU)+'" cy="'+Math.round(hpx*EMU)+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>');
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+parts.join('')+'</xdr:wsDr>';
}

/* sheets: [{name,rows,hdrRows,pic}]; opts.yield: async fn called between sheets; opts.isCancelled. Returns {blob,warnings}. */
async function buildXlsx(sheets,opts){
  opts=opts||{};
  var warn=[],styles=makeStyles(),files=[],ct=[],wbSheets=[],wbRels=[],media=0,drawN=0;
  var REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  if(!sheets.length)throw new Error('no sheets');
  for(var i=0;i<sheets.length;i++){
    var sh=sheets[i],n=i+1,pic=sh.pic&&sh.pic.items&&sh.pic.items.length?sh.pic:null;
    sh.tabSelected=(i===0);
    files.push({name:'xl/worksheets/sheet'+n+'.xml',data:enc.encode(sheetXml(sh,styles,warn,pic))});
    ct.push('<Override PartName="/xl/worksheets/sheet'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    if(pic){
      drawN++;
      files.push({name:'xl/worksheets/_rels/sheet'+n+'.xml.rels',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+REL+'/drawing" Target="../drawings/drawing'+drawN+'.xml"/></Relationships>')});
      files.push({name:'xl/drawings/drawing'+drawN+'.xml',data:enc.encode(drawingXml(pic))});
      var rels=[];
      pic.items.forEach(function(it,k){
        media++;
        files.push({name:'xl/media/image'+media+'.jpeg',data:dataUrlToBytes(it.img.dataUrl),store:true});
        rels.push('<Relationship Id="rId'+(k+1)+'" Type="'+REL+'/image" Target="../media/image'+media+'.jpeg"/>');
      });
      files.push({name:'xl/drawings/_rels/drawing'+drawN+'.xml.rels',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>')});
      ct.push('<Override PartName="/xl/drawings/drawing'+drawN+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
    }
    wbSheets.push('<sheet name="'+xmlEsc(sh.name)+'" sheetId="'+n+'" r:id="rId'+n+'"/>');
    wbRels.push('<Relationship Id="rId'+n+'" Type="'+REL+'/worksheet" Target="worksheets/sheet'+n+'.xml"/>');
    if(opts.yield)await opts.yield();
    if(opts.isCancelled&&opts.isCancelled())throw {cancelled:true};
  }
  var ns=sheets.length;
  wbRels.push('<Relationship Id="rId'+(ns+1)+'" Type="'+REL+'/styles" Target="styles.xml"/>');
  files.unshift(
    {name:'[Content_Types].xml',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+ct.join('')+'</Types>')},
    {name:'_rels/.rels',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+REL+'/officeDocument" Target="xl/workbook.xml"/></Relationships>')},
    {name:'xl/workbook.xml',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+REL+'"><bookViews><workbookView activeTab="0"/></bookViews><sheets>'+wbSheets.join('')+'</sheets></workbook>')},
    {name:'xl/_rels/workbook.xml.rels',data:enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+wbRels.join('')+'</Relationships>')},
    {name:'xl/styles.xml',data:enc.encode(styles.xml())}
  );
  var blob=await zipFiles(files,XL_MIME);
  return {blob:blob,warnings:warn};
}

/* ---- CSV: formula-injection guard, quotes, BOM ---- */
function csvField(v){
  var s;
  if(v==null||v==='')return '';
  if(typeof v==='number')s=isFinite(v)?String(v):'';
  else if(typeof v==='object'){
    s=(v.z===DATE_Z||/%$/.test(v.z))?cellDisp(v):String(v.v);
  }else{
    s=String(v);
    if(/^[=+\-@\t\r]/.test(s)&&!parseNumber(s))s="'"+s;
  }
  if(/[",\r\n]/.test(s))s='"'+s.replace(/"/g,'""')+'"';
  return s;
}
function toCsv(rows){
  var out=[];
  for(var i=0;i<rows.length;i++)out.push(rows[i].map(csvField).join(','));
  return '﻿'+out.join('\r\n');
}
/* ===== XLSX:END ===== */
/* ===== APP:BEGIN ===== */
var APP_VERSION='2.0';
var PDFJS_VER='3.11.174';
var PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_VER+'/pdf.min.js';
var PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_VER+'/pdf.worker.min.js';
var MAX_FILE=250*1024*1024,MAX_ITEMS=2000000,PREVIEW_ROWS=300;
var CANCEL={cancelled:true};

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

var EXAMPLE=[{name:'Statement of account',hdrRows:[0],rows:[
  ['Date','Description','Ref no.','Debit (PKR)','Credit (PKR)','Balance (PKR)'],
  ['01-Oct-2026','Opening balance','','','',250000],
  ['02-Oct-2026','Raast transfer, Rehman Traders','RT-48213',45000,'',205000],
  ['03-Oct-2026','Salary credit','SAL-1003','',180000,385000],
  ['05-Oct-2026','K-Electric bill payment','UB-77120',12460,'',372540],
  ['06-Oct-2026','ATM withdrawal, Clifton','ATM-5521',20000,'',352540],
  ['07-Oct-2026','Easypaisa top-up','EP-90311',5000,'',347540]]}];

var S={files:[],nextId:1,active:0,sheets:[],job:null,busy:false,summary:null,refreshTok:0,
  opts:{mode:'table',layout:'perPage',sens:'normal',nums:true,dates:true,wrap:true,pageCol:false,pics:false}};

/* ---------- small helpers ---------- */
function fmtSize(b){return b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';}
function fmtInt(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');}
function fmtTime(sec){
  sec=Math.max(0,Math.round(sec));
  if(sec<60)return sec+' s';
  var m=Math.floor(sec/60),s=sec%60;
  return m+' min'+(s?' '+s+' s':'');
}
var toastT;
function toast(msg){var t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(function(){t.classList.remove('show');},4200);}
function logErr(where,e){if(window.console&&console.error)console.error('[PDF to Excel] '+where+':',e);}
function safeFileName(n,ext){
  n=String(n).replace(/[\u0000-\u001F\\\/:*?"<>|]/g,'-').replace(/^[\s.]+|[\s.]+$/g,'').slice(0,100)||'converted';
  return n+ext;
}

/* Give the browser a turn (paint, clicks, Cancel). MessageChannel is not slowed down in background tabs. */
var mc=new MessageChannel(),waiters=[];
mc.port1.onmessage=function(){var w=waiters.shift();if(w)w();};
function tick(){return new Promise(function(r){waiters.push(r);mc.port2.postMessage(0);});}

/* ---------- pdf.js: loaded only when the first PDF is added ---------- */
var pdfjsP=null;
function loadPdfjs(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(pdfjsP)return pdfjsP;
  pdfjsP=new Promise(function(ok,fail){
    var s=document.createElement('script');
    s.src=PDFJS_URL;s.async=true;
    s.onload=function(){
      if(window.pdfjsLib){try{pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;}catch(e){}ok(window.pdfjsLib);}
      else{pdfjsP=null;fail(new Error('pdf.js missing after load'));}
    };
    s.onerror=function(){s.remove();pdfjsP=null;fail(new Error('pdf.js failed to load'));};
    document.head.appendChild(s);
  });
  return pdfjsP;
}

/* ---------- jobs: progress, ETA, cancel ---------- */
function newJob(kind){
  return {kind:kind,cancelled:false,t0:Date.now(),doneBytes:0,rows:0,pages:0,cur:null,phase:'read',phaseFrac:0,text:''};
}
function jobFraction(job){
  var files=S.files.filter(function(f){return f.inJob||f.status==='queued'||f.status==='reading';});
  var total=files.reduce(function(a,f){return a+Math.max(1,f.size);},0)||1;
  var frac=job.doneBytes;
  if(job.cur&&job.cur.total)frac+=Math.max(1,job.cur.f.size)*(job.cur.n/job.cur.total);
  frac=Math.min(1,frac/total);
  if(job.kind==='read')return job.phase==='read'?frac*0.92:0.92+0.08*job.phaseFrac;
  return job.phaseFrac;
}
var jobDirty=false;
function jobTouch(){
  if(jobDirty)return;
  jobDirty=true;
  var run=function(){jobDirty=false;renderJob();};
  if(document.hidden)setTimeout(run,250);else requestAnimationFrame(run);
}
function renderJob(){
  var job=S.job,box=$('#job');
  if(!job){box.hidden=true;return;}
  box.hidden=false;
  var frac=jobFraction(job),pct=Math.round(frac*100);
  var text=job.text;
  if(job.kind==='read'&&job.phase==='read'&&job.cur){
    var fi=S.files.filter(function(f){return f.inJob;}).length,fc=fi+S.files.filter(function(f){return f.status==='queued';}).length;
    text=(fc>1?'File '+fi+' of '+fc+' · ':'')+'Processing page '+job.cur.n+' of '+job.cur.total;
  }else if(job.kind==='read'&&job.phase==='layout')text='Building rows…';
  $('#jobText').textContent=text||'Working…';
  var bar=$('#jobBar');bar.style.width=pct+'%';
  var pb=$('#jobProg');pb.setAttribute('aria-valuenow',String(pct));
  var parts=[pct+'%'];
  if(job.kind==='read')parts.push(fmtInt(job.rows)+' rows');
  var el_=(Date.now()-job.t0)/1000;
  if(el_>1.5&&frac>0.05&&frac<0.995)parts.push('about '+fmtTime(el_/frac-el_)+' left');
  $('#jobStats').textContent=parts.join(' · ');
  var f=job.cur&&job.cur.f;if(f)updateFileRow(f);
}
function showJob(job){S.job=job;setBusy(true);renderJob();}
function endJob(){S.job=null;$('#job').hidden=true;setBusy(false);}

function setBusy(on){
  S.busy=on;
  $('#optsFs').disabled=on;
  $('#dlXlsx').disabled=on||!S.sheets.length;
  $('#dlCsv').disabled=on||!S.sheets.length;
}

/* ---------- reading a PDF, page by page ---------- */
function errText(e,f){
  var nm=e&&e.name,msg=String(e&&e.message||'');
  if(nm==='PasswordException')return null;
  if(nm==='InvalidPDFException'||nm==='FormatError'||/invalid pdf|xref|bad end|stream/i.test(msg))return 'This PDF looks damaged and could not be opened.';
  if(nm==='MissingPDFException')return 'This file could not be found. Add it again.';
  if(e instanceof RangeError||/memory|allocation|array buffer/i.test(msg))return 'Your device ran out of memory while reading this file. Try a smaller PDF, or close other tabs.';
  return 'Could not read this file. It may be damaged or use an unsupported feature.';
}
async function readFile(f,job){
  f.status='reading';f.inJob=true;f.progress=0;f.error='';f.warn='';f.pages=0;f.items=[];f.lc={};f.cache=null;f.retry=false;f.pdfPassword=false;
  jobTouch();
  if(!f.size){f.status='error';f.error='This file is empty (0 bytes).';return;}
  if(f.size>MAX_FILE){f.status='error';f.error='This file is very large ('+fmtSize(f.size)+'). The limit in the browser is '+fmtSize(MAX_FILE)+'. Split the PDF into smaller parts.';return;}
  try{
    var head=new Uint8Array(await f.file.slice(0,1024).arrayBuffer()),hs='';
    for(var k=0;k<head.length;k++)hs+=String.fromCharCode(head[k]);
    if(hs.indexOf('%PDF-')<0){f.status='error';f.error='This is not a PDF file (or it is damaged).';return;}
  }catch(e){logErr('read header',e);f.status='error';f.error='Could not read this file from your device.';return;}
  var lib;
  try{lib=await loadPdfjs();}
  catch(e){logErr('load pdf.js',e);f.status='error';f.retry=true;f.error='The PDF reader could not be loaded. Check your internet connection, then press Try again.';return;}
  if(job.cancelled)throw CANCEL;
  var task=null,pdf=null,buf=null,total=0,empty=0;
  try{
    buf=new Uint8Array(await f.file.arrayBuffer());
    task=lib.getDocument({data:buf,password:f.password||undefined,isEvalSupported:false,enableXfa:false});
    pdf=await task.promise;
    buf=null;
    f.pages=pdf.numPages;
    job.cur={f:f,n:0,total:pdf.numPages};
    for(var n=1;n<=pdf.numPages;n++){
      if(job.cancelled)throw CANCEL;
      var page=await pdf.getPage(n);
      var tc=await page.getTextContent();
      var items=pageItems(page,tc,lib);
      page.cleanup();
      total+=items.length;
      if(total>MAX_ITEMS){f.status='error';f.error='This PDF has too much text to convert in the browser ('+fmtInt(MAX_ITEMS)+' items limit). Split it into smaller parts.';f.items=[];throw {stop:true};}
      if(!items.length)empty++;
      f.items.push(items);
      var ln=toLines(items,S.opts.sens);f.lc[S.opts.sens]=f.lc[S.opts.sens]||[];f.lc[S.opts.sens][n-1]=ln;
      job.rows+=ln.length;
      f.progress=n/pdf.numPages;job.cur.n=n;
      jobTouch();
      await tick();
    }
    if(!total&&typeof window.PDF2XLSX_OCR==='function'){
      await ocrPages(f,pdf,job);
      f.lc={};
      total=f.items.reduce(function(a,p){return a+p.length;},0);
      empty=f.items.filter(function(p){return !p.length;}).length;
    }
    if(!total){f.status='notext';f.items=[];}
    else{
      f.status='done';
      if(empty)f.warn=empty+' of '+f.pages+' pages have no selectable text (maybe scanned) and were skipped.';
    }
  }catch(err){
    if(err===CANCEL)throw err;
    if(err&&err.stop)return;
    if(err&&err.name==='PasswordException'){f.status='password';f.pdfPassword=true;f.error=err.code===2?'That password is not correct.':'This PDF is password protected.';}
    else{logErr('read '+f.name,err);f.status='error';f.error=errText(err,f);}
    f.items=[];
  }finally{
    try{if(pdf)await pdf.destroy();}catch(e){}
    try{if(task)await task.destroy();}catch(e){}
  }
}

/* pdf.js text items -> {s,x,y,w,h}. Rotated pages are mapped through the viewport so lines stay horizontal. */
function pageItems(page,tc,lib){
  var out=[],rot=(page.rotate||0)%360,vp=null;
  if(rot!==0){try{vp=page.getViewport({scale:1});}catch(e){vp=null;}}
  tc.items.forEach(function(i){
    if(typeof i.str!=='string'||i.str.trim()==='')return;
    if(vp&&lib&&lib.Util){
      var m=lib.Util.transform(vp.transform,i.transform);
      out.push({s:i.str,x:m[4],y:vp.height-m[5],w:i.width,h:Math.hypot(m[2],m[3])||10});
    }else{
      out.push({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width,h:Math.abs(i.height)||Math.abs(i.transform[3])||10});
    }
  });
  return out;
}

/* Optional OCR: a page can define window.PDF2XLSX_OCR(canvas,{page,scale}) -> Promise<[{s,x,y,w,h}]>
   with x,y,w,h in canvas pixels, y measured from the top edge (baseline of the text box). Nothing is bundled. */
async function ocrPages(f,pdf,job){
  var sc=2;
  f.items=[];
  for(var n=1;n<=pdf.numPages;n++){
    if(job.cancelled)throw CANCEL;
    var page=await pdf.getPage(n),vp=page.getViewport({scale:sc});
    var cv=document.createElement('canvas');cv.width=Math.ceil(vp.width);cv.height=Math.ceil(vp.height);
    var ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);
    try{
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      var res=await window.PDF2XLSX_OCR(cv,{page:n,scale:sc});
      var list=(res||[]).filter(function(r){return r&&typeof r.s==='string'&&r.s.trim();}).map(function(r){
        return {s:r.s,x:r.x/sc,y:(cv.height-r.y)/sc,w:r.w/sc,h:Math.max(1,r.h/sc)};});
      f.items.push(list);
    }finally{cv.width=cv.height=1;page.cleanup();}
    job.cur={f:f,n:n,total:pdf.numPages};jobTouch();await tick();
  }
}

/* ---------- queue ---------- */
async function runQueue(){
  if(S.job)return;
  var job=newJob('read');showJob(job);
  var finished=false;
  try{
    var next;
    while((next=S.files.find(function(f){return f.status==='queued';}))){
      if(job.cancelled)throw CANCEL;
      job.cur=null;
      await readFile(next,job);
      job.doneBytes+=Math.max(1,next.size);
      job.cur=null;
      render();
    }
    job.phase='layout';job.phaseFrac=0;jobTouch();
    S.sheets=await computeSheets(job,true);
    finished=true;
  }catch(e){
    if(e===CANCEL){
      S.files=S.files.filter(function(f){return f.status==='done';});
      S.active=0;
      toast('Conversion cancelled.');
    }else if(e&&e.stop){
      /* message already stored on the file */
    }else{logErr('conversion',e);toast('Something went wrong while converting. Details are in the browser console.');}
  }
  var done=S.files.filter(function(f){return f.status==='done';});
  if(finished&&done.length){
    var rows=0;S.sheets.forEach(function(s){s.rows.forEach(function(r){if(r.some(function(v){return v!==''&&v!=null;}))rows++;});});
    S.summary={files:done.length,pages:done.reduce(function(a,f){return a+f.pages;},0),rows:rows,secs:(Date.now()-job.t0)/1000};
  }else if(!done.length)S.summary=null;
  S.files.forEach(function(f){f.inJob=false;});
  endJob();
  if(!finished){try{S.sheets=await computeSheets(null,false);}catch(e){logErr('layout',e);}}
  render();
}

function addFiles(list){
  var added=0,skipped=0;
  Array.prototype.forEach.call(list,function(file){
    var isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
    if(!isPdf){skipped++;return;}
    var dup=S.files.some(function(f){return f.name===file.name&&f.size===file.size&&f.lm===file.lastModified;});
    if(dup)return;
    S.files.push({id:S.nextId++,file:file,name:file.name,size:file.size,lm:file.lastModified,status:'queued',progress:0,pages:0,items:[],lc:{},cache:null,error:'',warn:'',password:'',inJob:false});
    added++;
  });
  if(skipped)toast('Only PDF files can be added. '+skipped+(skipped===1?' file was':' files were')+' skipped.');
  if(added){S.active=0;S.summary=null;render();if(!S.job)runQueue();else renderJob();}
}

/* ---------- rows: layout per file, cached by options ---------- */
function sig(o){return [o.mode,o.layout,o.sens,o.nums,o.dates,o.wrap,o.pageCol].join('|');}
function linesFor(f,i,sens){
  var c=f.lc[sens]||(f.lc[sens]=[]);
  return c[i]||(c[i]=toLines(f.items[i],sens));
}
async function layoutFile(f,o,job,base){
  var oo={mode:o.mode,wrap:o.wrap&&o.mode==='table',pageCol:o.pageCol},out=[],pages=[],i;
  for(i=0;i<f.items.length;i++){pages.push({n:i+1,lines:linesFor(f,i,o.sens)});}
  function finishSheet(lay,want){
    if(!lay.rows.length)return;
    var rows=trimEmptyCols(lay.rows);
    convertCells(rows,lay.hdr,o);
    out.push({want:want,rows:rows,hdrRows:lay.hdr,srcs:lay.srcs,file:f});
  }
  if(o.layout==='single'){
    var pl=o.mode==='table'?dropRepeats(pages):pages;
    finishSheet(layoutPages(pl,oo,true),base);
    await tick();
  }else{
    for(i=0;i<pages.length;i++){
      if(job&&job.cancelled)throw CANCEL;
      var p=pages[i];
      if(!p.lines.length)continue;
      finishSheet(layoutPages([p],oo,false),pages.length===1?base:base.slice(0,24)+' p'+p.n);
      if(i%4===3)await tick();
    }
  }
  return out;
}
async function computeSheets(job,report){
  var o=Object.assign({},S.opts),s=sig(o),done=S.files.filter(function(f){return f.status==='done';}),all=[];
  for(var i=0;i<done.length;i++){
    var f=done[i];
    if(job&&job.cancelled)throw CANCEL;
    if(!f.cache||f.cache.sig!==s){f.cache={sig:s,sheets:await layoutFile(f,o,job,baseName(f.name))};}
    f.cache.sheets.forEach(function(sh){all.push(sh);});
    if(job&&report){job.phaseFrac=(i+1)/done.length;jobTouch();}
    await tick();
  }
  var used={};
  return all.map(function(sh){
    return {name:uniqueName(sh.want,used),rows:sh.rows,hdrRows:sh.hdrRows,srcs:sh.srcs,file:sh.file};
  });
}
/* Option changed: lay out again (cheap, no re-reading). Newer calls cancel older ones. */
async function refresh(){
  var tok=++S.refreshTok;
  if(S.job)return;
  S.summary=null;
  var res=null;
  try{
    res=await computeSheets(null,false);
  }catch(e){logErr('layout',e);toast('Could not rebuild the table with these settings.');}
  if(tok!==S.refreshTok||!res)return;
  S.sheets=res;
  render();
}

/* ---------- rendering ---------- */
function fileSub(f){
  if(f.status==='queued')return 'Waiting';
  if(f.status==='reading'){return f.pages?('Reading page '+Math.max(1,Math.round(f.progress*f.pages))+' of '+f.pages):'Opening…';}
  if(f.status==='done')return f.pages+(f.pages===1?' page':' pages')+' · '+fmtSize(f.size)+(f.warn?' · '+f.warn:'');
  if(f.status==='notext')return 'No selectable text. This looks like a scanned PDF (a picture of paper). OCR is not included, so it cannot be converted. Run it through an OCR tool first (for example "Recognize Text" in Acrobat) and add the result.';
  return f.error||'Something went wrong.';
}
function svgIcon(path,size){
  var s=document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('width',size);s.setAttribute('height',size);s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');
  s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2.2');s.setAttribute('stroke-linecap','round');s.setAttribute('aria-hidden','true');
  var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',path);s.append(p);return s;
}
function fileRow(f){
  var cls='file'+(f.status==='done'?' done':'')+((f.status==='error'||f.status==='password')?' error':'')+(f.status==='notext'?' warn':'');
  var li=el('li',{class:cls,'data-id':f.id});
  li.append(el('div',{class:'tag',text:f.status==='done'?'OK':'PDF','aria-hidden':'true'}));
  var meta=el('div',{class:'meta'},el('div',{class:'name',text:f.name,title:f.name}),el('div',{class:'sub',text:fileSub(f)}));
  if(f.status==='reading'||f.status==='queued')meta.append(el('div',{class:'bar'},el('i',{style:'width:'+Math.round(f.progress*100)+'%'})));
  li.append(meta);
  li.append(el('button',{class:'icon-btn',type:'button','aria-label':'Remove '+f.name,onclick:function(){removeFile(f.id);}},svgIcon('M6 6l12 12M18 6 6 18',16)));
  if(f.status==='password'){
    var inp=el('input',{type:'password',id:'pw-'+f.id,placeholder:'PDF password','aria-label':'Password for '+f.name,autocomplete:'off'});
    var go=function(){f.password=inp.value;f.status='queued';render();if(!S.job)runQueue();};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')go();});
    li.append(el('div',{class:'pw'},inp,el('button',{class:'btn',type:'button',text:'Unlock',onclick:go})));
  }
  if(f.status==='error'&&f.retry){
    li.append(el('div',{class:'pw'},el('button',{class:'btn',type:'button',text:'Try again',onclick:function(){f.status='queued';render();if(!S.job)runQueue();}})));
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
  var f=S.files.find(function(x){return x.id===id;});
  if(f&&f.status==='reading'&&S.job){S.job.cancelled=true;return;}
  S.files=S.files.filter(function(x){return x.id!==id;});
  S.active=0;S.summary=null;
  if(!S.job)refresh();else render();
}
function renderFiles(){
  var ul=$('#fileList');ul.textContent='';
  S.files.forEach(function(f){ul.append(fileRow(f));});
}
function renderSummary(){
  var box=$('#summary'),s=S.summary;
  if(!s||S.job){box.hidden=true;return;}
  box.hidden=false;
  $('#sumFiles').textContent=fmtInt(s.files);
  $('#sumPages').textContent=fmtInt(s.pages);
  $('#sumRows').textContent=fmtInt(s.rows);
  $('#sumTime').textContent=s.secs<1?'under 1 s':fmtTime(s.secs);
  var note=$('#sumNote');
  note.textContent=S.sheets.length>200?'This workbook has '+S.sheets.length+' sheets. Excel opens it faster with "One sheet" layout.':'';
}
function render(){renderFiles();renderPreview();renderSummary();renderJob();}

function renderPreview(){
  var live=S.sheets.length>0;
  var sheets=live?S.sheets:(S.files.length?[]:EXAMPLE);
  if(S.active>=sheets.length)S.active=0;
  var sh=sheets[S.active];
  var wrap=$('#gridwrap'),more=$('#more'),tabs=$('#tabs');
  wrap.textContent='';more.textContent='';tabs.textContent='';
  $('#dlXlsx').disabled=!live||S.busy;$('#dlCsv').disabled=!live||S.busy;
  var chip=$('#chip');
  chip.textContent=live?'Your data':(S.files.length?'Working':'Example');
  chip.className='chip'+(live?' live':'');
  $('#pageColWrap').classList.toggle('off',S.opts.layout!=='single');
  $('#pageCol').disabled=S.opts.layout!=='single'||S.busy;
  $('#wrapWrap').classList.toggle('off',S.opts.mode!=='table');
  $('#wrap').disabled=S.opts.mode!=='table'||S.busy;

  if(!sh){
    var busy=S.files.some(function(f){return f.status==='queued'||f.status==='reading';});
    $('#sheetTitle').textContent=busy?'Reading your PDF…':'Nothing to show yet';
    $('#stats').textContent='';
    wrap.append(el('div',{class:'empty'},el('div',null,el('strong',{text:busy?'Extracting text':'No table data found'}),
      busy?'You can follow the progress on the left.':'Check the file list for details, or try Line by line extraction.')));
    return;
  }
  $('#sheetTitle').textContent=live?sh.name:sh.name+' (sample)';
  var nrows=sh.rows.length,ncols=sh.rows.reduce(function(m,r){return Math.max(m,r.length);},0);
  var st=$('#stats');st.textContent='';
  st.append(el('span',null,el('b',{text:fmtInt(nrows)}),' rows'),el('span',null,el('b',{text:String(ncols)}),' columns'),el('span',null,el('b',{text:fmtInt(sheets.length)}),sheets.length===1?' sheet':' sheets'));
  var hs={};(sh.hdrRows||[]).forEach(function(r){hs[r]=1;});
  var table=el('table',{class:'xl'});
  var hr=el('tr',null,el('th',{text:''}));
  for(var c=0;c<ncols;c++)hr.append(el('th',{text:colLetter(c)}));
  table.append(el('thead',null,hr));
  var tb=el('tbody'),frag=document.createDocumentFragment();
  sh.rows.slice(0,PREVIEW_ROWS).forEach(function(r,i){
    var tr=el('tr',{class:hs[i]?'hdr':''},el('th',{scope:'row',text:String(i+1)}));
    for(var c=0;c<ncols;c++){
      var v=r[c],d=cellDisp(v);
      tr.append(el('td',{class:cellIsNumeric(v)?'num':'',text:d,title:d.length>40?d:null}));
    }
    frag.append(tr);
  });
  tb.append(frag);table.append(tb);wrap.append(table);
  if(nrows>PREVIEW_ROWS)more.append(el('div',{class:'more',text:'Showing the first '+PREVIEW_ROWS+' of '+fmtInt(nrows)+' rows. The download contains every row.'}));
  sheets.forEach(function(s,i){
    tabs.append(el('button',{class:'tab',role:'tab',type:'button','aria-selected':i===S.active?'true':'false',title:s.name,text:s.name,onclick:function(){S.active=i;renderPreview();}}));
  });
}

/* ---------- pictures (optional) ---------- */
async function extractImages(f,job,label){
  var lib=await loadPdfjs();
  var buf=new Uint8Array(await f.file.arrayBuffer());
  var task=lib.getDocument({data:buf,password:f.password||undefined,isEvalSupported:false,enableXfa:false});
  var pdf=await task.promise,OPS=lib.OPS,res={};
  buf=null;
  try{
    for(var n=1;n<=pdf.numPages;n++){
      if(job.cancelled)throw CANCEL;
      job.text=label+' · picture scan, page '+n+' of '+pdf.numPages;job.phaseFrac=Math.min(0.9,(n/pdf.numPages)*0.9);jobTouch();
      var page=await pdf.getPage(n);
      var ol=await page.getOperatorList();
      var mats=imageMatrices(ol.fnArray,ol.argsArray,OPS);
      if(mats.length){
        var v1=page.getViewport({scale:1});
        var sc=Math.min(2,3200/Math.max(v1.width,v1.height));
        var vp=page.getViewport({scale:sc});
        var cv=document.createElement('canvas');
        cv.width=Math.max(1,Math.ceil(vp.width));cv.height=Math.max(1,Math.ceil(vp.height));
        var ctx=cv.getContext('2d');
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cv.width,cv.height);
        await page.render({canvasContext:ctx,viewport:vp}).promise;
        var list=[],seen={};
        mats.forEach(function(m){
          var b=boxFromCtm(m,function(x,y){return vp.convertToViewportPoint(x,y);},sc,v1.height);
          if(!keepBox(b,v1.width,v1.height))return;
          var key=[b.cx0,b.cy0,b.cx1,b.cy1].map(Math.round).join(',');
          if(seen[key])return;seen[key]=1;
          var x0=Math.max(0,Math.floor(b.cx0)+1),y0=Math.max(0,Math.floor(b.cy0)+1);
          var x1=Math.min(cv.width,Math.ceil(b.cx1)-1),y1=Math.min(cv.height,Math.ceil(b.cy1)-1);
          var cw=x1-x0,ch=y1-y0;
          if(cw<4||ch<4)return;
          var c2=document.createElement('canvas');c2.width=cw;c2.height=ch;
          c2.getContext('2d').drawImage(cv,x0,y0,cw,ch,0,0,cw,ch);
          list.push({dataUrl:c2.toDataURL('image/jpeg',0.88),uy:b.uy,uh:b.uh,w:(b.cx1-b.cx0)/sc,h:(b.cy1-b.cy0)/sc});
          c2.width=c2.height=1;
        });
        if(list.length)res[n]=list;
        cv.width=cv.height=1;
      }
      page.cleanup();
      await tick();
    }
  }finally{try{await pdf.destroy();}catch(e){}try{await task.destroy();}catch(e){}}
  return res;
}

/* ---------- downloads ---------- */
function saveBlob(filename,blob){
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download=filename;a.rel='noopener';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},30000);
}
async function exportXlsx(){
  if(!S.sheets.length||S.busy)return;
  var job=newJob('export');job.text='Building Excel file…';showJob(job);
  var done=S.files.filter(function(f){return f.status==='done';});
  var note='',sheets=null;
  try{
    sheets=S.sheets.map(function(s){return {name:s.name,rows:s.rows,hdrRows:s.hdrRows};});
    if(S.opts.pics){
      var any=false;
      try{
        for(var i=0;i<done.length;i++)done[i].imgs=await extractImages(done[i],job,'File '+(i+1)+' of '+done.length);
        S.sheets.forEach(function(s,si){
          var plan=planPictures(s,function(src){return s.file.imgs&&s.file.imgs[src.n];});
          if(plan){any=true;sheets[si]={name:s.name,rows:plan.rows,hdrRows:s.hdrRows,pic:{col:plan.col,items:plan.items}};}
        });
        if(!any)note='No pictures were found in this PDF, so the Excel file has none.';
      }catch(e){
        if(e===CANCEL)throw e;
        logErr('pictures',e);
        sheets=S.sheets.map(function(s){return {name:s.name,rows:s.rows,hdrRows:s.hdrRows};});
        note='Pictures could not be added, so the Excel file has none.';
      }
    }
    job.text='Building Excel file…';job.phaseFrac=0.95;jobTouch();
    var r=await buildXlsx(sheets,{yield:tick,isCancelled:function(){return job.cancelled;}});
    saveBlob(safeFileName(done.length===1?baseName(done[0].name):'converted-pdfs','.xlsx'),r.blob);
    toast(note||(r.warnings.length?r.warnings[0]:'Excel file is ready.'));
  }catch(e){
    if(e===CANCEL||(e&&e.cancelled))toast('Download cancelled.');
    else{logErr('xlsx',e);toast('The Excel file could not be created. Try the CSV download, or convert fewer pages.');}
  }finally{
    sheets=null;
    done.forEach(function(f){f.imgs=null;});
    endJob();render();
  }
}
function exportCsv(){
  var s=S.sheets[S.active];if(!s||S.busy)return;
  try{
    saveBlob(safeFileName(s.name,'.csv'),new Blob([toCsv(s.rows)],{type:'text/csv;charset=utf-8'}));
  }catch(e){logErr('csv',e);toast('The CSV file could not be created.');}
}

/* ---------- inputs ---------- */
var drop=$('#drop'),inp=$('#fileInput');
inp.addEventListener('change',function(){addFiles(inp.files);inp.value='';});
['dragenter','dragover'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('over');loadPdfjs().catch(function(){});});});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('over');});});
drop.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files)addFiles(e.dataTransfer.files);});
drop.addEventListener('pointerenter',function(){loadPdfjs().catch(function(){});},{once:true});
window.addEventListener('dragover',function(e){e.preventDefault();});
window.addEventListener('drop',function(e){e.preventDefault();});

document.querySelectorAll('input[name="mode"]').forEach(function(r){r.addEventListener('change',function(){
  S.opts.mode=r.value;
  $('#modeHint').textContent=r.value==='table'?'Aligns text into columns, like the table you see in the PDF.':'Keeps every line of the PDF as its own row, with values lined up in the same columns.';
  S.active=0;refresh();});});
document.querySelectorAll('input[name="layout"]').forEach(function(r){r.addEventListener('change',function(){S.opts.layout=r.value;S.active=0;refresh();});});
$('#sens').addEventListener('change',function(e){S.opts.sens=e.target.value;S.files.forEach(function(f){f.lc={};});refresh();});
$('#nums').addEventListener('change',function(e){S.opts.nums=e.target.checked;refresh();});
$('#dates').addEventListener('change',function(e){S.opts.dates=e.target.checked;refresh();});
$('#wrap').addEventListener('change',function(e){S.opts.wrap=e.target.checked;refresh();});
$('#pageCol').addEventListener('change',function(e){S.opts.pageCol=e.target.checked;refresh();});
$('#pics').addEventListener('change',function(e){S.opts.pics=e.target.checked;});
$('#dlXlsx').addEventListener('click',exportXlsx);
$('#dlCsv').addEventListener('click',exportCsv);
$('#cancelBtn').addEventListener('click',function(){if(S.job){S.job.cancelled=true;$('#jobText').textContent='Cancelling…';}});
window.addEventListener('unhandledrejection',function(e){logErr('unhandled',e.reason);});

$('#ver').textContent='v'+APP_VERSION;
render();
/* ===== APP:END ===== */

})();
