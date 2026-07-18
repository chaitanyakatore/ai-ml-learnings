// StadiumPulse AI — Production-Grade Dual-Mode Database Engine (Postgres + Local SQL Failover)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'users.db.json');

// Ensure database directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Hashing secret keys
const JWT_SECRET = process.env.JWT_SECRET || 'fifa-worldcup-2026-supersecret-token-key';

// Check if PostgreSQL database URL is configured (standard on Render deploys)
export let isPostgres = !!process.env.DATABASE_URL;

let pool = null;

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Required for Render Postgres connections
    },
    max: 10, // Limit active connections
    idleTimeoutMillis: 30000, // Close idle connections
    connectionTimeoutMillis: 5000 // Error out if connection takes too long
  });
}

// --- SECURE CRYPTO HELPERS ---

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const checkHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === checkHash;
}

// --- LOCAL FAILOVER DATABASE IMPLEMENTATION ---

function getLocalUsers() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const defaultUsers = [
        {
          username: "operator",
          passwordHash: hashPassword("password123"),
          role: "ops",
          name: "Tournament Ops Director",
          securityQuestion: "What is your favorite stadium?",
          securityAnswerHash: hashPassword("lusail")
        },
        {
          username: "volunteer",
          passwordHash: hashPassword("password123"),
          role: "volunteer",
          name: "Field Volunteer Sector C",
          securityQuestion: "What is your primary language?",
          securityAnswerHash: hashPassword("english")
        }
      ];
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
      return defaultUsers;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error("Local database read error:", err);
    return [];
  }
}

function saveLocalUsers(users) {
  try {
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(users, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
    return true;
  } catch (err) {
    console.error("Local database write error:", err);
    return false;
  }
}

// --- DATABASE PUBLIC ADAPTER INTERFACE ---

export const db = {
  // Initialize Database Schema & Seed Default Personas
  async init() {
    if (!isPostgres) {
      console.log("Storage engine initialized in Local File Failover mode.");
      getLocalUsers(); // Triggers default JSON seed creation
      return;
    }

    try {
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          name VARCHAR(100),
          security_question TEXT NOT NULL,
          security_answer_hash VARCHAR(255) NOT NULL
        );
      `;
      await pool.query(createTableQuery);

      // Seed default accounts if empty
      const checkCount = await pool.query('SELECT COUNT(*) FROM users');
      if (parseInt(checkCount.rows[0].count, 10) === 0) {
        const seedQuery = `
          INSERT INTO users (username, password_hash, role, name, security_question, security_answer_hash)
          VALUES 
            ('operator', $1, 'ops', 'Tournament Ops Director', 'What is your favorite stadium?', $2),
            ('volunteer', $3, 'volunteer', 'Field Volunteer Sector C', 'What is your primary language?', $4);
        `;
        await pool.query(seedQuery, [
          hashPassword("password123"),
          hashPassword("lusail"),
          hashPassword("password123"),
          hashPassword("english")
        ]);
        console.log("PostgreSQL database seeded with default operator/volunteer accounts.");
      }

      console.log("Storage engine initialized in PostgreSQL production mode.");
    } catch (err) {
      console.error("PostgreSQL schema initialization failed. Switching to Local File Mode:", err);
      isPostgres = false;
      getLocalUsers();
    }
  },

  // Retrieve user by username (Parameterized query protection)
  async findByUsername(username) {
    const normalizedUsername = username.toLowerCase().trim();

    if (isPostgres) {
      const query = 'SELECT * FROM users WHERE LOWER(username) = $1';
      const res = await pool.query(query, [normalizedUsername]);
      if (res.rows.length === 0) return null;
      
      const row = res.rows[0];
      return {
        username: row.username,
        passwordHash: row.password_hash,
        role: row.role,
        name: row.name,
        securityQuestion: row.security_question,
        securityAnswerHash: row.security_answer_hash
      };
    } else {
      const users = getLocalUsers();
      return users.find(u => u.username.toLowerCase() === normalizedUsername);
    }
  },

  // Insert a new user (SQL injection parameterized insert)
  async createUser({ username, password, role, name, securityQuestion, securityAnswer }) {
    const cleanUsername = username.trim();
    const cleanQuestion = securityQuestion.trim();
    const cleanAnswer = securityAnswer.toLowerCase().trim();

    if (isPostgres) {
      const query = `
        INSERT INTO users (username, password_hash, role, name, security_question, security_answer_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;
      try {
        const res = await pool.query(query, [
          cleanUsername,
          hashPassword(password),
          role || 'volunteer',
          name || cleanUsername,
          cleanQuestion,
          hashPassword(cleanAnswer)
        ]);
        const row = res.rows[0];
        return {
          username: row.username,
          role: row.role,
          name: row.name
        };
      } catch (err) {
        if (err.code === '23505') { // Postgres uniqueness constraint error code
          throw new Error("Username already registered.");
        }
        throw err;
      }
    } else {
      const users = getLocalUsers();
      if (users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
        throw new Error("Username already registered.");
      }
      
      const newUser = {
        username: cleanUsername,
        passwordHash: hashPassword(password),
        role: role || 'volunteer',
        name: name || cleanUsername,
        securityQuestion: cleanQuestion,
        securityAnswerHash: hashPassword(cleanAnswer)
      };

      users.push(newUser);
      saveLocalUsers(users);
      return newUser;
    }
  },

  // Update password field for recover password flows
  async updatePassword(username, newPassword) {
    const normalizedUsername = username.toLowerCase().trim();

    if (isPostgres) {
      const query = 'UPDATE users SET password_hash = $1 WHERE LOWER(username) = $2';
      await pool.query(query, [hashPassword(newPassword), normalizedUsername]);
      return true;
    } else {
      const users = getLocalUsers();
      const userIndex = users.findIndex(u => u.username.toLowerCase() === normalizedUsername);

      if (userIndex === -1) {
        throw new Error("User record not found.");
      }

      users[userIndex].passwordHash = hashPassword(newPassword);
      saveLocalUsers(users);
      return true;
    }
  }
};
