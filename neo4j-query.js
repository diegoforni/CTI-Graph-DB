// Neo4j Query Handler
// This file should be loaded BEFORE ui-handler.js

// Create global object to store our functions
window.Neo4jQueryHandler = {};

// ─── Vercel secrets & driver ──────────────────────────────────────
const NEO4J_URI      = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;
const neo4j  = window.neo4j;
const driver = neo4j ? neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
) : null;

// ─── UTILIDADES ───────────────────────────────────────────────────
window.Neo4jQueryHandler.toDisplayName = function(alias) {
  return alias
    .replace(/_/g,' ')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/\b\w/g,c=>c.toUpperCase());
};

window.Neo4jQueryHandler.parseReturnItems = function(cypher) {
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
};

// ─── GENERADOR DE PLANTILLAS CYPHER ────────────────────────────────
window.Neo4jQueryHandler.generateCypherQueries = function(schema) {
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
};

// ─── CONSULTA AL ESQUEMA ────────────────────────────────────────────
window.Neo4jQueryHandler.fetchDatabaseSchema = async function() {
  const session = driver.session();
  try {
    const res = await session.run('CALL apoc.meta.schema() YIELD value');
    return res.records[0].get('value');
  } catch(err) {
    console.error("Error fetching schema:", err);
    throw err;
  } finally {
    await session.close();
  }
};

// ─── CARGAR VALORES DE FILTRO ───────────────────────────────────────
window.Neo4jQueryHandler.loadFilterValues = async function(expr, baseQuery) {
  const session = driver.session();
  try {
    const prefix = baseQuery.replace(/RETURN[\s\S]*$/i, '').trim();
    const q = `${prefix}
RETURN ${expr} AS val, count(*) AS freq
ORDER BY freq DESC
LIMIT 100;`;
    const res = await session.run(q);
    return res.records.map(r => r.get('val'));
  } catch(err) {
    console.error("Error loading filter values:", err);
    throw err;
  } finally {
    await session.close();
  }
};

// ─── EJECUTAR CONSULTA FINAL ────────────────────────────────────────
window.Neo4jQueryHandler.executeQuery = async function(cypher) {
  const session = driver.session();
  try {
    const res = await session.run(cypher);
    const keys = res.records[0]?.keys || [];
    const records = res.records.map(record => {
      const row = {};
      keys.forEach(key => {
        row[key] = record.get(key);
      });
      return row;
    });
    
    return { keys, records };
  } catch(err) {
    console.error("Query execution error:", err);
    throw err;
  } finally {
    await session.close();
  }
};

// ─── CONSTRUIR CONSULTA FINAL ────────────────────────────────────────
window.Neo4jQueryHandler.buildFinalQuery = function({
  baseQuery,
  selectedColumns,
  filters,
  groupBy,
  maxRows
}) {
  const items = window.Neo4jQueryHandler.parseReturnItems(baseQuery);
  const itemsMap = Object.fromEntries(items.map(({expr, alias}) => [alias, expr]));
  
  // Columnas seleccionadas
  const cols = selectedColumns.map(alias => ({
    expr: itemsMap[alias],
    alias
  }));
  
  if (!cols.length) {
    throw new Error('Select at least one column.');
  }
  
  // Filtros
  const whereClauses = filters
    .filter(f => f.field && f.value)
    .map(f => {
      const op = groupBy.length ? 'CONTAINS' : '=';
      return `${f.field} ${op} '${f.value.replace(/'/g, "\\'")}'`;
    });
  
  const limit = parseInt(maxRows, 10) || 100;
  const prefix = baseQuery.replace(/RETURN[\s\S]*$/i, '').trim();
  
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
    const ret = cols.map(c => `${c.expr} AS ${c.alias}`).join(', ');
    cypher += `\nRETURN ${ret} LIMIT ${limit};`;
  }
  
  return cypher;
};

window.Neo4jQueryHandler.closeDriver = async function() {
  if (driver) {
    await driver.close();
  }
};