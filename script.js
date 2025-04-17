// Environment‑injected secrets (Vercel)
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;

// grab the global
const neo4j = window.neo4j;

// initialize driver
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);
const selectEl   = document.getElementById('querySelect');
const runBtn     = document.getElementById('runQuery');
const resultsDiv = document.getElementById('results');



// ─── 1) Build Cypher‑template generator ─────────────────────────────────────────

function generateCypherQueries(schema) {
  const queries = [];

  const buildReturn = (alias, props, prefix = '') =>
    props.length
      ? props.map(p => `${alias}.${p} AS ${prefix}${p}`).join(', ')
      : `${alias}  // no properties`;

  // node queries
  for (const [label, meta] of Object.entries(schema)) {
    if (meta.type !== 'node') continue;
    const props = Object.keys(meta.properties||{});
    const ret   = buildReturn('n', props);
    queries.push(
      `// All ${label} nodes\n` +
      `MATCH (n:${label})\n` +
      `RETURN ${ret};`
    );
  }

  // relationship queries
  for (const [relType, meta] of Object.entries(schema)) {
    if (meta.type !== 'relationship') continue;
    // find each outgoing usage of that relType
    for (const [startLabel, nodeMeta] of Object.entries(schema)) {
      if (nodeMeta.type !== 'node' || !nodeMeta.relationships) continue;
      const relDefs = nodeMeta.relationships[relType];
      if (!relDefs || relDefs.direction !== 'out') continue;

      relDefs.labels.forEach(endLabel => {
        const startProps = Object.keys(nodeMeta.properties||{});
        const relProps   = Object.keys(meta.properties||{});
        const endProps   = Object.keys((schema[endLabel]?.properties)||{});

        const retA = buildReturn('a', startProps, 'a_');
        const retR = buildReturn('r', relProps,   'r_');
        const retB = buildReturn('b', endProps,   'b_');

        const parts = [
          `// ${startLabel} -[${relType}]-> ${endLabel}`,
          `MATCH (a:${startLabel})-[r:${relType}]->(b:${endLabel})`,
          `RETURN ${retA}` +
            (startProps.length && relProps.length ? ', ' : '') +
            `${retR}` +
            ((startProps.length||relProps.length) && endProps.length ? ', ' : '') +
            `${retB};`
        ];
        queries.push(parts.join('\n'));
      });
    }
  }

  return queries;
}


// ─── 2) On load: fetch schema, populate dropdown ────────────────────────────────

async function loadSchemaAndPopulate() {
  selectEl.innerHTML = '<option>Loading schema…</option>';
  runBtn.disabled = true;

  const session = driver.session();
  try {
    // yield the value map
    const res = await session.run('CALL apoc.meta.schema() YIELD value');
    const schemaMap = res.records[0].get('value');

    const templates = generateCypherQueries(schemaMap);
    selectEl.innerHTML = '';
    templates.forEach((q, idx) => {
      const firstLine = q.split('\n')[0];
      const label     = firstLine.startsWith('//')
                          ? firstLine.slice(3).trim()
                          : `Query ${idx+1}`;
      const opt = document.createElement('option');
      opt.value       = q;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });

    selectEl.disabled = false;
    runBtn.disabled   = false;
  } catch(err) {
    console.error('Schema load error', err);
    selectEl.innerHTML = '<option>Error loading schema</option>';
  } finally {
    await session.close();
  }
}

window.addEventListener('DOMContentLoaded', loadSchemaAndPopulate);



// ─── 3) Run the chosen query ───────────────────────────────────────────────────

async function runSelectedQuery() {
  const cypher = selectEl.value;
  if (!cypher) return;

  resultsDiv.innerHTML = '';
  const session = driver.session();
  try {
    const res = await session.run(cypher);

    // build table header
    const keys = res.records.length
      ? res.records[0].keys
      : [];
    let html = '<table><thead><tr>' +
               keys.map(k => `<th>${k}</th>`).join('') +
               '</tr></thead><tbody>';

    // rows
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



// ─── 4) Cleanup ────────────────────────────────────────────────────────────────

window.addEventListener('beforeunload', async () => {
  await driver.close();
});
