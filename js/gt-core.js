/* DiaCare core: storage, units, validation, text parsing. No DOM, no network. */
window.GT=(function(){
const KEY='diacare.v1', MG=18.016;
const UNITS={glucose:['mg/dL','mmol/L'],hba1c:['%','mmol/mol']};
const LIM={glucose:{'mg/dL':[10,1000],'mmol/L':[0.5,55]},hba1c:{'%':[3,20],'mmol/mol':[10,200]}};
const uid=()=>'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const store={
 load(){try{const d=JSON.parse(localStorage.getItem(KEY)||'null');return d&&Array.isArray(d.readings)?d:{patient:null,readings:[]}}catch(e){return{patient:null,readings:[]}}},
 save(d){try{localStorage.setItem(KEY,JSON.stringify(d));return true}catch(e){return false}},
 wipe(){try{localStorage.removeItem(KEY)}catch(e){}}};
function validate(r){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||isNaN(Date.parse(r.date)))return 'Enter a valid date.';
 if(r.date>new Date().toISOString().slice(0,10))return 'Date is in the future.';
 if(!UNITS[r.test])return 'Choose a test type.';
 if(!UNITS[r.test].includes(r.unit))return 'Choose a unit (needed before this reading can be charted).';
 const v=Number(r.value);if(r.value===''||r.value===null||!isFinite(v))return 'Value must be a number.';
 const [lo,hi]=LIM[r.test][r.unit];if(v<lo||v>hi)return `Value looks out of range (${lo}–${hi} ${r.unit}). Check it.`;
 return null}
/* Convert only when the original unit is known; the original is always kept on the record. */
function toCommon(r){const v=Number(r.value);
 if(r.test==='glucose'){if(r.unit==='mg/dL')return v;if(r.unit==='mmol/L')return v*MG}
 if(r.test==='hba1c'){if(r.unit==='%')return v;if(r.unit==='mmol/mol')return 0.0915*v+2.15}
 return null}
const commonUnit=t=>t==='glucose'?'mg/dL':'%';
const key=r=>[r.date,r.test,r.value,r.unit,r.fasting].join('|');
function addUnique(d,list){let added=0,dup=0;const seen=new Set(d.readings.map(key));
 for(const r of list){const k=key(r);if(seen.has(k)){dup++;continue}seen.add(k);d.readings.push(Object.assign({id:uid()},r));added++}return{added,dup}}
/* Parser: proposes rows only. Anything uncertain is flagged; nothing is silently guessed. */
function iso(s){let m;
 if(m=s.match(/(\d{4})-(\d{2})-(\d{2})/))return{d:`${m[1]}-${m[2]}-${m[3]}`,amb:false};
 if(m=s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)){const a=+m[1],b=+m[2];const amb=a<=12&&b<=12&&a!==b;
  if(a>12&&b<=12)return{d:`${m[3]}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`,amb:false};
  return{d:`${m[3]}-${String(b).padStart(2,'0')}-${String(a).padStart(2,'0')}`,amb}}
 return null}
function parseText(text){const out=[];let ctx=null;
 for(const line of String(text).split(/\r?\n/)){
  const dt=iso(line);if(dt)ctx={...dt,line:true};
  const t=/hba1c|\ba1c\b|glycated|glycosylated|hb\s*a1c/i.test(line)?'hba1c':/glucose|\bfbs\b|\bppbs\b|\brbs\b|blood sugar/i.test(line)?'glucose':null;
  const m=line.match(/(\d+(?:\.\d+)?)\s*(mg\s*\/\s*dl|mmol\s*\/\s*l|mmol\s*\/\s*mol|%)/i);
  if(!t||!m)continue;
  const u={'mg/dl':'mg/dL','mmol/l':'mmol/L','mmol/mol':'mmol/mol','%':'%'}[m[2].toLowerCase().replace(/\s/g,'')];
  const unitOk=UNITS[t].includes(u);
  out.push({date:ctx?ctx.d:'',test:t,value:m[1],unit:unitOk?u:'',fasting:/fasting|\bfbs\b/i.test(line)?'yes':'unknown',
   uncertain:!ctx||ctx.amb||!unitOk||(dt?false:true)})}
 return out}
const demo=()=>{const rows=[],now=new Date();
 for(let i=17;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,10);const s=d.toISOString().slice(0,10);if(i===7||i===8)continue;
  rows.push({date:s,test:'glucose',value:String(Math.round(98+22*Math.sin(i/2.1)+i%3*4)),unit:'mg/dL',fasting:'yes',source:'synthetic demo',origin:'demo',status:'reviewed'});
  if(i%3===0)rows.push({date:s,test:'hba1c',value:(5.9+0.3*Math.cos(i/3)).toFixed(1),unit:'%',fasting:'unknown',source:'synthetic demo',origin:'demo',status:'reviewed'})}
 rows.push({date:new Date(now.getFullYear(),now.getMonth()-2,20).toISOString().slice(0,10),test:'glucose',value:'4.1',unit:'mmol/L',fasting:'unknown',source:'synthetic demo',origin:'demo',status:'reviewed'});
 return rows};
return{UNITS,store,validate,toCommon,commonUnit,addUnique,parseText,demo,uid}})();
