const { Client } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const client = new Client({
  host: 'localhost',
  port: 5433,
  database: 'puzzle_db',
  user: 'puzzle_user',
  password: 'puzzle_password',
});

const LAST_ID_FILE = path.join(__dirname, 'lastId.txt');
const LOG_FILE = path.join(__dirname, 'migration.log');

// Logging utility
class Logger {
  constructor(logFile) {
    this.logFile = logFile;
    this.logStream = null;
  }

  initialize() {
    try {
      // Open log file in append mode
      this.logStream = fsSync.createWriteStream(this.logFile, { flags: 'a' });
      this.log('=== Migration started ===');
    } catch (error) {
      // Fallback to console if file logging fails
      console.error('Failed to initialize log file:', error.message);
    }
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  log(message) {
    const timestamp = this.getTimestamp();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
      if (this.logStream) {
        this.logStream.write(logMessage);
      } else {
        // Fallback to console if stream not initialized
        console.log(message);
      }
    } catch (error) {
      // Fallback to console on error
      console.error('Logging error:', error.message);
      console.log(message);
    }
  }

  error(message, error = null) {
    const errorMessage = error ? `${message}: ${error.message || error}` : message;
    this.log(`ERROR: ${errorMessage}`);
  }

  close() {
    try {
      if (this.logStream) {
        this.log('=== Migration ended ===\n');
        this.logStream.end();
      }
    } catch (error) {
      console.error('Error closing log file:', error.message);
    }
  }
}

const logger = new Logger(LOG_FILE);

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
    logger.error(`Warning: Could not save lastId to file`, error);
  }
}

async function batchUpdate() {
  try {
    logger.initialize();
    await client.connect();
    logger.log('Connected to database');

    // Load lastId from file or start from null
    let lastId = await loadLastId();
    if (lastId) {
      logger.log(`Resuming from lastId: ${lastId}`);
    }

    let totalUpdated = 0;
    let totalInserted = 0;
    let batchNumber = 1;
    const batchSize = 1000;

    while (true) {
      // Select rows from dictionary_v2 with cursor-based paging
      // We'll process all words from dictionary_v2
      const selectQuery = lastId
        ? `
          SELECT d2.id, d2.word, d2.meaning, d2.relations
          FROM dictionary_v2 d2
          WHERE d2.id > $1::uuid
          ORDER BY d2.id
          LIMIT $2
        `
        : `
          SELECT d2.id, d2.word, d2.meaning, d2.relations
          FROM dictionary_v2 d2
          ORDER BY d2.id
          LIMIT $1
        `;

      const result = lastId
        ? await client.query(selectQuery, [lastId, batchSize])
        : await client.query(selectQuery, [batchSize]);

      if (result.rows.length === 0) {
        logger.log('No more rows to process. Process complete!');
        break;
      }

      logger.log(`Batch ${batchNumber}: Processing ${result.rows.length} rows...`);

      let batchUpdated = 0;
      let batchInserted = 0;

      // Process each row: update meaning if word exists, insert new row if it doesn't
      for (const row of result.rows) {
        // Check if word already exists in dictionary
        const checkQuery = `SELECT id FROM dictionary WHERE word = $1 LIMIT 1`;
        const checkResult = await client.query(checkQuery, [row.word]);
        
        if (checkResult.rows.length > 0) {
          // Word exists - update the meaning and relations columns
          const updateQuery = `
            UPDATE dictionary
            SET meaning = $1, relations = $2
            WHERE word = $3
          `;
          await client.query(updateQuery, [row.meaning, row.relations || null, row.word]);
          batchUpdated++;
        } else {
          // Word doesn't exist - insert new row with all required columns
          const insertQuery = `
            INSERT INTO dictionary (id, word, meaning, created_at, source, language, relations)
            VALUES (
              gen_random_uuid(),
              $1,
              $2,
              NOW(),
              'wiktionary',
              'english',
              $3
            )
          `;
          await client.query(insertQuery, [
            row.word,
            row.meaning,
            row.relations || null
          ]);
          batchInserted++;
        }
      }

      totalUpdated += batchUpdated;
      totalInserted += batchInserted;

      logger.log(`  Updated ${batchUpdated} rows in this batch`);
      logger.log(`  Inserted ${batchInserted} rows in this batch`);
      logger.log(`  Total updated so far: ${totalUpdated}`);
      console.log(`  Total updated so far: ${totalUpdated}`);
      logger.log(`  Total inserted so far: ${totalInserted}`);
      console.log(`  Total inserted so far: ${totalInserted}`);

      // Update lastId for next iteration - use the last ID from dictionary_v2
      if (result.rows.length > 0) {
        lastId = result.rows[result.rows.length - 1].id;
        await saveLastId(lastId);
        logger.log(`  LastId saved: ${lastId}`);
      } else {
        break;
      }
      batchNumber++;

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.log('=== Final Summary ===');
    logger.log(`Total rows updated: ${totalUpdated}`);
    logger.log(`Total rows inserted: ${totalInserted}`);
    logger.log(`Total rows processed: ${totalUpdated + totalInserted}`);
    logger.log(`Total batches processed: ${batchNumber - 1}`);
    
    // Clear lastId file when complete
    try {
      await fs.unlink(LAST_ID_FILE);
      logger.log('LastId file cleared (process complete)');
    } catch (error) {
      // File might not exist, ignore
    }

  } catch (error) {
    logger.error('Error occurred', error);
    logger.log(`Progress saved. Resume from lastId: ${lastId}`);
  } finally {
    await client.end();
    logger.log('Database connection closed');
    logger.close();
  }
}

batchUpdate();

