require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "cambiar_esta_clave_en_produccion";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || "";

if (!process.env.DATABASE_URL) {
  console.warn("ATENCION: falta DATABASE_URL en las variables de entorno.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !String(process.env.DATABASE_URL).includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function makeId() {
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      city TEXT DEFAULT '',
      industry TEXT DEFAULT '',
      description TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      plan TEXT NOT NULL DEFAULT 'free',
      verified TEXT NOT NULL DEFAULT 'no',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(author_user_id, target_profile_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendiente',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMP NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_id TEXT NULL REFERENCES profiles(id) ON DELETE SET NULL,
      plan TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'ARS',
      status TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'mercadopago',
      external_reference TEXT,
      mp_preference_id TEXT,
      mp_payment_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, profile_id)
    );
  `);


  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_a_id, user_b_id)
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      read_by_json TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read);`);

  const adminEmail = "admin@demo.com";
  const existing = await query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [adminEmail]);
  if (!existing.rows.length) {
    await query(
      `INSERT INTO users (id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)`,
      [makeId(), "Administrador", adminEmail, "admin", bcrypt.hashSync("admin123", 10)]
    );
  }
}

function sanitizeUser(user) {
  const safe = { ...user };
  delete safe.password_hash;
  return safe;
}

function mapProfile(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    name: row.name,
    city: row.city,
    industry: row.industry,
    description: row.description,
    phone: row.phone,
    email: row.email,
    tags: JSON.parse(row.tags_json || "[]"),
    plan: row.plan,
    verified: row.verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function getProfileByUserId(userId) {
  const result = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [userId]);
  return result.rows[0] || null;
}

