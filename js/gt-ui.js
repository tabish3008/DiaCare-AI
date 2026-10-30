/* DiaCare UI: upload/review, charts, history, report and optional Supabase sync. */
import { initializeSupabase } from './supabase-client.js';
const supabaseState=await initializeSupabase(),supabase=supabaseState.client,supabaseConfigured=supabaseState.configured;
const G=window.GT,$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=G.store.load(),pending=[],pdfjs=null,tesseractLoader=null;
const say=(t,bad)=>{$('msg').innerHTML=`<div class="notice ${bad?'alert':''}">${esc(t)}</div>`};
let cloudUser=null,cloudSyncPaused=false,cloudQueue=Promise.resolve();
const enterPortal=()=>{document.body.classList.add('portal-open');$('patientPortal').hidden=false;$('dashboard-section').hidden=true;document.querySelector('#loginMount').append($('cloud-section'));};
const leavePortal=()=>{document.body.classList.remove('portal-open');$('patientPortal').hidden=true;$('cloud-section').append($('cloudSignOut'));document.querySelector('#loginMount').append($('cloud-section'));};
$('loginMount').append($('cloud-section'));$('cloudSignUp').hidden=true;leavePortal();
const cloudStatus=t=>{$('cloudStatus').textContent=t};
window.DiaCareCloud={
 isSignedIn:()=>Boolean(cloudUser&&!cloudSyncPaused),
 askEducation:async question=>{
  if(!supabaseConfigured||!supabase)throw new Error('Ask Direct AI is temporarily unavailable because its service is not configured.');
  const {data:result,error}=await supabase.functions.invoke('diacare-education',{body:{question}});
  if(error){let message=error.message;try{const body=await error.context.json();if(body.error)message=body.error}catch{}throw new Error(message)}
  return result;
 }
};
const isUuid=x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x||''));
function recordKey(r){return [r.date,r.test,r.value,r.unit,r.fasting].join('|')}
async function readCloud(user){
 const p=await supabase.from('patients').select('*').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(1);
 if(p.error)throw p.error;
 const patient=p.data&&p.data[0];if(!patient)return null;
 const q=await supabase.from('patient_readings').select('*').eq('owner_id',user.id).eq('patient_id',patient.id).order('measurement_date');
 if(q.error)throw q.error;
 return {patient:{cloudId:patient.id,name:patient.display_name,from:patient.period_start||'',to:patient.period_end||'',notes:'',medication:patient.care_team_medication||'',lastVisited:patient.last_visited_at||''},readings:(q.data||[]).map(r=>({id:r.id,date:r.measurement_date,test:r.test_type,value:String(r.value),unit:r.unit,fasting:r.fasting_status==='not_applicable'?'unknown':r.fasting_status,source:r.source_type==='pdf_import'?'PDF import':'Supabase record',origin:r.source_type==='pdf_import'?'imported':'user-entered',status:'reviewed'}))};
}
async function writeCloud(snapshot){
 if(!cloudUser||cloudSyncPaused)return;
 const user=cloudUser;
 let patientId=snapshot.patient&&snapshot.patient.cloudId;
 const patientPayload={owner_id:user.id,display_name:(snapshot.patient&&snapshot.patient.name||'My demo record').trim().slice(0,60)||'My demo record',period_start:snapshot.patient&&snapshot.patient.from||null,period_end:snapshot.patient&&snapshot.patient.to||null};
 let p;
 if(patientId){p=await supabase.from('patients').update(patientPayload).eq('id',patientId).eq('owner_id',user.id).select('id').single()}
 else {p=await supabase.from('patients').insert(patientPayload).select('id').single()}
 if(p.error)throw p.error;
 patientId=p.data.id;
 if(!snapshot.patient)snapshot.patient={name:patientPayload.display_name,from:'',to:'',notes:''};
 snapshot.patient.cloudId=patientId;
 const remote=await supabase.from('patient_readings').select('id').eq('owner_id',user.id).eq('patient_id',patientId);
 if(remote.error)throw remote.error;
 const localRows=(snapshot.readings||[]).filter(r=>r.status==='reviewed'&&G.validate(r)===null);
 const payload=localRows.map(r=>{
  if(!isUuid(r.id))r.id=crypto.randomUUID();
  return {id:r.id,patient_id:patientId,owner_id:user.id,measurement_date:r.date,test_type:r.test,value:Number(r.value),unit:r.unit,fasting_status:r.test==='hba1c'&&r.fasting==='unknown'?'not_applicable':(r.fasting||'unknown'),source_type:r.origin==='imported'?'pdf_import':'manual'};
 });
 if(payload.length){const saved=await supabase.from('patient_readings').upsert(payload,{onConflict:'id'});if(saved.error)throw saved.error}
 const keep=new Set(payload.map(r=>r.id));
 for(const old of remote.data||[]){if(!keep.has(old.id)){const removed=await supabase.from('patient_readings').delete().eq('id',old.id).eq('owner_id',user.id);if(removed.error)throw removed.error}}
}
function queueCloudSave(){if(!cloudUser||cloudSyncPaused)return;const user=cloudUser,snapshot=JSON.parse(JSON.stringify(data));cloudQueue=cloudQueue.then(()=>writeCloud(snapshot)).then(()=>{if(cloudUser!==user)return;if(snapshot.patient){if(!data.patient)data.patient={name:snapshot.patient.name,from:snapshot.patient.from,to:snapshot.patient.to,notes:''};data.patient.cloudId=snapshot.patient.cloudId}const ids=new Map(snapshot.readings.map(r=>[recordKey(r),r.id]));data.readings.forEach(r=>{const id=ids.get(recordKey(r));if(id)r.id=id});G.store.save(data);cloudStatus('Signed in as '+user.email+' · confirmed records synced to Supabase.')}).catch(e=>cloudStatus('Cloud save failed: '+(e.message||'check the connection and database policies')))}
const persist=()=>{if(!G.store.save(data))say('Could not save to browser storage (private mode or full).',true);queueCloudSave()};
function hasLocalContent(d){return Boolean(d.patient||d.readings.length)}
async function activateCloudUser(user){
 cloudUser=user;cloudSyncPaused=false;$('cloudSignOut').hidden=false;$('cloudSignUp').hidden=true;$('cloudSignIn').textContent='Signed in';$('cloudSignIn').disabled=true;
 try{
  const local=G.store.load(),remote=await readCloud(user),localHas=hasLocalContent(local);
  if(!remote){leavePortal();cloudStatus('This login is not linked to a patient record yet. Ask the DiaCare administrator to link the correct patient to this account.');return}
  enterPortal();
  if(remote){const seen=new Date().toISOString();const visit=await supabase.from('patients').update({last_visited_at:seen}).eq('id',remote.patient.cloudId).eq('owner_id',user.id);if(visit.error)throw visit.error;remote.patient.lastVisited=seen;$('patientSummary').innerHTML=`<strong>${esc(remote.patient.name)}</strong><span>Last visited: ${new Date(seen).toLocaleString()}</span><span>Care-team medication on file: ${esc(remote.patient.medication||'None recorded.')}</span><span>DiaCare AI does not recommend or change medicines.</span>`;$('patientSummary').append($('cloudSignOut'));}else{$('patientSummary').innerHTML=`<strong>Patient record not linked yet</strong><span>Ask the DiaCare administrator to link this account to the correct patient record before using the portal.</span><span>Medication: shown only when recorded by your care team; DiaCare AI does not recommend medicines.</span>`;}
  if(remote&&localHas){
   const useMerge=confirm('A cloud patient record and browser data both exist. Press OK to merge confirmed browser readings into the cloud record. Press Cancel to pause cloud syncing and keep this browser unchanged.');
   if(!useMerge){cloudSyncPaused=true;data=local;showPatient();render();cloudStatus('Signed in as '+user.email+' · cloud sync paused so your browser data is not overwritten. Sign out or reload to choose again.');return}
   const merged=remote;if(local.patient&&local.patient.cloudId===remote.patient.cloudId)merged.patient.notes=local.patient.notes||'';const added=G.addUnique(merged,local.readings).added;data=merged;G.store.save(data);showPatient();render();await writeCloud(data);G.store.save(data);cloudStatus('Connected · cloud and browser records merged ('+added+' new reading(s)).');
  }else if(remote){if(local.patient&&local.patient.cloudId===remote.patient.cloudId)remote.patient.notes=local.patient.notes||'';data=remote;G.store.save(data);showPatient();render();cloudStatus('Connected · loaded your saved Supabase patient record and readings.');}
  else if(localHas){
   if(confirm('This account has no cloud record yet. Upload this browser’s patient label and '+local.readings.length+' confirmed reading(s) to Supabase? PDF/image files and notes will not be uploaded.')){data=local;await writeCloud(data);showPatient();cloudStatus('Connected · browser records uploaded to Supabase.')}
   else{cloudSyncPaused=true;cloudStatus('Signed in as '+user.email+' · cloud sync paused; browser records remain local.')}
  }else{data=local;cloudStatus('Connected as '+user.email+' · save a patient record to begin syncing.')}
 }catch(e){cloudStatus('Could not load cloud records: '+(e.message||'check the database setup and RLS policies'));}
}
if(!supabaseConfigured){$('cloudConfigHelp').hidden=!supabaseState.needsKey;$('cloudSignIn').disabled=true;$('cloudSignUp').disabled=true;if(supabaseState.error)cloudStatus(supabaseState.error)}
else{
 $('cloudAuthForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;cloudStatus('Signing in…');const {data:result,error}=await supabase.auth.signInWithPassword({email,password});if(error){cloudStatus(error.message);return}if(result.user)await activateCloudUser(result.user)});
 $('cloudSignUp').addEventListener('click',async()=>{const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return cloudStatus('Enter your email and a password of at least 6 characters first.');cloudStatus('Creating account…');const {data:result,error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.href.split('#')[0]}});if(error){cloudStatus(error.message);return}if(result.session&&result.user)await activateCloudUser(result.user);else cloudStatus('Account created. Check your email to confirm it, then sign in here.')});
 $('cloudSignOut').addEventListener('click',async()=>{const {error}=await supabase.auth.signOut();if(error){cloudStatus(error.message);return}cloudUser=null;cloudSyncPaused=false;leavePortal();$('cloudSignOut').hidden=true;$('cloudSignUp').hidden=false;$('cloudSignIn').textContent='Sign in';$('cloudSignIn').disabled=false;cloudStatus('Signed out. Your browser copy remains available on this device.')});
 supabase.auth.getSession().then(({data:sessionData,error})=>{if(error)cloudStatus(error.message);else if(sessionData.session)activateCloudUser(sessionData.session.user);else cloudStatus('Ready. Sign in to sync confirmed records to Supabase; otherwise they remain in this browser.')});
 supabase.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session&&!cloudUser)setTimeout(()=>activateCloudUser(session.user),0)});
}
const opt=(arr,sel)=>arr.map(x=>`<option ${x===sel?'selected':''}>${esc(x)}</option>`).join('');
const fill=()=>{$('mUnit').innerHTML=opt(G.UNITS[$('mTest').value])};
/* ---- patient ---- */
function showPatient(){const p=data.patient||{};if($('pName'))$('pName').value=p.name||'';if($('pFrom'))$('pFrom').value=p.from||'';if($('pTo'))$('pTo').value=p.to||'';if($('pNotes'))$('pNotes').value=p.notes||''}
$('savePatient').onclick=()=>{const n=$('pName').value.trim();if(!n)return say('Enter a name or pseudonym (no real identifiers needed).',true);
 const f=$('pFrom').value,t=$('pTo').value;if(f&&t&&f>t)return say('“From” must be before “To”.',true);
 data.patient={cloudId:data.patient&&data.patient.cloudId,name:n.slice(0,60),from:f,to:t,notes:$('pNotes').value.slice(0,500)};persist();say('Record saved in this browser.');render()};
 $('wipe').onclick=async()=>{const scope=cloudUser&&!cloudSyncPaused?'this browser and the linked Supabase account':'this browser';if(!confirm('Delete the patient record and all readings from '+scope+'? This cannot be undone.'))return;
 if(cloudUser&&!cloudSyncPaused){const removed=await supabase.from('patients').delete().eq('owner_id',cloudUser.id);if(removed.error)return say('Could not delete cloud data: '+removed.error.message,true)}
 G.store.wipe();data={patient:null,readings:[]};showPatient();say('All data deleted.');render();if(cloudUser&&!cloudSyncPaused)cloudStatus('Cloud account connected. Its patient record and readings were deleted.')};
