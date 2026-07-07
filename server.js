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
  console.error('❌ FATAL: JWT_SECRET no está definido en las variables de entorno. El servidor no puede iniciar de forma segura.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// ── Cabeceras de seguridad HTTP (helmet) ───────────────────────────────────
app.use(helmet());

// ── CORS restrictivo ───────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (ej: Postman, server-to-server) o de orígenes permitidos
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  },
  credentials: true
}));

app.use(express.json());

// ── Rate limiting en login (máx 10 intentos cada 15 min) ──────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.' }
});

// Database setup: Postgres with In-Memory fallback
let pool = null;
let useMock = false;

// Mock database store
const mockData = {
  usuarios: [
    {
      id: 1,
      email: 'planificador@camposol.com',
      password_hash: bcrypt.hashSync('camposol123', 10),
      nombre: 'Planificador Venta Nacional',
      role: 'Planificador'
    },
    {
      id: 2,
      email: 'frio@camposol.com',
      password_hash: bcrypt.hashSync('camposol123', 10),
      nombre: 'Responsable Cadena Frio',
      role: 'Cadena de frío'
    },
    {
      id: 3,
      email: 'despacho@camposol.com',
      password_hash: bcrypt.hashSync('camposol123', 10),
      nombre: 'Responsable Despacho',
      role: 'Despacho'
    },
    {
      id: 4,
      email: 'admin@camposol.com',
      password_hash: bcrypt.hashSync('camposol123', 10),
      nombre: 'Administrador Camposol',
      role: 'Administrador'
    }
  ],
  clientes: [
    { id: 1, razon_social: 'Supermercados Peruanos S.A.', ruc: '20100018612', direccion: 'Av. Larco 1230, Miraflores, Lima' },
    { id: 2, razon_social: 'Cencosud Retail Peru S.A.', ruc: '20509088721', direccion: 'Av. Raul Ferrero 120, La Molina, Lima' },
    { id: 3, razon_social: 'Hipermercados Tottus S.A.', ruc: '20508565934', direccion: 'Av. Tacna 650, Cercado de Lima, Lima' },
    { id: 4, razon_social: 'Camposol Trading S.A.C.', ruc: '20536471822', direccion: 'Av. El Derby 254, Santiago de Surco, Lima' }
  ],
  viajes: [],
  pallets: []
};

// Seed a few demo voyages to start with in mock mode
const now = new Date();
const startOfCurrentWeek = new Date(now.setDate(now.getDate() - now.getDay() + 1)); // Monday of current week
const formatMockDate = (d, daysOffset = 0, hoursOffset = 10) => {
  const target = new Date(d);
  target.setDate(target.getDate() + daysOffset);
  target.setHours(hoursOffset, 0, 0, 0);
  return target;
};

mockData.viajes.push(
  {
    id: 1,
    codigo_viaje: 'VIAJE-001',
    cultivo: 'Arándano',
    variedad: 'Ventura',
    origen_fruta: 'Fresco',
    cliente_id: 1,
    peso: 15000.00,
    fecha_hora_despacho: formatMockDate(startOfCurrentWeek, 1, 9).toISOString(), // Tuesday
    fecha_cosecha: formatMockDate(startOfCurrentWeek, 0).toISOString().split('T')[0], // Monday
    origen_despacho: 'Planta Chao',
    estado: 'Planificado',
    guia_remision: null,
    conductor_nombre: null,
    conductor_licencia: null,
    conductor_placa: null,
    creado_en: new Date().toISOString()
  },
  {
    id: 2,
    codigo_viaje: 'VIAJE-002',
    cultivo: 'Palta',
    variedad: 'Hass',
    origen_fruta: 'Fresco',
    cliente_id: 2,
    peso: 22000.00,
    fecha_hora_despacho: formatMockDate(startOfCurrentWeek, 3, 14).toISOString(), // Thursday
    fecha_cosecha: formatMockDate(startOfCurrentWeek, 2).toISOString().split('T')[0], // Wednesday
    origen_despacho: 'Planta Chao',
    estado: 'Planificado',
    guia_remision: null,
    conductor_nombre: null,
    conductor_licencia: null,
    conductor_placa: null,
    creado_en: new Date().toISOString()
  }
);

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('user:password')) {
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: true  // ✅ Verificar certificado SSL (protección MITM)
      },
      // Configuración para Neon.tech (serverless) — evita desconexiones idle
      max: 5,                        // máximo de conexiones en el pool
      idleTimeoutMillis: 10000,      // cerrar conexiones inactivas tras 10s
      connectionTimeoutMillis: 5000, // timeout de conexión nueva
      keepAlive: true
    });

    // Manejar errores de conexión idle SIN crashear el servidor
    pool.on('error', (err) => {
      console.error('⚠️  Error inesperado en cliente idle del pool (reconectando automáticamente):', err.message);
      // No relanzamos el error — el pool creará nuevas conexiones automáticamente
    });

    // Test connection
    const client = await pool.connect();
    console.log('✅ Conexión exitosa a la base de datos de Neon.tech (Postgres)');
    client.release();
  } catch (err) {
    console.error('❌ Error conectando a base de datos real. Usando Mock DB temporal en RAM:', err.message);
    useMock = true;
  }
} else {
  console.log('⚠️ DATABASE_URL no configurada o es plantilla por defecto. Usando Mock DB temporal en RAM.');
  useMock = true;
}