async function createNotification({ userId, actorUserId = null, type, title, message, meta = {} }) {
  if (!userId || !type || !title || !message) return null;
  const id = makeId();
  await query(
    `INSERT INTO notifications (id, user_id, actor_user_id, type, title, message, meta_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, userId, actorUserId, type, title, message, JSON.stringify(meta || {})]
  );
  return id;
}

function buildProfileChangedFields(previousProfile, nextProfile, tagsJson) {
  if (!previousProfile || !nextProfile) return [];
  const changes = [];
  const checks = [
    ['name', 'nombre'],
    ['city', 'ciudad'],
    ['industry', 'rubro'],
    ['description', 'descripción'],
    ['phone', 'teléfono'],
    ['plan', 'plan'],
  ];
  for (const [key, label] of checks) {
    if (String(previousProfile[key] || '').trim() !== String(nextProfile[key] || '').trim()) changes.push(label);
  }
  if (String(previousProfile.tags_json || '[]') !== String(tagsJson || '[]')) changes.push('etiquetas');
  return changes;
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "No autorizado" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }
}

async function loadUser(req, res, next) {
  try {
    const result = await query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [req.auth.userId]);
    if (!result.rows.length) return res.status(401).json({ error: "Usuario no encontrado" });
    req.user = result.rows[0];
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Acceso denegado" });
  }
  next();
}

async function profileStats(profileId) {
  const result = await query(
    `SELECT COUNT(*)::int AS count, COALESCE(AVG(score), 0)::float AS avg
     FROM reviews WHERE target_profile_id = $1`,
    [profileId]
  );
  return result.rows[0] || { count: 0, avg: 0 };
}

async function enrichProfiles(rows) {
  const output = [];
  for (const row of rows) {
    const stats = await profileStats(row.id);
    output.push({
      ...mapProfile(row),
      ownerName: row.owner_name || "Usuario",
      stats
    });
  }
  return output;
}


function normalizeConversationPair(userId1, userId2) {
  return [String(userId1), String(userId2)].sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureConversation(userId1, userId2) {
  const [userA, userB] = normalizeConversationPair(userId1, userId2);
  let existing = await query(
    `SELECT * FROM conversations WHERE user_a_id = $1 AND user_b_id = $2 LIMIT 1`,
    [userA, userB]
  );
  if (existing.rows.length) return existing.rows[0];

  const id = makeId();
  await query(
    `INSERT INTO conversations (id, user_a_id, user_b_id) VALUES ($1,$2,$3)`,
    [id, userA, userB]
  );
  existing = await query(`SELECT * FROM conversations WHERE id = $1 LIMIT 1`, [id]);
  return existing.rows[0];
}

async function conversationAllowed(userId, conversationId) {
  const result = await query(
    `SELECT * FROM conversations WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2) LIMIT 1`,
    [conversationId, userId]
  );
  return result.rows[0] || null;
}

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get("/api/config", (req, res) => {
  res.json({
    ok: true,
    mpPublicKey: MP_PUBLIC_KEY || "",
    baseUrl: APP_BASE_URL
  });
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }
    if (!["vendedor", "empresa"].includes(role)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = await query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    if (exists.rows.length) return res.status(400).json({ error: "Ese email ya está registrado" });

    const user = {
      id: makeId(),
      name: String(name).trim(),
      email: normalizedEmail,
      role,
      password_hash: bcrypt.hashSync(String(password), 10)
    };

    await query(
      `INSERT INTO users (id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.name, user.email, user.role, user.password_hash]
    );

    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const result = await query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [normalizedEmail]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Credenciales inválidas" });

    const ok = bcrypt.compareSync(String(password || ""), user.password_hash);
    if (!ok) return res.status(400).json({ error: "Credenciales inválidas" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ ok: true, token, user: sanitizeUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/me", authRequired, loadUser, async (req, res) => {
  try {
    const profileResult = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    const profile = profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null;
    res.json({ ok: true, user: sanitizeUser(req.user), profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/profiles", authRequired, loadUser, async (req, res) => {
  try {
    const { name, city, industry, description, phone, tags, plan } = req.body || {};
    if (!name) return res.status(400).json({ error: "El nombre es obligatorio" });

    const existing = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    const existingProfile = existing.rows[0] || null;
    const normalizedPlan = plan === "premium" ? "premium" : "free";
    const cleanPayload = {
      name: String(name).trim(),
      city: String(city || "").trim(),
      industry: String(industry || "").trim(),
      description: String(description || "").trim(),
      phone: String(phone || "").trim(),
      plan: normalizedPlan
    };
    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : []);

    if (!existingProfile) {
      const profileId = makeId();
      await query(
        `INSERT INTO profiles
         (id, user_id, type, name, city, industry, description, phone, email, tags_json, plan, verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          profileId,
          req.user.id,
          req.user.role,
          cleanPayload.name,
          cleanPayload.city,
          cleanPayload.industry,
          cleanPayload.description,
          cleanPayload.phone,
          req.user.email,
          tagsJson,
          cleanPayload.plan,
          "no"
        ]
      );
    } else {
      await query(
        `UPDATE profiles
         SET name=$1, city=$2, industry=$3, description=$4, phone=$5, tags_json=$6, plan=$7, updated_at=NOW()
         WHERE user_id=$8`,
        [
          cleanPayload.name,
          cleanPayload.city,
          cleanPayload.industry,
          cleanPayload.description,
          cleanPayload.phone,
          tagsJson,
          cleanPayload.plan,
          req.user.id
        ]
      );
    }

    const profileResult = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    const savedProfile = profileResult.rows[0];

    if (existingProfile) {
      const changedFields = buildProfileChangedFields(existingProfile, savedProfile, tagsJson);
      if (changedFields.length) {
        const followers = await query(
          `SELECT DISTINCT user_id FROM favorites WHERE profile_id = $1 AND user_id <> $2`,
          [savedProfile.id, req.user.id]
        );
        for (const follower of followers.rows) {
          await createNotification({
            userId: follower.user_id,
            actorUserId: req.user.id,
            type: 'favorite_profile_updated',
            title: 'Un favorito actualizó su perfil',
            message: `${savedProfile.name} actualizó su perfil`,
            meta: {
              profileId: savedProfile.id,
              changedFields
            }
          });
        }
      }
    }

    res.json({ ok: true, profile: mapProfile(savedProfile) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/profiles", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const role = String(req.query.role || "").trim().toLowerCase();
    const verified = String(req.query.verified || "").trim().toLowerCase();
    const plan = String(req.query.plan || "").trim().toLowerCase();
    const sort = String(req.query.sort || "destacados").trim().toLowerCase();
    const viewerUserId = String(req.query.viewerUserId || "").trim();

    const result = await query(`
      SELECT p.*, u.name AS owner_name
      FROM profiles p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.updated_at DESC, p.created_at DESC
    `);

    let rows = result.rows;
    if (q) {
      rows = rows.filter(r =>
        [r.name, r.city, r.industry, r.description, r.tags_json].join(" ").toLowerCase().includes(q)
      );
    }
    if (role && role !== "todos") rows = rows.filter(r => r.type === role);
    if (verified === "si" || verified === "no") rows = rows.filter(r => r.verified === verified);
    if (plan === "premium" || plan === "free") rows = rows.filter(r => r.plan === plan);

    let favoriteMap = new Set();
    if (viewerUserId) {
      const favs = await query(`SELECT profile_id FROM favorites WHERE user_id = $1`, [viewerUserId]);
      favoriteMap = new Set(favs.rows.map(r => r.profile_id));
    }

    let profiles = await enrichProfiles(rows);
    profiles = profiles.map(profile => ({ ...profile, isFavorite: favoriteMap.has(profile.id) }));

    profiles.sort((a, b) => {
      if (sort === "mejor_puntuados") {
        return (b.stats.avg - a.stats.avg) || (b.stats.count - a.stats.count) || (new Date(b.updatedAt) - new Date(a.updatedAt));
      }
      if (sort === "mas_recientes") {
        return (new Date(b.updatedAt) - new Date(a.updatedAt)) || (new Date(b.createdAt) - new Date(a.createdAt));
      }
      if (sort === "alfabetico") {
        return String(a.name).localeCompare(String(b.name), "es", { sensitivity: "base" });
      }
      const favoriteBoost = Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite));
      const premiumBoost = Number(b.plan === "premium") - Number(a.plan === "premium");
      const verifiedBoost = Number(b.verified === "si") - Number(a.verified === "si");
      return favoriteBoost || premiumBoost || verifiedBoost || (b.stats.avg - a.stats.avg) || (b.stats.count - a.stats.count) || (new Date(b.updatedAt) - new Date(a.updatedAt));
    });

    res.json({ ok: true, profiles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/favorites", authRequired, loadUser, async (req, res) => {
  try {
    const result = await query(`
      SELECT f.profile_id
      FROM favorites f
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    res.json({ ok: true, favorites: result.rows.map(r => r.profile_id) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/favorites", authRequired, loadUser, async (req, res) => {
  try {
    const { profileId } = req.body || {};
    if (!profileId) return res.status(400).json({ error: "Falta profileId" });

    const target = await query(`SELECT * FROM profiles WHERE id = $1 LIMIT 1`, [profileId]);
    if (!target.rows.length) return res.status(404).json({ error: "Perfil no encontrado" });
    if (target.rows[0].user_id === req.user.id) {
      return res.status(400).json({ error: "No podés guardarte a vos mismo" });
    }

    const insertResult = await query(
      `INSERT INTO favorites (id, user_id, profile_id) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, profile_id) DO NOTHING
       RETURNING id`,
      [makeId(), req.user.id, profileId]
    );

    if (insertResult.rows.length) {
      const actorProfile = await getProfileByUserId(req.user.id);
      await createNotification({
        userId: target.rows[0].user_id,
        actorUserId: req.user.id,
        type: 'added_to_favorites',
        title: 'Te guardaron en favoritos',
        message: `${actorProfile?.name || req.user.name} te guardó en favoritos`,
        meta: {
          profileId: target.rows[0].id,
          actorProfileId: actorProfile?.id || null
        }
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.delete("/api/favorites/:profileId", authRequired, loadUser, async (req, res) => {
  try {
    await query(`DELETE FROM favorites WHERE user_id = $1 AND profile_id = $2`, [req.user.id, req.params.profileId]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/reviews/:profileId", async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, u.name AS author_name
      FROM reviews r
      LEFT JOIN users u ON u.id = r.author_user_id
      WHERE r.target_profile_id = $1
      ORDER BY r.created_at DESC
    `, [req.params.profileId]);

    res.json({
      ok: true,
      reviews: result.rows.map(r => ({
        id: r.id,
        authorUserId: r.author_user_id,
        targetProfileId: r.target_profile_id,
        score: r.score,
        comment: r.comment,
        createdAt: r.created_at,
        authorName: r.author_name || "Usuario"
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/reviews", authRequired, loadUser, async (req, res) => {
  try {
    const { targetProfileId, score, comment } = req.body || {};
    if (!targetProfileId || !score || !comment) {
      return res.status(400).json({ error: "Faltan datos para la reseña" });
    }

    const target = await query(`SELECT * FROM profiles WHERE id = $1 LIMIT 1`, [targetProfileId]);
    if (!target.rows.length) return res.status(404).json({ error: "Perfil no encontrado" });
    if (target.rows[0].user_id === req.user.id) {
      return res.status(400).json({ error: "No podés calificarte a vos mismo" });
    }

    const scoreNum = Number(score);
    if (Number.isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return res.status(400).json({ error: "Puntaje inválido" });
    }

    const reviewId = makeId();
    await query(
      `INSERT INTO reviews (id, author_user_id, target_profile_id, score, comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [reviewId, req.user.id, targetProfileId, scoreNum, String(comment).trim()]
    );

    res.json({ ok: true });
  } catch (e) {
    if (String(e.message || "").includes("duplicate key")) {
      return res.status(400).json({ error: "Ya dejaste una reseña para este perfil" });
    }
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/reports", authRequired, loadUser, async (req, res) => {
  try {
    const { profileId, reason } = req.body || {};
    if (!profileId || !reason) return res.status(400).json({ error: "Faltan datos para la denuncia" });

    const profile = await query(`SELECT id FROM profiles WHERE id = $1 LIMIT 1`, [profileId]);
    if (!profile.rows.length) return res.status(404).json({ error: "Perfil no encontrado" });

    await query(
      `INSERT INTO reports (id, profile_id, reporter_user_id, reason) VALUES ($1,$2,$3,$4)`,
      [makeId(), profileId, req.user.id, String(reason).trim()]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/payments/create-preference", authRequired, loadUser, async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN) {
      return res.status(400).json({ error: "Falta configurar MP_ACCESS_TOKEN" });
    }

    const { plan } = req.body || {};
    const normalizedPlan = plan === "premium" ? "premium" : "free";
    const amount = normalizedPlan === "premium" ? 19990 : 0;

    const profileResult = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    if (!profileResult.rows.length) {
      return res.status(400).json({ error: "Primero creá tu perfil" });
    }

    const profile = profileResult.rows[0];
    const externalReference = `${req.user.id}:${normalizedPlan}:${Date.now()}`;

    const body = {
      items: [
        {
          title: `Plan ${normalizedPlan === "premium" ? "Premium" : "Free"} - Red de Vendedores y Empresas`,
          quantity: 1,
          currency_id: "ARS",
          unit_price: amount
        }
      ],
      external_reference: externalReference,
      back_urls: {
        success: `${APP_BASE_URL}/?mp=success`,
        failure: `${APP_BASE_URL}/?mp=failure`,
        pending: `${APP_BASE_URL}/?mp=pending`
      },
      auto_return: "approved",
      notification_url: `${APP_BASE_URL}/api/payments/webhook`
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error("Mercado Pago error:", mpData);
      return res.status(400).json({ error: "No se pudo crear la preferencia de pago" });
    }

    await query(
      `INSERT INTO payments
       (id, user_id, profile_id, plan, amount, currency, status, provider, external_reference, mp_preference_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [makeId(), req.user.id, profile.id, normalizedPlan, amount, "ARS", "preference_created", "mercadopago", externalReference, mpData.id]
    );

    res.json({
      ok: true,
      initPoint: mpData.init_point,
      sandboxInitPoint: mpData.sandbox_init_point || null,
      preferenceId: mpData.id
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno al crear el pago" });
  }
});

app.post("/api/payments/mock-upgrade", authRequired, loadUser, async (req, res) => {
  try {
    const profileResult = await query(`SELECT * FROM profiles WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    if (!profileResult.rows.length) {
      return res.status(400).json({ error: "Primero creá tu perfil" });
    }
    const profile = profileResult.rows[0];

    await query(`UPDATE profiles SET plan = 'premium', updated_at = NOW() WHERE id = $1`, [profile.id]);
    await query(
      `INSERT INTO payments
       (id, user_id, profile_id, plan, amount, currency, status, provider, external_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [makeId(), req.user.id, profile.id, "premium", 19990, "ARS", "approved_demo", "mercadopago", `demo:${req.user.id}:${Date.now()}`]
    );

    const updated = await query(`SELECT * FROM profiles WHERE id = $1`, [profile.id]);
    res.json({ ok: true, profile: mapProfile(updated.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.post("/api/payments/webhook", express.json({ type: "*/*" }), async (req, res) => {
  try {
    const topic = req.query.topic || req.body.type || "";
    const dataId = req.query.id || req.body?.data?.id || null;

    console.log("Webhook Mercado Pago recibido:", { topic, dataId, body: req.body });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok: true });
  }
});


app.get("/api/conversations", authRequired, loadUser, async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*, 
             CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END AS other_user_id,
             u.name AS other_user_name,
             u.email AS other_user_email,
             p.id AS other_profile_id,
             p.name AS other_profile_name,
             p.type AS other_profile_type,
             p.city AS other_profile_city,
             p.industry AS other_profile_industry,
             p.plan AS other_profile_plan,
             p.verified AS other_profile_verified,
             (
               SELECT m.body FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC
               LIMIT 1
             ) AS last_message,
             (
               SELECT m.created_at FROM messages m
               WHERE m.conversation_id = c.id
               ORDER BY m.created_at DESC
               LIMIT 1
             ) AS last_message_at,
             (
               SELECT COUNT(*)::int FROM messages m
               WHERE m.conversation_id = c.id
                 AND m.sender_user_id <> $1
                 AND POSITION($1 IN COALESCE(m.read_by_json, '[]')) = 0
             ) AS unread_count
      FROM conversations c
      LEFT JOIN users u ON u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
      LEFT JOIN profiles p ON p.user_id = u.id
      WHERE c.user_a_id = $1 OR c.user_b_id = $1
      ORDER BY COALESCE((
        SELECT m.created_at FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ), c.updated_at) DESC, c.created_at DESC
    `, [req.user.id]);

    res.json({
      ok: true,
      conversations: result.rows.map(r => ({
        id: r.id,
        otherUserId: r.other_user_id,
        otherUserName: r.other_user_name || 'Usuario',
        otherUserEmail: r.other_user_email || '',
        otherProfileId: r.other_profile_id || '',
        otherProfileName: r.other_profile_name || r.other_user_name || 'Perfil',
        otherProfileType: r.other_profile_type || '',
        otherProfileCity: r.other_profile_city || '',
        otherProfileIndustry: r.other_profile_industry || '',
        otherProfilePlan: r.other_profile_plan || 'free',
        otherProfileVerified: r.other_profile_verified || 'no',
        lastMessage: r.last_message || '',
        lastMessageAt: r.last_message_at || r.updated_at,
        unreadCount: r.unread_count || 0,
        createdAt: r.created_at
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post("/api/conversations/start", authRequired, loadUser, async (req, res) => {
  try {
    const { profileId } = req.body || {};
    if (!profileId) return res.status(400).json({ error: 'Falta profileId' });

    const profile = await query(`SELECT * FROM profiles WHERE id = $1 LIMIT 1`, [profileId]);
    if (!profile.rows.length) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (profile.rows[0].user_id === req.user.id) return res.status(400).json({ error: 'No podés chatear con tu propio perfil' });

    const conversation = await ensureConversation(req.user.id, profile.rows[0].user_id);
    res.json({ ok: true, conversationId: conversation.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get("/api/conversations/:id/messages", authRequired, loadUser, async (req, res) => {
  try {
    const conversation = await conversationAllowed(req.user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });

    const result = await query(`
      SELECT m.*, u.name AS sender_name
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT 200
    `, [req.params.id]);

    for (const row of result.rows) {
      let readers = [];
      try { readers = JSON.parse(row.read_by_json || '[]'); } catch {}
      if (!readers.includes(req.user.id)) {
        readers.push(req.user.id);
        await query(`UPDATE messages SET read_by_json = $1 WHERE id = $2`, [JSON.stringify(readers), row.id]);
        row.read_by_json = JSON.stringify(readers);
      }
    }

    await query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

    res.json({
      ok: true,
      messages: result.rows.map(r => ({
        id: r.id,
        conversationId: r.conversation_id,
        senderUserId: r.sender_user_id,
        senderName: r.sender_name || 'Usuario',
        body: r.body,
        createdAt: r.created_at,
        readBy: (() => { try { return JSON.parse(r.read_by_json || '[]'); } catch { return []; } })()
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post("/api/conversations/:id/messages", authRequired, loadUser, async (req, res) => {
  try {
    const { body } = req.body || {};
    const text = String(body || '').trim();
    if (!text) return res.status(400).json({ error: 'Escribí un mensaje' });
    if (text.length > 1500) return res.status(400).json({ error: 'El mensaje es demasiado largo' });

    const conversation = await conversationAllowed(req.user.id, req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversación no encontrada' });

    const messageId = makeId();
    await query(
      `INSERT INTO messages (id, conversation_id, sender_user_id, body, read_by_json) VALUES ($1,$2,$3,$4,$5)`,
      [messageId, req.params.id, req.user.id, text, JSON.stringify([req.user.id])]
    );
    await query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [req.params.id]);

    const receiverUserId = conversation.user_a_id === req.user.id ? conversation.user_b_id : conversation.user_a_id;
    const senderProfile = await getProfileByUserId(req.user.id);
    await createNotification({
      userId: receiverUserId,
      actorUserId: req.user.id,
      type: 'new_message',
      title: 'Nuevo mensaje',
      message: `${senderProfile?.name || req.user.name} te envió un mensaje`,
      meta: {
        conversationId: req.params.id,
        messageId,
        senderUserId: req.user.id
      }
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});


app.get("/api/notifications", authRequired, loadUser, async (req, res) => {
  try {
    const type = String(req.query.type || '').trim();
    const unreadOnly = String(req.query.unreadOnly || '').trim() === 'true';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const params = [req.user.id];
    let where = `WHERE n.user_id = $1`;
    if (type && type !== 'all') {
      params.push(type);
      where += ` AND n.type = $${params.length}`;
    }
    if (unreadOnly) where += ` AND n.is_read = FALSE`;

    params.push(limit);
    const result = await query(
      `SELECT n.*, u.name AS actor_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_user_id
       ${where}
       ORDER BY n.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({
      ok: true,
      notifications: result.rows.map(r => ({
        id: r.id,
        userId: r.user_id,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name || '',
        type: r.type,
        title: r.title,
        message: r.message,
        isRead: r.is_read,
        createdAt: r.created_at,
        meta: safeJsonParse(r.meta_json || '{}', {})
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get("/api/notifications/unread-count", authRequired, loadUser, async (req, res) => {
  try {
    const result = await query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );
    res.json({ ok: true, count: result.rows[0]?.count || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch("/api/notifications/read-all", authRequired, loadUser, async (req, res) => {
  try {
    await query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.patch("/api/notifications/:id/read", authRequired, loadUser, async (req, res) => {
  try {
    const result = await query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Notificación no encontrada' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

app.get("/api/admin/stats", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const users = await query(`SELECT COUNT(*)::int AS c FROM users`);
    const profiles = await query(`SELECT COUNT(*)::int AS c FROM profiles`);
    const premium = await query(`SELECT COUNT(*)::int AS c FROM profiles WHERE plan = 'premium'`);
    const verified = await query(`SELECT COUNT(*)::int AS c FROM profiles WHERE verified = 'si'`);
    const reviews = await query(`SELECT COUNT(*)::int AS c FROM reviews`);
    const reports = await query(`SELECT COUNT(*)::int AS c FROM reports`);
    const payments = await query(`SELECT COUNT(*)::int AS c FROM payments`);

    res.json({
      ok: true,
      stats: {
        users: users.rows[0].c,
        profiles: profiles.rows[0].c,
        premium: premium.rows[0].c,
        verified: verified.rows[0].c,
        reviews: reviews.rows[0].c,
        reports: reports.rows[0].c,
        payments: payments.rows[0].c
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/admin/users", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.name, u.email, u.role, u.created_at,
             p.id AS profile_id, p.name AS profile_name, p.plan, p.verified
      FROM users u
      LEFT JOIN profiles p ON p.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    res.json({
      ok: true,
      users: result.rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        role: r.role,
        createdAt: r.created_at,
        profileId: r.profile_id,
        profileName: r.profile_name || "",
        plan: r.plan || "",
        verified: r.verified || ""
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/admin/profiles", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, u.name AS owner_name
      FROM profiles p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.updated_at DESC
    `);
    const profiles = await enrichProfiles(result.rows);
    res.json({ ok: true, profiles });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/admin/reviews", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, u.name AS author_name, p.name AS profile_name
      FROM reviews r
      LEFT JOIN users u ON u.id = r.author_user_id
      LEFT JOIN profiles p ON p.id = r.target_profile_id
      ORDER BY r.created_at DESC
    `);
    res.json({
      ok: true,
      reviews: result.rows.map(r => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        createdAt: r.created_at,
        authorName: r.author_name || "Usuario",
        profileName: r.profile_name || "Perfil eliminado"
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/admin/reports", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const result = await query(`
      SELECT r.*, p.name AS profile_name, u.name AS reporter_name
      FROM reports r
      LEFT JOIN profiles p ON p.id = r.profile_id
      LEFT JOIN users u ON u.id = r.reporter_user_id
      ORDER BY r.created_at DESC
    `);
    res.json({
      ok: true,
      reports: result.rows.map(r => ({
        id: r.id,
        reason: r.reason,
        status: r.status,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
        profileName: r.profile_name || "Perfil eliminado",
        reporterName: r.reporter_name || "Usuario"
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("/api/admin/payments", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const result = await query(`
      SELECT pay.*, u.name AS user_name, u.email AS user_email, p.name AS profile_name
      FROM payments pay
      LEFT JOIN users u ON u.id = pay.user_id
      LEFT JOIN profiles p ON p.id = pay.profile_id
      ORDER BY pay.created_at DESC
      LIMIT 100
    `);
    res.json({
      ok: true,
      payments: result.rows.map(r => ({
        id: r.id,
        userName: r.user_name || "Usuario",
        userEmail: r.user_email || "",
        profileName: r.profile_name || "Sin perfil",
        plan: r.plan,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        provider: r.provider,
        createdAt: r.created_at
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.patch("/api/admin/profiles/:id", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    const { verified, plan } = req.body || {};
    const profile = await query(`SELECT * FROM profiles WHERE id = $1 LIMIT 1`, [req.params.id]);
    if (!profile.rows.length) return res.status(404).json({ error: "Perfil no encontrado" });

    const newVerified = verified === "si" || verified === "no" ? verified : profile.rows[0].verified;
    const newPlan = plan === "premium" || plan === "free" ? plan : profile.rows[0].plan;

    await query(
      `UPDATE profiles SET verified = $1, plan = $2, updated_at = NOW() WHERE id = $3`,
      [newVerified, newPlan, req.params.id]
    );

    const updated = await query(`SELECT * FROM profiles WHERE id = $1 LIMIT 1`, [req.params.id]);
    res.json({ ok: true, profile: mapProfile(updated.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.delete("/api/admin/reviews/:id", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    await query(`DELETE FROM reviews WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.patch("/api/admin/reports/:id/resolve", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    await query(`UPDATE reports SET status = 'resuelta', resolved_at = NOW() WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.delete("/api/admin/users/:id", authRequired, loadUser, adminRequired, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "No podés borrar tu propio usuario admin" });
    }
    await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error interno" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Servidor iniciado en ${APP_BASE_URL}`);
    });
  } catch (e) {
    console.error("No se pudo iniciar la app:", e);
    process.exit(1);
  }
})();