/* ---- manual add ---- */
$('mTest').onchange=fill;
$('addManual').onclick=()=>{const r={date:$('mDate').value,test:$('mTest').value,value:$('mVal').value,unit:$('mUnit').value,fasting:$('mFast').value,source:'manual entry',origin:'user-entered',status:'reviewed'};
 const e=G.validate(r);if(e)return say(e,true);const x=G.addUnique(data,[r]);if(!x.added)return say('That exact reading already exists.',true);persist();say('Reading added.');
 const c=G.toCommon(r);$('lowAlert').innerHTML=r.test==='glucose'&&c<70?lowHTML():'';render()};
const lowHTML=()=>'<div class="notice alert" role="alert"><strong>Needs attention:</strong> this value is below 70 mg/dL, which NIDDK describes as low for many people with diabetes (your own target may differ). Follow your clinician’s personal plan or contact your care team. If someone is severely confused, unconscious, or having a seizure, call emergency services (India: 112). This site cannot provide a treatment plan.</div>';
/* ---- upload & review ---- */
const MAX=10*1024*1024, MAX_PDF_PAGES=30, MAX_OCR_PAGES=10;
async function loadPdfjs(){if(pdfjs)return pdfjs;pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',import.meta.url).href;return pdfjs}
async function loadTesseract(){
 if(window.Tesseract)return window.Tesseract;
 if(!tesseractLoader)tesseractLoader=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';script.async=true;
  script.onload=()=>{if(window.Tesseract)resolve(window.Tesseract);else{tesseractLoader=null;reject(new Error('OCR engine did not initialize.'))}};
  script.onerror=()=>{tesseractLoader=null;reject(new Error('Could not load the local OCR engine. Check the internet connection and try again.'))};
  document.head.appendChild(script);
 });
 return tesseractLoader;
}
async function createOcrWorker(status){
 const api=await loadTesseract();
 return api.createWorker('eng',1,{logger:message=>{
  if(message.status==='recognizing text'&&Number.isFinite(message.progress))status('Reading image text locally… '+Math.round(message.progress*100)+'%');
 }});
}
async function pdfText(file){
 const lib=await loadPdfjs(),doc=await lib.getDocument({data:await file.arrayBuffer()}).promise;let out='';
 for(let p=1;p<=Math.min(doc.numPages,MAX_PDF_PAGES);p++){
  const page=await doc.getPage(p),content=await page.getTextContent();let y=null,line='';
  for(const item of content.items){
   if(!item.str)continue;
   const yy=item.transform?Math.round(item.transform[5]):y;
   if(y!==null&&yy!==null&&Math.abs(yy-y)>3){out+=line.trim()+'\n';line=''}
   line+=item.str+(item.hasEOL?'\n':' ');if(yy!==null)y=yy;
   if(item.hasEOL){out+=line.trim()+'\n';line='';y=null}
  }
  if(line.trim())out+=line.trim()+'\n';
 }
 return{doc,text:out};
}
async function ocrImage(file,status){
 const worker=await createOcrWorker(status);
 try{return(await worker.recognize(file)).data.text||''}finally{await worker.terminate()}
}
async function ocrPdf(doc,status){
 const pages=Math.min(doc.numPages,MAX_OCR_PAGES),parts=[],worker=await createOcrWorker(status);
 try{
  for(let number=1;number<=pages;number++){
   status('Preparing page '+number+' of '+pages+' for local OCR…');
   const page=await doc.getPage(number),initial=page.getViewport({scale:2}),scale=Math.min(1,2600/Math.max(initial.width,initial.height));
   const viewport=scale<1?page.getViewport({scale:2*scale}):initial,canvas=document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   const context=canvas.getContext('2d',{willReadFrequently:true});
   if(!context)throw new Error('Could not prepare a PDF page for local OCR.');
   await page.render({canvasContext:context,viewport}).promise;
   const result=await worker.recognize(canvas);parts.push(result.data.text||'');
   canvas.width=0;canvas.height=0;
  }
  return parts.join('\n');
 }finally{await worker.terminate()}
}
const setUploadStatus=(element,message,alert=false)=>{element.innerHTML='<div class="notice'+(alert?' alert':'')+'">'+esc(message)+'</div>'};
$('file').onchange=async ev=>{
 const f=ev.target.files[0];$('reviewBox').hidden=true;$('pdfTextPreview').textContent='';if(!f)return;const status=$('upStatus');
 const isPdf=/\.pdf$/i.test(f.name)||f.type==='application/pdf',isPng=/\.png$/i.test(f.name)||f.type==='image/png';
 if(!isPdf&&!isPng){setUploadStatus(status,'Unsupported file type. Please choose a PDF or PNG.',true);return}
 if(f.size>MAX){setUploadStatus(status,'File is larger than 10 MB. Please use a smaller file.',true);return}
 if(f.size===0){setUploadStatus(status,'The file is empty.',true);return}
 setUploadStatus(status,'Reading file locally…');let rows=[],text='',pdf=null,pdfPageCount=0,failed=false,usedOcr=false;
 try{
  if(isPdf){pdf=await pdfText(f);text=pdf.text;pdfPageCount=pdf.doc.numPages}
  if(!isPdf||text.replace(/\s/g,'').length<20||G.parseText(text).length===0){
   usedOcr=true;setUploadStatus(status,'No readable text layer found. Running private, on-device OCR…');
   text=isPdf?await ocrPdf(pdf.doc,message=>setUploadStatus(status,message)):await ocrImage(f,message=>setUploadStatus(status,message));
  }
  $('pdfTextPreview').textContent=text.trim();rows=G.parseText(text);
 }catch(error){
  failed=true;setUploadStatus(status,error&&error.message?error.message:'Could not read this file. It may be damaged or password-protected.',true);
 }finally{if(pdf&&pdf.doc)try{await pdf.doc.destroy()}catch{}}
 if(rows.length)setUploadStatus(status,'Found '+rows.length+' possible value(s). Please check each one.');
 else if(text&&!failed)setUploadStatus(status,'Text was read, but no glucose or HbA1c results were recognized. Review the extracted text below and add rows manually if needed.');
 else if(!failed)setUploadStatus(status,'No text was recognized. You can add the readings manually below.');
 if(usedOcr&&isPdf&&pdfPageCount>MAX_OCR_PAGES&&text&&rows.length)setUploadStatus(status,'Found '+rows.length+' possible value(s) in the first '+MAX_OCR_PAGES+' pages. Please check each one.');
 pending=rows.map(row=>({...row,source:f.name,origin:'imported'}));
 drawReview();$('reviewBox').hidden=false;ev.target.value='';
};
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
const localISO=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function shiftMonths(iso,amount){const [y,m,day]=iso.split('-').map(Number),d=new Date(y,m-1,1);d.setMonth(d.getMonth()+amount);d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));return localISO(d)}
function setLastSixMonths(){const today=localISO(new Date());$('fTo').value=today;$('fFrom').value=shiftMonths(today,-6)}
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
function describe(rows,test){const pts=rows.filter(r=>r.test===test&&G.toCommon(r)!==null).sort((a,b)=>a.date.localeCompare(b.date));if(!pts.length)return `<p>No chartable ${test==='glucose'?'glucose':'HbA1c'} readings in this period.</p>`;
 const values=pts.map(G.toCommon),min=Math.min(...values),max=Math.max(...values),first=pts[0],last=pts.at(-1),unit=G.commonUnit(test),delta=G.toCommon(last)-G.toCommon(first),direction=delta>0?'increased':delta<0?'decreased':'did not change';
 return `<p><strong>${test==='glucose'?'Glucose':'HbA1c'}:</strong> ${pts.length} chartable reading(s). Earliest: ${esc(first.date)} (${G.toCommon(first).toFixed(1)} ${unit}); latest: ${esc(last.date)} (${G.toCommon(last).toFixed(1)} ${unit}). Recorded minimum ${min.toFixed(1)} and maximum ${max.toFixed(1)} ${unit}. From first to last, the value ${direction} by ${Math.abs(delta).toFixed(1)} ${unit}. Descriptive comparison only; it is not a diagnosis or target. Glucose readings may have different fasting conditions.</p>`}
