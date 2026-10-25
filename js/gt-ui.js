/* DiaCare UI: upload/review, charts, history, report. Uses window.GT (gt-core.js). */
const G=window.GT,$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=G.store.load(),pending=[],pdfjs=null;
const say=(t,bad)=>{$('msg').innerHTML=`<div class="notice ${bad?'alert':''}">${esc(t)}</div>`};
const persist=()=>{if(!G.store.save(data))say('Could not save to browser storage (private mode or full).',true)};
const opt=(arr,sel)=>arr.map(x=>`<option ${x===sel?'selected':''}>${esc(x)}</option>`).join('');
const fill=()=>{$('mUnit').innerHTML=opt(G.UNITS[$('mTest').value])};
/* ---- patient ---- */
function showPatient(){const p=data.patient||{};$('pName').value=p.name||'';$('pFrom').value=p.from||'';$('pTo').value=p.to||'';$('pNotes').value=p.notes||''}
$('savePatient').onclick=()=>{const n=$('pName').value.trim();if(!n)return say('Enter a name or pseudonym (no real identifiers needed).',true);
 const f=$('pFrom').value,t=$('pTo').value;if(f&&t&&f>t)return say('“From” must be before “To”.',true);
 data.patient={name:n.slice(0,60),from:f,to:t,notes:$('pNotes').value.slice(0,500)};persist();say('Record saved in this browser.');render()};
$('loadDemo').onclick=()=>{const r=G.addUnique(data,G.demo());data.patient=data.patient||{name:'Demo Patient (synthetic)',from:'',to:'',notes:'Synthetic data for demonstration only.'};persist();showPatient();say(`Loaded ${r.added} synthetic readings (${r.dup} duplicates skipped).`);render()};
$('wipe').onclick=()=>{if(confirm('Delete the patient record and all readings from this browser?')){G.store.wipe();data={patient:null,readings:[]};showPatient();say('All data deleted.');render()}};
/* ---- manual add ---- */
$('mTest').onchange=fill;
$('addManual').onclick=()=>{const r={date:$('mDate').value,test:$('mTest').value,value:$('mVal').value,unit:$('mUnit').value,fasting:$('mFast').value,source:'manual entry',origin:'user-entered',status:'reviewed'};
 const e=G.validate(r);if(e)return say(e,true);const x=G.addUnique(data,[r]);if(!x.added)return say('That exact reading already exists.',true);persist();say('Reading added.');
 const c=G.toCommon(r);$('lowAlert').innerHTML=r.test==='glucose'&&c<70?lowHTML():'';render()};
const lowHTML=()=>'<div class="notice alert" role="alert"><strong>Needs attention:</strong> this value is below 70 mg/dL, which NIDDK describes as low for many people with diabetes (your own target may differ). Follow your clinician’s personal plan or contact your care team. If someone is severely confused, unconscious, or having a seizure, call emergency services (India: 112). This site cannot provide a treatment plan.</div>';
/* ---- upload & review ---- */
const MAX=10*1024*1024;
async function loadPdfjs(){if(pdfjs)return pdfjs;pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;return pdfjs}
async function pdfText(file){const lib=await loadPdfjs(),doc=await lib.getDocument({data:await file.arrayBuffer()}).promise;let out='';
 for(let p=1;p<=Math.min(doc.numPages,30);p++){const items=(await(await doc.getPage(p)).getTextContent()).items;let y=null,line='';
  for(const it of items){const yy=Math.round(it.transform[5]);if(y!==null&&Math.abs(yy-y)>3){out+=line+'\n';line=''}y=yy;line+=it.str+' '}out+=line+'\n'}return out}
