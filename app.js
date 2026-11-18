/* VocabFlow Phase 2.5: minimal UI, original Phase 2.4 study logic. */
'use strict';
const DB=window.VFStorage, SCHED=window.VFFSRS, SELECT=window.VFSelection;
const state={route:'home',data:null,prefs:{dailyNewGoal:15,theme:'light',selectedDeckId:'starter',targetRetention:.9},learn:{kind:'review',sessionId:null,flipped:false,status:'ready',fromNew:false},spell:{sessionId:'optional_cloze',answerStatus:'prompt',entered:[],positions:[],maskKey:'',revealed:false},search:'',statsRange:7,toast:null,busy:false,cacheReady:false,editWordId:null,favoriteSearch:''};
const NAV=[['home','学习总览','grid'],['learn','单词学习','book'],['spell','字母填空','keyboard'],['favorites','我的收藏','star'],['library','词库管理','library'],['stats','学习统计','chart'],['settings','设置','settings']];
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=(name,extra='')=>`<svg class="svg-icon ${extra}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const dayKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const DAYS=['日','一','二','三','四','五','六'];
const addDays=(date,n)=>{const d=new Date(date);d.setDate(d.getDate()+n);return d};
const fmtDate=date=>new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(date);
const ratingClasses={'忘记':'again','困难':'hard','记得':'good','简单':'easy'};
const lookup=()=>{
 const d=state.data||{};
 return {words:new Map((d.words||[]).map(w=>[w.id,w])),cards:new Map((d.cards||[]).map(c=>[c.id,c])),states:new Map((d.review_states||[]).map(s=>[s.cardId,s])),sessions:new Map((d.sessions||[]).map(s=>[s.id,s]))};
};
function deckLinks(){return (state.data?.deck_words||[]).filter(r=>r.deckId===state.prefs.selectedDeckId).sort((a,b)=>a.order-b.order)}
function wordIds(){return [...new Set(deckLinks().map(r=>r.wordId))]}
function ongoingNewSession(){return (state.data?.sessions||[]).filter(s=>s.kind==='new'&&s.deckId===state.prefs.selectedDeckId&&s.pending?.length).sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0))[0]||null}
function newSelectionPolicy(){return SELECT.policy(deckLinks())}
function favoriteWords(){return (state.data?.words||[]).filter(w=>w.favorite).sort((a,b)=>String(b.favoriteAt||'').localeCompare(String(a.favoriteAt||''))||a.en.localeCompare(b.en))}
function favoriteBtn(word,extra=''){if(!word)return '';return `<button type="button" class="favorite-btn ${word.favorite?'active':''} ${extra}" data-action="toggle-favorite" data-word-id="${esc(word.id)}" aria-pressed="${!!word.favorite}" aria-label="${word.favorite?'取消收藏':'收藏单词'}" title="${word.favorite?'取消收藏':'收藏'}">${icon('star')}</button>`;}
function usageDetails(word){
 const parts=[];
 if(word.example)parts.push(`<div class="usage-phrase"><span>搭配</span>${esc(word.example)}</div>`);
 if(word.ex)parts.push(`<div class="usage-example">${esc(word.ex)}${word.cnEx?`<small>${esc(word.cnEx)}</small>`:''}</div>`);
 return parts.length?`<div class="usage-notes">${parts.join('')}</div>`:'';
}
function deckWords(){const map=lookup().words;return wordIds().map(id=>map.get(id)).filter(Boolean)}
function newDone(){const today=dayKey();return new Set((state.data?.review_logs||[]).filter(l=>l.kind==='new'&&l.mode==='recognition'&&(!l.before||l.before.reps===0)&&dayKey(new Date(l.reviewedAt))===today).map(l=>l.wordId)).size}
function newRemaining(){return Math.max(0,state.prefs.dailyNewGoal-newDone())}
function dueCards(mode){const m=lookup().states;const now=Date.now();return wordIds().map(id=>`${mode}:${id}`).filter(id=>{const s=m.get(id);return s?.reps>0&&Date.parse(s.dueAt)<=now}).sort((a,b)=>Date.parse(m.get(a).dueAt)-Date.parse(m.get(b).dueAt))}
function newCandidates(){return SELECT.choose(deckLinks(),lookup().states,newRemaining()).map(id=>`recognition:${id}`)}
function spellingCandidates(){
 const {states:m,words}=lookup(),ids=wordIds().filter(id=>m.get(`recognition:${id}`)?.reps>0);
 const logByWord=new Map();
 for(const l of state.data?.review_logs||[]){if(l.activity==='cloze'){
  const old=logByWord.get(l.wordId);if(!old||Date.parse(l.reviewedAt)>Date.parse(old.reviewedAt))logByWord.set(l.wordId,l);
 }}
 return ids.filter(id=>clozeEligible(words.get(id)?.en||'')).sort((a,b)=>{
  const x=logByWord.get(a),y=logByWord.get(b);
  const pri=z=>!z?1:z.correct?2:0;
  return pri(x)-pri(y)||(Date.parse(x?.reviewedAt||0)-Date.parse(y?.reviewedAt||0));
 }).slice(0,15).map(id=>`spelling:${id}`);
}
function clozeEligible(word){return (String(word||'').match(/[A-Za-z]/g)||[]).length>=3}
// Stable within the current session; changes with the day and card position.
function clozePositions(word,seed){
 const chars=String(word).split(''),all=chars.map((c,i)=>/[A-Za-z]/.test(c)?i:-1).filter(i=>i>=0);
 if(all.length<3)return [];
 const interior=all.filter(i=>i!==all[0]&&i!==all[all.length-1]);
 const candidates=interior.length?interior:all;
 const count=Math.min(4,candidates.length,Math.max(1,Math.round(all.length*.28)));
 let hash=2166136261;
 for(const c of String(seed)){hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0}
 const shuffle=[...candidates];
 for(let i=shuffle.length-1;i>0;i--){hash^=hash<<13;hash^=hash>>>17;hash^=hash<<5;const j=(hash>>>0)%(i+1);[shuffle[i],shuffle[j]]=[shuffle[j],shuffle[i]]}
 const chosen=[];
 for(const p of shuffle){if(chosen.length===count)break;if(chosen.every(q=>Math.abs(q-p)>1))chosen.push(p)}
 for(const p of shuffle){if(chosen.length===count)break;if(!chosen.includes(p))chosen.push(p)}
 return chosen.sort((a,b)=>a-b);
}
function ensureCloze(item,ses){
 const key=`${ses.id}|${item.id}|${ses.completed}|${dayKey()}`;
 if(state.spell.maskKey!==key){state.spell.maskKey=key;state.spell.positions=clozePositions(item.word.en,key);state.spell.entered=state.spell.positions.map(()=>'');state.spell.answerStatus='prompt';state.spell.revealed=false}
 return state.spell.positions;
}
function clozeInputFields(item,ses){
 const positions=ensureCloze(item,ses),idx=new Map(positions.map((p,i)=>[p,i])),status=state.spell.answerStatus;
 return `<div class="cloze-word" role="group" aria-label="${esc(item.word.en.length)} 字符单词的字母填空">${Array.from(item.word.en).map((c,p)=>{
  if(idx.has(p)){
   const i=idx.get(p),answer=state.spell.entered[i]||'',isWrong=status!=='prompt'&&answer.toLowerCase()!==c.toLowerCase();
   return `<input class="cloze-slot ${status==='prompt'?'':isWrong?'is-wrong':'is-correct'}" data-cloze-slot="${i}" id="cloze-input-${i}" aria-label="缺失的第 ${i+1} 个字母" maxlength="1" type="text" inputmode="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(answer)}" ${status==='prompt'?'':'disabled'}>`;
  }
  return c===' '?'<span class="cloze-space" aria-hidden="true"></span>':`<span class="cloze-letter">${esc(c)}</span>`;
 }).join('')}</div>`;
}

function counts(){return {review:dueCards('recognition').length,spell:spellingCandidates().length,newDone:newDone(),newRemaining:newRemaining(),total:wordIds().length,ongoingNew:ongoingNewSession()}}
function streak(){const set=new Set((state.data?.review_logs||[]).filter(l=>l.mode==='recognition').map(l=>dayKey(new Date(l.reviewedAt))));let d=new Date(),n=0;if(!set.has(dayKey(d)))d=addDays(d,-1);while(set.has(dayKey(d))){n++;d=addDays(d,-1)}return n}
function weeklyData(days=7){const logs=state.data?.review_logs||[];return Array.from({length:days},(_,i)=>{const d=addDays(new Date(),i-days+1),key=dayKey(d);const todays=logs.filter(l=>dayKey(new Date(l.reviewedAt))===key);return {label:`${d.getMonth()+1}/${d.getDate()}`,recognition:todays.filter(l=>l.mode==='recognition').length,spelling:todays.filter(l=>l.mode==='spelling').length,newWords:new Set(todays.filter(l=>l.mode==='recognition'&&(!l.before||!l.before.reps)).map(l=>l.wordId)).size}})}
function forecast(){const ids=new Set(wordIds());return Array.from({length:7},(_,i)=>{const target=addDays(new Date(),i);const key=dayKey(target);return {label:i===0?'今天':`${target.getMonth()+1}/${target.getDate()}`,count:(state.data?.review_states||[]).filter(s=>s.reps>0&&s.cardId.startsWith('recognition:')&&ids.has(s.cardId.split(':').slice(1).join(':'))&&dayKey(new Date(s.dueAt))===key).length}})}
function toast(text,error=false){state.toast={text,error};render();clearTimeout(toast.timer);toast.timer=setTimeout(()=>{state.toast=null;render()},3200)}
async function refresh(){state.data=await DB.snapshot();state.prefs=state.data.settings.find(x=>x.id==='preferences')||state.prefs;render()}
async function run(task){if(state.busy)return;state.busy=true;try{await task()}catch(e){console.error(e);toast(e?.message||'操作失败，请重试。',true)}finally{state.busy=false}}
function navigate(route){state.route=route;render();window.scrollTo(0,0)}
function sidebar(){return `<aside class="sidebar" aria-label="主导航"><div class="brand"><div class="brand-icon">${icon('book','icon-lg')}</div><div><h1>VocabFlow</h1></div></div><nav class="nav-list">${NAV.map(([r,n,ico])=>`<button data-route="${r}" class="nav-btn ${state.route===r?'active':''}" ${state.route===r?'aria-current="page"':''}>${icon(ico)}<span>${n}</span></button>`).join('')}</nav></aside>`}
function header(){const name=state.data?.decks?.find(d=>d.id===state.prefs.selectedDeckId)?.name||'VocabFlow';return `<header class="topbar"><div class="breadcrumb"><strong>${esc(name)}</strong></div><div class="top-right"><span class="status-pill" title="${!navigator.onLine?'离线运行':state.cacheReady?'离线资源已缓存':'本地学习数据'}"><i class="status-dot"></i><span>${!navigator.onLine?'离线':state.cacheReady?'已缓存':'本地'}</span></span><button class="icon-btn" aria-label="切换主题" data-action="theme">${icon(state.prefs.theme==='dark'?'sun':'moon')}</button><button class="icon-btn" aria-label="打开设置" data-route="settings">${icon('settings')}</button><div class="avatar">VF</div></div></header>`}
function bottomNav(){return `<nav class="mobile-nav" aria-label="手机和平板竖屏导航">${NAV.filter(([r])=>r!=='settings').map(([r,n,ico])=>`<button data-route="${r}" class="${state.route===r?'active':''}">${icon(ico)}<span>${r==='home'?'首页':r==='learn'?'背词':r==='spell'?'填空':r==='library'?'词库':r==='favorites'?'收藏':'统计'}</span></button>`).join('')}</nav>`}
function metric(label,value,ico,color,progress=null){return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon(ico)}</span></div><div class="metric-value">${value}</div>${progress===null?'':`<div class="mini-progress"><span style="width:${Math.min(100,Math.max(0,progress))}%"></span></div>`}</article>`}
function chart(){const d=weeklyData(),max=Math.max(1,...d.map(x=>x.recognition+x.spelling+x.newWords));return `<div class="chart-area" aria-label="最近七日学习量">${d.map(x=>`<div class="chart-col"><div class="chart-bars"><span class="bar bar-primary" style="height:${Math.max(2,112*x.recognition/max)}px" title="认识评分 ${x.recognition} 次"></span><span class="bar bar-muted" style="height:${Math.max(2,112*x.spelling/max)}px" title="填空 ${x.spelling} 次"></span></div><span class="chart-day">${x.label}</span></div>`).join('')}</div><div class="chart-footer"><div class="legend"><span><i style="background:#8695f7"></i>认识</span><span><i style="background:#d9def6"></i>填空</span></div></div>`}
function forecastView(){const data=forecast(),max=Math.max(1,...data.map(x=>x.count));return `<div class="forecast">${data.map((x,i)=>`<div class="forecast-item"><em>${x.count}</em><div class="forecast-bar ${i===0?'today':''}" style="height:${Math.max(4,70*x.count/max)}px"></div><small>${x.label}</small></div>`).join('')}</div>`}
function goalEditor(location){return `<form data-form="goal" class="goal-inline" novalidate><label class="visually-hidden" for="goal-${location}">每日新词目标</label><input class="input" id="goal-${location}" data-goal-input type="text" inputmode="numeric" autocomplete="off" value="${esc(state.prefs.dailyNewGoal)}" aria-label="每日新词数量"><span class="small-label">词/天</span><button class="btn btn-secondary btn-sm" type="submit">保存</button></form>`}
function home(){const c=counts();return `<div class="page-heading"><h1 class="page-title">学习总览</h1><div class="date-chip">${icon('calendar','icon-sm')} ${fmtDate(new Date())}</div></div>
<div class="metrics-grid">${metric('待复习',c.review,'repeat','lavender')}${metric('今日新词',`${c.newDone} <small style="font-size:17px;color:var(--muted)">/ ${state.prefs.dailyNewGoal}</small>`,'book','mint',state.prefs.dailyNewGoal?100*c.newDone/state.prefs.dailyNewGoal:100)}${metric('字母填空',c.spell,'keyboard','orange')}${metric('连续学习',`${streak()} <small style="font-size:16px;color:var(--muted)">天</small>`,'flame','pink')}</div>
<div class="main-grid"><div class="section-stack"><section class="panel"><div class="panel-head"><h2 class="panel-title">近 7 天</h2></div>${chart()}</section><section class="panel"><div class="panel-head"><h2 class="panel-title">未来 7 天复习</h2>${icon('calendar')}</div>${forecastView()}</section></div><div class="section-stack"><section class="panel action-panel"><div class="start-intro"><div class="start-art">${icon('target','icon-xl')}</div><h3>开始学习</h3></div><button class="btn btn-primary btn-full" data-action="start-new" ${!c.ongoingNew&&(!c.newRemaining||!newCandidates().length)?'disabled':''}>${icon('book','icon-sm')} ${c.ongoingNew?`继续新词 · ${c.ongoingNew.pending.length}`:`学习新词 · ${newCandidates().length}`}</button><div class="action-secondary"><button class="btn btn-secondary" data-action="start-review" ${!c.review?'disabled':''}>${icon('repeat','icon-sm')} 复习 · ${c.review}</button><button class="btn btn-secondary" data-action="start-spell" ${!c.spell?'disabled':''}>${icon('keyboard','icon-sm')} 字母填空</button></div></section><section class="panel"><div class="panel-head" style="margin-bottom:16px"><h2 class="panel-title">每日新词目标</h2>${icon('edit')}</div>${goalEditor('home')}</section></div></div>`}
function focusHead(title,subtitle=''){return `<div class="focus-head"><button class="back-link" data-route="home" aria-label="返回首页">${icon('left','icon-sm')} 返回</button><div class="focus-label"><b>${title}</b>${subtitle?`<span>${subtitle}</span>`:''}</div><span class="focus-head-spacer" aria-hidden="true"></span></div>`}
function emptyFocus(title,desc='',action='home'){return `<div class="empty-panel"><div class="empty-circle">${icon('check','icon-lg')}</div><h2>${title}</h2>${desc?`<p>${desc}</p>`:''}<button class="btn btn-primary" data-route="${action}">返回首页</button></div>`}
function currentSession(){return lookup().sessions.get(state.route==='spell'?state.spell.sessionId:state.learn.sessionId)}
function currentCard(){const ses=currentSession(),cardId=ses?.pending?.[0];if(!cardId)return null;const {cards,words}=lookup();const card=cards.get(cardId);return card?{...card,word:words.get(card.wordId)}:null}
function focusProgress(ses){const total=ses.completed+ses.pending.length;return `${ses.completed} / ${total}`}
function intro(){
 const ses=currentSession();
 if(!ses||!['new','favorite'].includes(ses.kind)||!ses.pending.length)return `<section class="focus-shell intro-shell">${focusHead('预习')}${emptyFocus('暂无预习单词')}</section>`;
 const words=lookup().words,cards=lookup().cards;
 const missing=ses.kind==='favorite'?ses.pending.filter(id=>!cards.get(id)?.introducedAt):ses.pending;
 const list=missing.map((cardId,i)=>{
  const card=cards.get(cardId),word=words.get(card?.wordId);if(!word)return '';
  return `<article class="intro-word"><span class="intro-index">${i+1}</span><div class="intro-word-main"><strong>${esc(word.en)}</strong><span class="intro-pronunciation">${esc(word.ipa||'')}</span><p>${esc(word.pos||'')} ${esc(word.cn)}</p></div>${favoriteBtn(word)}<button class="intro-audio" data-action="audio" data-word-id="${esc(word.id)}" aria-label="发音">${icon('volume')}</button></article>`;
 }).join('');
 return `<section class="focus-shell intro-shell">${focusHead(ses.kind==='favorite'?'收藏词预习':'今日新词',`${missing.length} 词`)}<div class="intro-list">${list}</div><div class="intro-confirm"><button class="btn btn-primary" data-action="confirm-preview">开始记忆检测 ${icon('right','icon-sm')}</button></div></section>`;
}
function learn(){
 const ses=currentSession();
 if(['new','favorite'].includes(ses?.kind)&&ses.stage!=='cards')return intro();
 if(!ses)return `<section class="focus-shell">${focusHead('背词')}${emptyFocus('暂无学习任务')}</section>`;
 const item=currentCard(),finished=!ses.pending.length,total=ses.completed+ses.pending.length;
 const progress=total?100*ses.completed/total:100;
 return `<section class="focus-shell">${focusHead(ses.kind==='new'?'新词检测':ses.kind==='favorite'?'收藏卡片':'旧词复习',`${ses.completed} / ${total}`)}<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
 ${finished?`${emptyFocus('学习完成')}${ses.undoEventId?`<div class="focus-help"><button class="btn btn-ghost btn-sm" data-action="undo">${icon('undo','icon-sm')} 撤销</button></div>`:''}`:item?.word?`<div class="flash-card" data-testid="flash-card">${favoriteBtn(item.word,'in-card')}<h2 class="word">${esc(item.word.en)}</h2><div class="ipa">${esc(item.word.ipa)} <button class="icon-btn" data-action="audio" aria-label="英文发音">${icon('volume')}</button></div>${state.learn.flipped?`<div class="word-meaning">${esc(item.word.pos)} ${esc(item.word.cn)}</div>${usageDetails(item.word)}`:''}</div><div class="focus-actions">${!state.learn.flipped?`<button class="btn btn-primary btn-full" style="min-height:54px" data-action="flip">查看释义 ${icon('right','icon-sm')}</button>`:`<div class="rating-grid">${['忘记','困难','记得','简单'].map(r=>`<button class="rating-btn ${ratingClasses[r]}" data-action="rate-learn" data-rating="${r}">${r}</button>`).join('')}</div>`}<div class="focus-help"><button class="btn btn-ghost btn-sm" data-action="undo" ${ses.undoEventId||state.learn.fromNew?'':'disabled'}>${icon('undo','icon-sm')} 撤销</button></div></div>`:emptyFocus('词条不可用')}
 </section>`;
}
function spell(){
 const ses=currentSession();
 if(!ses)return `<section class="focus-shell">${focusHead('字母填空')}${emptyFocus('暂无可练习单词')}</section>`;
 const item=currentCard(),status=state.spell.answerStatus,finished=!ses.pending.length,total=ses.completed+ses.pending.length;
 const progress=total?100*ses.completed/total:100;
 return `<section class="focus-shell">${focusHead('字母填空',`${ses.completed} / ${total}`)}<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
 ${finished?`${emptyFocus('本轮完成')}${ses.undoEventId?`<div class="focus-help"><button class="btn btn-ghost btn-sm" data-action="undo">${icon('undo','icon-sm')} 撤销</button></div>`:''}`:item?.word?`
 <div class="spelling-prompt cloze-prompt">${favoriteBtn(item.word,'in-cloze')}<h2>${esc(item.word.cn)}</h2>${item.word.pos?`<span class="pos-pill">${esc(item.word.pos)}</span>`:''}</div>
 <div class="cloze-workspace"><form data-form="spell" class="spelling-form cloze-form" autocomplete="off">
  <span class="visually-hidden">请填写缺失字母</span>
  ${clozeInputFields(item,ses)}
  ${status==='prompt'?`<div class="spell-buttons"><button type="submit" class="btn btn-primary">检查 ${icon('right','icon-sm')}</button><button type="button" class="btn btn-secondary" data-action="reveal-spell">查看答案</button></div>`:''}
 </form>
 ${status!=='prompt'?`<div class="result-box"><div class="result-title ${status==='correct'?'ok':'no'}">${icon(status==='correct'?'check':'x')} ${status==='correct'?'正确':'未填对'}</div>
 <p><strong>${esc(item.word.en)}</strong></p>${usageDetails(item.word)}
 <button class="btn ${status==='correct'?'btn-primary':'btn-secondary'} btn-full" data-action="commit-cloze" style="margin-top:14px">继续 ${icon('right','icon-sm')}</button></div>`:''}
 <div class="focus-help cloze-footer"><button class="btn btn-ghost btn-sm" data-action="undo" ${ses.undoEventId?'':'disabled'}>${icon('undo','icon-sm')} 撤销</button></div></div>`:emptyFocus('词条不可用')}
 </section>`;
}
function libraryList(){
 const q=state.search.trim().toLowerCase();
 const list=deckWords().filter(w=>`${w.en} ${w.cn} ${w.pos}`.toLowerCase().includes(q));
 return list.slice(0,100).map(w=>`<div class="word-row vf-word-row"><div><b>${esc(w.en)}</b><small>${esc(w.ipa||'')}</small></div><span class="vf-row-definition">${esc(w.pos)} ${esc(w.cn)}</span><div class="vf-row-actions">${favoriteBtn(w)}<button type="button" class="icon-btn" data-action="edit-word" data-word-id="${esc(w.id)}" aria-label="编辑用法" title="编辑用法">${icon('edit')}</button></div></div>`).join('')||`<div class="empty-panel">无匹配词条</div>`;
}
function favoriteList(){
 const q=state.favoriteSearch.trim().toLowerCase(),items=favoriteWords().filter(w=>`${w.en} ${w.cn} ${w.example||''}`.toLowerCase().includes(q));
 return items.map(w=>`<article class="favorite-row"><div class="favorite-main"><div><strong>${esc(w.en)}</strong><small>${esc(w.ipa||'')}</small><p>${esc(w.pos||'')} ${esc(w.cn)}</p></div><div class="vf-row-actions"><button class="icon-btn" data-action="audio" data-word-id="${esc(w.id)}" aria-label="发音">${icon('volume')}</button><button class="icon-btn" data-action="edit-word" data-word-id="${esc(w.id)}" aria-label="编辑例句">${icon('edit')}</button>${favoriteBtn(w)}</div></div>${usageDetails(w)}</article>`).join('')||`<div class="empty-panel"><h2>还没有收藏单词</h2></div>`;
}
function favorites(){
 const items=favoriteWords(),eligible=items.filter(w=>lookup().states.get(`recognition:${w.id}`)?.reps>0&&clozeEligible(w.en)).length;
 return `<div class="page-heading"><h1 class="page-title">我的收藏 · ${items.length}</h1></div><section class="panel favorite-panel"><div class="favorite-actions"><button class="btn btn-primary" data-action="start-favorite-review" ${items.length?'':'disabled'}>${icon('book','icon-sm')} 收藏卡片学习</button><button class="btn btn-secondary" data-action="start-favorite-cloze" ${eligible?'':'disabled'}>${icon('keyboard','icon-sm')} 字母填空 · ${eligible}</button></div><div class="search-bar">${icon('search')}<input class="input" id="favorite-search" type="search" placeholder="搜索收藏词" value="${esc(state.favoriteSearch)}"></div><div class="favorite-list" id="favorite-results">${favoriteList()}</div></section>`;
}
function editor(){
 const w=lookup().words.get(state.editWordId);if(!w)return '';
 return `<div class="vf-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="编辑单词用法" class="vf-modal"><div class="panel-head"><h2 class="panel-title">${esc(w.en)} · 用法</h2><button type="button" class="icon-btn" data-action="close-editor" aria-label="关闭">${icon('x')}</button></div><form data-form="word-usage" data-word-id="${esc(w.id)}"><label>常见搭配<input class="input" name="example" maxlength="250" value="${esc(w.example||'')}" placeholder="例如：depend on"></label><label>英文例句<textarea class="input" name="ex" maxlength="800" rows="3">${esc(w.ex||'')}</textarea></label><label>例句翻译<textarea class="input" name="cnEx" maxlength="800" rows="3">${esc(w.cnEx||'')}</textarea></label><div class="favorite-actions"><button class="btn btn-primary" type="submit">保存</button><button class="btn btn-secondary" type="button" data-action="close-editor">取消</button></div></form></section></div>`;
}
function library(){const relations=state.data.deck_words||[];return `<div class="page-heading"><h1 class="page-title">我的词库</h1></div><div class="deck-grid">${state.data.decks.map(deck=>{const count=relations.filter(r=>r.deckId===deck.id).length;return `<article class="deck-card"><div class="deck-top"><span class="metric-icon lavender">${icon('library')}</span><span class="tiny-badge">${deck.sample?'示例':'词书'}</span></div><h3>${esc(deck.name)}</h3><div class="goal-row" style="margin-top:18px"><strong class="goal-value">${count} 词</strong></div><button class="btn btn-full ${state.prefs.selectedDeckId===deck.id?'btn-primary':'btn-secondary'}" data-action="select-deck" data-deck="${esc(deck.id)}">${state.prefs.selectedDeckId===deck.id?'当前词书':'选择词书'}</button></article>`}).join('')}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><h2 class="panel-title">导入词书</h2>${icon('upload')}</div><form data-form="import-deck" class="import-form"><label class="input-caption" for="deck-title">词书名称</label><input id="deck-title" class="input" required placeholder="例如：六级核心词" maxlength="100"><label class="input-caption" style="margin-top:14px" for="deck-file">CSV / JSON 文件</label><input id="deck-file" class="input file-input" type="file" accept=".csv,.json,text/csv,application/json" required><button type="submit" class="btn btn-primary" style="margin-top:14px">导入并启用</button></form><details class="compact-help"><summary>导入格式</summary><p>必填 word、meaning；可选 ipa、pos、example、frequency、priority。词频越大越优先；数值优先级越小越优先。</p></details></section><section class="panel" style="margin-top:18px"><div class="panel-head"><h2 class="panel-title">词汇检索</h2><span class="pill-header">${wordIds().length} 词</span></div><div class="search-bar">${icon('search')}<input id="word-search" class="input" type="search" autocomplete="off" placeholder="搜索英文或中文释义" value="${esc(state.search)}"></div><div class="word-list" id="word-results">${libraryList()}</div></section>`}
function stats(){const all=state.data.review_logs,unique=new Set(all.filter(l=>l.mode==='recognition'&&!l.before).map(l=>l.wordId)).size;const spell=all.filter(l=>l.mode==='spelling');const correct=spell.filter(l=>l.correct).length;const data=weeklyData(state.statsRange);const max=Math.max(1,...data.map(v=>v.recognition+v.spelling));return `<div class="page-heading"><h1 class="page-title">学习统计</h1></div><div class="stat-grid">${metric('已学单词',unique,'book','lavender')}${metric('填空正确率',spell.length?Math.round(100*correct/spell.length)+'%':'—','keyboard','mint')}${metric('连续学习',streak()+' 天','flame','orange')}</div><div class="main-grid" style="margin-top:20px"><section class="panel"><div class="panel-head"><h2 class="panel-title">学习活动</h2><div class="demobox" style="margin:0"><button class="btn btn-sm ${state.statsRange===7?'btn-primary':'btn-secondary'}" data-action="range-7">7 天</button><button class="btn btn-sm ${state.statsRange===30?'btn-primary':'btn-secondary'}" data-action="range-30">30 天</button></div></div><div class="chart-area" style="height:175px;gap:${state.statsRange===30?'2px':'12px'}">${data.map(d=>`<div class="chart-col"><div class="chart-bars"><span class="bar bar-primary" title="认识评分 ${d.recognition} 次" style="height:${Math.max(2,105*d.recognition/max)}px;width:${state.statsRange===30?'6px':'13px'}"></span><span class="bar bar-muted" title="填空 ${d.spelling} 次" style="height:${Math.max(2,105*d.spelling/max)}px;width:${state.statsRange===30?'6px':'13px'}"></span></div>${state.statsRange===7?`<span class="chart-day">${d.label}</span>`:''}</div>`).join('')}</div><div class="chart-footer"><div class="legend"><span><i style="background:#8695f7"></i>认识</span><span><i style="background:#d9def6"></i>填空</span></div></div></section><section class="panel"><h2 class="panel-title">四档评分</h2>${['忘记','困难','记得','简单'].map(r=>{const n=all.filter(l=>l.mode==='recognition'&&l.rating===r).length;return `<div style="margin-top:20px"><div class="goal-row"><span class="goal-text">${r}</span><strong class="goal-value">${n}</strong></div><div class="mini-progress"><span style="width:${all.filter(l=>l.mode==='recognition').length?100*n/all.filter(l=>l.mode==='recognition').length:0}%"></span></div></div>`}).join('')}</section></div>`}
function settings(){const p=state.prefs;return `<div class="page-heading"><h1 class="page-title">设置</h1></div><div class="settings-grid"><section class="panel"><div class="panel-head"><h2 class="panel-title">学习偏好</h2>${icon('target')}</div><div class="setting-row"><strong>每日新词目标</strong>${goalEditor('settings')}</div><div class="setting-row"><strong>目标保留率</strong><span class="tiny-badge">90%</span></div><div class="setting-row"><strong>新词抽取</strong><span class="tiny-badge">${newSelectionPolicy()==='priority-random'?'高频优先随机':'随机'}</span></div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">外观与存储</h2>${icon('settings')}</div><div class="setting-row"><strong>深色模式</strong><button class="switch ${p.theme==='dark'?'on':''}" role="switch" aria-checked="${p.theme==='dark'}" aria-label="切换深色模式" data-action="theme"></button></div><div class="setting-row"><strong>持久化存储</strong><button class="btn btn-secondary btn-sm" data-action="persist-storage">申请权限</button></div></section><section class="panel" style="grid-column:1/-1"><div class="panel-head"><h2 class="panel-title">数据备份与恢复</h2>${icon('upload')}</div><div class="backup-actions"><button class="btn btn-primary" data-action="export-backup">${icon('upload','icon-sm')} 导出备份</button><label class="btn btn-secondary backup-file-label" for="backup-file">导入备份</label><input id="backup-file" class="visually-hidden" type="file" accept=".json,application/json"></div><p class="safety-note">恢复备份会覆盖本机学习数据。</p></section></div>`}
function render(){if(!state.data)return;document.body.classList.toggle('theme-dark',state.prefs.theme==='dark');const focus=['learn','intro','spell'].includes(state.route);const content=state.route==='home'?home():state.route==='learn'?learn():state.route==='intro'?intro():state.route==='spell'?spell():state.route==='library'?library():state.route==='favorites'?favorites():state.route==='stats'?stats():settings();$('app').innerHTML=`<div class="app-shell ${focus?'focus-page':''}">${focus?'':sidebar()}<div class="main-frame">${focus?'':header()}<main id="main-content" class="content">${content}</main></div>${focus?'':bottomNav()}</div>${state.editWordId?editor():''}${state.toast?`<div class="toast ${state.toast.error?'error':''}" role="status">${icon(state.toast.error?'alert':'check','icon-sm')} ${esc(state.toast.text)}</div>`:''}`}
async function start(kind,options={}){
 const prefix=kind==='new'?'recognition_new':kind==='review'?'recognition_review':'optional_cloze';
 const currentId=`${prefix}:${state.prefs.selectedDeckId}`;
 const local=await DB.get('sessions',currentId),legacy=await DB.get('sessions',prefix);
 const old=local?.pending?.length?local:legacy?.pending?.length&&legacy.deckId===state.prefs.selectedDeckId?legacy:null;
 const resume=!!old?.pending?.length;
 const sessionId=resume?old.id:currentId;
 let candidates=kind==='new'?newCandidates():kind==='review'?dueCards('recognition'):spellingCandidates();
 if(kind==='review'&&options.excludeNewIds?.length)candidates=candidates.filter(id=>!options.excludeNewIds.includes(id));
 if(!resume&&!candidates.length){if(!options.silent)toast(kind==='new'?'暂无新词':kind==='cloze'?'暂无可填空单词':'暂无到期复习',true);return false}
 const ses=resume?old:await DB.beginSession(sessionId,kind==='cloze'?'spelling':'recognition',kind,candidates,state.prefs.selectedDeckId);
 if(kind==='cloze'){
  state.spell={sessionId,answerStatus:'prompt',entered:[],positions:[],maskKey:'',revealed:false};state.route='spell';
 }else{
  state.learn={kind,sessionId,flipped:false,status:'ready',fromNew:!!options.fromNew,fromNewSessionId:options.fromNewSessionId||null};
  const hasMissingIntro=kind==='new'&&ses.pending.some(cardId=>!lookup().cards.get(cardId)?.introducedAt);
  state.route=kind==='new'&&(ses.stage!=='cards'||hasMissingIntro)?'intro':'learn';
 }
 await refresh();window.scrollTo(0,0);return true;
}
async function confirmIntroduction(){
 const ses=currentSession();if(!ses||!['new','favorite'].includes(ses.kind))return;
 await DB.completeIntroduction(ses.id);
 state.learn.flipped=false;state.route='learn';await refresh();window.scrollTo(0,0);
}