// Middleware: Authenticate JWT Token
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

// Middleware: Check Roles
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'No tienes permisos para realizar esta acción' });
    }
    next();
  };
};

// Auth API endpoints
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
      if (result.rows.length === 0) {
        return res.status(400).json({ message: 'Credenciales incorrectas' });
      }
      user = result.rows[0];
      const validPass = await bcrypt.compare(password, user.password_hash);
      if (!validPass) {
        return res.status(400).json({ message: 'Credenciales incorrectas' });
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, nombre: user.nombre }, JWT_SECRET, { expiresIn: '8h' });
    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, nombre: user.nombre }
    });
  } catch (err) {
    console.error('[ERROR /api/auth/login]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Clientes API (Maestro)
app.get('/api/clientes', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      res.json(mockData.clientes);
    } else {
      const result = await pool.query('SELECT * FROM clientes ORDER BY razon_social ASC');
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR /api/clientes]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Viajes API (Programa de Ventas Semanal)
app.get('/api/viajes', authenticateToken, async (req, res) => {
  try {
    if (useMock) {
      // Map client object inside voyage for convenience
      const viajesConCliente = mockData.viajes.map(v => {
        const client = mockData.clientes.find(c => c.id === v.cliente_id);
        return { ...v, cliente: client };
      });
      res.json(viajesConCliente);
    } else {
      const query = `
        SELECT v.*, row_to_json(c) as cliente
        FROM viajes v
        LEFT JOIN clientes c ON v.cliente_id = c.id
        ORDER BY v.fecha_hora_despacho ASC
      `;
      const result = await pool.query(query);
      res.json(result.rows);
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Create Voyage (Planificador)
app.post('/api/viajes', authenticateToken, checkRole(['Planificador', 'Administrador']), async (req, res) => {
  const {
    codigo_viaje,
    cultivo,
    variedad,
    origen_fruta,
    cliente_id,
    peso,
    fecha_hora_despacho,
    fecha_cosecha,
    origen_despacho
  } = req.body;

  try {
    if (useMock) {
      // Validation: duplicate voyage code
      if (mockData.viajes.find(v => v.codigo_viaje.toLowerCase() === codigo_viaje.toLowerCase())) {
        return res.status(400).json({ message: 'El código de viaje ya existe' });
      }

      const newVoyage = {
        id: mockData.viajes.length + 1,
        codigo_viaje,
        cultivo,
        variedad,
        origen_fruta,
        cliente_id: parseInt(cliente_id),
        peso: parseFloat(peso),
        fecha_hora_despacho,
        fecha_cosecha,
        origen_despacho,
        estado: 'Planificado',
        guia_remision: null,
        conductor_nombre: null,
        conductor_licencia: null,
        conductor_placa: null,
        creado_en: new Date().toISOString()
      };

      mockData.viajes.push(newVoyage);
      res.status(201).json(newVoyage);
    } else {
      const query = `
        INSERT INTO viajes (
          codigo_viaje, cultivo, variedad, origen_fruta, cliente_id, peso, 
          fecha_hora_despacho, fecha_cosecha, origen_despacho
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `;
      const result = await pool.query(query, [
        codigo_viaje, cultivo, variedad, origen_fruta, cliente_id, peso,
        fecha_hora_despacho, fecha_cosecha, origen_despacho
      ]);
      res.status(201).json(result.rows[0]);
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

// Update Voyage (Planificador - Only if state is 'Planificado')
app.put('/api/viajes/:id', authenticateToken, checkRole(['Planificador', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const {
    codigo_viaje,
    cultivo,
    variedad,
    origen_fruta,
    cliente_id,
    peso,
    fecha_hora_despacho,
    fecha_cosecha,
    origen_despacho
  } = req.body;

  try {
    if (useMock) {
      const voyageIndex = mockData.viajes.findIndex(v => v.id === parseInt(id));
      if (voyageIndex === -1) return res.status(404).json({ message: 'Viaje no encontrado' });
      
      const voyage = mockData.viajes[voyageIndex];
      if (voyage.estado !== 'Planificado') {
        return res.status(400).json({ message: 'No se puede modificar un viaje que ya no está en estado Planificado' });
      }

      // Check duplicate code
      const duplicate = mockData.viajes.find(v => v.id !== parseInt(id) && v.codigo_viaje.toLowerCase() === codigo_viaje.toLowerCase());
      if (duplicate) return res.status(400).json({ message: 'El código de viaje ya existe' });

      mockData.viajes[voyageIndex] = {
        ...voyage,
        codigo_viaje,
        cultivo,
        variedad,
        origen_fruta,
        cliente_id: parseInt(cliente_id),
        peso: parseFloat(peso),
        fecha_hora_despacho,
        fecha_cosecha,
        origen_despacho
      };

      res.json(mockData.viajes[voyageIndex]);
    } else {
      // Validate current state
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Planificado') {
        return res.status(400).json({ message: 'No se puede modificar un viaje que ya no está en estado Planificado' });
      }

      const query = `
        UPDATE viajes SET
          codigo_viaje = $1, cultivo = $2, variedad = $3, origen_fruta = $4,
          cliente_id = $5, peso = $6, fecha_hora_despacho = $7, fecha_cosecha = $8,
          origen_despacho = $9
        WHERE id = $10 RETURNING *
      `;
      const result = await pool.query(query, [
        codigo_viaje, cultivo, variedad, origen_fruta, cliente_id, peso,
        fecha_hora_despacho, fecha_cosecha, origen_despacho, id
      ]);
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/viajes/:id]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Get Pallets of a Voyage
app.get('/api/viajes/:id/pallets', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      const pallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));
      res.json({ viaje: voyage, pallets });
    } else {
      const voyageResult = await pool.query('SELECT * FROM viajes WHERE id = $1', [id]);
      if (voyageResult.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      const palletsResult = await pool.query('SELECT * FROM pallets WHERE viaje_id = $1 ORDER BY id ASC', [id]);
      res.json({ viaje: voyageResult.rows[0], pallets: palletsResult.rows });
    }
  } catch (err) {
    console.error('[ERROR GET /api/viajes/:id/pallets]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Assign Pallets (Cadena de Frío)
app.post('/api/viajes/:id/pallets', authenticateToken, checkRole(['Cadena de frío', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { pallets } = req.body; // Array of pallet data parsed from excel

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Planificado') {
        return res.status(400).json({ message: 'Este viaje ya fue procesado y no puede ser modificado' });
      }

      // Check duplicates inside the payload itself
      const codes = pallets.map(p => p.codigo_pallet.trim().toLowerCase());
      const duplicates = codes.filter((item, index) => codes.indexOf(item) !== index);
      if (duplicates.length > 0) {
        return res.status(400).json({ message: `Códigos de pallet duplicados en la carga: ${duplicates.join(', ')}` });
      }

      // Check duplicate code against DB
      for (const p of pallets) {
        const exist = mockData.pallets.find(dbP => dbP.codigo_pallet.trim().toLowerCase() === p.codigo_pallet.trim().toLowerCase());
        if (exist) {
          return res.status(400).json({ message: `El pallet con código ${p.codigo_pallet} ya está registrado en el sistema` });
        }
      }

      // Delete existing pallets for this voyage (in case they retry)
      mockData.pallets = mockData.pallets.filter(p => p.viaje_id !== parseInt(id));

      const newPallets = pallets.map((p, idx) => ({
        id: mockData.pallets.length + idx + 1,
        viaje_id: parseInt(id),
        fecha_produccion: p.fecha_produccion,
        codigo_pallet: p.codigo_pallet,
        cultivo: p.cultivo,
        variedad: p.variedad,
        jabas_cf: parseInt(p.jabas),
        peso_cf: parseFloat(p.peso),
        precinto: p.precinto || null,
        peso_bruto: null,
        peso_tara: null,
        peso_despacho: null,
        desviacion: null,
        jabas_despacho: null,
        creado_en: new Date().toISOString()
      }));

      // Add to array
      mockData.pallets.push(...newPallets);

      // Transition voyage status
      voyage.estado = 'Preparado';

      res.status(201).json({ message: 'Pallets asignados y viaje bloqueado en estado Preparado', pallets: newPallets });
    } else {
      // Validate current state
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Planificado') {
        return res.status(400).json({ message: 'Este viaje ya fue procesado y no puede ser modificado' });
      }

      // Check unique constraints before inserting
      for (const p of pallets) {
        const checkPallet = await pool.query('SELECT id FROM pallets WHERE codigo_pallet = $1', [p.codigo_pallet]);
        if (checkPallet.rows.length > 0) {
          return res.status(400).json({ message: `El pallet con código ${p.codigo_pallet} ya está registrado en el sistema` });
        }
      }

      // Use transaction to insert
      await pool.query('BEGIN');
      
      // Delete any previous pallets for safety
      await pool.query('DELETE FROM pallets WHERE viaje_id = $1', [id]);

      for (const p of pallets) {
        const queryInsert = `
          INSERT INTO pallets (
            viaje_id, fecha_produccion, codigo_pallet, cultivo, variedad, jabas_cf, peso_cf, precinto
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        await pool.query(queryInsert, [
          id, p.fecha_produccion, p.codigo_pallet, p.cultivo, p.variedad, p.jabas, p.peso, p.precinto || null
        ]);
      }

      // Transition state
      await pool.query("UPDATE viajes SET estado = 'Preparado' WHERE id = $1", [id]);

      await pool.query('COMMIT');
      res.status(201).json({ message: 'Pallets asignados y viaje bloqueado en estado Preparado' });
    }
  } catch (err) {
    if (!useMock) await pool.query('ROLLBACK');
    console.error('[ERROR POST /api/viajes/:id/pallets]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Update single pallet weight/dispatch details (Despacho)
app.put('/api/pallets/:palletId', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { palletId } = req.params;
  const { peso_bruto, peso_tara, jabas_despacho } = req.body;

  const bruto = parseFloat(peso_bruto);
  const tara = parseFloat(peso_tara);
  const despacho = bruto -    tara;

  try {
    if (useMock) {
      const palletIndex = mockData.pallets.findIndex(p => p.id === parseInt(palletId));
      if (palletIndex === -1) return res.status(404).json({ message: 'Pallet no encontrado' });

      const pallet = mockData.pallets[palletIndex];
      const voyage = mockData.viajes.find(v => v.id === pallet.viaje_id);
      if (voyage.estado !== 'Preparado') {
        return res.status(400).json({ message: 'No se puede modificar un pallet de un viaje que no esté en estado Preparado' });
      }

      // Deviation percentage
      const diffAbs = Math.abs(despacho - pallet.peso_cf);
      const desviacion = parseFloat(((diffAbs / pallet.peso_cf) * 100).toFixed(2));

      mockData.pallets[palletIndex] = {
        ...pallet,
        peso_bruto: bruto,
        peso_tara: tara,
        peso_despacho: despacho,
        desviacion,
        jabas_despacho: parseInt(jabas_despacho)
      };

      res.json(mockData.pallets[palletIndex]);
    } else {
      // Find pallet and check Voyage state
      const checkPallet = await pool.query(`
        SELECT p.*, v.estado
        FROM pallets p
        JOIN viajes v ON p.viaje_id = v.id
        WHERE p.id = $1
      `, [palletId]);

      if (checkPallet.rows.length === 0) return res.status(404).json({ message: 'Pallet no encontrado' });
      if (checkPallet.rows[0].estado !== 'Preparado') {
        return res.status(400).json({ message: 'No se puede modificar un pallet de un viaje que no esté en estado Preparado' });
      }

      const peso_cf = parseFloat(checkPallet.rows[0].peso_cf);
      const diffAbs = Math.abs(despacho - peso_cf);
      const desviacion = parseFloat(((diffAbs / peso_cf) * 100).toFixed(2));

      const query = `
        UPDATE pallets SET
          peso_bruto = $1,
          peso_tara = $2,
          peso_despacho = $3,
          desviacion = $4,
          jabas_despacho = $5
        WHERE id = $6 RETURNING *
      `;
      const result = await pool.query(query, [bruto, tara, despacho, desviacion, parseInt(jabas_despacho), palletId]);
      res.json(result.rows[0]);
    }
  } catch (err) {
    console.error('[ERROR PUT /api/pallets/:palletId]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Finalize Loading - Change voyage status to "Cargado" (Despacho)
app.post('/api/viajes/:id/finalizar-carga', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para finalizar carga' });
      }

      // Check if all pallets for this voyage have been filled out
      const voyagePallets = mockData.pallets.filter(p => p.viaje_id === parseInt(id));
      const incomplete = voyagePallets.some(p => p.peso_bruto === null || p.peso_tara === null);
      if (incomplete || voyagePallets.length === 0) {
        return res.status(400).json({ message: 'Faltan rellenar datos de despacho para algunos pallets' });
      }

      voyage.estado = 'Cargado';
      res.json({ message: 'Viaje marcado como Cargado exitosamente', viaje: voyage });
    } else {
      // Validate all pallets are completed
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Preparado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Preparado para finalizar carga' });
      }

      const countIncomplete = await pool.query(`
        SELECT COUNT(*) as count 
        FROM pallets 
        WHERE viaje_id = $1 AND (peso_bruto IS NULL OR peso_tara IS NULL)
      `, [id]);

      if (parseInt(countIncomplete.rows[0].count) > 0) {
        return res.status(400).json({ message: 'Faltan rellenar datos de despacho para algunos pallets' });
      }

      await pool.query("UPDATE viajes SET estado = 'Cargado' WHERE id = $1", [id]);
      res.json({ message: 'Viaje marcado como Cargado exitosamente' });
    }
  } catch (err) {
    console.error('[ERROR POST /api/viajes/:id/finalizar-carga]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Finalize Dispatch - Assign dispatcher details and set to "Finalizado" (Despacho)
app.post('/api/viajes/:id/finalizar-despacho', authenticateToken, checkRole(['Despacho', 'Administrador']), async (req, res) => {
  const { id } = req.params;
  const { guia_remision, conductor_nombre, conductor_licencia, conductor_placa } = req.body;

  if (!guia_remision || !conductor_nombre || !conductor_licencia || !conductor_placa) {
    return res.status(400).json({ message: 'Todos los campos de despacho son requeridos (Guía, Conductor, Licencia, Placa)' });
  }

  try {
    if (useMock) {
      const voyage = mockData.viajes.find(v => v.id === parseInt(id));
      if (!voyage) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (voyage.estado !== 'Cargado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Cargado para poder finalizar el despacho' });
      }

      voyage.guia_remision = guia_remision;
      voyage.conductor_nombre = conductor_nombre;
      voyage.conductor_licencia = conductor_licencia;
      voyage.conductor_placa = conductor_placa;
      voyage.estado = 'Finalizado';

      res.json({ message: 'Despacho del viaje finalizado con éxito', viaje: voyage });
    } else {
      const checkState = await pool.query('SELECT estado FROM viajes WHERE id = $1', [id]);
      if (checkState.rows.length === 0) return res.status(404).json({ message: 'Viaje no encontrado' });
      if (checkState.rows[0].estado !== 'Cargado') {
        return res.status(400).json({ message: 'El viaje debe estar en estado Cargado para poder finalizar el despacho' });
      }

      const query = `
        UPDATE viajes SET
          guia_remision = $1,
          conductor_nombre = $2,
          conductor_licencia = $3,
          conductor_placa = $4,
          estado = 'Finalizado'
        WHERE id = $5 RETURNING *
      `;
      const result = await pool.query(query, [guia_remision, conductor_nombre, conductor_licencia, conductor_placa, id]);
      res.json({ message: 'Despacho del viaje finalizado con éxito', viaje: result.rows[0] });
    }
  } catch (err) {
    console.error('[ERROR POST /api/viajes/:id/finalizar-despacho]', err);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Servir la compilación del frontend en Producción
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Servidor backend escuchando en puerto ${PORT}`);
});