$('file').onchange=async ev=>{const f=ev.target.files[0];$('reviewBox').hidden=true;if(!f)return;const s=$('upStatus');
 const isPdf=/\.pdf$/i.test(f.name)&&(f.type===''||f.type==='application/pdf'),isPng=/\.png$/i.test(f.name)&&(f.type===''||f.type==='image/png');
 if(!isPdf&&!isPng)return s.innerHTML='<div class="notice alert">Unsupported file type. Please choose a PDF or PNG.</div>';
 if(f.size>MAX)return s.innerHTML='<div class="notice alert">File is larger than 10 MB. Please use a smaller file.</div>';
 if(f.size===0)return s.innerHTML='<div class="notice alert">The file is empty.</div>';
 s.innerHTML='<div class="notice">Reading file locally…</div>';let rows=[];
 try{if(isPdf){const t=await pdfText(f);if(t.replace(/\s/g,'').length<20)throw{scan:1};rows=G.parseText(t)}else throw{scan:1}}
 catch(e){if(e&&e.scan)s.innerHTML='<div class="notice">No selectable text found (scan or image). OCR is not bundled in this build, so nothing was extracted. Add rows by hand below, or see the README to add a local OCR engine.</div>';
  else s.innerHTML='<div class="notice alert">Could not read this file. It may be damaged, password-protected, or the local PDF engine failed to load (open the site through a local server — see README). You can still add rows manually.</div>'}
 if(rows.length)s.innerHTML=`<div class="notice">Found ${rows.length} possible value(s). Please check each one.</div>`;
 pending=rows.map(r=>({...r,source:f.name,origin:'imported'}));if(!rows.length&&!s.innerHTML.includes('alert'))pending=[];
 drawReview();$('reviewBox').hidden=false;ev.target.value=''};
function drawReview(){$('revRows').innerHTML=pending.map((r,i)=>{const nr=r.uncertain||!r.date||!r.unit;return `<tr data-i="${i}">
<td><input type="date" aria-label="Date" data-f="date" value="${esc(r.date)}"></td>
<td><select aria-label="Test" data-f="test">${['glucose','hba1c'].map(t=>`<option ${t===r.test?'selected':''}>${t}</option>`).join('')}</select></td>
<td><input aria-label="Value" data-f="value" value="${esc(r.value)}"></td>
<td><select aria-label="Unit" data-f="unit"><option value="">choose…</option>${(G.UNITS[r.test]||[]).map(u=>`<option ${u===r.unit?'selected':''}>${u}</option>`).join('')}</select></td>
<td><select aria-label="Fasting" data-f="fasting">${['unknown','yes','no'].map(t=>`<option ${t===r.fasting?'selected':''}>${t}</option>`).join('')}</select></td>
<td><span class="tag ${nr?'rev':'ok'}">${nr?'Needs review':'Check &amp; confirm'}</span></td>
<td><button class="btn-gt btn-ghost" data-rm aria-label="Reject row ${i+1}">✕</button></td></tr>`}).join('')||'<tr><td colspan="7">No rows. Use “Add row”.</td></tr>'}
$('revRows').addEventListener('change',e=>{const tr=e.target.closest('tr'),f=e.target.dataset.f;if(!tr||!f)return;const r=pending[tr.dataset.i];r[f]=e.target.value;if(f==='test'){r.unit='';}r.uncertain=false;drawReview()});
$('revRows').addEventListener('click',e=>{if(e.target.dataset.rm!==undefined){pending.splice(e.target.closest('tr').dataset.i,1);drawReview()}});
$('revAdd').onclick=()=>{pending.push({date:'',test:'glucose',value:'',unit:'',fasting:'unknown',source:'manual (review screen)',origin:'user-entered',uncertain:true});drawReview()};
$('revSave').onclick=()=>{const good=[],bad=[];pending.forEach((r,i)=>{const e=G.validate(r);e?bad.push(`Row ${i+1}: ${e}`):good.push({date:r.date,test:r.test,value:String(r.value),unit:r.unit,fasting:r.fasting,source:r.source,origin:r.origin,status:'reviewed'})});
 if(bad.length)return $('upStatus').innerHTML=`<div class="notice alert">${bad.map(esc).join('<br>')}</div>`;
 const x=G.addUnique(data,good);persist();pending=[];$('reviewBox').hidden=true;$('upStatus').innerHTML=`<div class="notice">Saved ${x.added} reviewed reading(s); ${x.dup} duplicate(s) skipped.</div>`;render()};
