// Dashboard integrado à planilha pública da CEPDEC/ES.
const SHEET_CSV_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vRrVz9Az5ASfD8yRWvGucRJpQ2JgP9Ih679bE21TmrLZX75SsxG2vzXpItf6CZ6ESqK0UUVJz2UfWfT/pub?gid=1636387945&single=true&output=csv';
const REFRESH_INTERVAL_MS=5*60*1000;

/* =========================================================
   STATE
   - filters[key].available = universo de valores possíveis
   - filters[key].selected  = valores marcados pelo usuário
   ========================================================= */
const state={
  raw:[],filtered:[],charts:{},cols:{},lastUpdated:0,
  filters:{
    ano:      { available:[], selected:[] },
    curso:    { available:[], selected:[] },
    municipio:{ available:[], selected:[] },
    sexo:     { available:[], selected:[] }
  }
};

const chartsCfg={font:"'Manrope', sans-serif", text:'#e9edf7', textSoft:'#c2cae0', grid:'rgba(148,163,196,.12)', gridStrong:'rgba(148,163,196,.18)'};

/* ===== Color system =====
 * - Year-based palette used across bar charts (Município, Curso, Estado, Defesa-bar)
 *   so the same year keeps the same color in every chart.
 * - Pizza charts: modern diagonal gradients per slice.
 */
const YEAR_PALETTE = [
  {solid:'#3b82f6', g1:'#3b82f6', g2:'#06b6d4'},   // Blue → Cyan
  {solid:'#f59e0b', g1:'#f59e0b', g2:'#ef4444'},   // Amber → Red
  {solid:'#10b981', g1:'#10b981', g2:'#84cc16'},   // Emerald → Lime
  {solid:'#8b5cf6', g1:'#8b5cf6', g2:'#ec4899'},   // Violet → Pink
  {solid:'#06b6d4', g1:'#06b6d4', g2:'#6366f1'},   // Cyan → Indigo
  {solid:'#fb7185', g1:'#fb7185', g2:'#fb923c'},   // Rose → Orange
];

// Pie/Doughnut diagonal gradient palette (modern)
// Terceira cor é um degradê cinza/prata para diferenciar do azul e rosa
const PIE_GRADIENTS = [
  ['#3b82f6','#06b6d4'],  // Blue → Cyan (Masculino)
  ['#ec4899','#f59e0b'],  // Pink → Amber (Feminino)
  ['#6b7280','#9ca3af'],  // Cinza → Prata (Pref. não dizer)
  ['#10b981','#84cc16'],  // Emerald → Lime
  ['#f43f5e','#fb923c'],  // Rose → Orange
];

function makeDiagonalGradient(ctx, area, c1, c2){
  if(!area) return c1;
  const g = ctx.createLinearGradient(area.left, area.top, area.right, area.bottom);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
}
function makeBarGradient(ctx, area, c1, c2, vertical=true){
  if(!area) return c1;
  const g = vertical
    ? ctx.createLinearGradient(0, area.top, 0, area.bottom)
    : ctx.createLinearGradient(area.left, 0, area.right, 0);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  return g;
}
// Year → palette index (stable: index in sorted unique year list)
function yearColor(yearList, year){
  const idx = yearList.indexOf(year);
  return YEAR_PALETTE[(idx<0?0:idx) % YEAR_PALETTE.length];
}

const els={
  uploadScreen:document.getElementById('uploadScreen'),dashboard:document.getElementById('dashboard'),
  statusCard:document.getElementById('statusCard'),statusTitle:document.getElementById('statusTitle'),
  statusMessage:document.getElementById('statusMessage'),retryBtn:document.getElementById('retryBtn'),
  fileBadge:document.getElementById('fileBadge'),refreshBtn:document.getElementById('refreshBtn'),
  filterGrid:document.getElementById('filterGrid'),
  kpiParticipantes:document.getElementById('kpiParticipantes'),kpiCertificado:document.getElementById('kpiCertificado'),
  kpiDeclarado:document.getElementById('kpiDeclarado'),kpiCursos:document.getElementById('kpiCursos'),
  kpiEstados:document.getElementById('kpiEstados'),kpiMunicipios:document.getElementById('kpiMunicipios'),
  sexoMasc:document.getElementById('sexoMasc'),sexoFem:document.getElementById('sexoFem'),sexoNd:document.getElementById('sexoNd')
};
const filterDefs=[['ano','Ano'],['curso','Curso'],['municipio','Município'],['sexo','Gênero']];

