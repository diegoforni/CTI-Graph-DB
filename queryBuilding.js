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

  // Contenedores de pasos - divs that contain the content for each step
  const step1 = document.querySelector('.timeline-step#step1');
  const step2 = document.querySelector('.timeline-step#step2');
  const step3 = document.querySelector('.timeline-step#step3');
  const step4 = document.querySelector('.timeline-step#step4');
  const step5 = document.querySelector('.timeline-step#step5');

  // Step navigation buttons
  const stepButtons = document.querySelectorAll('.step-button');
  stepButtons.forEach(button => {
    button.addEventListener('click', function() {
      const stepNum = parseInt(this.dataset.step);
      navigateToStep(stepNum);
    });
  });

  // Global navigation buttons
  const globalBackBtn = document.getElementById('globalBack');
  const globalNextBtn = document.getElementById('globalNext');

  // Track current step
  let currentStep = 1;

  // Set up global navigation
  globalBackBtn.addEventListener('click', function() {
    if (currentStep > 1) {
      navigateToStep(currentStep - 1);
    }
  });

  globalNextBtn.addEventListener('click', function() {
    if (currentStep < 5) {
      navigateToStep(currentStep + 1);
    }
  });


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
    globalNextBtn.disabled = false;

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
  function navigateToStep(stepNum) {
    // Hide all steps
    const allSteps = [step1, step2, step3, step4, step5];
    allSteps.forEach(step => step.classList.add('hidden'));
    
    // Show requested step
    allSteps[stepNum - 1].classList.remove('hidden');
    
    // If going to step 3, populate column checkboxes
    if (stepNum === 3) {
      populateColumnCheckboxes();
      updateHistoryTimeline(2, `Maximum rows: ${maxRowsInput.value}`);
    }
    
    // If going to step 4, clear and prepare filters
    if (stepNum === 4) {
      filtersDiv.innerHTML = ''; // Limpiar filtros anteriores
      updateHistoryTimeline(3, getSelectedColumnsSummary());
    }
    
    // If going to step 5, populate group by checkboxes
    if (stepNum === 5) {
      populateGroupByCheckboxes();
      updateHistoryTimeline(4, getFiltersSummary());
      // Activate run button when reaching the last step
      runQueryBtn.disabled = false;
      updateHistoryTimeline(5, getGroupingSummary());
    }
    
    // If going to step 2, update history for step 1
    if (stepNum === 2) {
      const selectedQuery = querySelect.options[querySelect.selectedIndex].text;
      updateHistoryTimeline(1, `Selected: ${selectedQuery}`);
    }
    
    // Update step indicators and buttons
    updateStepIndicators(stepNum);
    
    // Update current step tracker
    currentStep = stepNum;
  }

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
  
    // columnas elegidas
    const cols = items
      .filter(({alias})=>
        colCheckboxesEl.querySelector(`[data-alias="${alias}"]`)?.checked
      )
      .map(({expr,alias})=>({expr,alias}));
  
    if (!cols.length) {
      resultsDiv.textContent = 'Select at least one column.';
      return;
    }
  
    // agrupación seleccionada
    const groupBy = Array.from(groupByCheckboxesEl.querySelectorAll('input[type=checkbox]'))
      .filter(cb=>cb.checked)
      .map(cb=>cb.dataset.alias);
  
    // filtros: usa CONTAINS si hay agrupación, si no = para igualdad exacta
    const whereClauses = Array.from(filtersDiv.children)
      .map(row => {
        const [fs, vs] = row.querySelectorAll('select');
        if (fs.value && vs.value) {
          const op = groupBy.length ? 'CONTAINS' : '=';
          return `${fs.value} ${op} '${vs.value.replace(/'/g,"\\'")}'`;
        }
        return null;
      })
      .filter(Boolean);
  
    const limit = parseInt(maxRowsInput.value,10) || 100;
    const prefix = querySelect.value.replace(/RETURN[\s\S]*$/i, '').trim();
  
    let cypher = prefix;
    if (whereClauses.length) {
      cypher += '\nWHERE ' + whereClauses.join(' AND ');
    }
  
    if (groupBy.length) {
      // CONSULTA AGRUPADA
      const grp = groupBy
        .map(a => `${itemsMap[a]} AS ${a}`)
        .join(', ');
  
      const others = cols
        .map(c => c.alias)
        .filter(a => !groupBy.includes(a))
        .map(a => `collect(DISTINCT ${itemsMap[a]}) AS ${a}`);
  
      cypher += `\nRETURN ${grp}, count(*) AS Count${others.length ? ', ' + others.join(', '): ''}` +
                `\nORDER BY Count DESC\nLIMIT ${limit};`;
    } else {
      // CONSULTA SIMPLE
      const ret = cols.map(c=>`${c.expr} AS ${c.alias}`).join(', ');
      cypher += `\nRETURN ${ret} LIMIT ${limit};`;
    }
  
    // Ejecutar
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
    const stepIndicators = document.querySelectorAll('.step-button');
    stepIndicators.forEach((indicator, index) => {
      const stepNum = index + 1;
      indicator.classList.remove('active');
      
      if (stepNum === currentStepNum) {
        indicator.classList.add('active');
      }
    });
    
    // Update global navigation buttons
    globalBackBtn.disabled = currentStepNum <= 1;
    globalNextBtn.disabled = currentStepNum >= 5;
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
    if (colCheckboxesEl.querySelector('#col_all')?.checked) return "All columns selected";
    
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
    globalNextBtn.disabled = !this.value;
    
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