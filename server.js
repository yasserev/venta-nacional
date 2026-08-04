import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Seguridad: JWT_SECRET obligatorio ──────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET no está definido en las variables de entorno.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  },
  credentials: true
}));

app.use(express.json());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.' }
});

// ── Database Setup ──────────────────────────────────────────────────────────
let pool = null;
let useMock = false;

const mockData = {
  usuarios: [
    { id: 1, email: 'yespinoza@camposol.com', password_hash: bcrypt.hashSync('Camposol2026!', 10), nombre: 'Yasser Espinoza', role: 'Administrador', requiere_cambio_clave: false }
  ],
  clientes: [
    { id: 1, razon_social: 'Supermercados Peruanos S.A.', ruc: '20100018612', direccion: 'Av. Larco 1230, Miraflores, Lima' },
    { id: 2, razon_social: 'Cencosud Retail Peru S.A.', ruc: '20509088721', direccion: 'Av. Raul Ferrero 120, La Molina, Lima' },
    { id: 3, razon_social: 'Hipermercados Tottus S.A.', ruc: '20508565934', direccion: 'Av. Tacna 650, Cercado de Lima, Lima' },
    { id: 4, razon_social: 'Camposol Trading S.A.C.', ruc: '20536471822', direccion: 'Av. El Derby 254, Santiago de Surco, Lima' }
  ],
  unidades_medida: [
    { id: 1, codigo: 'JABAS', descripcion: 'Jabas', activo: true, creado_en: new Date().toISOString() },
    { id: 2, codigo: 'BINES', descripcion: 'Bines', activo: true, creado_en: new Date().toISOString() },
    { id: 3, codigo: 'KG', descripcion: 'Kilogramos', activo: true, creado_en: new Date().toISOString() }
  ],
  responsables_despacho: [
    { id: 1, nombre: 'Samuel Pacheco', dni: '45231876', activo: true, creado_en: new Date().toISOString() },
    { id: 2, nombre: 'María González', dni: '38291043', activo: true, creado_en: new Date().toISOString() },
    { id: 3, nombre: 'Carlos Rodríguez', dni: '52109834', activo: true, creado_en: new Date().toISOString() }
  ],
  viajes: [],
  pallets: []
};

let mockIdCounters = { viajes: 0, pallets: 0, unidades_medida: 3, responsables_despacho: 3 };

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('user:password')) {
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 5,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      keepAlive: true
    });
    pool.on('error', (err) => {
      console.error('⚠️ Error inesperado en pool idle:', err.message);
    });
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a Neon.tech (Postgres)');
    client.release();
  } catch (err) {
    console.error('❌ Error conectando a DB. Usando Mock DB:', err.message);
    useMock = true;
  }
} else {
  console.log('⚠️ DATABASE_URL no configurada. Usando Mock DB en RAM.');
  useMock = true;
}

// ── Middleware ──────────────────────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Acceso no autorizado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Sesión expirada o inválida' });
    req.user = user;
    next();
  });
};

const checkRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
  }
  next();
};