function n(v){return (v??'').toString().trim()}
function u(v){return n(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function fmt(v){return new Intl.NumberFormat('pt-BR').format(v||0)}
function pct(v,t){return t?((v/t)*100).toFixed(1).replace('.',',')+'%':'0,0%'}
function inferColumns(headers){const map={};headers.forEach(h=>{const x=u(h);if(x==='NOME')map.nome=h;if(x==='CPF')map.cpf=h;if(x.includes('SEXO'))map.sexo=h;if(x==='CURSO')map.curso=h;if(x==='ANO')map.ano=h;if(x.includes('ESTADO'))map.estado=h;if(x.includes('MUNICIPIO'))map.municipio=h;if(x.includes('CONCLUSAO'))map.conclusao=h;if(x.includes('DEFESA CIVIL'))map.defesa=h});return map}
function uniq(arr){return [...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:true}))}

function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  const source=text.replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){
      if(ch==='"'&&source[i+1]==='"'){field+='"';i++}
      else if(ch==='"'){quoted=false}
      else field+=ch;
    }else if(ch==='"'){quoted=true}
    else if(ch===','){row.push(field);field=''}
    else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}
    else field+=ch;
  }
  if(field.length||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}
  if(!rows.length)return[];
  const headers=rows.shift().map(n);
  return rows.filter(values=>values.some(value=>n(value)))
    .map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}
function normalizeRows(rows){
  if(!rows.length)throw new Error('A planilha publicada está vazia.');
  state.cols=inferColumns(Object.keys(rows[0]));
  const required=['sexo','curso','ano','estado','municipio','conclusao','defesa'];
  const missing=required.filter(key=>!state.cols[key]);
  if(missing.length)throw new Error('Colunas não encontradas: '+missing.join(', '));
  return rows.map(row=>({
    nome:n(row[state.cols.nome]),cpf:n(row[state.cols.cpf]),sexo:n(row[state.cols.sexo]),
    curso:n(row[state.cols.curso]),ano:n(row[state.cols.ano]),estado:n(row[state.cols.estado]),
    municipio:n(row[state.cols.municipio]),conclusao:n(row[state.cols.conclusao]),defesa:n(row[state.cols.defesa])
  }));
}

/* =========================================================
   Snapshot / restore (preserva seleções entre refreshes)
   ========================================================= */
function selectionSnapshot(){
  const snapshot={};
  filterDefs.forEach(([key])=>{
    snapshot[key]=[...state.filters[key].selected];
  });
  return snapshot;
}
function restoreSelections(snapshot){
  // 1) Anos primeiro (afetam available de curso/município)
  if(snapshot.ano){
    state.filters.ano.selected = snapshot.ano.filter(v => state.filters.ano.available.includes(v));
  } else {
    state.filters.ano.selected = [...state.filters.ano.available];
  }
  // 2) Recalcula universos dependentes
  updateDependentAvailable();
  // 3) Demais filtros, filtrando pelo available atualizado
  ['curso','municipio','sexo'].forEach(key=>{
    if(snapshot[key]){
      state.filters[key].selected = snapshot[key].filter(v => state.filters[key].available.includes(v));
    } else {
      state.filters[key].selected = [...state.filters[key].available];
    }
  });
}

function showInitialError(message){
  els.statusCard.classList.add('error');
  els.statusTitle.textContent='Não foi possível carregar os dados';
  els.statusMessage.textContent=message;
  els.retryBtn.hidden=false;
}
function updateBadge(kind,message){
  els.fileBadge.classList.remove('is-updating','has-error');
  if(kind)els.fileBadge.classList.add(kind);
  els.fileBadge.textContent=message;
}