async function startFavorites(mode){
 const isCloze=mode==='cloze',sessionId=isCloze?'favorite_cloze':'favorite_review';
 const old=await DB.get('sessions',sessionId),resume=!!old?.pending?.length;
 const selected=favoriteWords().filter(w=>!isCloze||(lookup().states.get(`recognition:${w.id}`)?.reps>0&&clozeEligible(w.en)));
 const ids=selected.map(w=>`${isCloze?'spelling':'recognition'}:${w.id}`);
 if(!resume&&!ids.length){toast('暂无可练习的收藏词',true);return}
 const missing=!isCloze&&ids.some(id=>!lookup().cards.get(id)?.introducedAt);
 const ses=resume?old:await DB.beginSession(sessionId,isCloze?'spelling':'recognition',isCloze?'favorite_cloze':'favorite',ids,null,{stage:missing?'preview':'cards'});
 if(isCloze){state.spell={sessionId,answerStatus:'prompt',entered:[],positions:[],maskKey:'',revealed:false};state.route='spell'}
 else{state.learn={kind:'favorite',sessionId,flipped:false,status:'ready',fromNew:false};state.route=ses.stage==='preview'?'intro':'learn'}
 await refresh();window.scrollTo(0,0);
}
async function toggleFavorite(wordId){
 const item=lookup().words.get(wordId);if(!item)return;
 await DB.setFavorite(wordId,!item.favorite);await refresh();
}
async function saveUsage(form){
 const wordId=form.dataset.wordId;if(!wordId)return;
 const values=Object.fromEntries(['example','ex','cnEx'].map(k=>[k,form.elements.namedItem(k)?.value||'']));
 await DB.updateWordUsage(wordId,values);state.editWordId=null;await refresh();toast('用法已保存');
}

