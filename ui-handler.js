// UI Interaction Handler
// This file should be loaded AFTER neo4j-query.js

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
  
    // Contenedores de pasos
    const step1 = document.getElementById('step1');
    const step2 = document.getElementById('step2');
    const step3 = document.getElementById('step3');
    const step4 = document.getElementById('step4');
    const step5 = document.getElementById('step5');
  
    // Global navigation buttons
    const globalBackBtn = document.getElementById('globalBack');
    const globalNextBtn = document.getElementById('globalNext');
  
    // Track current step
    let currentStep = 1;
  
    // Acceso a funciones del handler Neo4j
    const handler = window.Neo4jQueryHandler;
  
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
      const items = handler.parseReturnItems(querySelect.value);
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
      all.addEventListener('change', () => {
        colCheckboxesEl.querySelectorAll('input[data-expr]')
          .forEach(cb => cb.checked = all.checked);
      });
      colCheckboxesEl.append(all, allLbl, document.createElement('br'));
  
      items.forEach(({expr, alias}) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.id = `col_${alias}`;
        cb.dataset.expr = expr;  cb.dataset.alias = alias;
        cb.checked = true;
        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id; lbl.textContent = handler.toDisplayName(alias);
        colCheckboxesEl.append(cb, lbl, document.createElement('br'));
      });
  
      colCheckboxesEl.style.display = 'block';
    }
  
    // ─── CASILLAS DE VERIFICACIÓN GROUP-BY ────────────────────────────────
    function populateGroupByCheckboxes() {
      const items = handler.parseReturnItems(querySelect.value);
      groupByCheckboxesEl.innerHTML = '';
      if (!items.length) return;
  
      items.forEach(({expr, alias}) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.id = `gb_${alias}`;
        cb.dataset.expr = expr;  cb.dataset.alias = alias;
        const lbl = document.createElement('label');
        lbl.htmlFor = cb.id; lbl.textContent = handler.toDisplayName(alias);
        groupByCheckboxesEl.append(cb, lbl, document.createElement('br'));
      });
    }
  
    // ─── FILAS DE FILTRO ────────────────────────────────────────────────
    function addFilterRow() {
      const items = handler.parseReturnItems(querySelect.value);
      if (!items.length) return;
      
      const row = document.createElement('div');
      row.className = 'filter-row';
  
      // field select
      const fieldSelect = document.createElement('select');
      fieldSelect.className = 'filter-field';
      fieldSelect.innerHTML = `<option value="">-- choose field --</option>`;
      items.forEach(({expr, alias}) => {
        const o = document.createElement('option');
        o.value = expr;
        o.text = handler.toDisplayName(alias);
        fieldSelect.append(o);
      });
  
      // value select (populated on change)
      const valueSelect = document.createElement('select');
      valueSelect.className = 'filter-value';
      valueSelect.disabled = true;
      valueSelect.innerHTML = '<option>—</option>';
  
      fieldSelect.addEventListener('change', async () => {
        const expr = fieldSelect.value;
        if (!expr) {
          valueSelect.innerHTML = '<option>—</option>';
          valueSelect.disabled = true;
        } else {
          await populateFilterValues(expr, valueSelect);
        }
      });
  
      // remove
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-filter';
      remove.textContent = '✕';
      remove.addEventListener('click', () => filtersDiv.removeChild(row));
  
      row.append(fieldSelect, valueSelect, remove);
      filtersDiv.appendChild(row);
    }
  
    async function populateFilterValues(expr, valueSelect) {
      valueSelect.innerHTML = '<option>Loading…</option>';
      valueSelect.disabled = true;
      
      try {
        const values = await handler.loadFilterValues(expr, querySelect.value);
        
        valueSelect.innerHTML = '';
        values.forEach(value => {
          const o = document.createElement('option');
          o.value = value; 
          o.text = value;
          valueSelect.append(o);
        });
        valueSelect.disabled = false;
      } catch(err) {
        console.error(err);
        valueSelect.innerHTML = '<option>Error</option>';
      }
    }
  
    // ─── EJECUTAR LA CONSULTA FINAL ────────────────────────────────────────
    async function runSelectedQuery() {
      // Mostrar el contenedor de resultados
      resultsDiv.classList.remove('hidden');
      resultsDiv.innerHTML = '<p>Executing query...</p>';
      
      try {
        // Obtener columnas seleccionadas
        const selectedColumns = Array.from(colCheckboxesEl.querySelectorAll('input[data-expr]:checked'))
          .map(cb => cb.dataset.alias);
        
        // Obtener filtros
        const filters = Array.from(filtersDiv.children)
          .map(row => {
            const [fieldSelect, valueSelect] = row.querySelectorAll('select');
            return {
              field: fieldSelect.value,
              value: valueSelect.value
            };
          });
        
        // Obtener agrupación
        const groupBy = Array.from(groupByCheckboxesEl.querySelectorAll('input[type=checkbox]:checked'))
          .map(cb => cb.dataset.alias);
        
        // Construir consulta final
        const cypher = handler.buildFinalQuery({
          baseQuery: querySelect.value,
          selectedColumns,
          filters,
          groupBy,
          maxRows: maxRowsInput.value
        });
        
        // Ejecutar consulta
        const { keys, records } = await handler.executeQuery(cypher);
        
        // Mostrar resultados
        let html = '<table><thead><tr>' +
                  keys.map(k => `<th>${handler.toDisplayName(k)}</th>`).join('') +
                  '</tr></thead><tbody>';
        
        records.forEach(record => {
          html += '<tr>' + 
                  keys.map(k => `<td>${record[k]}</td>`).join('') + 
                  '</tr>';
        });
        
        html += '</tbody></table>';
        resultsDiv.innerHTML = html;
      } catch(err) {
        console.error(err);
        resultsDiv.textContent = 'Error: ' + err.message;
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
        .map(cb => handler.toDisplayName(cb.dataset.alias));
      
      if (groupByCols.length === 0) return "No grouping applied";
      
      return groupByCols.length > 2
        ? `Grouped by ${groupByCols.length} columns`
        : `Grouped by: ${groupByCols.join(', ')}`;
    }
  
    // ─── CARGAR ESQUEMA Y POPULAR UI ────────────────────────────────────
    async function loadSchemaAndPopulate() {
      querySelect.innerHTML = '<option>Loading schema…</option>';
      runQueryBtn.disabled = true;
      globalNextBtn.disabled = false;
  
      try {
        const schemaMap = await handler.fetchDatabaseSchema();
        const templates = handler.generateCypherQueries(schemaMap);
  
        querySelect.innerHTML = '';
        templates.forEach((q, i) => {
          const label = q.split('\n')[0].replace(/^\/\/\s*/, '') || `Query ${i+1}`;
          const opt = document.createElement('option');
          opt.value = q;
          opt.text = label;
          querySelect.append(opt);
        });
  
        querySelect.disabled = false;
        runQueryBtn.disabled = true;
      } catch(err) {
        console.error(err);
        querySelect.innerHTML = '<option>Error loading schema</option>';
      }
    }
  
    // ─── EVENTOS ───────────────────────────────────────────────────────
    
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
    
    // Ejecutar consulta
    runQueryBtn.addEventListener('click', runSelectedQuery);
    
    // Agregar filtro
    addFilterBtn.addEventListener('click', addFilterRow);
    
    // Actualizar el resumen de columnas cuando se modifican las selecciones
    colCheckboxesEl.addEventListener('change', function(e) {
      if (e.target.type === 'checkbox') {
        updateHistoryTimeline(3, getSelectedColumnsSummary());
      }
    });
    
    // Actualizar el resumen de agrupación cuando se modifican
    groupByCheckboxesEl.addEventListener('change', function(e) {
      if (e.target.type === 'checkbox') {
        updateHistoryTimeline(5, getGroupingSummary());
      }
    });
    
    // Actualizar el resumen de filtros cuando se modifican
    filtersDiv.addEventListener('change', function(e) {
      if (e.target.tagName === 'SELECT') {
        updateHistoryTimeline(4, getFiltersSummary());
      }
    });
    
    querySelect.addEventListener('change', function() {
      globalNextBtn.disabled = !this.value;
      
      if (this.value) {
        const selectedQueryName = this.options[this.selectedIndex].text;
        updateHistoryTimeline(1, `Selected: ${selectedQueryName}`);
      }
    });
    
    // ─── INICIALIZACIÓN ────────────────────────────────────────────────
    
    // Cargar esquema al iniciar la aplicación
    loadSchemaAndPopulate();
    
    // ─── CLEANUP ───────────────────────────────────────────────────────
    window.addEventListener('beforeunload', async () => {
      await handler.closeDriver();
    });
  });