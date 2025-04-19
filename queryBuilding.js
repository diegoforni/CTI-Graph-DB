// ─── Vercel secrets & driver ──────────────────────────────────────
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;
const neo4j  = window.neo4j;
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);

document.addEventListener('DOMContentLoaded', function() {
  // ─── REFERENCIAS UI ───────────────────────────────────────────────────
  // Referencias a elementos DOM principales
  const querySelect = document.getElementById('querySelect');
  const maxRowsInput = document.getElementById('maxRows');
  const runQueryBtn = document.getElementById('runQuery');
  const resultsDiv = document.getElementById('results');
  const colCheckboxesEl = document.getElementById('colCheckboxes');
  const filtersDiv = document.getElementById('filters');
  const addFilterBtn = document.getElementById('addFilterBtn');
  const groupByCheckboxesEl = document.getElementById('groupByCheckboxes');

  // Botones de navegación - Next
  const nextToStep2Btn = document.getElementById('nextToStep2');
  const nextToStep3Btn = document.getElementById('nextToStep3');
  const nextToStep4Btn = document.getElementById('nextToStep4');
  const nextToStep5Btn = document.getElementById('nextToStep5');
  const finishConfigBtn = document.getElementById('finishConfiguration');

  // Botones de navegación - Back
  const backToStep1Btn = document.getElementById('backToStep1');
  const backToStep2Btn = document.getElementById('backToStep2');
  const backToStep3Btn = document.getElementById('backToStep3');
  const backToStep4Btn = document.getElementById('backToStep4');

  // Contenedores de pasos
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const step3 = document.getElementById('step3');
  const step4 = document.getElementById('step4');
  const step5 = document.getElementById('step5');

  // ─── UTILIDADES ───────────────────────────────────────────────────
  function toDisplayName(alias) {
    return alias
      .replace(/_/g,' ')
      .replace(/([a-z])([A-Z])/g,'$1 $2')
      .replace(/\b\w/g,c=>c.toUpperCase());
  }

  function parseReturnItems(cypher) {
    const m = cypher.match(/RETURN\s+([\s\S]*?);?$/i);
    if (!m) return [];
    return m[1]
      .split(',')
      .map(s=>s.trim())
      .map(item=>{
        const parts = item.split(/\s+AS\s+/i);
        return parts.length===2
          ? { expr: parts[0], alias: parts[1] }
          : null;
      })
      .filter(Boolean);
  }

  // ─── GENERADOR DE PLANTILLAS CYPHER ────────────────────────────────
  function generateCypherQueries(schema) {
    const queries = [];
    const buildReturn = (varName, props, prefix) =>
      props.length
        ? props.map(p=>`${varName}.${p} AS ${prefix}${p}`).join(', ')
        : varName;

    // Node templates
    for (const [L,meta] of Object.entries(schema)) {
      if (meta.type!=='node') continue;
      const a = L.toLowerCase();
      const props = Object.keys(meta.properties||{});
      queries.push(
        `// All ${L} nodes\n`+
        `MATCH (${a}:${L})\n`+
        `RETURN ${buildReturn(a,props, L+'_')};`
      );
    }

    // Relationship templates
    for (const [R,rm] of Object.entries(schema)) {
      if (rm.type!=='relationship') continue;
      for (const [S,sm] of Object.entries(schema)) {
        if (sm.type!=='node'||!sm.relationships) continue;
        const def = sm.relationships[R];
        if (!def||def.direction!=='out') continue;
        def.labels.forEach(E=>{
          const sa = S.toLowerCase(), ra=R.toLowerCase(), ea=E.toLowerCase();
          const sp=Object.keys(sm.properties||{}),
                rp=Object.keys(rm.properties||{}),
                ep=Object.keys((schema[E]?.properties)||{});
          const retS = buildReturn(sa, sp, S+'_'),
                retR = buildReturn(ra, rp, R+'_'),
                retE = buildReturn(ea, ep, E+'_');
          queries.push(
            `// ${S} -[${R}]-> ${E}\n`+
            `MATCH (${sa}:${S})-[${ra}:${R}]->(${ea}:${E})\n`+
            `RETURN ${retS}` +
              (sp.length&&rp.length?', ':'')+`${retR}` +
              ((sp.length||rp.length)&&ep.length?', ':'')+`${retE};`
          );
        });
      }
    }

    return queries;
  }

  // ─── CARGAR ESQUEMA Y POPULAR UI ────────────────────────────────────
  async function loadSchemaAndPopulate() {
    querySelect.innerHTML = '<option>Loading schema…</option>';
    runQueryBtn.disabled = true;
    nextToStep2Btn.disabled = true;

    const session = driver.session();
    try {
      const res = await session.run('CALL apoc.meta.schema() YIELD value');
      const schemaMap = res.records[0].get('value');
      const templates = generateCypherQueries(schemaMap);

      querySelect.innerHTML = '';
      templates.forEach((q,i)=>{
        const label = q.split('\n')[0].replace(/^\/\/\s*/,'')||`Query ${i+1}`;
        const opt = document.createElement('option');
        opt.value = q;
        opt.text = label;
        querySelect.append(opt);
      });

      querySelect.disabled = false;
      
      // No activar el botón Run hasta completar la configuración
      runQueryBtn.disabled = true;
    } catch(err) {
      console.error(err);
      querySelect.innerHTML = '<option>Error loading schema</option>';
    } finally {
      await session.close();
    }
  }

  // ─── NAVEGACIÓN ENTRE PASOS ───────────────────────────────────────
  // Forward navigation
nextToStep2Btn.addEventListener('click', function() {
  step1.classList.add('hidden');
  step2.classList.remove('hidden');
  updateStepIndicators(2);
  
  const selectedQuery = querySelect.options[querySelect.selectedIndex].text;
  updateHistoryTimeline(1, `Selected: ${selectedQuery}`);
});

nextToStep3Btn.addEventListener('click', function() {
  step2.classList.add('hidden');
  step3.classList.remove('hidden');
  populateColumnCheckboxes();
  updateStepIndicators(3);
  
  const maxRows = maxRowsInput.value;
  updateHistoryTimeline(2, `Maximum rows: ${maxRows}`);
});

nextToStep4Btn.addEventListener('click', function() {
  step3.classList.add('hidden');
  step4.classList.remove('hidden');
  filtersDiv.innerHTML = ''; // Limpiar filtros anteriores
  updateStepIndicators(4);
  
  updateHistoryTimeline(3, getSelectedColumnsSummary());
});

nextToStep5Btn.addEventListener('click', function() {
  step4.classList.add('hidden');
  step5.classList.remove('hidden');
  populateGroupByCheckboxes();
  updateStepIndicators(5);
  
  updateHistoryTimeline(4, getFiltersSummary());
});

finishConfigBtn.addEventListener('click', function() {
  // Activar botón de ejecutar consulta
  runQueryBtn.disabled = false;
  
  updateHistoryTimeline(5, getGroupingSummary());
  
  // Desplazarse al botón de ejecutar
  document.getElementById('runQueryContainer').scrollIntoView({ behavior: 'smooth' });
});

// Backward navigation
backToStep1Btn.addEventListener('click', function() {
  step2.classList.add('hidden');
  step1.classList.remove('hidden');
  updateStepIndicators(1);
});

backToStep2Btn.addEventListener('click', function() {
  step3.classList.add('hidden');
  step2.classList.remove('hidden');
  updateStepIndicators(2);
});

backToStep3Btn.addEventListener('click', function() {
  step4.classList.add('hidden');
  step3.classList.remove('hidden');
  updateStepIndicators(3);
});

backToStep4Btn.addEventListener('click', function() {
  step5.classList.add('hidden');
  step4.classList.remove('hidden');
  updateStepIndicators(4);
});

  // ─── CASILLAS DE VERIFICACIÓN DE COLUMNAS ────────────────────────────
  function populateColumnCheckboxes() {
    const items = parseReturnItems(querySelect.value);
    colCheckboxesEl.innerHTML = '';
    if (!items.length) {
      colCheckboxesEl.style.display = 'none';
      return;
    }

    // "All columns" master
    const all = document.createElement('input');
    all.type = 'checkbox'; all.id = 'col_all'; all.checked = true;
    const allLbl = document.createElement('label');
    allLbl.htmlFor = 'col_all'; allLbl.textContent = 'All columns';
    all.addEventListener('change', ()=> {
      colCheckboxesEl.querySelectorAll('input[data-expr]')
        .forEach(cb=> cb.checked = all.checked);
    });
    colCheckboxesEl.append(all, allLbl, document.createElement('br'));

    items.forEach(({expr,alias})=>{
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = `col_${alias}`;
      cb.dataset.expr = expr;  cb.dataset.alias = alias;
      cb.checked = true;
      const lbl = document.createElement('label');
      lbl.htmlFor = cb.id; lbl.textContent = toDisplayName(alias);
      colCheckboxesEl.append(cb, lbl, document.createElement('br'));
    });

    colCheckboxesEl.style.display = 'block';
  }
  // Actualizar el resumen de columnas cuando se modifican las selecciones
  colCheckboxesEl.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox') {
      updateHistoryTimeline(3, getSelectedColumnsSummary());
    }
  });

  // ─── CASILLAS DE VERIFICACIÓN GROUP-BY ────────────────────────────────
  function populateGroupByCheckboxes() {
    const items = parseReturnItems(querySelect.value);
    groupByCheckboxesEl.innerHTML = '';
    if (!items.length) return;

    items.forEach(({expr,alias})=>{
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = `gb_${alias}`;
      cb.dataset.expr = expr;  cb.dataset.alias = alias;
      const lbl = document.createElement('label');
      lbl.htmlFor = cb.id; lbl.textContent = toDisplayName(alias);
      groupByCheckboxesEl.append(cb, lbl, document.createElement('br'));
    });
  }
  // Actualizar el resumen de agrupación cuando se modifican
  groupByCheckboxesEl.addEventListener('change', function(e) {
    if (e.target.type === 'checkbox') {
      updateHistoryTimeline(5, getGroupingSummary());
    }
  });

  // ─── FILAS DE FILTRO ────────────────────────────────────────────────
  addFilterBtn.addEventListener('click', addFilterRow);
  
  function addFilterRow() {
    const items = parseReturnItems(querySelect.value);
    if (!items.length) return;
    
    const row = document.createElement('div');
    row.className = 'filter-row'; // Actualizado para coincidir con el CSS

    // field select
    const fieldSelect = document.createElement('select');
    fieldSelect.className = 'filter-field';
    fieldSelect.innerHTML = `<option value="">-- choose field --</option>`;
    items.forEach(({expr,alias})=>{
      const o = document.createElement('option');
      o.value = expr;
      o.text = toDisplayName(alias);
      fieldSelect.append(o);
    });

    // value select (populated on change)
    const valueSelect = document.createElement('select');
    valueSelect.className = 'filter-value';
    valueSelect.disabled = true;
    valueSelect.innerHTML = '<option>—</option>';

    fieldSelect.addEventListener('change', ()=> {
      const expr = fieldSelect.value;
      if (!expr) {
        valueSelect.innerHTML = '<option>—</option>';
        valueSelect.disabled = true;
      } else {
        loadFilterValues(expr, valueSelect);
      }
    });

    // remove
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-filter';
    remove.textContent = '✕';
    remove.addEventListener('click', ()=> filtersDiv.removeChild(row));

    row.append(fieldSelect, valueSelect, remove);
    filtersDiv.appendChild(row);
  }

  // Actualizar el resumen de filtros cuando se modifican
  filtersDiv.addEventListener('change', function(e) {
    if (e.target.tagName === 'SELECT') {
      updateHistoryTimeline(4, getFiltersSummary());
    }
  });

  // cargar los 100 valores distintos principales para un campo
  async function loadFilterValues(expr, valueSelect) {
    valueSelect.innerHTML = '<option>Loading…</option>';
    valueSelect.disabled = true;
    const session = driver.session();
    try {
      const prefix = querySelect.value.replace(/RETURN[\s\S]*$/i, '').trim();
      const q = `${prefix}
  RETURN ${expr} AS val, count(*) AS freq
  ORDER BY freq DESC
  LIMIT 100;`;
      const res = await session.run(q);

      valueSelect.innerHTML = '';
      res.records.forEach(r => {
        const v = r.get('val');
        const o = document.createElement('option');
        o.value = v; o.text = v;
        valueSelect.append(o);
      });
      valueSelect.disabled = false;
    } catch(err) {
      console.error(err);
      valueSelect.innerHTML = '<option>Error</option>';
    } finally {
      await session.close();
    }
  }

  // ─── EJECUTAR LA CONSULTA FINAL ────────────────────────────────────────
  runQueryBtn.addEventListener('click', runSelectedQuery);
  
  async function runSelectedQuery() {
    // Mostrar el contenedor de resultados
    resultsDiv.classList.remove('hidden');
    resultsDiv.innerHTML = '<p>Executing query...</p>';
    
    const items = parseReturnItems(querySelect.value);
    const itemsMap = Object.fromEntries(items.map(({expr,alias})=>[alias,expr]));

    // chosen columns
    const cols = items
      .filter(({alias})=>
        colCheckboxesEl.querySelector(`[data-alias="${alias}"]`)?.checked
      )
      .map(({expr,alias})=>({expr,alias}));

    if (!cols.length) {
      resultsDiv.textContent = 'Select at least one column.';
      return;
    }

    // filters
    const whereClauses = Array.from(filtersDiv.children)
      .map(row=>{
        const [fs, vs] = row.querySelectorAll('select');
        return fs.value && vs.value
          ? `${fs.value} = '${vs.value.replace(/'/g,"\\'")}'`
          : null;
      })
      .filter(Boolean);

    // group‑by
    const groupBy = Array.from(groupByCheckboxesEl.querySelectorAll('input[type=checkbox]'))
      .filter(cb=>cb.checked)
      .map(cb=>cb.dataset.alias);

    const limit = parseInt(maxRowsInput.value,10) || 100;
    const prefix = querySelect.value.replace(/RETURN[\s\S]*$/i, '').trim();

    let cypher = prefix;
    if (whereClauses.length) {
      cypher += '\nWHERE ' + whereClauses.join(' AND ');
    }

    if (groupBy.length) {
      // GROUPED
      // 1) group keys
      const grp = groupBy
        .map(a=>`${itemsMap[a]} AS ${a}`)
        .join(', ');

      // 2) aggregates for other cols
      const others = cols
        .map(c=>c.alias)
        .filter(a=>!groupBy.includes(a))
        .map(a=>`collect(DISTINCT ${itemsMap[a]}) AS ${a}`);

      cypher += `\nRETURN ${grp}, count(*) AS Count` +
                (others.length? ', ' + others.join(', '): '') +
                `\nORDER BY Count DESC\nLIMIT ${limit};`;
    } else {
      // SIMPLE SELECT
      const ret = cols.map(c=>`${c.expr} AS ${c.alias}`).join(', ');
      cypher += `\nRETURN ${ret} LIMIT ${limit};`;
    }

    // execute
    resultsDiv.innerHTML = '';
    const session = driver.session();
    try {
      const res = await session.run(cypher);
      const keys = res.records[0]?.keys || [];
      let html = '<table><thead><tr>' +
                 keys.map(k=>`<th>${toDisplayName(k)}</th>`).join('') +
                 '</tr></thead><tbody>';
      res.records.forEach(r=>{
        html += '<tr>' + keys.map(k=>`<td>${r.get(k)}</td>`).join('') + '</tr>';
      });
      html += '</tbody></table>';
      resultsDiv.innerHTML = html;
    } catch(err) {
      console.error(err);
      resultsDiv.textContent = 'Error: ' + err.message;
    } finally {
      await session.close();
    }
  }

  // ─── ACTUALIZACIÓN DE HISTORIAL Y NAVEGACIÓN VISUAL ───────────────────────────