async function saveGoal(form){const raw=form.querySelector('[data-goal-input]')?.value.trim();if(!/^\d+$/.test(raw||'')||!Number.isSafeInteger(Number(raw))){toast('请输入非负整数',true);return}await DB.savePreferences({dailyNewGoal:Number(raw)});await refresh();toast('目标已保存')}
async function setTheme(){const theme=state.prefs.theme==='dark'?'light':'dark';await DB.savePreferences({theme});await refresh()}
async function rate(mode,rating){
 if(mode!=='recognition')return;
 const ses=currentSession(),item=currentCard();if(!ses||!item||!state.learn.flipped)return;
 const result=await DB.recordRating({sessionId:ses.id,cardId:item.id,rating,correct:null,retention:state.prefs.targetRetention});
 state.learn.flipped=false;if(result.session.kind==='review')state.learn.fromNew=false;await refresh();
 if(result.session.kind==='new'&&!result.session.pending.length){
  const batch=result.session.batchCards||[...new Set((state.data?.review_logs||[]).filter(l=>l.sessionId===ses.id).map(l=>l.cardId))];
  const transitioned=await start('review',{silent:true,fromNew:true,fromNewSessionId:ses.id,excludeNewIds:batch});
  if(transitioned){toast('新词完成，开始复习');return}
  toast('今日新词完成');
 }
}
async function completeCloze(){
 const ses=currentSession(),item=currentCard();if(!ses||!item||state.spell.answerStatus==='prompt')return;
 const result=await DB.recordCloze({sessionId:ses.id,cardId:item.id,positions:state.spell.positions,answers:state.spell.entered,revealed:state.spell.revealed});
 state.spell.maskKey='';state.spell.entered=[];state.spell.positions=[];state.spell.answerStatus='prompt';state.spell.revealed=false;
 await refresh();
 toast('练习已记录');
 // Allow the user to read the next prompt before raising the Android soft keyboard.
}
async function undo(){
 const ses=currentSession();
 if(ses?.kind==='review'&&state.learn.fromNew){
  const previous=await DB.undoLast(state.learn.fromNewSessionId||'recognition_new');
  if(previous){state.learn={kind:'new',sessionId:state.learn.fromNewSessionId||'recognition_new',flipped:true,status:'ready',fromNew:false,fromNewSessionId:null};state.route='learn';await refresh();toast('已撤销');return}
 }
 if(!ses?.undoEventId)return;
 const result=await DB.undoLast(ses.id);if(!result){toast('无法撤销',true);return}
 if(state.route==='learn')state.learn.flipped=true;
 else{state.spell.maskKey='';state.spell.entered=[];state.spell.positions=[];state.spell.answerStatus='prompt';state.spell.revealed=false}
 await refresh();toast('已撤销');
}
function checkSpell(reveal=false){
 if(state.spell.answerStatus!=='prompt')return;
 const item=currentCard(),ses=currentSession();if(!item||!ses)return;
 const positions=ensureCloze(item,ses);
 const inputs=Array.from(document.querySelectorAll('[data-cloze-slot]'));
 state.spell.entered=positions.map((_,i)=>String(inputs[i]?.value||'').replace(/[^A-Za-z]/g,'').slice(0,1));
 if(!reveal&&state.spell.entered.some(a=>!a)){toast('请填写全部空格',true);return}
 const correct=!reveal&&positions.every((p,i)=>state.spell.entered[i].toLowerCase()===item.word.en[p].toLowerCase());
 state.spell.answerStatus=correct?'correct':'incorrect';state.spell.revealed=reveal;
 render();
}