/* ---- filters, charts, history ---- */
const range=()=>{const f=$('fFrom').value,t=$('fTo').value;return data.readings.filter(r=>(!f||r.date>=f)&&(!t||r.date<=t)).sort((a,b)=>a.date.localeCompare(b.date))};
function chart(rows,test){const pts=rows.filter(r=>r.test===test&&G.toCommon(r)!==null),u=G.commonUnit(test);
 if(!pts.length)return '<p>No reviewed readings in this range.</p>';
 const W=640,H=260,P=48,T=pts.map(r=>Date.parse(r.date)),t0=Math.min(...T),t1=Math.max(...T)||t0+1,V=pts.map(G.toCommon),lo=Math.floor(Math.min(...V)-5),hi=Math.ceil(Math.max(...V)+5);
 const X=t=>P+(t1===t0?.5:(t-t0)/(t1-t0))*(W-2*P),Y=v=>H-P-(v-lo)/(hi-lo)*(H-2*P);
 const line=pts.map((r,i)=>`${i?'L':'M'}${X(T[i]).toFixed(1)} ${Y(V[i]).toFixed(1)}`).join('');
 const dots=pts.map((r,i)=>`<circle cx="${X(T[i]).toFixed(1)}" cy="${Y(V[i]).toFixed(1)}" r="5" fill="${test==='glucose'&&V[i]<70?'#ff8a8a':'#4fd1c5'}"><title>${esc(r.date)}: ${esc(r.value)} ${esc(r.unit)} (converted ${V[i].toFixed(1)} ${u})</title></circle>`).join('');
 return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${test} values over time, ${pts.length} readings, in ${u}"><rect width="${W}" height="${H}" fill="none"/><path d="M${P} ${H-P}H${W-P}M${P} ${P/2}V${H-P}" stroke="#7fa3a8"/>
<text x="4" y="${Y(hi)+4}" fill="#a9c2c6" font-size="11">${hi}</text><text x="4" y="${Y(lo)+4}" fill="#a9c2c6" font-size="11">${lo} ${u}</text>
<text x="${P}" y="${H-12}" fill="#a9c2c6" font-size="11">${esc(pts[0].date)}</text><text x="${W-P-62}" y="${H-12}" fill="#a9c2c6" font-size="11">${esc(pts.at(-1).date)}</text>
<path d="${line}" fill="none" stroke="#4fd1c5" stroke-width="2.5"/>${dots}</svg>`}
const months=(a,b)=>{const o=[],d=new Date(a.slice(0,7)+'-01'),e=new Date(b.slice(0,7)+'-01');while(d<=e){o.push(d.toISOString().slice(0,7));d.setMonth(d.getMonth()+1)}return o};
function gaps(rows){if(!rows.length)return[];const have=new Set(rows.map(r=>r.date.slice(0,7)));return months(rows[0].date,rows.at(-1).date).filter(m=>!have.has(m))}
function notes(rows){const n=[],unk=rows.filter(r=>G.toCommon(r)===null).length,mixed=[...new Set(rows.map(r=>r.test+' '+r.unit))],g=gaps(rows);
 if(mixed.length>[...new Set(rows.map(r=>r.test))].length)n.push('Readings use more than one unit; charts show values converted to mg/dL (glucose) or % (HbA1c), and each original value is kept in the table.');
 if(unk)n.push(`${unk} reading(s) have an unknown unit and are not charted.`);if(g.length)n.push(`No readings in: ${g.join(', ')}.`);return n}
function render(){const rows=range();$('chartG').innerHTML=chart(rows,'glucose');$('chartA').innerHTML=chart(rows,'hba1c');
 const gl=rows.filter(r=>r.test==='glucose'),hb=rows.filter(r=>r.test==='hba1c');
 $('stats').innerHTML=rows.length?`<p>${rows.length} reviewed reading(s): ${gl.length} glucose, ${hb.length} HbA1c, from ${esc(rows[0].date)} to ${esc(rows.at(-1).date)}. Descriptive only — no score, diagnosis or prediction.</p>`:'<p>No readings yet. Add one above, upload a report, or load the synthetic demo data.</p>';
 $('unitNote').innerHTML=notes(rows).map(t=>`<div class="notice">${esc(t)}</div>`).join('');
 $('histRows').innerHTML=rows.map(r=>{const c=G.toCommon(r),low=r.test==='glucose'&&c!==null&&c<70;return `<tr><td>${esc(r.date)}</td><td>${r.test==='hba1c'?'HbA1c':'Glucose'}</td><td>${esc(r.value)} ${esc(r.unit)} ${low?'<span class="tag lowt">Low — attention</span>':''}</td><td>${esc(r.fasting)}</td><td>${esc(r.source)}</td><td>${esc(r.origin)}</td><td>${esc(r.status)}</td><td><button class="btn-gt btn-ghost" data-del="${esc(r.id)}" aria-label="Delete reading from ${esc(r.date)}">✕</button></td></tr>`}).join('')||'<tr><td colspan="8">Empty.</td></tr>'}
$('histRows').onclick=e=>{const id=e.target.dataset.del;if(id){data.readings=data.readings.filter(r=>r.id!==id);persist();render()}};
$('fFrom').onchange=$('fTo').onchange=render;
document.addEventListener('diacare:record-updated',()=>{data=G.store.load();showPatient();render()});
/* ---- report ---- */
$('makeReport').onclick=()=>{const rows=range(),p=data.patient||{},n=notes(rows),g=rows.filter(r=>r.test==='glucose'&&G.toCommon(r)<70&&G.toCommon(r)!==null);
 $('reportOut').innerHTML=`<h3>DIACARE AI summary (educational, not a diagnosis)</h3>
<p><strong>Patient (pseudonym):</strong> ${esc(p.name||'not set')} &nbsp; <strong>Range:</strong> ${esc($('fFrom').value||rows[0]?.date||'—')} to ${esc($('fTo').value||rows.at(-1)?.date||'—')} &nbsp; <strong>Generated:</strong> ${new Date().toISOString().slice(0,10)}</p>
<div class="notice">Please verify this summary against the original lab reports. This summary is not a diagnosis or treatment recommendation. Demo rows are synthetic.</div>
<h4>Glucose</h4>${chart(rows,'glucose')}<h4>HbA1c (reflects roughly the previous 2–3 months)</h4>${chart(rows,'hba1c')}
<h4>Reviewed readings (${rows.length})</h4><table class="tbl"><tr><th>Date</th><th>Test</th><th>Original value</th><th>Fasting</th><th>Source</th><th>Origin</th></tr>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.test)}</td><td>${esc(r.value)} ${esc(r.unit)}</td><td>${esc(r.fasting)}</td><td>${esc(r.source)}</td><td>${r.origin==='imported'?'Imported':r.origin==='demo'?'Synthetic demo':'User-entered'}</td></tr>`).join('')}</table>
<h4>Uncertainties &amp; data notes</h4><ul>${(n.length?n:['None flagged.']).map(t=>`<li>${esc(t)}</li>`).join('')}${g.length?`<li>${g.length} glucose value(s) below 70 mg/dL were flagged for attention; discuss with your care team.</li>`:''}<li>Imported values were extracted automatically and confirmed by the user on a review screen; fasting status is “unknown” unless stated in the source.</li></ul>
<h4>Questions for a healthcare professional</h4><ul><li>What are my personal glucose and HbA1c targets?</li><li>Do any of these readings need follow-up or repeat testing?</li><li>How often should I test, and under what conditions?</li><li>Could any supplement or traditional product I use interact with my medicines?</li><li>What kind of physical activity is suitable for me?</li></ul>
<h4>Sources</h4><p class="small">NIDDK: Diabetes Tests &amp; Diagnosis; Low Blood Glucose; The A1C Test. NCCIH: Ayurvedic Medicine In Depth (links in the Learn and Ayurveda sections).</p>`};
$('printReport').onclick=()=>{if(!$('reportOut').innerHTML.trim())$('makeReport').click();window.print()};
fill();showPatient();render();