function updateStepIndicators(currentStepNum) {
  const stepIndicators = document.querySelectorAll('.step-indicator');
  stepIndicators.forEach((indicator, index) => {
    const stepNum = index + 1;
    indicator.classList.remove('active');
    
    if (stepNum < currentStepNum) {
      indicator.classList.add('completed');
    } else if (stepNum === currentStepNum) {
      indicator.classList.add('active');
    } else {
      indicator.classList.remove('completed');
    }
  });
}

function updateHistoryTimeline(completedStep, details) {
  const historyStep = document.getElementById(`history-step${completedStep}`);
  const historyDetail = document.getElementById(`history-detail-step${completedStep}`);
  
  if (historyStep) {
    historyStep.classList.add('completed');
  }
  
  if (historyDetail && details) {
    historyDetail.textContent = details;
  }
}

// Actualizar historial con selecciones actuales
function getSelectedColumnsSummary() {
  const selectedCols = Array.from(colCheckboxesEl.querySelectorAll('input[data-expr]:checked'))
    .map(cb => cb.dataset.alias);
  
  if (selectedCols.length === 0) return "No columns selected";
  if (colCheckboxesEl.querySelector('#col_all').checked) return "All columns selected";
  
  return selectedCols.length > 2 
    ? `Selected ${selectedCols.length} columns` 
    : `Selected: ${selectedCols.join(', ')}`;
}

