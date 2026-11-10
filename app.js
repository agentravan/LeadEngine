const cfg = window.LEADENGINE_SUPABASE;
const db = supabase.createClient(cfg.url, cfg.publishableKey);
const $ = id => document.getElementById(id);
const stages = ["New Leads","Contacted","Qualified","Demo Scheduled","Closed/Won","Lost"];
let user = null, leads = [], campaigns = [];
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function toast(s){$("toast").textContent=s;$("toast").classList.remove("hidden");setTimeout(()=>$("toast").classList.add("hidden"),3500);}
function page(p){["dashboard","search","leads","pipeline","campaigns","outreach"].forEach(x=>$("page-"+x).classList.toggle("hidden",x!==p));if(p==="outreach"&&window.drawOutreach)window.drawOutreach();if(p==="leads")drawLeads();if(p==="pipeline")drawKanban("kanban");if(p==="campaigns")drawCampaigns();}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>page(b.dataset.page)));
async function authAction(mode){
 const email=$("authEmail").value.trim(),password=$("authPassword").value;
 if(!email||password.length<8){$("authMsg").textContent="Enter a valid email and password of at least 8 characters.";return;}
 $("authMsg").textContent="Please wait…";
 const {data,error}=mode==="signup"?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
 if(error){$("authMsg").textContent=error.message;return;}
 if(mode==="signup"&&!data.session){$("authMsg").textContent="Account created. Check your email to confirm, then sign in.";return;}
 user=data.user;await startApp();
}
async function startApp(){
 if(!user){$("authScreen").classList.remove("hidden");return;}
 $("authScreen").classList.add("hidden");$("logoutBtn").classList.remove("hidden");
 await refresh();
}
async function refresh(){
 const [l,c]=await Promise.all([
  db.from("leads").select("*").order("created_at",{ascending:false}),
  db.from("campaigns").select("*").order("created_at",{ascending:false})
 ]);
 if(l.error||c.error){toast((l.error||c.error).message);return;}
 leads=l.data||[];campaigns=c.data||[];drawDashboard();drawLeads();drawKanban("dashKanban");
}
async function search(){
 const b=$("searchBtn");b.disabled=true;$("searchMsg").textContent="Searching OpenStreetMap…";
 try{
  const niche=$("niche").value.trim(),location=$("location").value.trim(),city=$("city").value.trim(),limit=Math.min(100,Math.max(1,Number($("limit").value)||50));
  const response=await fetch("/api/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({niche,location,limit})});
  const result=await response.json().catch(()=>({error:"Search service returned an invalid response."}));
  if(!response.ok)throw Error(result.error||"Business search failed (HTTP "+response.status+").");
  const elements=result.elements||[];
  const rows=elements.flatMap(item=>{
   const t=item.tags||{},name=t.name||t.brand||t.operator;if(!name)return [];
   const address=["addr:housenumber","addr:street","addr:suburb","addr:neighbourhood","addr:city","addr:postcode"].map(k=>t[k]).filter(Boolean).join(", ");
   const website=t.website||t["contact:website"]||"",email=t.email||t["contact:email"]||"",phone=t.phone||t["contact:phone"]||"",social=t["contact:instagram"]||t.instagram||t["contact:facebook"]||t.facebook;
   const score=(website?0:45)+(social?0:25)+(email?0:10);
   return [{owner_id:user.id,source_id:"osm:"+item.type+":"+item.id,name,category:niche,city,area:location,address,phone,website,email,profile_url:"https://www.openstreetmap.org/"+item.type+"/"+item.id,source:"OpenStreetMap",score,priority:score>=60?"High":score>=30?"Medium":"Low"}];
  });
  if(rows.length){const {error}=await db.from("leads").upsert(rows,{onConflict:"owner_id,source_id",ignoreDuplicates:true});if(error)throw error;}
  const {error:ce}=await db.from("campaigns").insert({owner_id:user.id,niche,location,count:rows.length});if(ce)throw ce;
  $("searchMsg").textContent="Found "+rows.length+" records. Refreshing…";await refresh();page("leads");
 }catch(e){$("searchMsg").textContent="Search failed";toast(e.message||"Unexpected error");}finally{b.disabled=false;}
}
function drawDashboard(){
 const n=leads.length,won=leads.filter(x=>x.status==="Closed/Won").length;
 $("total").textContent=n;$("newCount").textContent=leads.filter(x=>x.status==="New Leads").length;
 $("qualified").textContent=leads.filter(x=>["Qualified","Demo Scheduled"].includes(x.status)).length;
 $("hot").textContent=leads.filter(x=>x.priority==="High").length;$("conversion").textContent=n?Math.round(won/n*100)+"%":"—";
 $("sourceOSM").textContent=leads.filter(x=>x.source==="OpenStreetMap").length;$("sourceManual").textContent=leads.filter(x=>x.source==="Manual").length;$("sourceWeb").textContent=leads.filter(x=>x.website).length;
 $("recent").innerHTML=leads.slice(0,8).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td>${esc(x.area||x.city)}</td><td>${x.score}</td><td>${esc(x.status)}</td><td><button class="btn" onclick="openLead('${x.id}')">Open</button></td></tr>`).join("");
 drawKanban("dashKanban");
}
function drawLeads(){
 const q=($("q").value||"").toLowerCase(),st=$("statusFilter").value,min=Number($("minScore").value||0);
 const a=leads.filter(x=>(!q||[x.name,x.address,x.area,x.phone].join(" ").toLowerCase().includes(q))&&(!st||x.status===st)&&x.score>=min);
 $("leadRows").innerHTML=a.map(x=>`<tr><td><b>${esc(x.name)}</b><br>${esc(x.category)}</td><td>${esc(x.address||x.area||x.city)}</td><td>${esc(x.phone||"—")}</td><td>${x.website?'<a target="_blank" rel="noopener" href="'+esc(x.website)+'">Open</a>':"Not listed"}</td><td>${x.score} ${esc(x.priority)}</td><td><select class="filter" onchange="changeStatus('${x.id}',this.value)">${stages.map(s=>'<option '+(s===x.status?'selected':'')+'>'+s+'</option>').join("")}</select></td><td><button class="btn" onclick="openLead('${x.id}')">View / Hook</button></td></tr>`).join("");
 $("leadEmpty").classList.toggle("hidden",a.length>0);
}
function drawKanban(id){$(id).innerHTML=stages.map(s=>`<div class="lane" ondragover="event.preventDefault()" ondrop="dropCard(event,'${s}')"><h3>${s} (${leads.filter(x=>x.status===s).length})</h3>${leads.filter(x=>x.status===s).map(x=>`<div class="leadcard" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${x.id}')"><b>${esc(x.name)}</b><small>${esc(x.category)} · ${x.score} pts</small></div>`).join("")}</div>`).join("");}
async function changeStatus(id,status){const {error}=await db.from("leads").update({status}).eq("id",id);if(error){toast(error.message);return;}const x=leads.find(v=>v.id===id);if(x)x.status=status;drawDashboard();drawLeads();drawKanban("kanban");}
async function dropCard(e,status){e.preventDefault();await changeStatus(e.dataTransfer.getData("text/plain"),status);}
function openLead(id){
 const x=leads.find(v=>v.id===id);if(!x)return;
 $("modal").innerHTML=`<div class="modalbg"><div class="modal"><button class="btn" onclick="document.getElementById('modal').innerHTML=''">Close</button><h2>${esc(x.name)}</h2><p>${esc(x.category)} · ${esc(x.address||x.area||x.city)}</p><p>Phone: ${esc(x.phone||"Not listed")}</p><p>Website: ${esc(x.website||"Not listed")}</p><p>Score: ${x.score} · ${esc(x.priority)}</p><label class="field">Service to pitch<input id="service" value="website, SEO and online bookings"></label><label class="field">Demo URL<input id="demo" placeholder="https://demo.example"></label><button class="btn primary" onclick="makeHook('${x.id}')">Generate short hook</button><textarea id="hook" class="filter" placeholder="Review your message before sending"></textarea><div class="row"><button class="btn" onclick="sendDraft('${x.id}')">Open WhatsApp draft</button><a class="btn" target="_blank" rel="noopener" href="${esc(x.profile_url||"#")}">Source record</a></div><label class="field">Notes<textarea id="leadNotes" class="filter">${esc(x.notes||"")}</textarea></label><button class="btn" onclick="saveNotes('${x.id}')">Save notes</button><p class="muted">WhatsApp opens a prefilled message; review and press Send yourself.</p></div></div>`;
}
function makeHook(id){const x=leads.find(v=>v.id===id);if(!x)return;const missing=x.website?"booking flow":"website";const demo=$("demo").value.trim();$("hook").value=`Hi ${x.name} team — I found your ${x.category.toLowerCase()} listing in ${x.area||x.city}. Have you considered a simple ${missing} to turn more local searches into enquiries? I can share a quick idea for ${$("service").value}.${demo?" Demo: "+demo:""}`;}
function sendDraft(id){const x=leads.find(v=>v.id===id),m=$("hook").value.trim(),digits=(x?.phone||"").replace(/\D/g,"");if(!m||!digits){toast(!m?"Generate a hook first.":"No public phone number is available.");return;}window.open("https://wa.me/"+digits+"?text="+encodeURIComponent(m),"_blank","noopener");}
async function saveNotes(id){const {error}=await db.from("leads").update({notes:$("leadNotes").value}).eq("id",id);if(error){toast(error.message);return;}const x=leads.find(v=>v.id===id);if(x)x.notes=$("leadNotes").value;toast("Notes saved.");}
function drawCampaigns(){$("campaignRows").innerHTML=campaigns.map(x=>`<tr><td>${esc(x.niche)}</td><td>${esc(x.location)}</td><td>${x.count}</td><td>${esc(x.status)}</td><td>${new Date(x.created_at).toLocaleString()}</td></tr>`).join("");}
function exportCSV(){const keys=["name","category","city","area","address","phone","website","email","rating","reviews","score","priority","status","source","profile_url"];const lines=[keys.join(",")].concat(leads.map(x=>keys.map(k=>'"'+String(x[k]??"").replace(/"/g,'""')+'"').join(",")));const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\r\n")],{type:"text/csv;charset=utf-8"}));a.download="leadengine.csv";a.click();URL.revokeObjectURL(a.href);}
$("signInBtn").onclick=()=>authAction("signin");$("signUpBtn").onclick=()=>authAction("signup");
$("logoutBtn").onclick=async()=>{await db.auth.signOut();user=null;leads=[];campaigns=[];$("authScreen").classList.remove("hidden");$("logoutBtn").classList.add("hidden");};
$("searchBtn").onclick=search;$("export").onclick=exportCSV;$("export2").onclick=exportCSV;
["q","statusFilter","minScore"].forEach(k=>$(k).addEventListener("input",drawLeads));
window.openLead=openLead;window.makeHook=makeHook;window.sendDraft=sendDraft;window.changeStatus=changeStatus;window.dropCard=dropCard;window.saveNotes=saveNotes;
db.auth.onAuthStateChange((_event,session)=>{user=session?.user||null;if(user)startApp();});
db.auth.getSession().then(({data})=>{user=data.session?.user||null;startApp();});