async function loadGoogleSheet({background=false}={}){
  if(background)updateBadge('is-updating','Atualizando dados…');
  else{
    els.statusCard.classList.remove('error');
    els.statusTitle.textContent='Carregando dados';
    els.statusMessage.textContent='Consultando a planilha publicada no Google Sheets…';
    els.retryBtn.hidden=true;
  }
  els.refreshBtn.disabled=true;
  try{
    const separator=SHEET_CSV_URL.includes('?')?'&':'?';
    const response=await fetch(SHEET_CSV_URL+separator+'_='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('O Google Sheets respondeu com o status '+response.status+'.');
    const snapshot=selectionSnapshot();
    state.raw=normalizeRows(parseCsv(await response.text()));
    buildFilters();
    restoreSelections(snapshot);
    renderOptionLists();
    applyFilters();
    state.lastUpdated=Date.now();
    const time=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(state.lastUpdated);
    updateBadge('',`Planilha atualizada às ${time}`);
    els.uploadScreen.style.display='none';
    els.dashboard.style.display='block';
  }catch(error){
    console.error(error);
    if(!state.raw.length)showInitialError(error.message||'Falha inesperada ao consultar a planilha.');
    else updateBadge('has-error','Falha na atualização — tente novamente');
  }finally{els.refreshBtn.disabled=false}
}

/* =========================================================
   FILTROS EM CASCATA
   ========================================================= */
/**
 * Reconstrói o universo de "curso" e "município" a partir dos anos selecionados.
 * Também remove das seleções atuais qualquer valor que não exista mais.
 * "Ano" e "Gênero" mantêm o universo completo (não faz sentido restringir).
 */
function updateDependentAvailable(){
  const anosSel = state.filters.ano.selected;
  const rawNoAno = anosSel.length === 0
    ? []
    : state.raw.filter(d => anosSel.includes(d.ano));

  state.filters.curso.available     = uniq(rawNoAno.map(d=>d.curso));
  state.filters.municipio.available = uniq(rawNoAno.map(d=>d.municipio));

  // Reconcilia seleções (descarta valores que sumiram)
  state.filters.curso.selected     = state.filters.curso.selected.filter(v=>state.filters.curso.available.includes(v));
  state.filters.municipio.selected = state.filters.municipio.selected.filter(v=>state.filters.municipio.available.includes(v));
}

function buildFilters(){
  // Universo base
  state.filters.ano.available       = uniq(state.raw.map(d=>d.ano));
  state.filters.sexo.available      = uniq(state.raw.map(d=>d.sexo));
  state.filters.curso.available     = uniq(state.raw.map(d=>d.curso));
  state.filters.municipio.available = uniq(state.raw.map(d=>d.municipio));

  // Seleção inicial = tudo marcado
  filterDefs.forEach(([key])=>{
    state.filters[key].selected = [...state.filters[key].available];
  });

  // Estrutura HTML dos filtros (dropdowns)
  els.filterGrid.innerHTML='';
  filterDefs.forEach(([key,label])=>{
    const box=document.createElement('div'); box.className='filter-box';
    box.innerHTML=`<h3>${label}</h3>
      <button class="dropdown-toggle" type="button" data-dd="${key}">Selecionar</button>
      <div class="dropdown-panel">
        <div class="filter-actions">
          <button data-action="all" data-key="${key}">Todos</button>
          <button data-action="none" data-key="${key}">Limpar</button>
        </div>
        <div class="option-list" id="list-${key}"></div>
      </div>`;
    els.filterGrid.appendChild(box);

    box.querySelector('.dropdown-toggle').addEventListener('click',e=>{
      document.querySelectorAll('.filter-box').forEach(x=>{if(x!==box)x.classList.remove('open')});
      box.classList.toggle('open'); e.stopPropagation();
    });
    box.querySelectorAll('.filter-actions button').forEach(btn=>{
      btn.addEventListener('click',()=>bulkAction(btn.dataset.key,btn.dataset.action));
    });
  });
}

/**
 * Redesenha as listas de opções de cada filtro com base em
 * state.filters[key].available e marca visualmente as selecionadas.
 */
function renderOptionLists(){
  filterDefs.forEach(([key])=>{
    const list=document.getElementById('list-'+key);
    if(!list) return;
    list.innerHTML='';
    const sel=new Set(state.filters[key].selected);

    if(state.filters[key].available.length===0){
      const empty=document.createElement('div');
      empty.className='option-empty';
      empty.textContent='Sem opções para a seleção atual';
      list.appendChild(empty);
    } else {
      state.filters[key].available.forEach(val=>{
        const b=document.createElement('button');
        b.className='option-chip'+(sel.has(val)?' active':'');
        b.dataset.key=key; b.dataset.value=val;
        b.innerHTML=`<input type="checkbox" ${sel.has(val)?'checked':''}><span>${val}</span>`;
        b.addEventListener('click',()=>toggleOption(key,val));
        list.appendChild(b);
      });
    }
  });
  updateToggleLabels();
}

function updateToggleLabels(){
  document.querySelectorAll('.filter-box').forEach(box=>{
    const toggle=box.querySelector('.dropdown-toggle');
    const key=toggle.dataset.dd;
    const vals=state.filters[key].selected;
    toggle.textContent = vals.length===0
      ? 'Nenhum selecionado'
      : vals.length<=2
        ? vals.join(', ')
        : vals.length+' selecionados';
  });
}

function toggleOption(key,val){
  const arr=state.filters[key].selected;
  const i=arr.indexOf(val);
  if(i>-1) arr.splice(i,1); else arr.push(val);

  // Se mudou o ano, o universo de curso/município muda → recalcular tudo
  if(key==='ano'){
    updateDependentAvailable();
    renderOptionLists();
  } else {
    // Só atualiza visual do chip clicado + labels
    const chip=document.querySelector(`.option-chip[data-key="${key}"][data-value="${CSS.escape(val)}"]`);
    if(chip) chip.classList.toggle('active', arr.includes(val));
    updateToggleLabels();
  }
  applyFilters();
}

function bulkAction(key,action){
  // "Todos" usa o universo ATUAL desse filtro (já pode estar restrito por ano)
  state.filters[key].selected = action==='all'
    ? [...state.filters[key].available]
    : [];

  if(key==='ano'){
    updateDependentAvailable();
    renderOptionLists();
  } else {
    renderOptionLists();
  }
  applyFilters();
}

function selected(key){ return state.filters[key].selected; }

document.addEventListener('click',e=>{if(!e.target.closest('.filter-box')) document.querySelectorAll('.filter-box').forEach(x=>x.classList.remove('open'));});

/* ===== apply filters / KPIs ===== */
function applyFilters(){
  const anos=new Set(selected('ano')), cursos=new Set(selected('curso')),
        municipios=new Set(selected('municipio')), sexos=new Set(selected('sexo'));

  state.filtered=state.raw.filter(d=>
    (!anos.size||anos.has(d.ano)) &&
    (!cursos.size||cursos.has(d.curso)) &&
    (!municipios.size||municipios.has(d.municipio)) &&
    (!sexos.size||sexos.has(d.sexo))
  );
  renderKPIs(); renderCharts();
}

function renderKPIs(){
  const d=state.filtered;
  els.kpiParticipantes.textContent=fmt(state.filtered.length);
  els.kpiCertificado.textContent=fmt(d.filter(x=>u(x.conclusao).includes('CERTIFIC')).length);
  els.kpiDeclarado.textContent=fmt(d.filter(x=>u(x.conclusao).includes('DECLAR')).length);

  /* =========================================================
     KPI "Cursos ofertados"
     Cada combinação única (curso + ano) conta como UMA oferta.
     Assim, o mesmo curso ofertado em anos diferentes conta
     como ofertas distintas, conforme esperado.
     ========================================================= */
  const ofertas = new Set(
    d.filter(x => x.curso && x.ano).map(x => `${x.curso}|||${x.ano}`)
  );
  els.kpiCursos.textContent=fmt(ofertas.size);

  els.kpiEstados.textContent=fmt(new Set(d.map(x=>x.estado).filter(Boolean)).size);
  els.kpiMunicipios.textContent=fmt(new Set(d.map(x=>x.municipio).filter(Boolean)).size);
}

function destroyCharts(){Object.values(state.charts).forEach(c=>c&&c.destroy()); state.charts={}}

/* ===== Chart.js plugins ===== */
const centerText={id:'centerText',afterDraw(chart,args,opts){
  if(chart.config.type!=='doughnut')return;
  const {ctx}=chart;const meta=chart.getDatasetMeta(0);if(!meta.data.length)return;
  ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='#dfe6fb';ctx.font='700 13px Manrope';
  const x=(chart.chartArea.left+chart.chartArea.right)/2;
  const y=(chart.chartArea.top+chart.chartArea.bottom)/2;
  ctx.fillText(opts.title||'Total',x,y-12);
  ctx.fillStyle='#ffffff';ctx.font='800 26px Sora';
  ctx.fillText(fmt(opts.value||0),x,y+14);
  ctx.restore();
}};
const valueLabels={id:'valueLabels',afterDatasetsDraw(chart){
  const {ctx}=chart;ctx.save();
  chart.data.datasets.forEach((dataset,i)=>{
    const meta=chart.getDatasetMeta(i);
    meta.data.forEach((el,idx)=>{
      const val=dataset.data[idx];if(val==null||val===0)return;
      const p=el.tooltipPosition();
      ctx.font='800 11px Manrope';ctx.fillStyle='#e9edf7';
      ctx.textAlign=chart.options.indexAxis==='y'?'left':'center';
      ctx.textBaseline='middle';
      const yoff = chart.options.indexAxis==='y' ? 0 : -10;
      const xoff = chart.options.indexAxis==='y' ? 8 : 0;
      ctx.fillText(fmt(val),p.x+xoff,p.y+yoff);
    });
  });
  ctx.restore();
}};
const doughnutPerc={id:'doughnutPerc',afterDatasetsDraw(chart){
  if(chart.config.type!=='doughnut')return;
  const {ctx}=chart;const ds=chart.data.datasets[0];
  const total=ds.data.reduce((a,b)=>a+b,0);
  ctx.save(); ctx.font='800 13px Manrope'; ctx.fillStyle='#ffffff';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='rgba(0,0,0,.55)'; ctx.shadowBlur=6;
  chart.getDatasetMeta(0).data.forEach((arc,i)=>{
    const v=ds.data[i]; if(!v) return;
    const angle=(arc.startAngle+arc.endAngle)/2;
    const r=(arc.outerRadius+arc.innerRadius)/2;
    const x=arc.x+Math.cos(angle)*r;
    const y=arc.y+Math.sin(angle)*r;
    const txt=((v/total)*100).toFixed(1).replace('.',',')+'%';
    ctx.fillText(txt,x,y);
  });
  ctx.restore();
}};

Chart.defaults.font.family=chartsCfg.font;
Chart.defaults.color=chartsCfg.text;
Chart.defaults.plugins.tooltip = {
  ...Chart.defaults.plugins.tooltip,
  enabled:true, backgroundColor:'rgba(10,14,26,.95)', titleColor:'#fff',
  bodyColor:'#dfe6fb', borderColor:'rgba(99,102,241,.5)', borderWidth:1,
  padding:12, cornerRadius:10, titleFont:{weight:'800',size:13}, bodyFont:{weight:'600',size:12},
  displayColors:true, boxPadding:6
};

function doughnutLabels(labels,vals){const total=vals.reduce((a,b)=>a+b,0);return labels.map((l,i)=>`${l} · ${fmt(vals[i])} · ${pct(vals[i],total)}`)}

// Função para atualizar as cores das legendas com base nos gradientes do gráfico pizza
function updateLegendColors(){
  const mascCard=document.getElementById('legendMasc');
  const femCard=document.getElementById('legendFem');
  const ndCard=document.getElementById('legendNd');
  if(mascCard) mascCard.style.background=`linear-gradient(135deg, ${PIE_GRADIENTS[0][0]}, ${PIE_GRADIENTS[0][1]})`;
  if(femCard)  femCard.style.background =`linear-gradient(135deg, ${PIE_GRADIENTS[1][0]}, ${PIE_GRADIENTS[1][1]})`;
  if(ndCard)   ndCard.style.background  =`linear-gradient(135deg, ${PIE_GRADIENTS[2][0]}, ${PIE_GRADIENTS[2][1]})`;
}

function renderCharts(){
  destroyCharts();
  const d=state.filtered;
  const allYears=uniq(d.map(x=>x.ano));
  const yearsSel=selected('ano');
  // Lista de anos "universo" (imutável) para colorir de forma estável
  const yearList=state.filters.ano.available;
  const multi = yearsSel.length>1;

  /* ===== Inscritos × gênero (doughnut with diagonal gradients) ===== */
  const sexoVals=[
    d.filter(x=>u(x.sexo).startsWith('MASC')).length,
    d.filter(x=>u(x.sexo).startsWith('FEM')).length,
    d.filter(x=>!u(x.sexo).startsWith('MASC')&&!u(x.sexo).startsWith('FEM')).length
  ];
  els.sexoMasc.textContent=fmt(sexoVals[0]);
  els.sexoFem.textContent=fmt(sexoVals[1]);
  els.sexoNd.textContent=fmt(sexoVals[2]);

  // Aplica as cores sincronizadas com o gráfico pizza nos cards de legenda
  updateLegendColors();

  state.charts.sexo=new Chart(document.getElementById('chartSexoPizza'),{
    type:'doughnut',
    data:{labels:doughnutLabels(['Masculino','Feminino','Pref. não dizer'],sexoVals),
      datasets:[{
        data:sexoVals,
        backgroundColor:(c)=>{
          const grads = [PIE_GRADIENTS[0], PIE_GRADIENTS[1], PIE_GRADIENTS[2]];
          const [c1,c2] = grads[c.dataIndex];
          return makeDiagonalGradient(c.chart.ctx, c.chart.chartArea, c1, c2);
        },
        borderColor:'#0f1424', borderWidth:3, hoverOffset:8
      }]},
    options:{
      maintainAspectRatio:false, responsive:true, cutout:'58%',
      animation:{animateRotate:true, duration:900, easing:'easeOutCubic'},
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:12,boxHeight:12,padding:14,font:{size:12,weight:'700'},color:'#dfe6fb'}},
        centerText:{title:'Total', value:sexoVals.reduce((a,b)=>a+b,0)}
      }
    },
    plugins:[centerText,doughnutPerc]
  });

  /* ===== Participação feminina por ano (year-based color) ===== */
  const femaleAbs=allYears.map(y=>d.filter(x=>x.ano===y&&u(x.sexo).startsWith('FEM')).length);
  state.charts.fem=new Chart(document.getElementById('chartFemininoAno'),{
    type:'bar',
    data:{labels:allYears, datasets:[{
      label:'Participantes femininas', data:femaleAbs,
      backgroundColor:(c)=>{
        const yp = yearColor(yearList, allYears[c.dataIndex]);
        return makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true);
      },
      borderRadius:10, maxBarThickness:60
    }]},
    options:{
      maintainAspectRatio:false,
      animation:{duration:800, easing:'easeOutCubic'},
      plugins:{legend:{display:false}},
      scales:{
        y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},
        x:{grid:{display:false},ticks:{color:chartsCfg.textSoft,font:{weight:'700'}}}
      }
    },
    plugins:[valueLabels]
  });

  /* ===== Helper for multi/single bar datasets by year ===== */
  function buildYearDatasets(categoryKeys, axisIsY=false){
    const ds=[];
    yearsSel.forEach((ano)=>{
      const yp = yearColor(yearList, ano);
      const map=new Map();
      d.filter(x=>x.ano===ano).forEach(x=>{
        const k = x[categoryKeys.field];
        if(!k || (categoryKeys.excludeOutro && u(k)==='OUTRO')) return;
        map.set(k,(map.get(k)||0)+1);
      });
      ds.push({
        label:ano,
        data:categoryKeys.sortedKeys.map(c=>map.get(c)||0),
        backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, !axisIsY),
        borderRadius:8, maxBarThickness:axisIsY?11:34, barThickness:axisIsY?11:undefined,
        categoryPercentage:axisIsY?.85:undefined, barPercentage:axisIsY?.55:undefined
      });
    });
    return ds;
  }

  /* ===== Alunos inscritos por município ===== */
  const muniFiltered = d.filter(x=>u(x.municipio)!=='OUTRO' && x.municipio);
  const muniTotals = new Map();
  muniFiltered.forEach(x=>muniTotals.set(x.municipio,(muniTotals.get(x.municipio)||0)+1));
  // Top 30 municípios com mais alunos
  const muniSorted = Array.from(muniTotals.entries()).sort((a,b)=>b[1]-a[1]).slice(0,30);
  const muniLabels = muniSorted.map(x=>x[0]);

  let muniDatasets;
  if(multi){
    muniDatasets = buildYearDatasets({field:'municipio', excludeOutro:true, sortedKeys:muniLabels}, false);
  } else {
    const onlyYear = yearsSel[0] || allYears[0] || '';
    const yp = yearColor(yearList, onlyYear);
    muniDatasets = [{
      label: onlyYear || 'Selecionado',
      data: muniSorted.map(x=>x[1]),
      backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true),
      borderRadius:8, maxBarThickness:28, categoryPercentage:.82, barPercentage:.78
    }];
  }
  state.charts.muni=new Chart(document.getElementById('chartMunicipio'),{
    type:'bar', data:{labels:muniLabels, datasets:muniDatasets},
    options:{
      maintainAspectRatio:false,
      animation:{duration:800, easing:'easeOutCubic'},
      layout:{padding:{top:18,bottom:4}},
      plugins:{legend:{position:'top',align:'start',labels:{font:{size:12,weight:'700'},color:'#dfe6fb',boxWidth:12,boxHeight:12,padding:12}}},
      scales:{
        y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},
        x:{grid:{display:false},ticks:{maxRotation:55,minRotation:55,autoSkip:false,font:{size:10,weight:'600'},color:chartsCfg.textSoft}}
      }
    },
    plugins:[valueLabels]
  });

  /* ===== Alunos inscritos por curso ===== */
  const cursoTotalsMap = new Map();
  d.forEach(x=>{ if(x.curso) cursoTotalsMap.set(x.curso,(cursoTotalsMap.get(x.curso)||0)+1) });
  const cursoSorted = Array.from(cursoTotalsMap.entries()).sort((a,b)=>b[1]-a[1]);
  const cursoLabels = cursoSorted.map(x=>x[0]);

  let cursoDatasets;
  if(multi){
    cursoDatasets = buildYearDatasets({field:'curso', excludeOutro:false, sortedKeys:cursoLabels}, false);
  } else {
    const onlyYear = yearsSel[0] || allYears[0] || '';
    const yp = yearColor(yearList, onlyYear);
    cursoDatasets = [{
      label: onlyYear || 'Selecionado',
      data: cursoSorted.map(x=>x[1]),
      backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true),
      borderRadius:8, maxBarThickness:38
    }];
  }
  state.charts.curso=new Chart(document.getElementById('chartCurso'),{
    type:'bar', data:{labels:cursoLabels, datasets:cursoDatasets},
    options:{
      maintainAspectRatio:false,
      animation:{duration:800, easing:'easeOutCubic'},
      layout:{padding:{top:18}},
      plugins:{legend:{position:'top',align:'start',labels:{font:{size:12,weight:'700'},color:'#dfe6fb',boxWidth:12,boxHeight:12,padding:12}}},
      scales:{
        y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},
        x:{grid:{display:false},ticks:{maxRotation:42,minRotation:42,font:{size:11,weight:'600'},color:chartsCfg.textSoft}}
      }
    },
    plugins:[valueLabels]
  });

  /* ===== Defesa Civil — pizza ===== */
  const defesaVals=[
    d.filter(x=>u(x.defesa).startsWith('SIM')).length,
    d.filter(x=>u(x.defesa).startsWith('NAO')||u(x.defesa).startsWith('NÃO')).length,
    d.filter(x=>!u(x.defesa).startsWith('SIM')&&!u(x.defesa).startsWith('NAO')&&!u(x.defesa).startsWith('NÃO')).length
  ];
  state.charts.dp=new Chart(document.getElementById('chartDefesaPizza'),{
    type:'doughnut',
    data:{labels:doughnutLabels(['Sim','Não','Não informado'],defesaVals),
      datasets:[{
        data:defesaVals,
        backgroundColor:(c)=>{
          const grads = [PIE_GRADIENTS[3], PIE_GRADIENTS[4], PIE_GRADIENTS[2]];
          const [c1,c2] = grads[c.dataIndex];
          return makeDiagonalGradient(c.chart.ctx, c.chart.chartArea, c1, c2);
        },
        borderColor:'#0f1424', borderWidth:3, hoverOffset:8
      }]},
    options:{
      maintainAspectRatio:false, responsive:true, cutout:'58%',
      animation:{animateRotate:true, duration:900, easing:'easeOutCubic'},
      plugins:{
        legend:{position:'bottom',labels:{boxWidth:12,boxHeight:12,padding:14,font:{size:12,weight:'700'},color:'#dfe6fb'}},
        centerText:{title:'Total',value:defesaVals.reduce((a,b)=>a+b,0)}
      }
    },
    plugins:[centerText,doughnutPerc]
  });

  /* ===== Defesa Civil — barras ===== */
  if(multi){
    const ds=[];
    yearsSel.forEach((ano)=>{
      const yp = yearColor(yearList, ano);
      const subset=d.filter(x=>x.ano===ano);
      ds.push({
        label:ano,
        data:[
          subset.filter(x=>u(x.defesa).startsWith('SIM')).length,
          subset.filter(x=>u(x.defesa).startsWith('NAO')||u(x.defesa).startsWith('NÃO')).length,
          subset.filter(x=>!u(x.defesa).startsWith('SIM')&&!u(x.defesa).startsWith('NAO')&&!u(x.defesa).startsWith('NÃO')).length,
        ],
        backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true),
        borderRadius:10, maxBarThickness:48
      });
    });
    state.charts.db=new Chart(document.getElementById('chartDefesaBar'),{
      type:'bar', data:{labels:['Sim','Não','Não informado'], datasets:ds},
      options:{
        maintainAspectRatio:false,
        animation:{duration:800,easing:'easeOutCubic'},
        plugins:{legend:{position:'bottom',labels:{font:{size:12,weight:'700'},color:'#dfe6fb',boxWidth:12,boxHeight:12,padding:12}}},
        scales:{y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},x:{grid:{display:false},ticks:{color:chartsCfg.textSoft,font:{weight:'700'}}}}
      },
      plugins:[valueLabels]
    });
  } else {
    const onlyYear = yearsSel[0] || allYears[0] || '';
    const yp = yearColor(yearList, onlyYear);
    state.charts.db=new Chart(document.getElementById('chartDefesaBar'),{
      type:'bar',
      data:{labels:['Sim','Não','Não informado'],
        datasets:[{label:onlyYear||'Selecionado', data:defesaVals,
          backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true),
          borderRadius:10, maxBarThickness:64}]},
      options:{
        maintainAspectRatio:false,
        animation:{duration:800,easing:'easeOutCubic'},
        plugins:{legend:{position:'bottom',labels:{font:{size:12,weight:'700'},color:'#dfe6fb',boxWidth:12,boxHeight:12,padding:12}}},
        scales:{y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},x:{grid:{display:false},ticks:{color:chartsCfg.textSoft,font:{weight:'700'}}}}
      },
      plugins:[valueLabels]
    });
  }

  /* ===== Estado × alunos ===== */
  const estTotals = new Map();
  d.forEach(x=>{ if(x.estado) estTotals.set(x.estado,(estTotals.get(x.estado)||0)+1) });
  const estSorted = Array.from(estTotals.entries()).sort((a,b)=>b[1]-a[1]);
  const estLabels = estSorted.map(x=>x[0]);

  let estDatasets;
  if(multi){
    estDatasets = buildYearDatasets({field:'estado', excludeOutro:false, sortedKeys:estLabels}, false);
  } else {
    const onlyYear = yearsSel[0] || allYears[0] || '';
    const yp = yearColor(yearList, onlyYear);
    estDatasets = [{
      label:onlyYear||'Selecionado',
      data:estSorted.map(x=>x[1]),
      backgroundColor:(c)=>makeBarGradient(c.chart.ctx, c.chart.chartArea, yp.g1, yp.g2, true),
      borderRadius:10, maxBarThickness:60
    }];
  }
  state.charts.estadoAluno=new Chart(document.getElementById('chartEstadoAluno'),{
    type:'bar', data:{labels:estLabels, datasets:estDatasets},
    options:{
      maintainAspectRatio:false,
      animation:{duration:800, easing:'easeOutCubic'},
      layout:{padding:{top:18}},
      plugins:{legend:{position:'top',align:'start',labels:{font:{size:12,weight:'700'},color:'#dfe6fb',boxWidth:12,boxHeight:12,padding:12}}},
      scales:{
        y:{beginAtZero:true,grid:{color:chartsCfg.grid},ticks:{color:chartsCfg.textSoft}},
        x:{grid:{display:false},ticks:{font:{size:12,weight:'700'},color:chartsCfg.textSoft}}
      }
    },
    plugins:[valueLabels]
  });
}

els.refreshBtn.addEventListener('click',()=>loadGoogleSheet({background:true}));
els.retryBtn.addEventListener('click',()=>loadGoogleSheet());
setInterval(()=>loadGoogleSheet({background:true}),REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&Date.now()-state.lastUpdated>REFRESH_INTERVAL_MS){
    loadGoogleSheet({background:Boolean(state.raw.length)});
  }
});
loadGoogleSheet();