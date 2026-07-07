import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR: La variable DATABASE_URL no está configurada en el archivo .env");
  process.exit(1);
}

console.log("Connecting to Neon.tech...");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log(`Reading schema from: ${schemaPath}`);
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log("Executing schema SQL queries on Neon...");
    await pool.query(sql);
    console.log("✅ base de datos inicializada con éxito en Neon.tech!");
    
    // Test SELECT
    const res = await pool.query("SELECT COUNT(*) FROM usuarios");
    console.log(`Verificación: ${res.rows[0].count} usuarios cargados en base de datos.`);
  } catch (err) {
    console.error("❌ ERROR ejecutando la migración:", err.message);
  } finally {
    await pool.end();
  }
}

runMigration();
