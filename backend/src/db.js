require('dotenv').config();
const sql = require('mssql/msnodesqlv8');

const SERVER = process.env.DB_SERVER || 'localhost';
const DB     = process.env.DB_DATABASE || 'mydb';

// actualizar para que no de error por aquello version nueva
const connectionString =
  `Driver={ODBC Driver 18 for SQL Server};` +   
  `Server=${SERVER};` +
  `Database=${DB};` +
  `Trusted_Connection=Yes;` +
  `Encrypt=Yes;TrustServerCertificate=Yes;`;

let pool;
async function getPool() {
  if (pool) return pool;
  pool = await new sql.ConnectionPool({ connectionString }).connect();
  console.log('✅ Conectado a SQL Server correctamente');
  return pool;
}

module.exports = { sql, getPool };
