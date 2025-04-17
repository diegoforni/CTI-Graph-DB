// ─── Vercel secrets ─────────────────────────────────────────────
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;

// pull in browser bundle
const neo4j  = window.neo4j;
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);

// UI refs
const selectEl        = document.getElementById('querySelect');
const runBtn          = document.getElementById('runQuery');
const resultsDiv      = document.getElementById('results');
const maxRowsInput    = document.getElementById('maxRows');
const colCheckboxesEl = document.getElementById('colCheckboxes');
const filtersDiv      = document.getElementById('filters');
const addFilterBtn    = document.getElementById('addFilterBtn');



// ─── UTILS ───────────────────────────────────────────────────────

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



// ─── CYPHER TEMPLATE GENERATOR ────────────────────────────────────

function generateCypherQueries(schema) {
  const queries = [];
  const buildReturn = (varName, props, prefix) =>
    props.length
      ? props.map(p=>`${varName}.${p} AS ${prefix}${p}`).join(', ')
      : varName;

  // node queries
  for (const [label,meta] of Object.entries(schema)) {
    if (meta.type!=='node') continue;
    const alias = label.toLowerCase();
    const props = Object.keys(meta.properties||{});
    const ret   = buildReturn(alias, props, label+'_');
    queries.push(
      `// All ${label} nodes\n`+
      `MATCH (${alias}:${label})\n`+
      `RETURN ${ret};`
    );
  }

  // relationship queries
  for (const [rtype,rmeta] of Object.entries(schema)) {
    if (rmeta.type!=='relationship') continue;
    for (const [sLabel,smeta] of Object.entries(schema)) {
      if (smeta.type!=='node'||!smeta.relationships) continue;
      const relDef = smeta.relationships[rtype];
      if (!relDef||relDef.direction!=='out') continue;

      relDef.labels.forEach(eLabel=>{
        const sAlias = sLabel.toLowerCase();
        const rAlias = rtype.toLowerCase();
        const eAlias = eLabel.toLowerCase();

        const sProps = Object.keys(smeta.properties||{});
        const rProps = Object.keys(rmeta.properties||{});
        const eProps = Object.keys((schema[eLabel]?.properties)||{});

        const retS = buildReturn(sAlias, sProps, sLabel+'_');
        const retR = buildReturn(rAlias, rProps, rtype+'_');
        const retE = buildReturn(eAlias, eProps, eLabel+'_');

        queries.push(
          `// ${sLabel} -[${rtype}]-> ${eLabel}\n`+
          `MATCH (${sAlias}:${sLabel})-[${rAlias}:${rtype}]->(${eAlias}:${eLabel})\n`+
          `RETURN ${retS}` +
            (sProps.length&&rProps.length?', ':'') +
            `${retR}` +
            ((sProps.length||rProps.length)&&eProps.length?', ':'') +
            `${retE};`
        );
      });
    }
  }

  return queries;
}



// ─── LOAD SCHEMA & POPULATE ────────────────────────────────────────

async function loadSchemaAndPopulate() {
  selectEl.innerHTML = '<option>Loading…</option>';
  runBtn.disabled = true;

  const session = driver.session();
  try {
    const res       = await session.run('CALL apoc.meta.schema() YIELD value');
    const schemaMap = res.records[0].get('value');
    const templates = generateCypherQueries(schemaMap);

    // fill dropdown
    selectEl.innerHTML = '';
    templates.forEach((q,i)=>{
      const label = q.split('\n')[0].replace(/^\/\/\s*/,'')||`Query ${i+1}`;
      const opt   = document.createElement('option');
      opt.value   = q;
      opt.text    = label;
      selectEl.append(opt);
    });

    selectEl.disabled = false;
    runBtn.disabled   = false;
    populateColumnCheckboxes();
    filtersDiv.innerHTML = '';
  } catch(err) {
    console.error(err);
    selectEl.innerHTML = '<option>Error</option>';
  } finally {
    await session.close();
  }
}

window.addEventListener('DOMContentLoaded', loadSchemaAndPopulate);
selectEl.addEventListener('change',()=>{
  populateColumnCheckboxes();
  filtersDiv.innerHTML = '';
});



// ─── COLUMN CHECKBOXES ─────────────────────────────────────────────

function populateColumnCheckboxes() {
  const items = parseReturnItems(selectEl.value);

  colCheckboxesEl.innerHTML = '';
  if (!items.length) {
    colCheckboxesEl.style.display = 'none';
    return;
  }

  const allBox = document.createElement('input');
  allBox.type    = 'checkbox';
  allBox.id      = 'col_all';
  allBox.checked = true;
  const allLbl   = document.createElement('label');
  allLbl.htmlFor = 'col_all';
  allLbl.textContent = 'All columns';
  allBox.addEventListener('change', ()=>{
    colCheckboxesEl.querySelectorAll('input[data-expr]').forEach(cb=>{
      cb.checked = allBox.checked;
    });
  });

  colCheckboxesEl.append(allBox, allLbl, document.createElement('br'));

  items.forEach(({expr,alias})=>{
    const cb  = document.createElement('input');
    cb.type   = 'checkbox';
    cb.id     = `col_${alias}`;
    cb.dataset.expr  = expr;
    cb.dataset.alias = alias;
    cb.checked = true;
    const lbl = document.createElement('label');
    lbl.htmlFor    = cb.id;
    lbl.textContent = toDisplayName(alias);
    colCheckboxesEl.append(cb, lbl, document.createElement('br'));
  });

  colCheckboxesEl.style.display = 'block';
}



