// ─── Vercel secrets & driver ──────────────────────────────────────
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;
const neo4j  = window.neo4j;
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);

// UI refs
const selectEl           = document.getElementById('querySelect');
const runBtn             = document.getElementById('runQuery');
const resultsDiv         = document.getElementById('results');
const maxRowsInput       = document.getElementById('maxRows');
const colCheckboxesEl    = document.getElementById('colCheckboxes');
const filtersDiv         = document.getElementById('filters');
const addFilterBtn       = document.getElementById('addFilterBtn');
const groupByCheckboxesEl= document.getElementById('groupByCheckboxes');


// ─── UTILITIES ───────────────────────────────────────────────────
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


// ─── LOAD SCHEMA & POPULATE UI ────────────────────────────────────
async function loadSchemaAndPopulate() {
  selectEl.innerHTML = '<option>Loading…</option>';
  runBtn.disabled = true;

  const session = driver.session();
  try {
    const res       = await session.run('CALL apoc.meta.schema() YIELD value');
    const schemaMap = res.records[0].get('value');
    const templates = generateCypherQueries(schemaMap);

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
    populateGroupByCheckboxes();
    filtersDiv.innerHTML = '';
  } catch(err) {
    console.error(err);
    selectEl.innerHTML = '<option>Error loading schema</option>';
  } finally {
    await session.close();
  }
}
window.addEventListener('DOMContentLoaded', loadSchemaAndPopulate);
selectEl.addEventListener('change', ()=>{
  populateColumnCheckboxes();
  populateGroupByCheckboxes();
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

  // “All columns” master
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


// ─── GROUP‑BY CHECKBOXES ───────────────────────────────────────────
function populateGroupByCheckboxes() {
  const items = parseReturnItems(selectEl.value);
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


// ─── FILTER ROWS ────────────────────────────────────────────────────
addFilterBtn.addEventListener('click', addFilterRow);
function addFilterRow() {
  const items = parseReturnItems(selectEl.value);
  if (!items.length) return;
  const row = document.createElement('div');
  row.className = 'filterRow';

  // field select
  const fieldSelect = document.createElement('select');
  fieldSelect.innerHTML = `<option value="">-- choose field --</option>`;
  items.forEach(({expr,alias})=>{
    const o = document.createElement('option');
    o.value = expr;
    o.text  = toDisplayName(alias);
    fieldSelect.append(o);
  });

  // value select (populated on change)
  const valueSelect = document.createElement('select');
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
  remove.textContent = 'Remove';
  remove.addEventListener('click', ()=> filtersDiv.removeChild(row));

  row.append(fieldSelect, valueSelect, remove);
  filtersDiv.appendChild(row);
}

// load top‑100 distinct values for a field
async function loadFilterValues(expr, valueSelect) {
  valueSelect.innerHTML = '<option>Loading…</option>';
  valueSelect.disabled = true;
  const session = driver.session();
  try {
    const prefix = selectEl.value.replace(/RETURN[\s\S]*$/i, '').trim();
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


// ─── RUN THE FINAL QUERY ────────────────────────────────────────────
runBtn.addEventListener('click', runSelectedQuery);
async function runSelectedQuery() {
  const items = parseReturnItems(selectEl.value);
  const itemsMap = Object.fromEntries(items.map(({expr,alias})=>[alias,expr]));

  // chosen columns
  const cols = items
    .filter(({alias})=>
      colCheckboxesEl.querySelector(`[data-alias="${alias}"]`).checked
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
  const prefix = selectEl.value.replace(/RETURN[\s\S]*$/i, '').trim();

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


// ─── CLEANUP ───────────────────────────────────────────────────────
window.addEventListener('beforeunload', async () => {
  await driver.close();
});
