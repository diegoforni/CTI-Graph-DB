// Get secrets from environment (they'll be injected via Vercel)
const NEO4J_URI = import.meta.env.VITE_NEO4J_URI;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;

// Initialize the driver
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic('neo4j', NEO4J_PASSWORD)
);



// UI references
const runBtn = document.getElementById('runQuery');
const resultsDiv = document.getElementById('results');

// Query logic
async function runSampleQuery() {
  resultsDiv.innerHTML = '';

  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (:IP)-[a:ATACA]->(:PAIS) RETURN a.tecnica AS Tecnica, count(*) AS Frecuencia ORDER BY Frecuencia DESC'
    );

    let html = '<table><thead><tr><th>Técnica</th><th>Frecuencia</th></tr></thead><tbody>';
    result.records.forEach(record => {
      html += `<tr><td>${record.get('Tecnica')}</td><td>${record.get('Frecuencia')}</td></tr>`;
    });
    html += '</tbody></table>';

    resultsDiv.innerHTML = html;
  } catch (error) {
    console.error('Query error', error);
    resultsDiv.textContent = 'Error running query: ' + error.message;
  } finally {
    await session.close();
  }
}

runBtn.addEventListener('click', runSampleQuery);

window.addEventListener('beforeunload', async () => {
  await driver.close();
});