// ─── FILTER ROWS ─────────────────────────────────────────────────────

// Fetch the top‐100 values for a given expression, descending by count
async function loadFilterValues(expr, valueSelect) {
    valueSelect.innerHTML = '<option>Loading…</option>';
    valueSelect.disabled = true;
    const session = driver.session();
    try {
      // Build a little aggregation query using the same MATCH clause
      const prefix = selectEl.value.replace(/RETURN[\s\S]*$/i, '').trim();
      const q = `${prefix}
  RETURN ${expr} AS val, count(*) AS freq
  ORDER BY freq DESC
  LIMIT 100;`;
  
      const res = await session.run(q);
  
      // populate dropdown
      valueSelect.innerHTML = '';
      res.records.forEach(rec => {
        const v = rec.get('val');
        const opt = document.createElement('option');
        opt.value   = v;
        opt.text    = v;
        valueSelect.append(opt);
      });
      valueSelect.disabled = false;
    } catch (err) {
      console.error('Value‑load error', err);
      valueSelect.innerHTML = '<option>Error</option>';
    } finally {
      await session.close();
    }
  }
  
  // Override addFilterRow:
  function addFilterRow() {
    const items = parseReturnItems(selectEl.value);
    if (!items.length) return;
  
    const row = document.createElement('div');
    row.className = 'filterRow';
  
    // 1) filter‑by dropdown
    const fieldSelect = document.createElement('select');
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.text  = '-- choose field --';
    fieldSelect.append(emptyOpt);
  
    items.forEach(({expr, alias}) => {
      const opt = document.createElement('option');
      opt.value = expr;
      opt.text  = toDisplayName(alias);
      fieldSelect.append(opt);
    });
  
    // 2) value dropdown (initially empty/disabled)
    const valueSelect = document.createElement('select');
    valueSelect.disabled = true;
    valueSelect.innerHTML = '<option>—</option>';
  
    // when the user picks a field, load its values
    fieldSelect.addEventListener('change', () => {
      const expr = fieldSelect.value;
      if (!expr) {
        valueSelect.innerHTML = '<option>—</option>';
        valueSelect.disabled = true;
      } else {
        loadFilterValues(expr, valueSelect);
      }
    });
  
    // 3) remove button
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      filtersDiv.removeChild(row);
    });
  
    row.append(fieldSelect, valueSelect, removeBtn);
    filtersDiv.appendChild(row);
  }
  
  addFilterBtn.addEventListener('click', addFilterRow);



// ─── RUN QUERY ───────────────────────────────────────────────────────

async function runSelectedQuery() {
  // collect columns
  const cols = Array.from(colCheckboxesEl.querySelectorAll('input[data-expr]'))
    .filter(cb=>cb.checked)
    .map(cb=>({expr:cb.dataset.expr, alias:cb.dataset.alias}));
  if (!cols.length) {
    resultsDiv.textContent = 'Select at least one column.';
    return;
  } 

  

    // build WHERE
  const whereClauses = Array.from(filtersDiv.children)
    .map(row => {
      const [fieldSelect, valueSelect] = row.querySelectorAll('select');
      const expr  = fieldSelect.value;
      const value = valueSelect.value;
      return (expr && value)
        ? `${expr} = '${value.replace(/'/g,"\\'")}'`
        : null;
    })
    .filter(Boolean);

  const limit = parseInt(maxRowsInput.value,10) || 100;
  const prefix = selectEl.value.replace(/RETURN[\s\S]*$/i,'').trim();

  let cypher = prefix;
  if (whereClauses.length) {
    cypher += '\nWHERE ' + whereClauses.join(' AND ');
  }
  cypher += '\nRETURN ' +
    cols.map(c=>`${c.expr} AS ${c.alias}`).join(', ') +
    ` LIMIT ${limit};`;

  // run it
  resultsDiv.innerHTML = '';
  const session = driver.session();
  try {
    const res = await session.run(cypher);
    const keys = res.records[0]?.keys||[];
    let html = '<table><thead><tr>' +
               keys.map(k=>`<th>${toDisplayName(k)}</th>`).join('') +
               '</tr></thead><tbody>';
    res.records.forEach(r=>{
      html += '<tr>' +
              keys.map(k=>`<td>${r.get(k)}</td>`).join('') +
              '</tr>';
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

runBtn.addEventListener('click', runSelectedQuery);



// ─── CLEANUP ────────────────────────────────────────────────────────
window.addEventListener('beforeunload',async()=>await driver.close());
