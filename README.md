# Dictionary Migration Script

Batch update script for migrating dictionary data from `dictionary_v2` to `dictionary` table.

## Description

This script performs batch updates on a PostgreSQL dictionary table, migrating `relations` data from `dictionary_v2` to `dictionary` where `relations` is NULL. The script uses cursor-based pagination to handle large datasets efficiently and supports resumable execution.

## Features

- Batch processing with configurable batch size (default: 1000 rows)
- Cursor-based pagination for efficient large dataset handling
- Resumable execution - saves progress and can resume from last processed ID
- Progress tracking and logging

## Prerequisites

- Node.js (v12 or higher)
- PostgreSQL database
- `pg` npm package

## Installation

```bash
npm install
```

## Configuration

Update the database connection settings in `main.js`:

```javascript
const client = new Client({
  host: 'localhost',
  port: 5433,
  database: 'puzzle_db',
  user: 'puzzle_user',
  password: 'puzzle_password',
});
```

**Note:** For production use, consider using environment variables for sensitive credentials.

## Usage

```bash
npm start
```

or

```bash
node main.js
```

## How It Works

1. Connects to the PostgreSQL database
2. Loads the last processed ID from `lastId.txt` (if exists) to resume from previous run
3. Processes rows in batches of 1000
4. Updates `dictionary.relations` from `dictionary_v2.relations` where `dictionary.relations IS NULL`
5. Saves progress after each batch
6. Clears the progress file when complete

## License

[Add your license here]