function render(){const rows=range();$('chartG').innerHTML=chart(rows,'glucose');$('chartA').innerHTML=chart(rows,'hba1c');
 const gl=rows.filter(r=>r.test==='glucose'),hb=rows.filter(r=>r.test==='hba1c');
 $('stats').innerHTML=rows.length?`<p>${rows.length} reviewed reading(s) between ${esc($('fFrom').value)} and ${esc($('fTo').value)}. Descriptive only — not a diagnosis or prediction.</p>${describe(rows,'glucose')}${describe(rows,'hba1c')}`:'<p>No readings in this date range yet. Add a reading above or upload a report to get started.</p>';
 $('unitNote').innerHTML=notes(rows).map(t=>`<div class="notice">${esc(t)}</div>`).join('');
 $('histRows').innerHTML=rows.map(r=>{const c=G.toCommon(r),low=r.test==='glucose'&&c!==null&&c<70;return `<tr><td>${esc(r.date)}</td><td>${r.test==='hba1c'?'HbA1c':'Glucose'}</td><td>${esc(r.value)} ${esc(r.unit)} ${low?'<span class="tag lowt">Low — attention</span>':''}</td><td>${esc(r.fasting)}</td><td>${esc(r.source)}</td><td>${esc(r.origin)}</td><td>${esc(r.status)}</td><td><button class="btn-gt btn-ghost" data-del="${esc(r.id)}" aria-label="Delete reading from ${esc(r.date)}">✕</button></td></tr>`}).join('')||'<tr><td colspan="8">Empty.</td></tr>'}
