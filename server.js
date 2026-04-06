require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "cambiar_esta_clave_en_produccion";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !String(process.env.DATABASE_URL).includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "2mb" }));

// 🔥 ESTA PARTE ES LA CLAVE (NO ROMPE NADA)
const publicDir = path.join(__dirname, "public");
const rootDir = __dirname;
const staticDir = fs.existsSync(path.join(publicDir, "index.html")) ? publicDir : rootDir;

app.use(express.static(staticDir));


// =================== RUTAS ===================

// prueba
app.get("/api/test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, fecha: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});


// 🔥 ESTO MUESTRA TU WEB
app.get("*", (req, res) => {
  const indexPath = fs.existsSync(path.join(publicDir, "index.html"))
    ? path.join(publicDir, "index.html")
    : path.join(rootDir, "index.html");

  res.sendFile(indexPath);
});


// =================== START ===================
app.listen(PORT, () => {
  console.log("Servidor funcionando en puerto", PORT);
});