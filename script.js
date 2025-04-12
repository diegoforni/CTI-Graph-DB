// Get secrets from environment (they'll be injected via Vercel)
const NEO4J_URI = import.meta.env.VITE_NEO4J_URI;
const NEO4J_USER = import.meta.env.VITE_NEO4J_USER;
const NEO4J_PASSWORD = import.meta.env.VITE_NEO4J_PASSWORD;

// Initialize the driver
const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
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
      'MATCH (p:Person)-[r:FRIENDS_WITH]->(friend) RETURN p.name AS name, friend.name AS friend'
    );

    let html = '<table><thead><tr><th>Person</th><th>Friend</th></tr></thead><tbody>';
    result.records.forEach(record => {
      html += `<tr><td>${record.get('name')}</td><td>${record.get('friend')}</td></tr>`;
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
