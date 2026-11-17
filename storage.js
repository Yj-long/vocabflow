/* Offline-first persistence with native IndexedDB. No CDN/npm runtime dependency. */
(function(global){
'use strict';
const DB_NAME='vocabflow-v2';const DB_VERSION=2;
const TABLES=['words','decks','deck_words','cards','review_states','review_logs','sessions','settings'];
let db=null;
const uuid=()=>global.crypto?.randomUUID?.()||`vf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const req=p=>new Promise((resolve,reject)=>{p.onsuccess=()=>resolve(p.result);p.onerror=()=>reject(p.error)});
function open(){if(db)return Promise.resolve(db);return new Promise((resolve,reject)=>{
 const r=indexedDB.open(DB_NAME,DB_VERSION);
 r.onupgradeneeded=()=>{
   const d=r.result;
   for(const name of TABLES){if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:name==='review_states'?'cardId':'id'});}
   const addIndex=(name,index,path)=>{const s=r.transaction.objectStore(name);if(!s.indexNames.contains(index))s.createIndex(index,path,{unique:false})};
   addIndex('review_logs','reviewedAt','reviewedAt');addIndex('review_logs','cardId','cardId');addIndex('review_states','dueAt','dueAt');addIndex('deck_words','deckId','deckId');addIndex('deck_words','wordId','wordId');
 };
 r.onsuccess=()=>{db=r.result;db.onversionchange=()=>{db.close();db=null};resolve(db)};
 r.onerror=()=>reject(r.error);
 r.onblocked=()=>reject(new Error('数据库正被其他标签页占用，请先关闭其他 VocabFlow 页面。'));
});}
function transact(names,mode,handler){return new Promise((resolve,reject)=>{
  if(!db){reject(new Error('数据库尚未打开'));return}
  let output;const t=db.transaction(names,mode);
  t.oncomplete=()=>resolve(output);t.onerror=()=>reject(t.error||new Error('数据库事务失败'));
  t.onabort=()=>reject(t.error||new Error('数据库写入已中止'));
  try{handler(t,(val)=>{output=val})}catch(err){try{t.abort()}catch(_){}reject(err)}
});}
async function all(name){const d=await open();return req(d.transaction([name],'readonly').objectStore(name).getAll())}
async function get(name,key){const d=await open();return req(d.transaction([name],'readonly').objectStore(name).get(key))}
async function put(name,value){await open();return transact([name],'readwrite',t=>t.objectStore(name).put(value))}
const SEED=[
 ['resilient','/rɪˈzɪliənt/','adj.','有韧性的；恢复能力强的','Children are remarkably resilient.','孩子们具有很强的恢复能力。','a resilient material'],
 ['coherent','/koʊˈhɪrənt/','adj.','连贯的；条理清晰的','She gave a coherent explanation.','她给出了条理清晰的解释。','a coherent argument'],
 ['substantial','/səbˈstænʃəl/','adj.','大量的；重大的；实质性的','They made substantial progress.','他们取得了重大进展。','substantial evidence'],
 ['intrinsic','/ɪnˈtrɪnzɪk/','adj.','内在的；固有的','Curiosity has intrinsic value.','好奇心具有内在价值。','intrinsic properties'],
 ['mitigate','/ˈmɪtɪɡeɪt/','v.','减轻；缓和','The measures can mitigate the risk.','这些措施可以降低风险。','mitigate the impact'],
 ['elaborate','/ɪˈlæbərət/','adj.','详尽的；复杂的','The team prepared an elaborate plan.','团队准备了一份详细的计划。','an elaborate design'],
 ['quantify','/ˈkwɑːntɪfaɪ/','v.','量化；确定数量','We need to quantify the uncertainty.','我们需要量化不确定性。','quantify the effect'],
 ['retain','/rɪˈteɪn/','v.','保留；记住；保持','The material can retain its shape.','这种材料能够保持其形状。','retain information']
];
async function initialize(){await open();const preferences=await get('settings','preferences');if(preferences)return;
 const deck={id:'starter',name:'入门示例词库',subtitle:'8 条原创示例词 · 可自行导入词书',createdAt:new Date().toISOString(),sample:true};
 await transact(['words','decks','deck_words','cards','settings'],'readwrite',tx=>{
  tx.objectStore('decks').put(deck);
  SEED.forEach(([en,ipa,pos,cn,ex,cnEx,example],order)=>{
   const id=`sample-${order+1}`,word={id,en,ipa,pos,cn,ex,cnEx,example,aliases:[],createdAt:deck.createdAt};
   tx.objectStore('words').put(word);
   tx.objectStore('deck_words').put({id:`starter:${id}`,deckId:'starter',wordId:id,order});
   for(const mode of ['recognition','spelling'])tx.objectStore('cards').put({id:`${mode}:${id}`,wordId:id,mode});
  });
  tx.objectStore('settings').put({id:'preferences',dailyNewGoal:15,theme:'light',selectedDeckId:'starter',targetRetention:.9,schemaVersion:2,algorithmVersion:'fsrs6-local-1'});
 });}
async function snapshot(){await open();const entries=await Promise.all(TABLES.map(async name=>[name,await all(name)]));return Object.fromEntries(entries)}
async function beginSession(sessionId,mode,kind,cardIds,deckId=null){
  const session={id:sessionId,mode,kind,deckId,pending:[...cardIds],completed:0,undoEventId:null,updatedAt:new Date().toISOString()};
  await put('sessions',session);return session;
}
async function recordRating({sessionId,cardId,rating,correct=null,retention=.9}){
 await open();return transact(['review_states','review_logs','sessions'],'readwrite',(tx,setResult)=>{
  const states=tx.objectStore('review_states');const logs=tx.objectStore('review_logs');const sessions=tx.objectStore('sessions');
  const sReq=sessions.get(sessionId);
  sReq.onsuccess=()=>{
   const ses=sReq.result;
   if(!ses||ses.pending[0]!==cardId){tx.abort();return}
   const rReq=states.get(cardId);
   rReq.onsuccess=()=>{
    const before=rReq.result||null;
    const now=new Date();
    const next=global.VFFSRS.calculate(before?{...before,cardId}:{cardId,reps:0},rating,now,retention);
    const id=uuid(),event={id,sessionId,cardId,wordId:cardId.split(':').slice(1).join(':'),mode:ses.mode,kind:ses.kind,rating,correct,reviewedAt:now.toISOString(),before,after:next,sessionBefore:{...ses,pending:[...ses.pending]}};
    const updated={...ses,pending:ses.pending.slice(1),completed:ses.completed+1,undoEventId:id,updatedAt:now.toISOString()};
    states.put(next);logs.put(event);sessions.put(updated);setResult({event,state:next,session:updated});
   };
  };
 });}
async function undoLast(sessionId){await open();return transact(['review_states','review_logs','sessions'],'readwrite',(tx,setResult)=>{
 const sesStore=tx.objectStore('sessions'),logStore=tx.objectStore('review_logs'),stateStore=tx.objectStore('review_states');
 sesStore.get(sessionId).onsuccess=e=>{
  const ses=e.target.result;
  if(!ses?.undoEventId){setResult(false);return}
  logStore.get(ses.undoEventId).onsuccess=evt=>{
   const log=evt.target.result;
   if(!log){setResult(false);return}
   stateStore.get(log.cardId).onsuccess=evs=>{
    const current=evs.target.result;
    if(!current||current.lastReviewAt!==log.after.lastReviewAt){setResult(false);return}
    if(log.before)stateStore.put(log.before);else stateStore.delete(log.cardId);
    logStore.delete(log.id);
    sesStore.put({...log.sessionBefore,undoEventId:null});setResult({log,session:{...log.sessionBefore,undoEventId:null}});
   };
  };
 };
});}
function readCSV(text){
 const rows=[];let row=[],cell='',quoted=false;
 text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
  else if(c===','&&!quoted){row.push(cell);cell=''}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 if(quoted)throw new Error('CSV 引号未闭合');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)throw new Error('CSV 至少需要表头和一行单词');
 const head=rows.shift().map(v=>v.trim().toLowerCase());
 const aliases={en:['word','en','english','单词','英文'],cn:['meaning','cn','translation','释义','中文'],ipa:['ipa','phonetic','音标'],pos:['pos','part of speech','词性'],ex:['example','sentence','例句'],cnEx:['example_cn','sentence_cn','例句翻译'],example:['collocation','phrase','搭配'],alternate:['aliases','alternatives','变体']};
 const idx={};for(const [k,vals] of Object.entries(aliases))idx[k]=head.findIndex(h=>vals.includes(h));
 if(idx.en<0||idx.cn<0)throw new Error('CSV 表头需要包含 word、meaning（或 单词、释义）');
 return rows.map(r=>Object.fromEntries(Object.keys(idx).map(k=>[k,idx[k]>=0?(r[idx[k]]||'').trim():''])));
}
function sanitizeWord(item){
 if(!item||typeof item!=='object')return null;
 const en=String(item.en||item.word||item.单词||'').trim(),cn=String(item.cn||item.meaning||item.释义||'').trim();
 if(!en||!cn||en.length>100||cn.length>1200)return null;
 return {en,cn,ipa:String(item.ipa||'').slice(0,120),pos:String(item.pos||'').slice(0,40),ex:String(item.ex||item.sentence||'').slice(0,800),cnEx:String(item.cnEx||'').slice(0,800),example:String(item.example||'').slice(0,250),aliases:Array.isArray(item.aliases)?item.aliases.map(String).slice(0,12):String(item.alternate||'').split(/[|;]/).map(v=>v.trim()).filter(Boolean).slice(0,12)};
}
async function importDeck(name,fileText,format){
 const entries=format==='csv'?readCSV(fileText):JSON.parse(fileText);
 const input=Array.isArray(entries)?entries:(Array.isArray(entries?.words)?entries.words:null);
 if(!input||input.length===0||input.length>30000)throw new Error('词库必须包含 1–30000 条记录');
 const clean=input.map(sanitizeWord).filter(Boolean);
 if(!clean.length)throw new Error('没有识别到有效的单词与释义');
 const allWords=await all('words');const signatures=new Map(allWords.map(w=>[`${w.en.toLowerCase()}|${w.pos}|${w.cn}`,w.id]));
 const seen=new Set();const additions=[];const link=[];const deckId=uuid();const deckName=String(name||'自定义词书').trim().slice(0,100)||'自定义词书';
 clean.forEach((w,i)=>{
  const sig=`${w.en.toLowerCase()}|${w.pos}|${w.cn}`;if(seen.has(sig))return;seen.add(sig);
  const wordId=signatures.get(sig)||uuid();
  if(!signatures.has(sig)){signatures.set(sig,wordId);additions.push({...w,id:wordId,createdAt:new Date().toISOString()})}
  link.push({id:`${deckId}:${wordId}`,deckId,wordId,order:i});
 });
 const deck={id:deckId,name:deckName,subtitle:`导入词书 · ${link.length} 词`,createdAt:new Date().toISOString(),sample:false};
 await transact(['decks','words','deck_words','cards','settings'],'readwrite',tx=>{
   tx.objectStore('decks').put(deck);
   for(const word of additions){tx.objectStore('words').put(word);for(const mode of ['recognition','spelling'])tx.objectStore('cards').put({id:`${mode}:${word.id}`,wordId:word.id,mode})}
   for(const rel of link)tx.objectStore('deck_words').put(rel);
   tx.objectStore('settings').get('preferences').onsuccess=e=>{let pref=e.target.result;if(pref)tx.objectStore('settings').put({...pref,selectedDeckId:deckId})};
 });return {deck,count:link.length,added:additions.length,skipped:clean.length-seen.size};
}
function validateBackup(value){
 if(!value||value.app!=='VocabFlow'||value.formatVersion!==2||value.algorithmVersion!=='fsrs6-local-1')throw new Error('备份版本或算法版本不兼容，已拒绝覆盖');
 if(!value.tables||TABLES.some(n=>!Array.isArray(value.tables[n])))throw new Error('备份缺少必要数据表');
 for(const n of TABLES){if(value.tables[n].length>150000)throw new Error(`备份数据表 ${n} 过大`);const key=n==='review_states'?'cardId':'id';if(value.tables[n].some(v=>!v||typeof v!=='object'||typeof v[key]!=='string'||!v[key]))throw new Error(`${n} 包含无效记录`);}
 const decks=new Set(value.tables.decks.map(v=>v.id)),words=new Set(value.tables.words.map(v=>v.id)),cards=new Set(value.tables.cards.map(v=>v.id));
 if(value.tables.deck_words.some(v=>!decks.has(v.deckId)||!words.has(v.wordId)))throw new Error('备份的词书关联存在缺失');
 if(value.tables.cards.some(v=>!words.has(v.wordId)))throw new Error('备份的卡片缺少对应单词');
 if(value.tables.review_states.some(v=>!cards.has(v.cardId)||!Number.isFinite(v.stability)||!Number.isFinite(v.difficulty)||!Number.isFinite(v.reps)||!Number.isFinite(Date.parse(v.dueAt))))throw new Error('备份中存在异常复习状态');
 if(value.tables.review_logs.some(v=>!cards.has(v.cardId)||!Number.isFinite(Date.parse(v.reviewedAt))))throw new Error('备份中存在异常复习日志');
 if(value.tables.settings.some(v=>v.id==='preferences'&&(!Number.isSafeInteger(v.dailyNewGoal)||v.dailyNewGoal<0)))throw new Error('备份的每日新词数量无效');
 if(!value.tables.settings.some(v=>v.id==='preferences'))throw new Error('备份缺少用户设置');
 return {words:words.size,logs:value.tables.review_logs.length,decks:decks.size};
}
async function restoreBackup(backup){validateBackup(backup);await open();await transact(TABLES,'readwrite',tx=>{
 for(const n of TABLES){const store=tx.objectStore(n);store.clear();for(const record of backup.tables[n])store.put(record)}
});}
async function exportBackup(){return {app:'VocabFlow',formatVersion:2,algorithmVersion:'fsrs6-local-1',exportedAt:new Date().toISOString(),tables:await snapshot()}}
async function savePreferences(patch){const prev=await get('settings','preferences');const next={...prev,...patch,id:'preferences'};await put('settings',next);return next}
global.VFStorage={open,initialize,snapshot,all,get,put,beginSession,recordRating,undoLast,importDeck,readCSV,validateBackup,restoreBackup,exportBackup,savePreferences,uuid,DB_NAME,DB_VERSION};
})(window);
