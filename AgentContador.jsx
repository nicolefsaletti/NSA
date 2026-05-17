import { useState, useRef, useEffect } from "react";

// ── WEBHOOKS N8N (ponte para Airtable) ────────────────────────────────────────
const N8N_BASE = "https://nsalettiadvocacia.app.n8n.cloud/webhook";
const WH = {
  criar:      `${N8N_BASE}/contador-criar`,
  listar:     `${N8N_BASE}/contador-listar`,
  atualizar:  `${N8N_BASE}/contador-atualizar`,
  claude:     `${N8N_BASE}/contador-claude`,  // proxy seguro → chave fica no n8n
};

// ── FUNÇÕES DE ACESSO AO AIRTABLE VIA N8N ────────────────────────────────────
async function atCriar(tabela, campos) {
  const res = await fetch(WH.criar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabela, campos }),
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao criar registro`);
  return res.json();
}

async function atListar(tabela, filtro = "") {
  const res = await fetch(WH.listar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabela, filtro }),
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao listar`);
  return res.json();
}

async function atAtualizar(tabela, recordId, campos) {
  const res = await fetch(WH.atualizar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabela, recordId, campos }),
  });
  if (!res.ok) throw new Error(`Erro ${res.status} ao atualizar`);
  return res.json();
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────────────────────
const SYSTEM = `Você é o Contador Pessoal de um advogado autônomo brasileiro.
Você conversa, orienta, extrai dados e emite blocos de ação JSON para o app salvar no Airtable.

TABELAS (use a chave exata):
- "lancamentos" → Lançamentos
- "impostos"    → Impostos
- "notas"       → Notas Fiscais

CAMPOS — LANÇAMENTOS:
"Descrição" | "Data" (YYYY-MM-DD) | "Tipo" ("Receita"/"Despesa") | "Módulo" ("PJ"/"CPF")
"Valor (R$)" (número) | "Categoria" (Honorários/Assinaturas/Softwares/Transporte/Combustível/Despesas Pessoais/Tarifas Bancárias/INSS/GPS/DAS Simples/Outros)
"Competência" (YYYY-MM) | "Status" ("Confirmado"/"Pendente") | "Observação"

CAMPOS — IMPOSTOS:
"Descrição" | "Tipo" ("DAS - Simples Nacional"/"GPS - INSS Contribuinte"/"DARF"/"IRPF - Pessoa Física")
"Competência" (YYYY-MM) | "Faturamento Base (R$)" (número) | "Valor Calculado (R$)" (número)
"Vencimento" (YYYY-MM-DD) | "Data Pagamento" (YYYY-MM-DD) | "Status" ("Pendente"/"Pago"/"Atrasado")

CAMPOS — NOTAS FISCAIS:
"Número/Ref" | "Cliente" | "Data Emissão" (YYYY-MM-DD) | "Descrição do Serviço"
"Valor (R$)" (número) | "Competência" (YYYY-MM) | "Status" ("Emitida"/"Pendente"/"Cancelada")

DATAS — CRÍTICO:
- Campos date: SEMPRE YYYY-MM-DD. Ex: "2026-05-20"
- Competência: SEMPRE YYYY-MM. Ex: "2026-05"
- NUNCA DD/MM/YYYY

COMO EMITIR AÇÕES — formato exato, blocos ANTES do texto:

Criar:
%%ACAO%%{"op":"criar","tabela":"lancamentos","campos":{"Descrição":"...","Data":"YYYY-MM-DD","Tipo":"Receita","Módulo":"PJ","Valor (R$)":0.00,"Categoria":"Honorários","Competência":"YYYY-MM","Status":"Confirmado"}}%%FIM%%

Listar:
%%ACAO%%{"op":"listar","tabela":"lancamentos","filtro":""}%%FIM%%

Atualizar:
%%ACAO%%{"op":"atualizar","tabela":"impostos","recordId":"recXXXXXX","campos":{"Status":"Pago","Data Pagamento":"YYYY-MM-DD"}}%%FIM%%

REGRAS DE NEGÓCIO:
- Receita PJ → 2 blocos: criar em lancamentos + criar em impostos (DAS = valor×4,50%, vencimento dia 20 mês seguinte, Status "Pendente")
- GPS → criar em impostos (Tipo "GPS - INSS Contribuinte") + criar em lancamentos (Despesa, Categoria "INSS/GPS", Módulo "PJ")
- Dados incompletos → pergunte antes de emitir
- Ao listar → emita bloco listar, o app exibe os dados

PERFIL:
Advogado autônomo · Simples Nacional Anexo IV · ≤ R$10k/mês · DAS 4,50%
INSS via GPS separado do DAS (Anexo IV — diferença crucial)
Distribuição de lucros: ISENTA de IR

Responda em português. Tabelas markdown para dados. Blocos ANTES do texto.`;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function fmt(t) {
  t = t.replace(/%%ACAO%%[\s\S]*?%%FIM%%/g,"").trim();
  t = t.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\*(.*?)\*/g,"<em>$1</em>");
  const lines=t.split("\n"); const out=[]; let tbl="",inT=false;
  for(let i=0;i<lines.length;i++){
    const l=lines[i].trim();
    if(l.startsWith("|")&&l.endsWith("|")){
      if(!inT){inT=true;tbl="<table style='border-collapse:collapse;width:100%;margin:8px 0;font-size:12px'>";}
      if(/^[| -]+$/.test(l))continue;
      const cols=l.split("|").filter(c=>c.trim());
      const isH=lines[i+1]?.trim().replace(/[| -]/g,"")==="";
      const tag=isH?"th":"td";
      tbl+=`<tr>${cols.map(c=>`<${tag} style='padding:4px 8px;border:1px solid var(--color-border-tertiary);${tag==="th"?"font-weight:600;background:var(--color-background-secondary)":""}'>${c.trim()}</${tag}>`).join("")}</tr>`;
    } else {
      if(inT){out.push(tbl+"</table>");inT=false;tbl="";}
      out.push(l);
    }
  }
  if(inT)out.push(tbl+"</table>");
  t=out.join("\n");
  t=t.replace(/^[-•]\s(.+)$/gm,"<li style='margin:2px 0'>$1</li>");
  t=t.replace(/(<li.*?<\/li>\n?)+/g,m=>`<ul style='margin:6px 0;padding-left:18px'>${m}</ul>`);
  return t.replace(/\n/g,"<br/>");
}

