/* VocabFlow Phase 2.5: minimalist learning UI. */
'use strict';
const DB=window.VFStorage, SCHED=window.VFFSRS, SELECT=window.VFSelection;
const state={route:'home',data:null,prefs:{dailyNewGoal:15,theme:'light',selectedDeckId:'starter',targetRetention:.9},learn:{kind:'review',sessionId:null,flipped:false,status:'ready',fromNew:false},spell:{sessionId:'optional_cloze',answerStatus:'prompt',entered:[],positions:[],maskKey:'',revealed:false},search:'',statsRange:7,toast:null,busy:false,cacheReady:false};
const NAV=[['home','学习总览','grid'],['learn','单词学习','book'],['spell','字母填空','keyboard'],['library','词库管理','library'],['stats','学习统计','chart'],['settings','设置','settings']];
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
function deckWords(){const map=lookup().words;return wordIds().map(id=>map.get(id)).filter(Boolean)}
function newDone(){const today=dayKey();return new Set((state.data?.review_logs||[]).filter(l=>l.mode==='recognition'&&(!l.before||l.before.reps===0)&&dayKey(new Date(l.reviewedAt))===today).map(l=>l.wordId)).size}
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
function header(){const name=state.data?.decks?.find(d=>d.id===state.prefs.selectedDeckId)?.name||'VocabFlow';return `<header class="topbar"><div class="breadcrumb"><strong>${esc(name)}</strong></div><div class="top-right"><span class="status-pill"><i class="status-dot"></i><span>${!navigator.onLine?'离线':state.cacheReady?'已缓存':'本地'}</span></span><button class="icon-btn" aria-label="切换主题" data-action="theme">${icon(state.prefs.theme==='dark'?'sun':'moon')}</button><button class="icon-btn" aria-label="打开设置" data-route="settings">${icon('settings')}</button><div class="avatar">VF</div></div></header>`}
function bottomNav(){return `<nav class="mobile-nav" aria-label="手机和平板竖屏导航">${NAV.filter(([r])=>r!=='settings').map(([r,n,ico])=>`<button data-route="${r}" class="${state.route===r?'active':''}">${icon(ico)}<span>${r==='home'?'首页':r==='learn'?'背词':r==='spell'?'填空':r==='library'?'词库':'统计'}</span></button>`).join('')}</nav>`}
function metric(label,value,foot,ico,color,progress=null){return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${color}">${icon(ico)}</span></div><div class="metric-value">${value}</div>${progress===null?'':`<div class="mini-progress"><span style="width:${Math.min(100,Math.max(0,progress))}%"></span></div>`}</article>`}
function chart(){const d=weeklyData(),max=Math.max(1,...d.map(x=>x.recognition+x.spelling+x.newWords));return `<div class="chart-area" aria-label="按真实记录统计的最近七日学习量">${d.map(x=>`<div class="chart-col"><div class="chart-bars"><span class="bar bar-primary" style="height:${Math.max(2,112*x.recognition/max)}px" title="认识复习 ${x.recognition} 次"></span><span class="bar bar-muted" style="height:${Math.max(2,112*x.spelling/max)}px" title="拼写 ${x.spelling} 次"></span></div><span class="chart-day">${x.label}</span></div>`).join('')}</div><div class="chart-footer"><div class="legend"><span><i style="background:#8695f7"></i>认识评价</span><span><i style="background:#d9def6"></i>字母填空</span></div><span class="subtle-hint">真实日志</span></div>`}
function forecastView(){const data=forecast(),max=Math.max(1,...data.map(x=>x.count));return `<div class="forecast">${data.map((x,i)=>`<div class="forecast-item"><em>${x.count}</em><div class="forecast-bar ${i===0?'today':''}" style="height:${Math.max(4,70*x.count/max)}px"></div><small>${x.label}</small></div>`).join('')}</div>`}
function goalEditor(location){return `<form data-form="goal" class="goal-inline" novalidate><label class="small-label" for="goal-${location}">每日新词</label><input class="input" id="goal-${location}" data-goal-input type="text" inputmode="numeric" autocomplete="off" value="${esc(state.prefs.dailyNewGoal)}" aria-label="每日新词目标，输入非负整数"><span class="small-label">个</span><button class="btn btn-secondary btn-sm" type="submit">保存</button></form>`}
function home(){const c=counts(),selection=state.data?.decks.find(d=>d.id===state.prefs.selectedDeckId);return `<div class="page-heading"><div><h1 class="page-title">学习总览</h1></div><div class="date-chip">${icon('calendar','icon-sm')} ${fmtDate(new Date())}</div></div>
<div class="metrics-grid">${metric('待复习',c.review,'已到期的认识卡片','repeat','lavender')}${metric('今日新词',`${c.newDone} <small style="font-size:17px;color:var(--muted)">/ ${state.prefs.dailyNewGoal}</small>`,c.newRemaining?'仍可学习 '+c.newRemaining+' 个新词':'今日新词目标已达到','book','mint',state.prefs.dailyNewGoal?100*c.newDone/state.prefs.dailyNewGoal:100)}${metric('字母填空',c.spell,'认识过的词可以自由巩固 · 不计入每日任务','keyboard','orange')}${metric('连续学习',`${streak()} <small style="font-size:16px;color:var(--muted)">天</small>`,'根据实际学习日志计算','flame','pink')}</div>
<div class="main-grid"><div class="section-stack"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">近 7 天</h2></div><span class="pill-header">学习趋势</span></div>${chart()}</section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">未来 7 天复习</h2></div>${icon('calendar')}</div>${forecastView()}</section></div><div class="section-stack"><section class="panel action-panel"><div class="start-intro"><div class="start-art">${icon('target','icon-xl')}</div><div><h3>开始学习</h3><p>新词先预习词义与音标，再进行记忆检测；新词完成后自动衔接旧词复习。</p></div></div><button class="btn btn-primary btn-full" data-action="start-new" ${!c.ongoingNew&&(!c.newRemaining||!newCandidates().length)?'disabled':''}>${icon('book','icon-sm')} ${c.ongoingNew?`继续新词 · 剩余 ${c.ongoingNew.pending.length} 张`:`学习新词 · ${newCandidates().length} 个`}</button><div class="action-secondary"><button class="btn btn-secondary" data-action="start-review" ${!c.review?'disabled':''}>${icon('repeat','icon-sm')} 复习 · ${c.review}</button><button class="btn btn-secondary" data-action="start-spell" ${!c.spell?'disabled':''}>${icon('keyboard','icon-sm')} 字母填空</button></div></section><section class="panel"><div class="panel-head" style="margin-bottom:16px"><div><h2 class="panel-title">每日新词目标</h2></div>${icon('edit')}</div>${goalEditor('home')}</section></div></div>`}
function focusHead(title,subtitle){return `<div class="focus-head"><button class="back-link" data-route="home" aria-label="返回首页">${icon('left','icon-sm')} 返回</button><div class="focus-label"><b>${title}</b>${subtitle?`<span>${subtitle}</span>`:''}</div><span class="focus-head-spacer" aria-hidden="true"></span></div>`}
function emptyFocus(title,desc,action='home'){return `<div class="empty-panel"><div class="empty-circle">${icon('check','icon-lg')}</div><h2>${title}</h2><button class="btn btn-primary" data-route="${action}">返回首页</button></div>`}
function currentSession(){return lookup().sessions.get(state.route==='spell'?state.spell.sessionId:state.learn.sessionId)}
function currentCard(){const ses=currentSession(),cardId=ses?.pending?.[0];if(!cardId)return null;const {cards,words}=lookup();const card=cards.get(cardId);return card?{...card,word:words.get(card.wordId)}:null}
function focusProgress(ses){const total=ses.completed+ses.pending.length;return `${ses.completed} / ${total}`}
function intro(){
 const ses=currentSession();
 if(!ses||ses.kind!=='new'||!ses.pending.length)return `<section class="focus-shell intro-shell">${focusHead('今日新词 · 初次见面','暂无待预习单词')}${emptyFocus('没有待预习的新词','请从首页重新选择今日新词。')}</section>`;
 const words=lookup().words, cards=lookup().cards;
 const list=ses.pending.map((cardId,i)=>{const card=cards.get(cardId),word=words.get(card?.wordId);if(!word)return '';
  return `<article class="intro-word" data-preview-word="${esc(word.id)}"><span class="intro-index">${i+1}</span><div class="intro-word-main"><strong>${esc(word.en)}</strong><span class="intro-pronunciation">${esc(word.ipa||'暂无音标')}</span><p><span class="intro-pos">${esc(word.pos||'')}</span> ${esc(word.cn)}</p></div><button class="intro-audio" data-action="audio" data-word-id="${esc(word.id)}" aria-label="播放 ${esc(word.en)} 发音">${icon('volume')}</button></article>`;
 }).join('');
 return `<section class="focus-shell intro-shell">${focusHead('今日新词 · 初次见面',`本批 ${ses.pending.length} 个 · ${newSelectionPolicy()==='priority-random'?'高频优先随机':'随机抽取'}`)}
 
 <div class="intro-list" aria-label="本批今日新词预习列表">${list}</div>
 <div class="intro-confirm"><button class="btn btn-primary" data-action="confirm-preview">开始记忆检测 ${icon('right','icon-sm')}</button></div>
 </section>`;
}
function learn(){const ses=currentSession();if(ses?.kind==='new'&&ses.stage!=='cards')return intro();if(!ses)return `<section class="focus-shell">${focusHead('认识模式','暂无任务')}${emptyFocus('尚未开始学习','请先在首页选择今日复习或新词任务。')}</section>`;const item=currentCard(),finished=!ses.pending.length;const progress=ses.completed+ses.pending.length?100*ses.completed/(ses.completed+ses.pending.length):100;
return `<section class="focus-shell">${focusHead(ses.kind==='new'?'新词检测':'旧词复习',`已完成 ${ses.completed}，待处理 ${finished?0:ses.pending.length}`)}<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
${finished?`${emptyFocus('当前学习任务已完成','所有已提交的评分都已保存；到期复习优先按记忆模型安排。')}${ses.undoEventId?`<div class="focus-help"><button class="btn btn-ghost btn-sm" data-action="undo">撤销上一次评分</button></div>`:''}`:item?.word?`<div class="flash-card" data-testid="flash-card"><h2 class="word">${esc(item.word.en)}</h2><div class="ipa">${esc(item.word.ipa)} <button class="icon-btn" data-action="audio" aria-label="英文发音">${icon('volume')}</button></div>${state.learn.flipped?`<div class="word-meaning">${esc(item.word.pos)} ${esc(item.word.cn)}</div>${item.word.ex?`<div class="word-example">${esc(item.word.ex)}</div>`:''}${item.word.cnEx?`<div class="word-example-cn">${esc(item.word.cnEx)}</div>`:''}${item.word.example?`<span class="chip">${esc(item.word.example)}</span>`:''}`:``}</div><div class="focus-actions">${!state.learn.flipped?`<button class="btn btn-primary btn-full" style="min-height:54px" data-action="flip">查看答案 ${icon('right','icon-sm')}</button>`:`<div class="rating-grid">${['忘记','困难','记得','简单'].map((r,i)=>`<button class="rating-btn ${ratingClasses[r]}" data-action="rate-learn" data-rating="${r}">${r}</button>`).join('')}</div>`}<div class="focus-help"><span>${!state.learn.flipped?'空格键翻卡':'请根据真实回忆难度评分'}</span><button class="btn btn-ghost btn-sm" data-action="undo" ${ses.undoEventId||state.learn.fromNew?'':'disabled'}>${icon('undo','icon-sm')} 撤销评分</button></div></div>`:emptyFocus('单词内容不可用','请检查词库后重新开始。')}
</section>`}
function spell(){
 const ses=currentSession();
 if(!ses)return `<section class="focus-shell">${focusHead('字母填空 · 自由练习','完全自愿')}${emptyFocus('还没有可练习的单词','先在认识模式中学习至少一个英文单词，再来做辅助巩固。')}</section>`;
 const item=currentCard(),status=state.spell.answerStatus,finished=!ses.pending.length;
 const progress=ses.completed+ses.pending.length?100*ses.completed/(ses.completed+ses.pending.length):100;
 return `<section class="focus-shell">${focusHead('字母填空',`本次已完成 ${ses.completed}，剩余 ${ses.pending.length} · 随时可退出`)}<div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
 ${finished?`${emptyFocus('本轮字母填空完成','练习结果已保存，适度影响单词的认识记忆；不增加每日新词或复习任务。')}${ses.undoEventId?`<div class="focus-help"><button class="btn btn-ghost btn-sm" data-action="undo">撤销上一次填空</button></div>`:''}`:item?.word?`
 <div class="spelling-prompt cloze-prompt"><h2>${esc(item.word.cn)}</h2><span class="pos-pill">${esc(item.word.pos||'英文词汇')}</span></div>
 <div class="cloze-workspace"><form data-form="spell" class="spelling-form cloze-form" autocomplete="off">
  <label class="input-caption" for="cloze-input-0">填写字母</label>
  ${clozeInputFields(item,ses)}
  
  ${status==='prompt'?`<div class="spell-buttons"><button type="submit" class="btn btn-primary">检查 ${icon('right','icon-sm')}</button><button type="button" class="btn btn-secondary" data-action="reveal-spell">查看答案</button></div>`:''}
 </form>
 ${status!=='prompt'?`<div class="result-box"><div class="result-title ${status==='correct'?'ok':'no'}">${icon(status==='correct'?'check':'x')} ${status==='correct'?'填空正确':'继续巩固一下'}</div>
 <p><strong>${esc(item.word.en)}</strong></p>
 <button class="btn ${status==='correct'?'btn-primary':'btn-secondary'} btn-full" data-action="commit-cloze" style="margin-top:14px">继续 ${icon('right','icon-sm')}</button></div>`:''}
 <div class="focus-help cloze-footer"><span>想休息可以随时返回首页，不影响每日新词进度。</span><button class="btn btn-ghost btn-sm" data-action="undo" ${ses.undoEventId?'':'disabled'}>${icon('undo','icon-sm')} 撤销上一次练习</button></div></div>`:emptyFocus('词条缺失','请检查当前词库是否完整。')}
 </section>`;
}

function libraryList(){const q=state.search.trim().toLowerCase();const list=deckWords().filter(w=>`${w.en} ${w.cn} ${w.pos}`.toLowerCase().includes(q));return list.slice(0,100).map(w=>`<div class="word-row"><div><b>${esc(w.en)}</b><br><small>${esc(w.ipa)}</small></div><span style="font-size:12px">${esc(w.pos)} ${esc(w.cn)}</span><span class="tiny-badge">${lookup().states.get(`recognition:${w.id}`)?.reps?'已学习':'未学习'}</span></div>`).join('')||`<div class="empty-panel" style="border:0;min-height:160px;margin:0"><p>没有找到匹配的词条。</p></div>`}
function library(){const relations=state.data.deck_words||[];return `<div class="page-heading"><div><h1 class="page-title">我的词库</h1></div></div><div class="deck-grid">${state.data.decks.map(deck=>{const count=relations.filter(r=>r.deckId===deck.id).length;return `<article class="deck-card"><div class="deck-top"><span class="metric-icon lavender">${icon('library')}</span><span class="tiny-badge">${deck.sample?'测试词书':'个人词书'}</span></div><h3>${esc(deck.name)}</h3><div class="goal-row" style="margin-top:18px"><span class="small-label">包含词条</span><strong class="goal-value">${count} 词</strong></div><button class="btn btn-full ${state.prefs.selectedDeckId===deck.id?'btn-primary':'btn-secondary'}" data-action="select-deck" data-deck="${esc(deck.id)}">${state.prefs.selectedDeckId===deck.id?'当前正在学习':'选择该词书'}</button></article>`}).join('')}</div><section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2 class="panel-title">导入词书</h2></div>${icon('upload')}</div><form data-form="import-deck" class="import-form"><label class="input-caption" for="deck-title">词书名称</label><input id="deck-title" class="input" required placeholder="例如：论文阅读术语" maxlength="100"><label class="input-caption" style="margin-top:14px" for="deck-file">选择 CSV 或 JSON 文件</label><input id="deck-file" class="input file-input" type="file" accept=".csv,.json,text/csv,application/json" required><button type="submit" class="btn btn-primary" style="margin-top:14px">导入词库并启用</button></form><p class="subtle-hint" style="margin-top:12px">词频 frequency 数值越大越优先；priority 数值越小越优先（也支持 high / medium / low）。分层内每天随机抽取，缺失数据则随机；请确保词库具有使用权限。</p></section><section class="panel" style="margin-top:18px"><div class="panel-head"><div><h2 class="panel-title">词汇检索</h2></div><span class="pill-header">${wordIds().length} 词</span></div><div class="search-bar">${icon('search')}<input id="word-search" class="input" type="search" autocomplete="off" placeholder="搜索英文或中文释义" value="${esc(state.search)}"></div><div class="word-list" id="word-results">${libraryList()}</div></section>`}
function stats(){const all=state.data.review_logs,unique=new Set(all.filter(l=>l.mode==='recognition'&&!l.before).map(l=>l.wordId)).size;const spell=all.filter(l=>l.mode==='spelling');const correct=spell.filter(l=>l.correct).length;const data=weeklyData(state.statsRange);const max=Math.max(1,...data.map(v=>v.recognition+v.spelling));return `<div class="page-heading"><div><h1 class="page-title">学习统计</h1></div></div><div class="stat-grid">${metric('已学单词',unique,'首次完成认识评分的词条','book','lavender')}${metric('字母填空正确率',spell.length?Math.round(100*correct/spell.length)+'%':'—',`正确 ${correct} / 总计 ${spell.length} 次`,'keyboard','mint')}${metric('连续学习',streak()+' 天','根据每天有无评分来统计','flame','orange')}</div><div class="main-grid" style="margin-top:20px"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">学习活动</h2></div><div class="demobox" style="margin:0"><button class="btn btn-sm ${state.statsRange===7?'btn-primary':'btn-secondary'}" data-action="range-7">近 7 天</button><button class="btn btn-sm ${state.statsRange===30?'btn-primary':'btn-secondary'}" data-action="range-30">近 30 天</button></div></div><div class="chart-area" style="height:175px;gap:${state.statsRange===30?'2px':'12px'}">${data.map(d=>`<div class="chart-col"><div class="chart-bars"><span class="bar bar-primary" style="height:${Math.max(2,105*d.recognition/max)}px;width:${state.statsRange===30?'6px':'13px'}"></span><span class="bar bar-muted" style="height:${Math.max(2,105*d.spelling/max)}px;width:${state.statsRange===30?'6px':'13px'}"></span></div>${state.statsRange===7?`<span class="chart-day">${d.label}</span>`:''}</div>`).join('')}</div><p class="subtle-hint" style="margin-top:17px">紫色：认识评分；浅色：可选字母填空。</p></section><section class="panel"><h2 class="panel-title">复习记录摘要</h2>${['忘记','困难','记得','简单'].map(r=>{const n=all.filter(l=>l.mode==='recognition'&&l.rating===r).length;return `<div style="margin-top:20px"><div class="goal-row"><span class="goal-text">${r}</span><strong class="goal-value">${n}</strong></div><div class="mini-progress"><span style="width:${all.filter(l=>l.mode==='recognition').length?100*n/all.filter(l=>l.mode==='recognition').length:0}%"></span></div></div>`}).join('')}</section></div>`}
function settings(){const p=state.prefs;return `<div class="page-heading"><div><h1 class="page-title">设置</h1></div></div><div class="settings-grid"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">学习偏好</h2></div>${icon('target')}</div><div class="setting-row"><div><strong>每日新词目标</strong><p>默认 15，可输入非负整数；0 为暂停新词。</p></div>${goalEditor('settings')}</div><div class="setting-row"><div><strong>FSRS 目标保留率</strong><p>当前 FSRS-6 调度目标，默认 90%。</p></div><span class="tiny-badge">90% · 暂定固定</span></div><div class="setting-row"><div><strong>每日新词抽取策略</strong><p>有优先级或词频：先在高优先级组内随机；否则从未学习词随机选择。抽出的批次会保存直到完成。</p></div><span class="tiny-badge">${newSelectionPolicy()==='priority-random'?'高频优先随机':'全词库随机'}</span></div><div class="setting-row"><div><strong>四档评价</strong><p>新词先看完整词表再以四档评价回忆；可选字母填空仅对认识状态轻度校正。</p></div><span class="tiny-badge">已启用</span></div></section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">外观与离线</h2></div>${icon('settings')}</div><div class="setting-row"><div><strong>深色模式</strong><p>跨启动保持主题偏好。</p></div><button class="switch ${p.theme==='dark'?'on':''}" role="switch" aria-checked="${p.theme==='dark'}" aria-label="切换深色模式" data-action="theme"></button></div><div class="setting-row"><div><strong>本地数据库</strong><p>${esc(DB.DB_NAME)} · 版本 ${DB.DB_VERSION}</p></div><span class="tiny-badge">IndexedDB</span></div><div class="setting-row"><div><strong>持久化存储</strong><p>尽量避免浏览器自动清理数据，仍需手动备份。</p></div><button class="btn btn-secondary btn-sm" data-action="persist-storage">申请权限</button></div></section><section class="panel" style="grid-column:1/-1"><div class="panel-head"><div><h2 class="panel-title">完整数据备份与恢复</h2></div>${icon('upload')}</div><div class="backup-actions"><button class="btn btn-primary" data-action="export-backup">${icon('upload','icon-sm')} 导出完整备份 JSON</button><label class="btn btn-secondary backup-file-label" for="backup-file">选择备份并恢复</label><input id="backup-file" class="visually-hidden" type="file" accept=".json,application/json"></div><p class="subtle-hint">调度算法版本：<strong>FSRS-6（本地实现）</strong>。可选字母填空采用小权重启发式修正（不是官方 FSRS 评分）；不会增加必做任务或提前改变到期日。</p></section></div>`}
function render(){if(!state.data)return;document.body.classList.toggle('theme-dark',state.prefs.theme==='dark');const focus=['learn','intro','spell'].includes(state.route);const content=state.route==='home'?home():state.route==='learn'?learn():state.route==='intro'?intro():state.route==='spell'?spell():state.route==='library'?library():state.route==='stats'?stats():settings();$('app').innerHTML=`<div class="app-shell ${focus?'focus-page':''}">${focus?'':sidebar()}<div class="main-frame">${focus?'':header()}<main id="main-content" class="content">${content}</main></div>${focus?'':bottomNav()}</div>${state.toast?`<div class="toast ${state.toast.error?'error':''}" role="status">${icon(state.toast.error?'alert':'check','icon-sm')} ${esc(state.toast.text)}</div>`:''}`}
async function start(kind,options={}){
 const prefix=kind==='new'?'recognition_new':kind==='review'?'recognition_review':'optional_cloze';
 const currentId=`${prefix}:${state.prefs.selectedDeckId}`;
 const local=await DB.get('sessions',currentId),legacy=await DB.get('sessions',prefix);
 const old=local?.pending?.length?local:legacy?.pending?.length&&legacy.deckId===state.prefs.selectedDeckId?legacy:null;
 const resume=!!old?.pending?.length;
 const sessionId=resume?old.id:currentId;
 let candidates=kind==='new'?newCandidates():kind==='review'?dueCards('recognition'):spellingCandidates();
 if(kind==='review'&&options.excludeNewIds?.length)candidates=candidates.filter(id=>!options.excludeNewIds.includes(id));
 if(!resume&&!candidates.length){if(!options.silent)toast(kind==='new'?'今天暂无可预习的新词。':kind==='cloze'?'还没有可填空的单词，先学习一些新词。':'目前没有到期旧词。',true);return false}
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
 const ses=currentSession();if(!ses||ses.kind!=='new')return;
 await DB.completeIntroduction(ses.id);
 state.learn.flipped=false;state.route='learn';await refresh();window.scrollTo(0,0);
}
async function saveGoal(form){const raw=form.querySelector('[data-goal-input]')?.value.trim();if(!/^\d+$/.test(raw||'')||!Number.isSafeInteger(Number(raw))){toast('请输入有效的非负整数，如 0、15 或 30。',true);return}await DB.savePreferences({dailyNewGoal:Number(raw)});await refresh();toast(`每日新词目标已保存为 ${raw} 个。`)}
async function setTheme(){const theme=state.prefs.theme==='dark'?'light':'dark';await DB.savePreferences({theme});await refresh()}
async function rate(mode,rating){
 if(mode!=='recognition')return;
 const ses=currentSession(),item=currentCard();if(!ses||!item||!state.learn.flipped)return;
 const result=await DB.recordRating({sessionId:ses.id,cardId:item.id,rating,correct:null,retention:state.prefs.targetRetention});
 state.learn.flipped=false;if(result.session.kind==='review')state.learn.fromNew=false;await refresh();
 if(result.session.kind==='new'&&!result.session.pending.length){
  const batch=result.session.batchCards||[...new Set((state.data?.review_logs||[]).filter(l=>l.sessionId===ses.id).map(l=>l.cardId))];
  const transitioned=await start('review',{silent:true,fromNew:true,fromNewSessionId:ses.id,excludeNewIds:batch});
  if(transitioned){toast('本批新词已进入记忆调度，接下来复习之前积攒的到期卡片。');return}
  toast('本批新词已进入等待时间，目前没有需要复习的旧词。');
 }
}
async function completeCloze(){
 const ses=currentSession(),item=currentCard();if(!ses||!item||state.spell.answerStatus==='prompt')return;
 const result=await DB.recordCloze({sessionId:ses.id,cardId:item.id,positions:state.spell.positions,answers:state.spell.entered,revealed:state.spell.revealed});
 state.spell.maskKey='';state.spell.entered=[];state.spell.positions=[];state.spell.answerStatus='prompt';state.spell.revealed=false;
 await refresh();
 toast(result.auxiliaryApplied?'已记录填空；对认识记忆作了轻度校正。':'已记录填空；该词今天不再重复校正模型。');
 // Allow the user to read the next prompt before raising the Android soft keyboard.
}
async function undo(){
 const ses=currentSession();
 if(ses?.kind==='review'&&state.learn.fromNew){
  const previous=await DB.undoLast(state.learn.fromNewSessionId||'recognition_new');
  if(previous){state.learn={kind:'new',sessionId:state.learn.fromNewSessionId||'recognition_new',flipped:true,status:'ready',fromNew:false,fromNewSessionId:null};state.route='learn';await refresh();toast('已撤销上一条新词评分。');return}
 }
 if(!ses?.undoEventId)return;
 const result=await DB.undoLast(ses.id);if(!result){toast('无法撤销：评分状态已改变。',true);return}
 if(state.route==='learn')state.learn.flipped=true;
 else{state.spell.maskKey='';state.spell.entered=[];state.spell.positions=[];state.spell.answerStatus='prompt';state.spell.revealed=false}
 await refresh();toast('上一条记录已撤销，记忆状态和日志同步恢复。');
}
function checkSpell(reveal=false){
 if(state.spell.answerStatus!=='prompt')return;
 const item=currentCard(),ses=currentSession();if(!item||!ses)return;
 const positions=ensureCloze(item,ses);
 const inputs=Array.from(document.querySelectorAll('[data-cloze-slot]'));
 state.spell.entered=positions.map((_,i)=>String(inputs[i]?.value||'').replace(/[^A-Za-z]/g,'').slice(0,1));
 if(!reveal&&state.spell.entered.some(a=>!a)){toast('请填写所有空格，也可以选择「不会，查看答案」。',true);return}
 const correct=!reveal&&positions.every((p,i)=>state.spell.entered[i].toLowerCase()===item.word.en[p].toLowerCase());
 state.spell.answerStatus=correct?'correct':'incorrect';state.spell.revealed=reveal;
 render();
}

function pronounce(wordId=null){const word=wordId?lookup().words.get(wordId):currentCard()?.word;if(!word)return;if(!('speechSynthesis' in window)){toast('当前浏览器没有可用的系统语音功能。',true);return}try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(word.en);u.lang='en-US';u.rate=.85;speechSynthesis.speak(u)}catch(e){toast('发音失败。系统语音服务不保证完全离线。',true)}}
async function selectDeck(id){if(!state.data.decks.some(d=>d.id===id))return;await DB.savePreferences({selectedDeckId:id});state.search='';await refresh();toast('已切换到所选词书。')}
function downloadJson(data,filename){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function importDeck(form){const f=form.querySelector('#deck-file')?.files?.[0],name=form.querySelector('#deck-title')?.value.trim();if(!f||!name)throw new Error('请填写词书名称，并选择文件。');if(f.size>20*1024*1024)throw new Error('单次词书导入限制 20 MB');const result=await DB.importDeck(name,await f.text(),f.name.toLowerCase().endsWith('.csv')?'csv':'json');state.search='';await refresh();toast(`导入成功：${result.count} 词，其中新增 ${result.added} 个词条。`)}
async function restoreFile(file){if(file.size>40*1024*1024)throw new Error('备份文件不能超过 40 MB');const data=JSON.parse(await file.text());const summary=DB.validateBackup(data);if(!confirm(`即将恢复完整备份：\n词书 ${summary.decks} 本、词条 ${summary.words} 个、复习记录 ${summary.logs} 条。\n\n这会覆盖当前设备的全部本地学习数据，确定继续吗？`))return;await DB.restoreBackup(data);state.route='home';await refresh();toast('完整备份已恢复。')}
$('app').addEventListener('click',ev=>{const route=ev.target.closest('[data-route]');if(route){const r=route.dataset.route;if(r==='learn')run(()=>start('review'));else if(r==='spell')run(()=>start('cloze'));else navigate(r);return}const btn=ev.target.closest('[data-action]');if(!btn||state.busy)return;const action=btn.dataset.action;switch(action){case 'theme':run(setTheme);break;case 'start-review':run(()=>start('review'));break;case 'start-new':run(()=>start('new'));break;case 'start-spell':run(()=>start('cloze'));break;case 'flip':state.learn.flipped=true;render();break;case 'confirm-preview':run(confirmIntroduction);break;case 'rate-learn':run(()=>rate('recognition',btn.dataset.rating));break;case 'commit-cloze':run(completeCloze);break;case 'undo':run(undo);break;case 'audio':pronounce(btn.dataset.wordId||null);break;case 'reveal-spell':checkSpell(true);break;case 'select-deck':run(()=>selectDeck(btn.dataset.deck));break;case 'range-7':state.statsRange=7;render();break;case 'range-30':state.statsRange=30;render();break;case 'export-backup':run(async()=>{downloadJson(await DB.exportBackup(),`VocabFlow_backup_${dayKey()}.json`);toast('备份文件已生成，请妥善保存。')});break;case 'persist-storage':run(async()=>{if(!navigator.storage?.persist)throw new Error('当前浏览器不支持持久化存储权限');const accepted=await navigator.storage.persist();toast(accepted?'浏览器已授予持久化存储权限。':'浏览器未授予权限，请定期导出备份。',!accepted)});break;default:break}});
$('app').addEventListener('submit',e=>{const form=e.target.closest('form');if(!form)return;e.preventDefault();if(form.dataset.form==='goal')run(()=>saveGoal(form));if(form.dataset.form==='import-deck')run(()=>importDeck(form));if(form.dataset.form==='spell')checkSpell(false)});
$('app').addEventListener('change',e=>{if(e.target.id==='backup-file'&&e.target.files?.[0])run(()=>restoreFile(e.target.files[0]))});
$('app').addEventListener('input',e=>{
 if(e.target.matches('[data-cloze-slot]')){
  const fields=Array.from(document.querySelectorAll('[data-cloze-slot]'));
  const idx=Number(e.target.dataset.clozeSlot),letter=String(e.target.value||'').replace(/[^A-Za-z]/g,'').slice(-1);
  e.target.value=letter;state.spell.entered[idx]=letter;
  if(letter&&fields[idx+1])fields[idx+1].focus();return;
 }
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
document.addEventListener('keydown',e=>{const focused=document.activeElement;const editable=focused?.matches?.('input,textarea,select,[contenteditable]');if(editable||e.altKey||e.metaKey)return;if(state.route!=='learn')return;if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();run(undo);return}if(e.code==='Space'&&!state.learn.flipped){e.preventDefault();state.learn.flipped=true;render();return}if(state.learn.flipped&&['1','2','3','4'].includes(e.key)){e.preventDefault();run(()=>rate('recognition',['忘记','困难','记得','简单'][Number(e.key)-1]))}});
(async()=>{try{await DB.initialize();await refresh();if('serviceWorker' in navigator&&/^(localhost|127\.0\.0\.1)$/.test(location.hostname)||('serviceWorker' in navigator&&location.protocol==='https:')){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{state.cacheReady=true;render()}).catch(e=>console.warn('PWA 离线资源注册失败：',e))}}catch(e){console.error(e);$('app').innerHTML=`<main class="empty-panel"><h2>无法启动本地数据库</h2><p>${esc(e.message||e)}</p><p>建议通过 localhost 或 HTTPS 访问，确认浏览器未禁用 IndexedDB。</p></main>`}})();