$('histRows').onclick=e=>{const id=e.target.dataset.del;if(id){data.readings=data.readings.filter(r=>r.id!==id);persist();render()}};
$('fFrom').onchange=$('fTo').onchange=render;
$('lastSix').onclick=()=>{setLastSixMonths();render()};
document.addEventListener('diacare:record-updated',()=>{data=G.store.load();showPatient();render();queueCloudSave()});
/* ---- report ---- */
$('makeReport').onclick=()=>{const rows=range(),p=data.patient||{},n=notes(rows),g=rows.filter(r=>r.test==='glucose'&&G.toCommon(r)<70&&G.toCommon(r)!==null);
 $('reportOut').innerHTML=`<h3>DIACARE AI summary (educational, not a diagnosis)</h3>
<p><strong>Patient (pseudonym):</strong> ${esc(p.name||'not set')} &nbsp; <strong>Range:</strong> ${esc($('fFrom').value||'—')} to ${esc($('fTo').value||'—')} &nbsp; <strong>Generated:</strong> ${localISO(new Date())}</p>
<div class="notice">Please verify this summary against the original lab reports. This summary is not a diagnosis or treatment recommendation.</div>
<h4>Descriptive analysis for selected period</h4>${describe(rows,'glucose')}${describe(rows,'hba1c')}
<h4>Glucose</h4>${chart(rows,'glucose')}<h4>HbA1c (reflects roughly the previous 2–3 months)</h4>${chart(rows,'hba1c')}
<h4>Reviewed readings (${rows.length})</h4><table class="tbl"><tr><th>Date</th><th>Test</th><th>Original value</th><th>Fasting</th><th>Source</th><th>Origin</th></tr>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.test)}</td><td>${esc(r.value)} ${esc(r.unit)}</td><td>${esc(r.fasting)}</td><td>${esc(r.source)}</td><td>${r.origin==='imported'?'Imported':'User-entered'}</td></tr>`).join('')}</table>
<h4>Uncertainties &amp; data notes</h4><ul>${(n.length?n:['None flagged.']).map(t=>`<li>${esc(t)}</li>`).join('')}${g.length?`<li>${g.length} glucose value(s) below 70 mg/dL were flagged for attention; discuss with your care team.</li>`:''}<li>Imported values were extracted automatically and confirmed by the user on a review screen; fasting status is “unknown” unless stated in the source.</li></ul>
<h4>Questions for a healthcare professional</h4><ul><li>What are my personal glucose and HbA1c targets?</li><li>Do any of these readings need follow-up or repeat testing?</li><li>How often should I test, and under what conditions?</li><li>Could any supplement or traditional product I use interact with my medicines?</li><li>What kind of physical activity is suitable for me?</li></ul>
<h4>Sources</h4><ul><li><a href="https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis" rel="noopener">NIDDK — Diabetes Tests &amp; Diagnosis</a></li><li><a href="https://www.niddk.nih.gov/health-information/diagnostic-tests/A1C-test" rel="noopener">NIDDK — The A1C Test</a></li><li><a href="https://www.niddk.nih.gov/health-information/diabetes/overview/preventing-problems/low-blood-glucose-hypoglycemia" rel="noopener">NIDDK — Low Blood Glucose</a></li><li><a href="https://www.nccih.nih.gov/health/ayurvedic-medicine-in-depth" rel="noopener">NCCIH — Ayurvedic Medicine: In Depth</a></li><li><a href="https://www.nccih.nih.gov/health/yoga-effectiveness-and-safety" rel="noopener">NCCIH — Yoga: Effectiveness and Safety</a></li></ul>`};
$('printReport').onclick=()=>{if(!$('reportOut').innerHTML.trim())$('makeReport').click();window.print()};
setLastSixMonths();fill();showPatient();render();