function extrairAcoes(txt) {
  const re=/%%ACAO%%([\s\S]*?)%%FIM%%/g; const r=[]; let m;
  while((m=re.exec(txt))!==null){ try{r.push(JSON.parse(m[1].trim()));}catch{} }
  return r;
}

function moeda(v){ return `R$ ${Number(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`; }
function fmtData(d){ if(!d)return "—"; const [y,mo,dd]=(d+"").split("-"); return `${dd||"?"}/${mo||"?"}/${y||"?"}`; }

async function pdfB64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(",")[1]);
    r.onerror=rej; r.readAsDataURL(file);
  });
}

const TABLE_LABEL = { lancamentos:"Lançamentos", impostos:"Impostos", notas:"Notas Fiscais" };

// ── AÇÕES RÁPIDAS ─────────────────────────────────────────────────────────────
const ACOES = {
  pj:[
    {icon:"ti-paperclip",  label:"Enviar PDF",            p:"__PDF__"},
    {icon:"ti-coins",      label:"Registrar receita",     p:"Quero registrar honorários recebidos. Pergunte: de quem, quando e qual valor."},
    {icon:"ti-minus",      label:"Registrar despesa PJ",  p:"Quero registrar uma despesa do escritório."},
    {icon:"ti-calculator", label:"Calcular + salvar DAS", p:"Vou informar meu faturamento. Calcule o DAS e salve."},
    {icon:"ti-shield",     label:"Registrar GPS/INSS",    p:"Preciso registrar o GPS/INSS. Pergunte competência e valor."},
    {icon:"ti-file",       label:"Nova nota fiscal",      p:"Quero registrar uma nota fiscal emitida."},
    {icon:"ti-list",       label:"Ver lançamentos",       p:"Liste todos os lançamentos salvos."},
    {icon:"ti-bell",       label:"Impostos pendentes",    p:'Liste os impostos com Status "Pendente" ou "Atrasado".'},
  ],
  cpf:[
    {icon:"ti-paperclip",  label:"Enviar PDF",            p:"__PDF__"},
    {icon:"ti-minus",      label:"Despesa pessoal",       p:"Quero registrar uma despesa pessoal do CPF."},
    {icon:"ti-list",       label:"Ver despesas CPF",      p:'Liste os lançamentos com Módulo "CPF".'},
    {icon:"ti-coins",      label:"Distribuição de lucros",p:"Como funciona a distribuição de lucros isenta no Simples?"},
    {icon:"ti-file-text",  label:"Checklist IRPF",        p:"Gere checklist completo para o IRPF."},
    {icon:"ti-calculator", label:"Simular IRPF",          p:"Quero simular meu IRPF. Me faça as perguntas necessárias."},
  ],
};