// ── AUTH ────────────────────────────────────────────────────────────────────

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = null;
    if (useMock) {
      user = mockData.usuarios.find(u => u.email === email);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(400).json({ message: 'Credenciales incorrectas' });
      }
    } else {
      const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
      if (result.rows.length === 0) return res.status(400).json({ message: 'Credenciales incorrectas' });
      user = result.rows[0];
      if (!await bcrypt.compare(password, user.password_hash)) {
        return res.status(400).json({ message: 'Credenciales incorrectas' });
      }
    }
    const safeUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      nombre: user.nombre,
      requiere_cambio_clave: user.requiere_cambio_clave ?? true
    };
    const token = jwt.sign(safeUser, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error('[ERROR /api/auth/login]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      const user = mockData.usuarios.find(u => u.id === req.user.id);
      if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
      const { password_hash, ...safeUser } = user;
      res.json({ user: safeUser });
    } else {
      const result = await pool.query('SELECT id, email, nombre, role, requiere_cambio_clave FROM usuarios WHERE id = $1', [req.user.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json({ user: result.rows[0] });
    }
  } catch (err) {
    console.error('[ERROR /api/auth/me]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/auth/cambiar-clave', authenticateToken, async (req, res) => {
  const { password_nueva } = req.body;
  if (!password_nueva || password_nueva.trim().length < 6) {
    return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const hash = bcrypt.hashSync(password_nueva.trim(), 10);
  try {
    if (useMock) {
      const idx = mockData.usuarios.findIndex(u => u.id === req.user.id);
      if (idx === -1) return res.status(404).json({ message: 'Usuario no encontrado' });
      mockData.usuarios[idx].password_hash = hash;
      mockData.usuarios[idx].requiere_cambio_clave = false;
      const { password_hash, ...safeUser } = mockData.usuarios[idx];
      res.json({ message: 'Contraseña actualizada con éxito', user: safeUser });
    } else {
      const result = await pool.query(
        'UPDATE usuarios SET password_hash = $1, requiere_cambio_clave = FALSE WHERE id = $2 RETURNING id, email, nombre, role, requiere_cambio_clave',
        [hash, req.user.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json({ message: 'Contraseña actualizada con éxito', user: result.rows[0] });
    }
  } catch (err) {
    console.error('[ERROR POST /api/auth/cambiar-clave]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── USUARIOS ─────────────────────────────────────────────────────────────────

app.get('/api/usuarios', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  try {
    if (useMock) {
      const list = mockData.usuarios.map(({ password_hash, ...u }) => u);
      res.json(list);
    } else {
      const result = await pool.query('SELECT id, email, nombre, role, requiere_cambio_clave, creado_en FROM usuarios ORDER BY nombre ASC');
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/usuarios]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/usuarios', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  const { email, password, nombre, role } = req.body;
  const trimEmail = (email || '').trim().toLowerCase();
  const trimNombre = (nombre || '').trim();
  const validRoles = ['Planificador', 'Cadena de frío', 'Despacho', 'Administrador'];

  if (!trimEmail || !password || !trimNombre || !role) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios' });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Rol no válido' });
  }

  const hash = bcrypt.hashSync(password, 10);

  try {
    if (useMock) {
      if (mockData.usuarios.some(u => u.email === trimEmail)) {
        return res.status(400).json({ message: 'El correo electrónico ya está registrado' });
      }
      const newU = { id: mockData.usuarios.length + 1, email: trimEmail, password_hash: hash, nombre: trimNombre, role, requiere_cambio_clave: true, creado_en: new Date().toISOString() };
      mockData.usuarios.push(newU);
      const { password_hash, ...safeUser } = newU;
      res.status(201).json(safeUser);
    } else {
      const result = await pool.query(
        'INSERT INTO usuarios (email, password_hash, nombre, role, requiere_cambio_clave) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, email, nombre, role, requiere_cambio_clave, creado_en',
        [trimEmail, hash, trimNombre, role]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ message: 'El correo electrónico ya está registrado' });
    } else {
      console.error('[ERROR POST /api/usuarios]', err);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  }
});

app.put('/api/usuarios/:id', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  const { id } = req.params;
  const { email, password, nombre, role } = req.body;
  const trimEmail = (email || '').trim().toLowerCase();
  const trimNombre = (nombre || '').trim();
  const validRoles = ['Planificador', 'Cadena de frío', 'Despacho', 'Administrador'];

  if (!trimEmail || !trimNombre || !role) {
    return res.status(400).json({ message: 'Email, nombre y rol son obligatorios' });
  }
  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'Rol no válido' });
  }

  try {
    if (useMock) {
      const idx = mockData.usuarios.findIndex(u => u.id === parseInt(id));
      if (idx === -1) return res.status(404).json({ message: 'Usuario no encontrado' });
      
      mockData.usuarios[idx].email = trimEmail;
      mockData.usuarios[idx].nombre = trimNombre;
      mockData.usuarios[idx].role = role;
      if (password) {
        mockData.usuarios[idx].password_hash = bcrypt.hashSync(password, 10);
      }
      const { password_hash, ...safeUser } = mockData.usuarios[idx];
      res.json(safeUser);
    } else {
      let query = 'UPDATE usuarios SET email=$1, nombre=$2, role=$3 WHERE id=$4 RETURNING id, email, nombre, role, creado_en';
      let params = [trimEmail, trimNombre, role, id];

      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        query = 'UPDATE usuarios SET email=$1, nombre=$2, role=$3, password_hash=$5 WHERE id=$4 RETURNING id, email, nombre, role, creado_en';
        params = [trimEmail, trimNombre, role, id, hash];
      }

      const result = await pool.query(query, params);
      if (result.rows.length === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/usuarios/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.delete('/api/usuarios/:id', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ message: 'No puedes eliminar tu propia cuenta' });
  }
  try {
    if (useMock) {
      const idx = mockData.usuarios.findIndex(u => u.id === parseInt(id));
      if (idx === -1) return res.status(404).json({ message: 'Usuario no encontrado' });
      mockData.usuarios.splice(idx, 1);
      res.json({ message: 'Usuario eliminado exitosamente' });
    } else {
      const result = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
      if (result.rowCount === 0) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json({ message: 'Usuario eliminado exitosamente' });
    }
  } catch (err) {
    console.error('[ERROR DELETE /api/usuarios/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── CLIENTES ─────────────────────────────────────────────────────────────────

app.get('/api/clientes', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      res.json(mockData.clientes);
    } else {
      const result = await pool.query('SELECT * FROM clientes ORDER BY razon_social ASC');
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/clientes]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/clientes', authenticateToken, checkRole(['Planificador', 'Administrador']), async (req, res) => {
  const { razon_social, ruc, direccion } = req.body;
  const trimmedRazon = (razon_social || '').trim();
  const trimmedRuc = (ruc || '').trim();
  const trimmedDir = (direccion || '').trim();

  if (!trimmedRazon || !trimmedRuc || !trimmedDir) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios' });
  }
  if (trimmedRuc.length !== 11 || !/^\d+$/.test(trimmedRuc)) {
    return res.status(400).json({ message: 'El RUC debe tener exactamente 11 dígitos numéricos' });
  }

  try {
    if (useMock) {
      if (mockData.clientes.some(c => c.razon_social.toLowerCase() === trimmedRazon.toLowerCase())) {
        return res.status(400).json({ message: 'La razón social del cliente ya existe' });
      }
      const newClient = { id: mockData.clientes.length + 1, razon_social: trimmedRazon, ruc: trimmedRuc, direccion: trimmedDir };
      mockData.clientes.push(newClient);
      res.status(201).json(newClient);
    } else {
      const result = await pool.query(
        'INSERT INTO clientes (razon_social, ruc, direccion) VALUES ($1, $2, $3) RETURNING *',
        [trimmedRazon, trimmedRuc, trimmedDir]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ message: 'La razón social del cliente ya existe en el sistema' });
    } else {
      console.error('[ERROR POST /api/clientes]', err);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  }
});

// ── UNIDADES DE MEDIDA ───────────────────────────────────────────────────────

app.get('/api/unidades-medida', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      res.json(mockData.unidades_medida.filter(u => u.activo));
    } else {
      const result = await pool.query('SELECT * FROM unidades_medida ORDER BY codigo ASC');
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/unidades-medida]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/unidades-medida', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  const { codigo, descripcion } = req.body;
  const trimCodigo = (codigo || '').trim().toUpperCase();
  const trimDesc = (descripcion || '').trim();
  if (!trimCodigo || !trimDesc) {
    return res.status(400).json({ message: 'Código y descripción son obligatorios' });
  }
  try {
    if (useMock) {
      if (mockData.unidades_medida.some(u => u.codigo === trimCodigo)) {
        return res.status(400).json({ message: 'El código de unidad ya existe' });
      }
      mockIdCounters.unidades_medida++;
      const newUM = { id: mockIdCounters.unidades_medida, codigo: trimCodigo, descripcion: trimDesc, activo: true, creado_en: new Date().toISOString() };
      mockData.unidades_medida.push(newUM);
      res.status(201).json(newUM);
    } else {
      const result = await pool.query(
        'INSERT INTO unidades_medida (codigo, descripcion) VALUES ($1, $2) RETURNING *',
        [trimCodigo, trimDesc]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ message: 'El código de unidad de medida ya existe' });
    } else {
      console.error('[ERROR POST /api/unidades-medida]', err);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  }
});

app.put('/api/unidades-medida/:id', authenticateToken, checkRole(['Administrador']), async (req, res) => {
  const { id } = req.params;
  const { codigo, descripcion, activo } = req.body;
  try {
    if (useMock) {
      const idx = mockData.unidades_medida.findIndex(u => u.id === parseInt(id));
      if (idx === -1) return res.status(404).json({ message: 'Unidad no encontrada' });
      mockData.unidades_medida[idx] = {
        ...mockData.unidades_medida[idx],
        codigo: (codigo || '').trim().toUpperCase(),
        descripcion: (descripcion || '').trim(),
        activo: activo !== undefined ? activo : mockData.unidades_medida[idx].activo
      };
      res.json(mockData.unidades_medida[idx]);
    } else {
      const result = await pool.query(
        'UPDATE unidades_medida SET codigo=$1, descripcion=$2, activo=$3 WHERE id=$4 RETURNING *',
        [(codigo || '').trim().toUpperCase(), (descripcion || '').trim(), activo, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Unidad no encontrada' });
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/unidades-medida/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── RESPONSABLES DE DESPACHO ─────────────────────────────────────────────────

app.get('/api/responsables-despacho', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      res.json(mockData.responsables_despacho.filter(r => r.activo));
    } else {
      const result = await pool.query('SELECT * FROM responsables_despacho WHERE activo = TRUE ORDER BY nombre ASC');
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/responsables-despacho]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/responsables-despacho', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { nombre, dni } = req.body;
  const trimNombre = (nombre || '').trim();
  const trimDni = (dni || '').trim();
  if (!trimNombre || !trimDni) {
    return res.status(400).json({ message: 'Nombre y DNI son obligatorios' });
  }
  if (trimDni.length !== 8 || !/^\d+$/.test(trimDni)) {
    return res.status(400).json({ message: 'El DNI debe tener exactamente 8 dígitos numéricos' });
  }
  try {
    if (useMock) {
      mockIdCounters.responsables_despacho++;
      const newResp = { id: mockIdCounters.responsables_despacho, nombre: trimNombre, dni: trimDni, activo: true, creado_en: new Date().toISOString() };
      mockData.responsables_despacho.push(newResp);
      res.status(201).json(newResp);
    } else {
      const result = await pool.query(
        'INSERT INTO responsables_despacho (nombre, dni) VALUES ($1, $2) RETURNING *',
        [trimNombre, trimDni]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR POST /api/responsables-despacho]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.put('/api/responsables-despacho/:id', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { nombre, dni, activo } = req.body;
  try {
    if (useMock) {
      const idx = mockData.responsables_despacho.findIndex(r => r.id === parseInt(id));
      if (idx === -1) return res.status(404).json({ message: 'Responsable no encontrado' });
      mockData.responsables_despacho[idx] = {
        ...mockData.responsables_despacho[idx],
        nombre: (nombre || '').trim(),
        dni: (dni || '').trim(),
        activo: activo !== undefined ? activo : mockData.responsables_despacho[idx].activo
      };
      res.json(mockData.responsables_despacho[idx]);
    } else {
      const result = await pool.query(
        'UPDATE responsables_despacho SET nombre=$1, dni=$2, activo=$3 WHERE id=$4 RETURNING *',
        [(nombre || '').trim(), (dni || '').trim(), activo, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Responsable no encontrado' });
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/responsables-despacho/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── VIAJES ───────────────────────────────────────────────────────────────────

app.get('/api/viajes', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      const result = mockData.viajes.map(v => ({
        ...v,
        cliente: mockData.clientes.find(c => c.id === v.cliente_id) || null,
        responsable_despacho: mockData.responsables_despacho.find(r => r.id === v.responsable_despacho_id) || null
      }));
      res.json(result);
    } else {
      const result = await pool.query(`
        SELECT v.*,
          row_to_json(c) as cliente,
          row_to_json(rd) as responsable_despacho
        FROM viajes v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN responsables_despacho rd ON v.responsable_despacho_id = rd.id
        ORDER BY v.fecha_hora_despacho ASC
      `);
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/viajes', authenticateToken, checkRole(['Planificador', 'Administrador']), async (req, res) => {
  const { codigo_viaje, cultivo, variedades, origen_fruta, cliente_id, peso, fecha_hora_despacho, origen_despacho } = req.body;

  if (!codigo_viaje || !cultivo || !variedades || !origen_fruta || !cliente_id || !peso || !fecha_hora_despacho || !origen_despacho) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios' });
  }

  // variedades can be an array from frontend — join to comma-separated string
  const variedadesStr = Array.isArray(variedades) ? variedades.join(',') : variedades;

  try {
    if (useMock) {
      if (mockData.viajes.find(v => v.codigo_viaje.toLowerCase() === codigo_viaje.toLowerCase())) {
        return res.status(400).json({ message: 'El código de viaje ya existe' });
      }
      mockIdCounters.viajes++;
      const newViaje = {
        id: mockIdCounters.viajes,
        codigo_viaje, cultivo, variedades: variedadesStr, origen_fruta,
        cliente_id: parseInt(cliente_id), peso: parseFloat(peso),
        fecha_hora_despacho, origen_despacho,
        estado: 'Planificado', estado_frio: 'En proceso',
        guia_remision: null, conductor_nombre: null, conductor_licencia: null,
        conductor_placa: null, observaciones: null, responsable_despacho_id: null,
        area_responsable: 'CÁMARAS Y DESPACHOS FRESCOS',
        creado_en: new Date().toISOString()
      };
      mockData.viajes.push(newViaje);
      const cliente = mockData.clientes.find(c => c.id === newViaje.cliente_id);
      res.status(201).json({ ...newViaje, cliente });
    } else {
      const result = await pool.query(`
        INSERT INTO viajes (codigo_viaje, cultivo, variedades, origen_fruta, cliente_id, peso, fecha_hora_despacho, origen_despacho)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
      `, [codigo_viaje, cultivo, variedadesStr, origen_fruta, cliente_id, peso, fecha_hora_despacho, origen_despacho]);

      const viaje = result.rows[0];
      const clienteResult = await pool.query('SELECT * FROM clientes WHERE id = $1', [viaje.cliente_id]);
      res.status(201).json({ ...viaje, cliente: clienteResult.rows[0] || null });
    }
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).json({ message: 'El código de viaje ya existe en el sistema' });
    } else {
      console.error('[ERROR POST /api/viajes]', err);
      res.status(500).json({ message: 'Error interno del servidor' });
    }
  }
});

app.put('/api/viajes/:id', authenticateToken, checkRole(['Planificador', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { codigo_viaje, cultivo, variedades, origen_fruta, cliente_id, peso, fecha_hora_despacho, origen_despacho } = req.body;
  const variedadesStr = Array.isArray(variedades) ? variedades.join(',') : variedades;

  try {
    if (useMock) {
      const idx = mockData.viajes.findIndex(v => v.id === parseInt(id));
      if (idx === -1) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (mockData.viajes[idx].estado !== 'Planificado') {
        return res.status(400).json({ message: 'No se puede modificar un viaje que ya no está en estado Planificado' });
      }
      const dup = mockData.viajes.find(v => v.id !== parseInt(id) && v.codigo_viaje.toLowerCase() === codigo_viaje.toLowerCase());
      if (dup) return res.status(400).json({ message: 'El código de viaje ya existe' });
      mockData.viajes[idx] = {
        ...mockData.viajes[idx], codigo_viaje, cultivo, variedades: variedadesStr,
        origen_fruta, cliente_id: parseInt(cliente_id), peso: parseFloat(peso),
        fecha_hora_despacho, origen_despacho
      };
      const cliente = mockData.clientes.find(c => c.id === mockData.viajes[idx].cliente_id);
      res.json({ ...mockData.viajes[idx], cliente });
    } else {
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Planificado') {
        return res.status(400).json({ message: 'No se puede modificar un viaje que ya no está en estado Planificado' });
      }
      const result = await pool.query(`
        UPDATE viajes SET codigo_viaje=$1, cultivo=$2, variedades=$3, origen_fruta=$4,
          cliente_id=$5, peso=$6, fecha_hora_despacho=$7, origen_despacho=$8
        WHERE id=$9 RETURNING *
      `, [codigo_viaje, cultivo, variedadesStr, origen_fruta, cliente_id, peso, fecha_hora_despacho, origen_despacho, id]);
      const viaje = result.rows[0];
      const clienteResult = await pool.query('SELECT * FROM clientes WHERE id = $1', [viaje.cliente_id]);
      res.json({ ...viaje, cliente: clienteResult.rows[0] || null });
    }
  } catch (err) {
    console.error('[ERROR PUT /api/viajes/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── CADENA DE FRÍO ───────────────────────────────────────────────────────────

// GET all pallet records for a voyage
app.get('/api/viajes/:id/pallets', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));
      res.json({
        viaje: { ...voyage, cliente: mockData.clientes.find(c => c.id === voyage.cliente_id) },
        pallets
      });
    } else {
      const voyageResult = await pool.query(`
        SELECT v.*, row_to_json(c) as cliente
        FROM viajes v LEFT JOIN clientes c ON v.cliente_id = c.id
        WHERE v.id = $1
      `, [id]);
      if (voyageResult.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      const palletsResult = await pool.query(
        'SELECT * FROM pallets WHERE viaje_id = $1 ORDER BY variedad, numero_pallet, id ASC', [id]
      );
      res.json({ viaje: voyageResult.rows[0], pallets: palletsResult.rows });
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes/:id/pallets]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST upload batch of records for a specific variedad
app.post('/api/viajes/:id/pallets', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { variedad, pallets } = req.body;

  if (!variedad || !pallets || !Array.isArray(pallets) || pallets.length === 0) {
    return res.status(400).json({ message: 'Variedad y lista de registros son requeridos' });
  }

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Planificado' || voyage.estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }

      const validCodigos = mockData.unidades_medida.filter(u => u.activo).map(u => u.codigo);
      for (const p of pallets) {
        if (!validCodigos.includes((p.unidad_medida || '').trim().toUpperCase())) {
          return res.status(400).json({ message: `Unidad de medida inválida: "${p.unidad_medida}". Opciones válidas: ${validCodigos.join(', ')}` });
        }
      }

      const maxId = mockData.pallets.length > 0 ? Math.max(...mockData.pallets.map(x => x.id)) : 0;
      const newPallets = pallets.map((p, idx) => ({
        id: maxId + idx + 1,
        viaje_id: parseInt(id),
        variedad,
        numero_pallet: parseInt(p.numero_pallet),
        codigo_pallet: (p.codigo_pallet || '').trim(),
        fecha_cosecha: p.fecha_cosecha || null,
        procedencia: (p.procedencia || '').trim() || null,
        cantidad: parseFloat(p.cantidad),
        unidad_medida: (p.unidad_medida || '').trim().toUpperCase(),
        peso_produccion: p.peso_produccion !== '' && p.peso_produccion !== null ? parseFloat(p.peso_produccion) : null,
        precinto: (p.precinto || '').trim() || null,
        peso_bruto: null, peso_tara: null, peso_despacho: null, desviacion: null,
        creado_en: new Date().toISOString()
      }));
      mockData.pallets.push(...newPallets);
      res.status(201).json({ message: `${newPallets.length} registros añadidos para ${variedad}`, pallets: newPallets });
    } else {
      const checkState = await pool.query('SELECT estado, estado_frio FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      const { estado, estado_frio } = checkState.rows[0];
      if (estado !== 'Planificado' || estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }

      const umResult = await pool.query('SELECT codigo FROM unidades_medida WHERE activo = TRUE');
      const validCodigos = umResult.rows.map(r => r.codigo);
      for (const p of pallets) {
        if (!validCodigos.includes((p.unidad_medida || '').trim().toUpperCase())) {
          return res.status(400).json({ message: `Unidad de medida inválida: "${p.unidad_medida}". Opciones: ${validCodigos.join(', ')}` });
        }
      }

      await pool.query('BEGIN');
      const newPallets = [];
      for (const p of pallets) {
        const result = await pool.query(`
          INSERT INTO pallets
            (viaje_id, variedad, numero_pallet, codigo_pallet, fecha_cosecha, procedencia, cantidad, unidad_medida, peso_produccion, precinto)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
        `, [id, variedad, parseInt(p.numero_pallet), (p.codigo_pallet || '').trim(),
           p.fecha_cosecha || null, (p.procedencia || '').trim() || null,
           parseFloat(p.cantidad), (p.unidad_medida || '').trim().toUpperCase(),
           (p.peso_produccion !== '' && p.peso_produccion !== null && p.peso_produccion !== undefined) ? parseFloat(p.peso_produccion) : null,
           (p.precinto || '').trim() || null]);
        newPallets.push(result.rows[0]);
      }
      await pool.query('COMMIT');
      res.status(201).json({ message: `${newPallets.length} registros añadidos para ${variedad}`, pallets: newPallets });
    }
  } catch (err) {
    if (!useMock) await pool.query('ROLLBACK').catch(() => {});
    console.error('[ERROR POST /api/viajes/:id/pallets]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// PUT edit a single pallet record (Cadena de Frío)
app.put('/api/pallets/:palletId', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { palletId } = req.params;
  const { numero_pallet, codigo_pallet, fecha_cosecha, procedencia, cantidad, unidad_medida, peso_produccion, precinto } = req.body;

  try {
    if (useMock) {
      const idx = mockData.pallets.findIndex(p => p.id === parseInt(palletId));
      if (idx === -1) return res.status(404).json({ message: 'Registro no encontrado' });
      const viaje = mockData.viajes.find(v => v.id === mockData.pallets[idx].viaje_id);
      if (!viaje || viaje.estado !== 'Planificado' || viaje.estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      const validCodigos = mockData.unidades_medida.filter(u => u.activo).map(u => u.codigo);
      if (!validCodigos.includes((unidad_medida || '').trim().toUpperCase())) {
        return res.status(400).json({ message: `Unidad de medida inválida: "${unidad_medida}"` });
      }
      mockData.pallets[idx] = {
        ...mockData.pallets[idx],
        numero_pallet: parseInt(numero_pallet),
        codigo_pallet: (codigo_pallet || '').trim(),
        fecha_cosecha: fecha_cosecha || null,
        procedencia: (procedencia || '').trim() || null,
        cantidad: parseFloat(cantidad),
        unidad_medida: (unidad_medida || '').trim().toUpperCase(),
        peso_produccion: (peso_produccion !== '' && peso_produccion !== null) ? parseFloat(peso_produccion) : null,
        precinto: (precinto || '').trim() || null
      };
      res.json(mockData.pallets[idx]);
    } else {
      const check = await pool.query(`
        SELECT p.*, v.estado, v.estado_frio FROM pallets p
        JOIN viajes v ON p.viaje_id = v.id WHERE p.id = $1
      `, [palletId]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Registro no encontrado' });
      if (check.rows[0].estado !== 'Planificado' || check.rows[0].estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      const umCheck = await pool.query('SELECT codigo FROM unidades_medida WHERE codigo=$1 AND activo=TRUE', [(unidad_medida || '').trim().toUpperCase()]);
      if (umCheck.rows.length === 0) return res.status(400).json({ message: `Unidad de medida inválida: "${unidad_medida}"` });

      const result = await pool.query(`
        UPDATE pallets SET numero_pallet=$1, codigo_pallet=$2, fecha_cosecha=$3, procedencia=$4,
          cantidad=$5, unidad_medida=$6, peso_produccion=$7, precinto=$8
        WHERE id=$9 RETURNING *
      `, [parseInt(numero_pallet), (codigo_pallet || '').trim(), fecha_cosecha || null,
          (procedencia || '').trim() || null, parseFloat(cantidad), (unidad_medida || '').trim().toUpperCase(),
          (peso_produccion !== '' && peso_produccion !== null && peso_produccion !== undefined) ? parseFloat(peso_produccion) : null,
          (precinto || '').trim() || null, palletId]);
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/pallets/:palletId]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// DELETE a single pallet record (Cadena de Frío)
app.delete('/api/pallets/:palletId', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { palletId } = req.params;
  try {
    if (useMock) {
      const idx = mockData.pallets.findIndex(p => p.id === parseInt(palletId));
      if (idx === -1) return res.status(404).json({ message: 'Registro no encontrado' });
      const viaje = mockData.viajes.find(v => v.id === mockData.pallets[idx].viaje_id);
      if (!viaje || viaje.estado !== 'Planificado' || viaje.estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      mockData.pallets.splice(idx, 1);
      res.json({ message: 'Registro eliminado exitosamente' });
    } else {
      const check = await pool.query(`
        SELECT p.*, v.estado, v.estado_frio FROM pallets p
        JOIN viajes v ON p.viaje_id = v.id WHERE p.id = $1
      `, [palletId]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Registro no encontrado' });
      if (check.rows[0].estado !== 'Planificado' || check.rows[0].estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      await pool.query('DELETE FROM pallets WHERE id = $1', [palletId]);
      res.json({ message: 'Registro eliminado exitosamente' });
    }
  } catch (err) {
    console.error('[ERROR DELETE /api/pallets/:palletId]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// DELETE all records for a specific variedad in a voyage
app.delete('/api/viajes/:id/pallets/variedad/:variedad', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { id, variedad } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Planificado' || voyage.estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      const before = mockData.pallets.filter(p => p.viaje_id === parseInt(id) && p.variedad === variedad).length;
      mockData.pallets = mockData.pallets.filter(p => !(p.viaje_id === parseInt(id) && p.variedad === variedad));
      res.json({ message: `${before} registros eliminados para variedad "${variedad}"` });
    } else {
      const check = await pool.query('SELECT estado, estado_frio FROM viajes WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (check.rows[0].estado !== 'Planificado' || check.rows[0].estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje no está disponible para edición' });
      }
      const result = await pool.query('DELETE FROM pallets WHERE viaje_id=$1 AND variedad=$2', [id, variedad]);
      res.json({ message: `${result.rowCount} registros eliminados para variedad "${variedad}"` });
    }
  } catch (err) {
    console.error('[ERROR DELETE /api/viajes/:id/pallets/variedad/:variedad]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST Confirmar Carga (Cadena de Frío) — viaje pasa a Preparado
app.post('/api/viajes/:id/confirmar-frio', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Planificado' || voyage.estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Planificado para confirmar' });
      }
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));
      if (pallets.length === 0) {
        return res.status(400).json({ message: 'Debe registrar al menos un pallet antes de confirmar la carga' });
      }
      voyage.estado = 'Preparado';
      voyage.estado_frio = 'Confirmado';
      res.json({ message: 'Carga confirmada. El viaje pasó a estado Preparado.', viaje: voyage });
    } else {
      const check = await pool.query('SELECT estado, estado_frio FROM viajes WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (check.rows[0].estado !== 'Planificado' || check.rows[0].estado_frio !== 'En proceso') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Planificado para confirmar' });
      }
      const count = await pool.query('SELECT COUNT(*) FROM pallets WHERE viaje_id = $1', [id]);
      if (parseInt(count.rows[0].count) === 0) {
        return res.status(400).json({ message: 'Debe registrar al menos un registro antes de confirmar la carga' });
      }
      await pool.query("UPDATE viajes SET estado='Preparado', estado_frio='Confirmado' WHERE id=$1", [id]);
      res.json({ message: 'Carga confirmada. El viaje pasó a estado Preparado.' });
    }
  } catch (err) {
    console.error('[ERROR POST /api/viajes/:id/confirmar-frio]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST Devolver a Cadena de Frío (Despacho regresa el viaje)
app.post('/api/viajes/:id/devolver-frio', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Preparado') {
        return res.status(400).json({ message: 'Solo se puede devolver un viaje en estado Preparado' });
      }
      voyage.estado = 'Planificado';
      voyage.estado_frio = 'En proceso';
      mockData.pallets.filter(p => p.viaje_id === parseInt(id)).forEach(p => {
        p.peso_bruto = null; p.peso_tara = null; p.peso_despacho = null; p.desviacion = null;
      });
      res.json({ message: 'Viaje devuelto a Cadena de Frío para revisión' });
    } else {
      const check = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (check.rows[0].estado !== 'Preparado') {
        return res.status(400).json({ message: 'Solo se puede devolver un viaje en estado Preparado' });
      }
      await pool.query('BEGIN');
      await pool.query("UPDATE viajes SET estado='Planificado', estado_frio='En proceso' WHERE id=$1", [id]);
      await pool.query('UPDATE pallets SET peso_bruto=NULL, peso_tara=NULL, peso_despacho=NULL, desviacion=NULL WHERE viaje_id=$1', [id]);
      await pool.query('COMMIT');
      res.json({ message: 'Viaje devuelto a Cadena de Frío para revisión' });
    }
  } catch (err) {
    if (!useMock) await pool.query('ROLLBACK').catch(() => {});
    console.error('[ERROR POST /api/viajes/:id/devolver-frio]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── DESPACHO ──────────────────────────────────────────────────────────────────

// GET pallets grouped by numero_pallet for Despacho view
app.get('/api/viajes/:id/pallets-grupos', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));

      const groups = {};
      for (const p of pallets) {
        const key = p.numero_pallet;
        if (!groups[key]) {
          groups[key] = {
            numero_pallet: p.numero_pallet,
            variedades: [],
            cantidad_total: 0,
            unidad_medida: p.unidad_medida,
            peso_produccion_total: 0,
            peso_bruto: p.peso_bruto,
            peso_tara: p.peso_tara,
            peso_despacho: p.peso_despacho,
            desviacion: p.desviacion
          };
        }
        const g = groups[key];
        g.cantidad_total = parseFloat((g.cantidad_total + (parseFloat(p.cantidad) || 0)).toFixed(3));
        g.peso_produccion_total = parseFloat((g.peso_produccion_total + (parseFloat(p.peso_produccion) || 0)).toFixed(3));
        if (!g.variedades.includes(p.variedad)) g.variedades.push(p.variedad);
        if (p.peso_bruto !== null) { g.peso_bruto = p.peso_bruto; g.peso_tara = p.peso_tara; g.peso_despacho = p.peso_despacho; g.desviacion = p.desviacion; }
      }
      const sortedGroups = Object.values(groups).sort((a, b) => a.numero_pallet - b.numero_pallet);
      res.json({
        viaje: { ...voyage, cliente: mockData.clientes.find(c => c.id === voyage.cliente_id), responsable_despacho: mockData.responsables_despacho.find(r => r.id === voyage.responsable_despacho_id) || null },
        grupos: sortedGroups
      });
    } else {
      const voyageResult = await pool.query(`
        SELECT v.*, row_to_json(c) as cliente, row_to_json(rd) as responsable_despacho
        FROM viajes v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN responsables_despacho rd ON v.responsable_despacho_id = rd.id
        WHERE v.id = $1
      `, [id]);
      if (voyageResult.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });

      const gruposResult = await pool.query(`
        SELECT
          numero_pallet,
          ARRAY_AGG(DISTINCT variedad ORDER BY variedad) as variedades,
          SUM(cantidad) as cantidad_total,
          MAX(unidad_medida) as unidad_medida,
          SUM(COALESCE(peso_produccion, 0)) as peso_produccion_total,
          MAX(peso_bruto) as peso_bruto,
          MAX(peso_tara) as peso_tara,
          MAX(peso_despacho) as peso_despacho,
          MAX(desviacion) as desviacion
        FROM pallets WHERE viaje_id = $1
        GROUP BY numero_pallet ORDER BY numero_pallet ASC
      `, [id]);

      res.json({ viaje: voyageResult.rows[0], grupos: gruposResult.rows });
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes/:id/pallets-grupos]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// PUT save peso_bruto/tara for a pallet group
app.put('/api/viajes/:id/pallets-grupo/:numeroPallet', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id, numeroPallet } = req.params;
  const { peso_bruto, peso_tara } = req.body;

  const bruto = parseFloat(peso_bruto);
  const tara = parseFloat(peso_tara);
  if (isNaN(bruto) || isNaN(tara)) {
    return res.status(400).json({ message: 'Peso bruto y tara deben ser valores numéricos válidos' });
  }
  if (bruto < tara) {
    return res.status(400).json({ message: 'El peso bruto no puede ser menor que la tara' });
  }
  const despacho = parseFloat((bruto - tara).toFixed(3));

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para registrar pesos' });
      }
      const groupPallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id) && p.numero_pallet === parseInt(numeroPallet));
      if (groupPallets.length === 0) return res.status(404).json({ message: 'Grupo de pallet no encontrado' });

      const totalPesoProd = groupPallets.reduce((s, p) => s + (parseFloat(p.peso_produccion) || 0), 0);
      const diffAbs = Math.abs(despacho - totalPesoProd);
      const desviacion = totalPesoProd > 0 ? parseFloat(((diffAbs / totalPesoProd) * 100).toFixed(2)) : 0;

      groupPallets.forEach(p => {
        p.peso_bruto = bruto; p.peso_tara = tara; p.peso_despacho = despacho; p.desviacion = desviacion;
      });
      res.json({ numero_pallet: parseInt(numeroPallet), peso_bruto: bruto, peso_tara: tara, peso_despacho: despacho, desviacion });
    } else {
      const check = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (check.rows[0].estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para registrar pesos' });
      }

      const pesoResult = await pool.query(
        'SELECT COALESCE(SUM(COALESCE(peso_produccion, 0)), 0) as total FROM pallets WHERE viaje_id=$1 AND numero_pallet=$2',
        [id, numeroPallet]
      );
      const totalPesoProd = parseFloat(pesoResult.rows[0].total);
      const diffAbs = Math.abs(despacho - totalPesoProd);
      const desviacion = totalPesoProd > 0 ? parseFloat(((diffAbs / totalPesoProd) * 100).toFixed(2)) : 0;

      await pool.query(
        'UPDATE pallets SET peso_bruto=$1, peso_tara=$2, peso_despacho=$3, desviacion=$4 WHERE viaje_id=$5 AND numero_pallet=$6',
        [bruto, tara, despacho, desviacion, id, numeroPallet]
      );
      res.json({ numero_pallet: parseInt(numeroPallet), peso_bruto: bruto, peso_tara: tara, peso_despacho: despacho, desviacion });
    }
  } catch (err) {
    console.error('[ERROR PUT /api/viajes/:id/pallets-grupo/:numeroPallet]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST Finalizar Carga (Despacho → Cargado)
app.post('/api/viajes/:id/finalizar-carga', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para finalizar carga' });
      }
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));
      if (pallets.length === 0) return res.status(400).json({ message: 'No hay registros de pallets en este viaje' });

      const uniquePallets = [...new Set(pallets.map(p => p.numero_pallet))];
      const incomplete = uniquePallets.some(num => {
        const g = pallets.filter(p => p.numero_pallet === num);
        return g[0].peso_bruto === null || g[0].peso_tara === null;
      });
      if (incomplete) {
        return res.status(400).json({ message: 'Faltan registrar los pesos para algunos pallets' });
      }
      voyage.estado = 'Cargado';
      res.json({ message: 'Viaje marcado como Cargado exitosamente', viaje: voyage });
    } else {
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para finalizar carga' });
      }
      const incomplete = await pool.query(`
        SELECT COUNT(DISTINCT numero_pallet) as count FROM pallets
        WHERE viaje_id=$1 AND (peso_bruto IS NULL OR peso_tara IS NULL)
      `, [id]);
      if (parseInt(incomplete.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Faltan registrar los pesos para algunos pallets' });
      }
      await pool.query("UPDATE viajes SET estado='Cargado' WHERE id=$1", [id]);
      res.json({ message: 'Viaje marcado como Cargado exitosamente' });
    }
  } catch (err) {
    console.error('[ERROR POST /api/viajes/:id/finalizar-carga]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// POST Finalizar Despacho (Despacho → Finalizado)
app.post('/api/viajes/:id/finalizar-despacho', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { guia_remision, conductor_nombre, conductor_licencia, conductor_placa, observaciones, responsable_despacho_id, area_responsable } = req.body;

  if (!guia_remision || !conductor_nombre || !conductor_licencia || !conductor_placa) {
    return res.status(400).json({ message: 'Guía de Remisión, Conductor, Licencia y Placa son obligatorios' });
  }

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Cargado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Cargado para finalizar el despacho' });
      }
      Object.assign(voyage, {
        guia_remision, conductor_nombre, conductor_licencia, conductor_placa,
        observaciones: observaciones || null,
        responsable_despacho_id: responsable_despacho_id ? parseInt(responsable_despacho_id) : null,
        area_responsable: area_responsable || 'CÁMARAS Y DESPACHOS FRESCOS',
        estado: 'Finalizado'
      });
      res.json({ message: 'Despacho finalizado con éxito', viaje: voyage });
    } else {
      const check = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (check.rows[0].estado !== 'Cargado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Cargado para finalizar el despacho' });
      }
      const result = await pool.query(`
        UPDATE viajes SET
          guia_remision=$1, conductor_nombre=$2, conductor_licencia=$3, conductor_placa=$4,
          observaciones=$5, responsable_despacho_id=$6, area_responsable=$7, estado='Finalizado'
        WHERE id=$8 RETURNING *
      `, [guia_remision, conductor_nombre, conductor_licencia, conductor_placa,
          observaciones || null, responsable_despacho_id || null,
          area_responsable || 'CÁMARAS Y DESPACHOS FRESCOS', id]);
      res.json({ message: 'Despacho finalizado con éxito', viaje: result.rows[0] });
    }
  } catch (err) {
    console.error('[ERROR POST /api/viajes/:id/finalizar-despacho]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── VALE DE SALIDA ────────────────────────────────────────────────────────────

app.get('/api/viajes/:id/vale', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      const cliente = mockData.clientes.find(c => c.id === voyage.cliente_id);
      const responsable = mockData.responsables_despacho.find(r => r.id === voyage.responsable_despacho_id) || null;
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));

      // Group by numero_pallet, then allocate weights proportionally by variedad
      const palletGroups = {};
      pallets.forEach(p => {
        if (!palletGroups[p.numero_pallet]) palletGroups[p.numero_pallet] = [];
        palletGroups[p.numero_pallet].push(p);
      });

      const variedadData = {};
      Object.values(palletGroups).forEach(group => {
        const totalCant = group.reduce((s, p) => s + (parseFloat(p.cantidad) || 0), 0);
        const pesoDesp = parseFloat(group[0].peso_despacho) || 0;
        group.forEach(p => {
          if (!variedadData[p.variedad]) {
            variedadData[p.variedad] = { variedad: p.variedad, cantidad: 0, unidad_medida: p.unidad_medida, peso_total: 0 };
          }
          const prop = totalCant > 0 ? (parseFloat(p.cantidad) || 0) / totalCant : 0;
          variedadData[p.variedad].cantidad += parseFloat(p.cantidad) || 0;
          variedadData[p.variedad].peso_total += pesoDesp * prop;
        });
      });

      const detalles = Object.values(variedadData).map(d => ({
        ...d,
        cantidad: parseFloat(d.cantidad.toFixed(3)),
        peso_total: parseFloat(d.peso_total.toFixed(3))
      }));

      res.json({ viaje: { ...voyage, cliente, responsable_despacho: responsable }, detalles });
    } else {
      const voyageResult = await pool.query(`
        SELECT v.*, row_to_json(c) as cliente, row_to_json(rd) as responsable_despacho
        FROM viajes v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        LEFT JOIN responsables_despacho rd ON v.responsable_despacho_id = rd.id
        WHERE v.id = $1
      `, [id]);
      if (voyageResult.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });

      // Proportional allocation of peso_despacho by variedad within each pallet group
      const detallesResult = await pool.query(`
        WITH pallet_groups AS (
          SELECT
            numero_pallet,
            COALESCE(SUM(cantidad), 0) as total_cantidad_grupo,
            MAX(COALESCE(peso_despacho, 0)) as peso_despacho_grupo
          FROM pallets WHERE viaje_id = $1
          GROUP BY numero_pallet
        )
        SELECT
          p.variedad,
          SUM(p.cantidad) as cantidad,
          MAX(p.unidad_medida) as unidad_medida,
          SUM(
            CASE WHEN pg.total_cantidad_grupo > 0
              THEN pg.peso_despacho_grupo * p.cantidad / pg.total_cantidad_grupo
              ELSE 0 END
          ) as peso_total
        FROM pallets p
        JOIN pallet_groups pg ON p.numero_pallet = pg.numero_pallet
        WHERE p.viaje_id = $1
        GROUP BY p.variedad
        ORDER BY p.variedad
      `, [id]);

      res.json({ viaje: voyageResult.rows[0], detalles: detallesResult.rows });
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes/:id/vale]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// ── STATIC FILES & STARTUP ────────────────────────────────────────────────────

if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
  app.listen(PORT, () => {
    console.log(`🚀 Servidor backend escuchando en puerto ${PORT}`);
  });
}

export default app;