function pronounce(wordId=null){const word=wordId?lookup().words.get(wordId):currentCard()?.word;if(!word)return;if(!('speechSynthesis' in window)){toast('当前浏览器没有可用的系统语音功能。',true);return}try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(word.en);u.lang='en-US';u.rate=.85;speechSynthesis.speak(u)}catch(e){toast('发音失败。系统语音服务不保证完全离线。',true)}}
async function selectDeck(id){if(!state.data.decks.some(d=>d.id===id))return;await DB.savePreferences({selectedDeckId:id});state.search='';await refresh();toast('已切换词书')}
function downloadJson(data,filename){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function importDeck(form){const f=form.querySelector('#deck-file')?.files?.[0],name=form.querySelector('#deck-title')?.value.trim();if(!f||!name)throw new Error('请填写词书名称，并选择文件。');if(f.size>20*1024*1024)throw new Error('单次词书导入限制 20 MB');const result=await DB.importDeck(name,await f.text(),f.name.toLowerCase().endsWith('.csv')?'csv':'json');state.search='';await refresh();toast(`导入成功：${result.count} 词，其中新增 ${result.added} 个词条。`)}
async function restoreFile(file){if(file.size>40*1024*1024)throw new Error('备份文件不能超过 40 MB');const data=JSON.parse(await file.text());const summary=DB.validateBackup(data);if(!confirm(`即将恢复完整备份：\n词书 ${summary.decks} 本、词条 ${summary.words} 个、复习记录 ${summary.logs} 条。\n\n这会覆盖当前设备的全部本地学习数据，确定继续吗？`))return;await DB.restoreBackup(data);state.route='home';await refresh();toast('备份已恢复')}
$('app').addEventListener('click',ev=>{const route=ev.target.closest('[data-route]');if(route){const r=route.dataset.route;if(r==='learn')run(()=>start('review'));else if(r==='spell')run(()=>start('cloze'));else navigate(r);return}const btn=ev.target.closest('[data-action]');if(!btn||state.busy)return;const action=btn.dataset.action;switch(action){case 'theme':run(setTheme);break;case 'toggle-favorite':run(()=>toggleFavorite(btn.dataset.wordId));break;case 'edit-word':state.editWordId=btn.dataset.wordId;render();break;case 'close-editor':state.editWordId=null;render();break;case 'start-favorite-review':run(()=>startFavorites('review'));break;case 'start-favorite-cloze':run(()=>startFavorites('cloze'));break;case 'start-review':run(()=>start('review'));break;case 'start-new':run(()=>start('new'));break;case 'start-spell':run(()=>start('cloze'));break;case 'flip':state.learn.flipped=true;render();break;case 'confirm-preview':run(confirmIntroduction);break;case 'rate-learn':run(()=>rate('recognition',btn.dataset.rating));break;case 'commit-cloze':run(completeCloze);break;case 'undo':run(undo);break;case 'audio':pronounce(btn.dataset.wordId||null);break;case 'reveal-spell':checkSpell(true);break;case 'select-deck':run(()=>selectDeck(btn.dataset.deck));break;case 'range-7':state.statsRange=7;render();break;case 'range-30':state.statsRange=30;render();break;case 'export-backup':run(async()=>{downloadJson(await DB.exportBackup(),`VocabFlow_backup_${dayKey()}.json`);toast('备份已导出')});break;case 'persist-storage':run(async()=>{if(!navigator.storage?.persist)throw new Error('当前浏览器不支持持久化存储权限');const accepted=await navigator.storage.persist();toast(accepted?'权限已授予':'未获得权限，请定期备份',!accepted)});break;default:break}});
$('app').addEventListener('submit',e=>{const form=e.target.closest('form');if(!form)return;e.preventDefault();if(form.dataset.form==='goal')run(()=>saveGoal(form));if(form.dataset.form==='import-deck')run(()=>importDeck(form));if(form.dataset.form==='spell')checkSpell(false);if(form.dataset.form==='word-usage')run(()=>saveUsage(form))});
$('app').addEventListener('change',e=>{if(e.target.id==='backup-file'&&e.target.files?.[0])run(()=>restoreFile(e.target.files[0]))});
$('app').addEventListener('input',e=>{
 if(e.target.matches('[data-cloze-slot]')){
  const fields=Array.from(document.querySelectorAll('[data-cloze-slot]'));
  const idx=Number(e.target.dataset.clozeSlot),letter=String(e.target.value||'').replace(/[^A-Za-z]/g,'').slice(-1);
  e.target.value=letter;state.spell.entered[idx]=letter;
  if(letter&&fields[idx+1])fields[idx+1].focus();return;
 }
 if(e.target.id==='favorite-search'){state.favoriteSearch=e.target.value;const n=$('favorite-results');if(n)n.innerHTML=favoriteList();return}
 if(e.target.id==='word-search'){state.search=e.target.value;const n=$('word-results');if(n)n.innerHTML=libraryList()}
});
$('app').addEventListener('keydown',e=>{
 const field=e.target.closest?.('[data-cloze-slot]');if(!field)return;
 const fields=Array.from(document.querySelectorAll('[data-cloze-slot]')),idx=Number(field.dataset.clozeSlot);
 if(e.key==='Backspace'&&!field.value&&idx>0){e.preventDefault();fields[idx-1].value='';state.spell.entered[idx-1]='';fields[idx-1].focus()}
 if(e.key==='ArrowLeft'&&idx>0){e.preventDefault();fields[idx-1].focus()}
 if(e.key==='ArrowRight'&&idx<fields.length-1){e.preventDefault();fields[idx+1].focus()}
});
$('app').addEventListener('paste',e=>{
 const field=e.target.closest?.('[data-cloze-slot]');if(!field)return;
 const letters=(e.clipboardData?.getData('text')||'').replace(/[^A-Za-z]/g,'');if(!letters)return;
 e.preventDefault();const fields=Array.from(document.querySelectorAll('[data-cloze-slot]'));const at=Number(field.dataset.clozeSlot);
 for(let i=0;i<letters.length&&at+i<fields.length;i++){fields[at+i].value=letters[i];state.spell.entered[at+i]=letters[i]}
 fields[Math.min(fields.length-1,at+letters.length)]?.focus();
});
document.addEventListener('keydown',e=>{const focused=document.activeElement;const editable=focused?.matches?.('input,textarea,select,[contenteditable]');if(e.key==='Escape'&&state.editWordId){state.editWordId=null;render();return}if(editable||e.altKey||e.metaKey)return;if(state.route!=='learn')return;if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();run(undo);return}if(e.code==='Space'&&!state.learn.flipped){e.preventDefault();state.learn.flipped=true;render();return}if(state.learn.flipped&&['1','2','3','4'].includes(e.key)){e.preventDefault();run(()=>rate('recognition',['忘记','困难','记得','简单'][Number(e.key)-1]))}});
(async()=>{try{await DB.initialize();await DB.fillMissingUsage();await refresh();if('serviceWorker' in navigator&&/^(localhost|127\.0\.0\.1)$/.test(location.hostname)||('serviceWorker' in navigator&&location.protocol==='https:')){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{state.cacheReady=true;render()}).catch(e=>console.warn('PWA 离线资源注册失败：',e))}}catch(e){console.error(e);$('app').innerHTML=`<main class="empty-panel"><h2>无法启动本地数据库</h2><p>${esc(e.message||e)}</p><p>请使用 HTTPS 或 localhost，并允许本地存储。</p></main>`}})();
