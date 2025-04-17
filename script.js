// script.js

// ─── Vercel‑injected secrets ────────────────────────────────────────────────
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;

// pull in the global browser bundle
const neo4j  = window.neo4j;
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);

// UI elements
const selectEl         = document.getElementById('querySelect');
const runBtn           = document.getElementById('runQuery');
const resultsDiv       = document.getElementById('results');
const maxRowsInput     = document.getElementById('maxRows');
const colCheckboxesEl  = document.getElementById('colCheckboxes');



// ─── UTILITIES ─────────────────────────────────────────────────────────────

function toDisplayName(alias) {
  return alias
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseReturnItems(cypher) {
  const m = cypher.match(/RETURN\s+([\s\S]*?);?$/i);
  if (!m) return [];
  return m[1]
    .split(',')
    .map(s => s.trim())
    .map(item => {
      const parts = item.split(/\s+AS\s+/i);
      return parts.length === 2
        ? { expr: parts[0], alias: parts[1] }
        : null;
    })
    .filter(Boolean);
}



// ─── GENERATE CYPHER TEMPLATES ───────────────────────────────────────────────

function generateCypherQueries(schema) {
  const queries = [];

  const buildReturn = (varName, props, prefix) =>
    props.length
      ? props.map(p => `${varName}.${p} AS ${prefix}${p}`).join(', ')
      : `${varName}`; // no props → return the entire node/rel

  // 1) Node queries
  for (const [label, meta] of Object.entries(schema)) {
    if (meta.type !== 'node') continue;
    const aliasName = label.toLowerCase();
    const props     = Object.keys(meta.properties||{});
    const ret       = buildReturn(aliasName, props, `${label}_`);
    queries.push(
      `// All ${label} nodes\n` +
      `MATCH (${aliasName}:${label})\n` +
      `RETURN ${ret};`
    );
  }

  // 2) Relationship queries
  for (const [relType, relMeta] of Object.entries(schema)) {
    if (relMeta.type !== 'relationship') continue;

    for (const [startLabel, nodeMeta] of Object.entries(schema)) {
      if (nodeMeta.type !== 'node' || !nodeMeta.relationships) continue;
      const relDef = nodeMeta.relationships[relType];
      if (!relDef || relDef.direction !== 'out') continue;

      relDef.labels.forEach(endLabel => {
        const startAlias = startLabel.toLowerCase();
        const relAlias   = relType.toLowerCase();
        const endAlias   = endLabel.toLowerCase();

        const startProps = Object.keys(nodeMeta.properties||{});
        const relProps   = Object.keys(relMeta.properties||{});
        const endProps   = Object.keys((schema[endLabel]?.properties)||{});

        const retStart = buildReturn(startAlias, startProps, `${startLabel}_`);
        const retRel   = buildReturn(relAlias,   relProps,   `${relType}_`);
        const retEnd   = buildReturn(endAlias,   endProps,   `${endLabel}_`);

        queries.push(
          `// ${startLabel} -[${relType}]-> ${endLabel}\n` +
          `MATCH (${startAlias}:${startLabel})-[${relAlias}:${relType}]->(${endAlias}:${endLabel})\n` +
          `RETURN ${retStart}` +
            (startProps.length && relProps.length ? ', ' : '') +
            `${retRel}` +
            ((startProps.length||relProps.length) && endProps.length ? ', ' : '') +
            `${retEnd};`
        );
      });
    }
  }

  return queries;
}


// ─── LOAD SCHEMA & POPULATE DROPDOWN ────────────────────────────────────────

async function loadSchemaAndPopulate() {
  selectEl.innerHTML = '<option>Loading schema…</option>';
  runBtn.disabled = true;

  const session = driver.session();
  try {
    const res       = await session.run('CALL apoc.meta.schema() YIELD value');
    const schemaMap = res.records[0].get('value');
    const templates = generateCypherQueries(schemaMap);

    selectEl.innerHTML = '';
    templates.forEach((q, idx) => {
      const label = q.split('\n')[0].replace(/^\/\/\s*/, '') || `Query ${idx+1}`;
      const opt   = document.createElement('option');
      opt.value   = q;
      opt.text    = label;
      selectEl.append(opt);
    });

    selectEl.disabled = false;
    runBtn.disabled   = false;
    populateColumnCheckboxes();
  } catch(err) {
    console.error('Schema load error', err);
    selectEl.innerHTML = '<option>Error loading schema</option>';
  } finally {
    await session.close();
  }
}

window.addEventListener('DOMContentLoaded', loadSchemaAndPopulate);
selectEl.addEventListener('change', populateColumnCheckboxes);



// ─── BUILD COLUMN CHECKBOXES ────────────────────────────────────────────────

function populateColumnCheckboxes() {
  const cypher = selectEl.value;
  const items  = parseReturnItems(cypher);

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

  allBox.addEventListener('change', () => {
    colCheckboxesEl.querySelectorAll('input[data-expr]').forEach(cb => {
      cb.checked = allBox.checked;
    });
  });

  colCheckboxesEl.append(allBox, allLbl, document.createElement('br'));

  items.forEach(({expr, alias}) => {
    const cb  = document.createElement('input');
    cb.type   = 'checkbox';
    cb.id     = `col_${alias}`;
    cb.value  = alias;
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



// ─── RUN THE CUSTOMIZED QUERY ───────────────────────────────────────────────

async function runSelectedQuery() {
  const origCypher = selectEl.value;
  const items = Array.from(colCheckboxesEl.querySelectorAll('input[data-expr]'))
    .filter(cb => cb.checked)
    .map(cb => ({ expr: cb.dataset.expr, alias: cb.dataset.alias }));

  if (!items.length) {
    resultsDiv.textContent = 'Select at least one column.';
    return;
  }

  const limit = parseInt(maxRowsInput.value, 10) || 100;
  const prefix = origCypher.replace(/RETURN[\s\S]*$/i, '').trim();
  const retClause = 
    'RETURN ' +
    items.map(({expr,alias}) => `${expr} AS ${alias}`).join(', ') +
    ` LIMIT ${limit};`;
  const cypher = `${prefix}\n${retClause}`;

  resultsDiv.innerHTML = '';
  const session = driver.session();
  try {
    const res = await session.run(cypher);

    const keys = res.records[0]?.keys || [];
    let html = '<table><thead><tr>' +
               keys.map(k => `<th>${toDisplayName(k)}</th>`).join('') +
               '</tr></thead><tbody>';

    res.records.forEach(r => {
      html += '<tr>' +
              keys.map(k => `<td>${r.get(k)}</td>`).join('') +
              '</tr>';
    });
    html += '</tbody></table>';

    resultsDiv.innerHTML = html;
  } catch(err) {
    console.error('Query error', err);
    resultsDiv.textContent = 'Error: ' + err.message;
  } finally {
    await session.close();
  }
}

runBtn.addEventListener('click', runSelectedQuery);

// ─── CLEANUP ────────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', async () => {
  await driver.close();
});