// ── COMPONENTE ────────────────────────────────────────────────────────────────
export default function AgentContador(){
  const [mod,   setMod]   = useState("pj");
  const [msgs,  setMsgs]  = useState([{role:"assistant",
    content:"Olá! Agente Contador autônomo ✅\n\nConectado ao Airtable via **n8n** — sem token no browser, sem CORS, sem depender de nenhuma outra conversa.\n\n**Contabilidade NS Advocacia** pronta:\n- 📋 Lançamentos · 🧾 Impostos · 📄 Notas Fiscais\n\nPor onde quer começar?"}]);
  const [inp,   setInp]   = useState("");
  const [load,  setLoad]  = useState(false);
  const [pdfs,  setPdfs]  = useState([]);
  const [pdfErr,setPdfErr]= useState("");
  const [notifs,setNotifs]= useState([]);
  const endRef  = useRef(null);
  const fileRef = useRef(null);

  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs,load,notifs]);

  // Executa ações no Airtable via n8n
  const executar = async(acoes) => {
    const ns = [];
    for(const a of acoes){
      try{
        if(a.op==="criar"){
          await atCriar(a.tabela, a.campos);
          const desc = a.campos["Descrição"]||a.campos["Número/Ref"]||"registro";
          ns.push({ ok:true, msg:`✅ Salvo em **${TABLE_LABEL[a.tabela]||a.tabela}** — ${desc}` });
        } else if(a.op==="listar"){
          // BUG CORRIGIDO #3: variável renomeada de `data` para `resultado`
          // para não sombrear o helper `fmtData` (ex-`data`) do escopo externo
          const resultado = await atListar(a.tabela, a.filtro||"");
          const recs = Array.isArray(resultado) ? resultado : (resultado.records||[]);
          ns.push({ ok:true, op:"listar", tabela:a.tabela, records:recs,
            msg:`📋 **${TABLE_LABEL[a.tabela]}** — ${recs.length} registro(s)` });
        } else if(a.op==="atualizar"){
          await atAtualizar(a.tabela, a.recordId, a.campos);
          ns.push({ ok:true, msg:`✅ Atualizado em **${TABLE_LABEL[a.tabela]||a.tabela}**` });
        }
      }catch(e){
        ns.push({ ok:false, msg:`❌ Erro em ${TABLE_LABEL[a.tabela]||a.tabela}: ${e.message}` });
      }
    }
    return ns;
  };

  // Formata listagem como tabela para inserir no chat
  const fmtListagem = (ns) => {
    const listas = ns.filter(n=>n.op==="listar"&&n.ok&&n.records?.length>0);
    return listas.map(l=>{
      const rows = l.records.map(r=>{
        const f = r.fields||r;
        if(l.tabela==="lancamentos") return `| ${f["Descrição"]||"—"} | ${fmtData(f["Data"])} | ${f["Tipo"]||"—"} | ${f["Módulo"]||"—"} | ${moeda(f["Valor (R$)"])} | ${f["Status"]||"—"} |`;
        if(l.tabela==="impostos")    return `| ${f["Descrição"]||"—"} | ${fmtData(f["Vencimento"])} | ${moeda(f["Valor Calculado (R$)"])} | ${f["Status"]||"—"} |`;
        if(l.tabela==="notas")       return `| ${f["Número/Ref"]||"—"} | ${f["Cliente"]||"—"} | ${fmtData(f["Data Emissão"])} | ${moeda(f["Valor (R$)"])} | ${f["Status"]||"—"} |`;
        return "";
      }).join("\n");
      if(l.tabela==="lancamentos") return `**Lançamentos** (${l.records.length})\n| Descrição | Data | Tipo | Módulo | Valor | Status |\n|---|---|---|---|---|---|\n${rows}`;
      if(l.tabela==="impostos")    return `**Impostos** (${l.records.length})\n| Descrição | Vencimento | Valor | Status |\n|---|---|---|---|\n${rows}`;
      if(l.tabela==="notas")       return `**Notas Fiscais** (${l.records.length})\n| Nº/Ref | Cliente | Data | Valor | Status |\n|---|---|---|---|---|\n${rows}`;
      return "";
    }).join("\n\n");
  };

  const send = async(text) => {
    if(text==="__PDF__"){ fileRef.current?.click(); return; }
    if(!text.trim()&&pdfs.length===0) return;
    if(load) return;

    const pdfLabel = pdfs.length > 0 ? ` 📎 ${pdfs.map(p=>p.name).join(", ")}` : "";
    const display = pdfs.length > 0 ? `${text||"Analisar documento"}${pdfLabel}` : text;
    const hist = [...msgs, {role:"user",content:`[${mod.toUpperCase()}] ${display}`}];
    setMsgs(hist); setInp(""); setLoad(true); setNotifs([]);

    // Captura se há PDFs neste envio antes de limpar o estado
    const hasPdf = pdfs.length > 0;
    const capturedPdfs = [...pdfs];

    let apiContent;
    if(hasPdf){
      apiContent=[
        ...capturedPdfs.map(p=>({type:"document",source:{type:"base64",media_type:"application/pdf",data:p.b64}})),
        {type:"text",text:`Módulo: ${mod.toUpperCase()}. Arquivo(s): ${capturedPdfs.map(p=>`"${p.name}"`).join(", ")}. ${text||"Extraia todos os dados e prepare os registros para salvar."}`},
      ];
      setPdfs([]);
    } else {
      apiContent=`[${mod.toUpperCase()}] ${text}`;
    }

    const rawMsgs = hist.slice(0,-1)
      .map(m => ({ role: m.role, content: m.content }))
      .filter(m => {
        const c = typeof m.content === "string" ? m.content.trim() : "";
        return c !== "" && !c.startsWith("Erro:");
      });
    while (rawMsgs.length > 0 && rawMsgs[0].role !== "user") rawMsgs.shift();
    const normalized = [];
    for (const m of rawMsgs) {
      if (normalized.length === 0 || normalized[normalized.length-1].role !== m.role) {
        normalized.push(m);
      }
    }
    normalized.push({ role: "user", content: apiContent });
    const apiMsgs = normalized;

    try{
      // Chama o webhook n8n que faz o proxy seguro para a Anthropic.
      // A chave da API fica guardada no n8n — nunca exposta no browser.
      const res=await fetch(WH.claude,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          system:   SYSTEM,
          messages: apiMsgs,
          model:    "claude-sonnet-4-6",
          max_tokens: 4096,
          hasPdf,   // n8n usa para adicionar o header anthropic-beta quando necessário
        }),
      });

      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        throw new Error(`Proxy n8n ${res.status}: ${err?.error?.message||res.statusText}`);
      }

      const resData=await res.json();
      // n8n devolve a resposta da Anthropic diretamente — mesmo formato
      const resp=(resData.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();

      const acoes=extrairAcoes(resp);
      let extra="";
      if(acoes.length>0){
        setNotifs([{msg:"⏳ Salvando no Airtable via n8n..."}]);
        const ns=await executar(acoes);
        setNotifs(ns);
        extra=fmtListagem(ns);
      }

      const final=[resp,extra].filter(Boolean).join("\n\n");
      setMsgs(p=>[...p,{role:"assistant",content:final||"Processado."}]);
    }catch(e){
      setMsgs(p=>[...p,{role:"assistant",content:`Erro: ${e.message}`}]);
    }
    setLoad(false);
  };

  const handleFile=async(e)=>{
    const files=Array.from(e.target.files||[]); if(!files.length) return;
    const erros=[];
    const novos=[];
    for(const f of files){
      if(f.type!=="application/pdf"){erros.push(`${f.name}: apenas PDF`);continue;}
      if(f.size>4*1024*1024){erros.push(`${f.name}: máx 4MB`);continue;}
      try{novos.push({name:f.name,b64:await pdfB64(f)});}
      catch{erros.push(`${f.name}: erro ao ler`);}
    }
    setPdfErr(erros.join(" · "));
    if(novos.length>0) setPdfs(prev=>[...prev,...novos]);
    e.target.value="";
  };

  const cor=mod==="pj"?"#1D9E75":"#D85A30";

  return(
    <div style={{display:"flex",height:"660px",fontFamily:"var(--font-sans)",fontSize:"14px",
      color:"var(--color-text-primary)",background:"var(--color-background-primary)",
      borderRadius:"var(--border-radius-lg)",overflow:"hidden",
      border:"1px solid var(--color-border-tertiary)"}}>

      {/* SIDEBAR */}
      <div style={{width:"210px",borderRight:"1px solid var(--color-border-tertiary)",
        display:"flex",flexDirection:"column",background:"var(--color-background-secondary)",flexShrink:0}}>

        <div style={{padding:"13px 14px 10px",borderBottom:"1px solid var(--color-border-tertiary)"}}>
          <div style={{fontWeight:500,fontSize:"13px",display:"flex",alignItems:"center",gap:"7px"}}>
            <i className="ti ti-building" style={{fontSize:"15px",color:cor}} aria-hidden="true"/>
            Contador Pessoal
          </div>
          <div style={{fontSize:"10px",color:"var(--color-text-secondary)",marginTop:"2px"}}>
            Simples Nacional · Anexo IV · 4,50%
          </div>
          <div style={{display:"flex",gap:"10px",marginTop:"7px"}}>
            <span style={{fontSize:"10px",color:"#1D9E75",fontWeight:500}}>n8n ✓</span>
            <span style={{fontSize:"10px",color:"#1D9E75",fontWeight:500}}>Airtable ✓</span>
            <span style={{fontSize:"10px",color:"#1D9E75",fontWeight:500}}>PDF ✓</span>
          </div>
        </div>

        <div style={{padding:"10px 10px 6px"}}>
          <div style={{fontSize:"10px",fontWeight:500,color:"var(--color-text-secondary)",
            textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"6px"}}>Módulo ativo</div>
          <div style={{display:"flex",gap:"4px"}}>
            {[{id:"pj",c:"#1D9E75"},{id:"cpf",c:"#D85A30"}].map(m=>(
              <button key={m.id} onClick={()=>setMod(m.id)} style={{
                flex:1,padding:"7px 0",border:"1px solid",borderRadius:"6px",
                cursor:"pointer",fontSize:"12px",fontWeight:500,transition:"all 0.15s",
                background:mod===m.id?m.c:"transparent",
                color:mod===m.id?"#fff":"var(--color-text-secondary)",
                borderColor:mod===m.id?"transparent":"var(--color-border-tertiary)",
              }}>{m.id.toUpperCase()}</button>
            ))}
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"2px 8px 8px"}}>
          <div style={{fontSize:"10px",fontWeight:500,color:"var(--color-text-secondary)",
            textTransform:"uppercase",letterSpacing:"0.07em",margin:"4px 0 5px 2px"}}>Ações rápidas</div>
          {ACOES[mod].map(a=>(
            <button key={a.label} onClick={()=>send(a.p)} style={{
              display:"flex",alignItems:"center",gap:"8px",width:"100%",textAlign:"left",
              padding:"6px 8px",marginBottom:"1px",border:"none",borderRadius:"6px",
              background:a.icon==="ti-paperclip"?`${cor}18`:"transparent",
              color:a.icon==="ti-paperclip"?cor:"var(--color-text-secondary)",
              cursor:"pointer",fontSize:"12px",fontWeight:a.icon==="ti-paperclip"?500:400,
            }}
            onMouseEnter={e=>e.currentTarget.style.background=a.icon==="ti-paperclip"?`${cor}28`:"var(--color-background-tertiary)"}
            onMouseLeave={e=>e.currentTarget.style.background=a.icon==="ti-paperclip"?`${cor}18`:"transparent"}>
              <i className={`ti ${a.icon}`} style={{fontSize:"14px",color:cor,flexShrink:0}} aria-hidden="true"/>
              {a.label}
            </button>
          ))}
        </div>

        <div style={{padding:"10px 12px",borderTop:"1px solid var(--color-border-tertiary)"}}>
          <div style={{fontSize:"10px",fontWeight:500,color:"var(--color-text-secondary)",
            textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:"5px"}}>Vencimentos</div>
          {[["Dia 15","GPS/INSS"],["Dia 20","DAS Simples"],["31/mar","DEFIS"]].map(([d,n])=>(
            <div key={d} style={{display:"flex",gap:"6px",marginBottom:"4px",fontSize:"11px",
              color:"var(--color-text-secondary)",alignItems:"center"}}>
              <i className="ti ti-calendar" style={{fontSize:"11px"}} aria-hidden="true"/>
              <strong style={{color:"var(--color-text-primary)",fontWeight:500}}>{d}</strong>
              <span>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CHAT */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>

        <div style={{padding:"11px 16px",borderBottom:"1px solid var(--color-border-tertiary)",
          display:"flex",alignItems:"center",gap:"8px"}}>
          <div style={{width:"8px",height:"8px",borderRadius:"50%",background:cor}}/>
          <span style={{fontWeight:500,fontSize:"13px"}}>
            {mod==="pj"?"Módulo PJ — Escritório de Advocacia":"Módulo CPF — Pessoa Física"}
          </span>
          <div style={{marginLeft:"auto",display:"flex",gap:"10px",alignItems:"center"}}>
            <a href="https://airtable.com/appV7rbMF0jYZOZPW" target="_blank" rel="noopener noreferrer"
              style={{fontSize:"11px",color:cor,textDecoration:"none",display:"flex",alignItems:"center",gap:"4px",fontWeight:500}}>
              <i className="ti ti-external-link" style={{fontSize:"12px"}} aria-hidden="true"/>Airtable
            </a>
            <button onClick={()=>{setMsgs([msgs[0]]);setNotifs([]);}} style={{background:"none",border:"none",
              color:"var(--color-text-secondary)",cursor:"pointer",fontSize:"12px",
              display:"flex",alignItems:"center",gap:"4px"}}>
              <i className="ti ti-refresh" style={{fontSize:"13px"}} aria-hidden="true"/>Limpar
            </button>
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"16px 14px"}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{marginBottom:"12px",display:"flex",flexDirection:"column",
              alignItems:m.role==="user"?"flex-end":"flex-start"}}>
              {m.role==="assistant"&&(
                <div style={{fontSize:"10px",color:"var(--color-text-secondary)",marginBottom:"3px",paddingLeft:"2px"}}>Contador Pessoal</div>
              )}
              <div style={{
                maxWidth:"92%",padding:"10px 13px",lineHeight:"1.65",fontSize:"13px",
                borderRadius:m.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px",
                background:m.role==="user"?cor:"var(--color-background-secondary)",
                color:m.role==="user"?"#fff":"var(--color-text-primary)",
                border:m.role==="assistant"?"1px solid var(--color-border-tertiary)":"none",
              }}
              dangerouslySetInnerHTML={{__html:fmt(m.content.replace(/^\[(PJ|CPF)\] /,""))}}
              />
            </div>
          ))}

          {notifs.length>0&&(
            <div style={{marginBottom:"10px"}}>
              {notifs.map((n,i)=>(
                <div key={i} style={{fontSize:"12px",padding:"5px 10px",borderRadius:"6px",marginBottom:"4px",
                  background:n.msg?.startsWith("❌")?"#fff5f5":n.msg?.startsWith("⏳")?"var(--color-background-secondary)":"#f0faf5",
                  color:n.msg?.startsWith("❌")?"#c53030":n.msg?.startsWith("⏳")?"var(--color-text-secondary)":"#276749",
                  border:`1px solid ${n.msg?.startsWith("❌")?"#fed7d7":n.msg?.startsWith("⏳")?"var(--color-border-tertiary)":"#c6f6d5"}`}}
                dangerouslySetInnerHTML={{__html:fmt(n.msg||"")}}
                />
              ))}
            </div>
          )}

          {load&&(
            <div style={{display:"flex",alignItems:"center",gap:"8px",
              color:"var(--color-text-secondary)",fontSize:"12px",marginBottom:"8px"}}>
              <div style={{display:"flex",gap:"3px"}}>
                {[0,1,2].map(j=>(<div key={j} style={{width:"5px",height:"5px",borderRadius:"50%",
                  background:cor,animation:`pulse 1s ${j*0.2}s infinite`}}/>))}
              </div>
              Processando...
            </div>
          )}
          <div ref={endRef}/>
        </div>

        {pdfs.length>0&&(
          <div style={{padding:"6px 14px 0",display:"flex",flexDirection:"column",gap:"3px"}}>
            {pdfs.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 10px",
                borderRadius:"8px",background:`${cor}15`,border:`1px solid ${cor}40`,fontSize:"12px"}}>
                <i className="ti ti-file-type-pdf" style={{fontSize:"15px",color:cor,flexShrink:0}} aria-hidden="true"/>
                <span style={{color:cor,fontWeight:500,flex:1,overflow:"hidden",
                  textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                <button onClick={()=>setPdfs(prev=>prev.filter((_,j)=>j!==i))}
                  style={{background:"none",border:"none",color:"var(--color-text-secondary)",cursor:"pointer",padding:0}}>
                  <i className="ti ti-x" style={{fontSize:"13px"}} aria-hidden="true"/>
                </button>
              </div>
            ))}
          </div>
        )}
        {pdfErr&&<div style={{padding:"4px 14px 0",fontSize:"11px",color:"#e53e3e"}}>{pdfErr}</div>}

        <div style={{padding:"10px 14px 12px",borderTop:"1px solid var(--color-border-tertiary)"}}>
          <div style={{display:"flex",gap:"8px",alignItems:"flex-end"}}>
            <button onClick={()=>fileRef.current?.click()} title="Enviar PDF"
              style={{padding:"9px 11px",border:"1px solid var(--color-border-tertiary)",
                borderRadius:"var(--border-radius-md)",background:"transparent",
                color:cor,cursor:"pointer",fontSize:"16px",flexShrink:0,display:"flex",alignItems:"center"}}>
              <i className="ti ti-paperclip" aria-hidden="true"/>
            </button>
            <textarea value={inp} onChange={e=>setInp(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send(inp);}}}
              placeholder={pdfs.length>0?"Instrução para os documentos (ou Enter para analisar)..."
                :mod==="pj"?"Ex: Recebi R$ 8.000 de honorários da ABC em maio/2026..."
                :"Ex: Paguei R$ 800 de plano de saúde em 10/04/2026..."}
              rows={2} style={{flex:1,padding:"9px 12px",
                border:"1px solid var(--color-border-tertiary)",
                borderRadius:"var(--border-radius-md)",resize:"none",fontSize:"13px",
                fontFamily:"var(--font-sans)",color:"var(--color-text-primary)",
                background:"var(--color-background-secondary)",outline:"none",lineHeight:"1.5"}}
            />
            <button onClick={()=>send(inp)} disabled={load||(!inp.trim()&&pdfs.length===0)} style={{
              padding:"9px 14px",border:"none",borderRadius:"var(--border-radius-md)",
              background:cor,color:"#fff",fontSize:"14px",flexShrink:0,transition:"opacity 0.15s",
              cursor:load||(!inp.trim()&&pdfs.length===0)?"not-allowed":"pointer",
              opacity:load||(!inp.trim()&&pdfs.length===0)?0.4:1}}>
              <i className="ti ti-send" aria-hidden="true"/>
            </button>
          </div>
          <div style={{fontSize:"11px",color:"var(--color-text-secondary)",marginTop:"5px"}}>
            Enter para enviar · 📎 Múltiplos PDFs aceitos · Salva via n8n → Airtable automaticamente
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple
        onChange={handleFile} style={{display:"none"}}/>
      <style>{`@keyframes pulse{0%,100%{opacity:.2}50%{opacity:1}}textarea:focus{border-color:${cor}!important;box-shadow:0 0 0 2px ${cor}22}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:var(--color-border-tertiary);border-radius:2px}`}</style>
    </div>
  );
}