function getFiltersSummary() {
  const filterCount = filtersDiv.children.length;
  if (filterCount === 0) return "No filters applied";
  
  const activeFilters = Array.from(filtersDiv.children)
    .filter(row => {
      const selects = row.querySelectorAll('select');
      return selects[0].value && !selects[1].disabled;
    }).length;
  
  return `${activeFilters} filter${activeFilters !== 1 ? 's' : ''} applied`;
}

function getGroupingSummary() {
  const groupByCols = Array.from(groupByCheckboxesEl.querySelectorAll('input[type=checkbox]:checked'))
    .map(cb => toDisplayName(cb.dataset.alias));
  
  if (groupByCols.length === 0) return "No grouping applied";
  
  return groupByCols.length > 2
    ? `Grouped by ${groupByCols.length} columns`
    : `Grouped by: ${groupByCols.join(', ')}`;
}

  // ─── EVENTOS ───────────────────────────────────────────────────────
  
  // Cargar esquema al iniciar la aplicación
  loadSchemaAndPopulate();
  
  querySelect.addEventListener('change', function() {
    nextToStep2Btn.disabled = !this.value;
    
    if (this.value) {
      const selectedQueryName = this.options[this.selectedIndex].text;
      updateHistoryTimeline(1, `Selected: ${selectedQueryName}`);
    }
  });
  
  // ─── CLEANUP ───────────────────────────────────────────────────────
  window.addEventListener('beforeunload', async () => {
    await driver.close();
  });

});