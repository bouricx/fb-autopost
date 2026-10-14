let localToken='', jobs=[], editing=null;
const $=s=>document.querySelector(s);
const labels={queued:'รอเวลา',running:'กำลังโพสต์',sent:'โพสต์แล้ว',failed:'ไม่สำเร็จ',uncertain:'ต้องตรวจสอบเพจ',cancelled:'ยกเลิกแล้ว'};
function notice(text){$('#notice').textContent=text;}
async function api(path,method='GET',body){
 const r=await fetch(path,{method,headers:{'Content-Type':'application/json','X-Local-Token':localToken},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error(typeof data.detail==='string'?data.detail:'กรุณาตรวจข้อมูลที่กรอก');return data;
}
function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn){const b=node('button',text,'secondary');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();await refresh();}catch(e){notice(e.message);}finally{b.disabled=false;}};return b;}
async function refresh(){
 const data=await api('/api/state');localToken=data.local_token;jobs=data.jobs;$('#connection').textContent='โปรแกรมเชื่อมต่อแล้ว';
 const select=$('#composer select');const chosen=select.value;select.replaceChildren();$('#pages').replaceChildren();
 for(const p of data.pages){const o=node('option',p.name+' · '+p.id);o.value=p.id;select.append(o);const row=node('div','','page');row.append(node('span',p.name),button('ตัดการเชื่อมต่อ',()=>api('/api/pages/'+p.id,'DELETE')));$('#pages').append(row);}
 if([...select.options].some(o=>o.value===chosen))select.value=chosen;
 $('#jobs').replaceChildren();$('#count').textContent='('+jobs.length+')';
 if(!jobs.length)$('#jobs').append(node('p','ยังไม่มีงานในคิว'));
 for(const j of jobs){const box=node('div','','job');box.append(node('span',labels[j.status]||j.status,'status '+j.status),node('small',j.page_id+' · '+new Date(j.scheduled_at).toLocaleString()),node('p',j.message));if(j.link)box.append(node('small',j.link));if(j.error)box.append(node('small',j.error));if(j.result_id)box.append(node('small','Post ID: '+j.result_id));
 if(j.status==='queued'){box.append(button('แก้ไข',()=>{editing=j.id;const f=$('#composer');for(const k of ['page_id','message','link'])f.elements[k].value=j[k];const d=new Date(j.scheduled_at);f.elements.scheduled_at.value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);$('#composer-title').textContent='แก้ไขโพสต์';$('#save').textContent='บันทึกการแก้ไข';f.scrollIntoView({behavior:'smooth'});}),button('ยกเลิก',()=>api('/api/jobs/'+j.id+'/cancel','POST')));}
 if(['failed','uncertain','cancelled'].includes(j.status))box.append(button('ลองโพสต์อีกครั้ง',()=>{if(confirm('ตรวจสอบเพจแล้วว่าโพสต์นี้ยังไม่ถูกส่ง? การลองใหม่จะส่งทันที'))return api('/api/jobs/'+j.id+'/retry','POST');}));$('#jobs').append(box);}
}
function reset(){editing=null;$('#composer').reset();$('#composer-title').textContent='สร้างโพสต์ใหม่';$('#save').textContent='เพิ่มเข้าคิว';const d=new Date(Date.now()+300000);$('#composer input[type=datetime-local]').value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
$('#reset').onclick=reset;
$('#account').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('/api/pages','POST',Object.fromEntries(new FormData(e.target)));e.target.elements.token.value='';notice('เชื่อมต่อเพจแล้ว');await refresh();}catch(err){notice(err.message);}finally{b.disabled=false;}};
$('#composer').onsubmit=async e=>{e.preventDefault();const b=$('#save');b.disabled=true;try{const body=Object.fromEntries(new FormData(e.target));body.scheduled_at=new Date(body.scheduled_at).toISOString();await api(editing?'/api/jobs/'+editing:'/api/jobs',editing?'PUT':'POST',body);reset();notice('บันทึกงานแล้ว');await refresh();}catch(err){notice(err.message);}finally{b.disabled=false;}};
$('#export').onclick=()=>{const rows=jobs.map(({page_id,message,link,scheduled_at,status,result_id})=>({page_id,message,link,scheduled_at,status,result_id}));const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fb-autopost-export.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>200000)throw Error('ไฟล์ใหญ่เกิน 200 KB');await api('/api/import','POST',{text:await f.text()});notice('นำเข้าแล้ว');await refresh();}catch(err){notice(err.message);}finally{e.target.value='';}};
reset();refresh().catch(e=>notice(e.message));setInterval(()=>refresh().catch(()=>{$('#connection').textContent='โปรแกรมขาดการเชื่อมต่อ';}),7000);

$('#discover').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const result=await api('/api/discover','POST',{token:e.target.elements.token.value});e.target.elements.token.value='';$('#found-pages').replaceChildren();for(const p of result.pages){const row=node('div','','page');row.append(node('span',p.name),button('เลือกเพจนี้',async()=>{await api('/api/select/'+p.id,'POST');notice('เชื่อมต่อ '+p.name+' แล้ว');}));$('#found-pages').append(row);}if(!result.pages.length)notice('ไม่พบเพจ ตรวจสิทธิ์ pages_show_list และบทบาทดูแลเพจ');}catch(err){notice(err.message);}finally{b.disabled=false;}};
$('#now').onclick=()=>{if(!confirm('หลังจากกดเพิ่มเข้าคิว งานจะส่งทันที ยืนยันหรือไม่?'))return;const d=new Date();$('#composer input[type=datetime-local]').value=new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);notice('พร้อมโพสต์ทันที ตรวจข้อความแล้วกดเพิ่มเข้าคิว');};
