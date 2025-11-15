const { Client } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const client = new Client({
  host: 'localhost',
  port: 5433,
  database: 'puzzle_db',
  user: 'puzzle_user',
  password: 'puzzle_password',
});

const LAST_ID_FILE = path.join(__dirname, 'lastId.txt');

async function loadLastId() {
  try {
    const data = await fs.readFile(LAST_ID_FILE, 'utf8');
    const lastId = data.trim();
    return lastId || null;
  } catch (error) {
    // File doesn't exist or can't be read, start from null
    return null;
  }
}

async function saveLastId(lastId) {
  try {
    await fs.writeFile(LAST_ID_FILE, lastId, 'utf8');
  } catch (error) {
    console.error(`Warning: Could not save lastId to file: ${error.message}`);
  }
}

async function batchUpdate() {
  try {
    await client.connect();
    console.log('Connected to database');

    // Load lastId from file or start from null
    let lastId = await loadLastId();
    if (lastId) {
      console.log(`Resuming from lastId: ${lastId}`);
    }

    let totalUpdated = 0;
    let batchNumber = 1;
    const batchSize = 1000;

    while (true) {
      // Select rows that need updating with cursor-based paging
      // Handle UUID comparison - PostgreSQL can compare UUIDs directly
      const selectQuery = lastId
        ? `
          SELECT d.id
          FROM dictionary d
          WHERE d.relations IS NULL
            AND d.id > $1::uuid
          ORDER BY d.id
          LIMIT $2
        `
        : `
          SELECT d.id
          FROM dictionary d
          WHERE d.relations IS NULL
          ORDER BY d.id
          LIMIT $1
        `;

      const result = lastId
        ? await client.query(selectQuery, [lastId, batchSize])
        : await client.query(selectQuery, [batchSize]);

      if (result.rows.length === 0) {
        console.log('\nNo more rows to update. Process complete!');
        break;
      }

      console.log(`\nBatch ${batchNumber}: Processing ${result.rows.length} rows...`);

      // Update all rows in this batch with a single query
      const ids = result.rows.map(row => row.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
      
      const updateQuery = `
        UPDATE dictionary d
        SET relations = (
          SELECT d2.relations 
          FROM dictionary_v2 d2 
          WHERE d2.word = d.word
        )
        WHERE d.relations IS NULL
          AND d.id IN (${placeholders})
      `;

      const updateResult = await client.query(updateQuery, ids);
      const batchUpdated = updateResult.rowCount;

      totalUpdated += batchUpdated;
      console.log(`  Updated ${batchUpdated} rows in this batch`);
      console.log(`  Total updated so far: ${totalUpdated}`);

      // Update lastId to the maximum ID from this batch for next iteration
      // For UUIDs, we need to sort as strings and take the last one
      if (ids.length > 0) {
        // Sort UUIDs as strings and take the last (maximum) one
        const sortedIds = [...ids].sort();
        lastId = sortedIds[sortedIds.length - 1];
        await saveLastId(lastId);
        console.log(`  LastId saved: ${lastId}`);
      } else {
        break;
      }
      batchNumber++;

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n=== Final Summary ===`);
    console.log(`Total rows updated: ${totalUpdated}`);
    console.log(`Total batches processed: ${batchNumber - 1}`);
    
    // Clear lastId file when complete
    try {
      await fs.unlink(LAST_ID_FILE);
      console.log('LastId file cleared (process complete)');
    } catch (error) {
      // File might not exist, ignore
    }

  } catch (error) {
    console.error('Error:', error);
    console.log(`\nProgress saved. Resume from lastId: ${lastId}`);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

batchUpdate();

