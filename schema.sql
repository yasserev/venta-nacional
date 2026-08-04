-- Schema for Venta Nacional Camposol v2.0
-- Neon.tech Postgres Database
-- Autor: Yasser Espinoza | Camposol

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS pallets;
DROP TABLE IF EXISTS viajes;
DROP TABLE IF EXISTS responsables_despacho;
DROP TABLE IF EXISTS unidades_medida;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS usuarios;

-- 1. Usuarios
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Planificador', 'Cadena de frío', 'Despacho', 'Administrador')),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Clientes (Maestro)
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    razon_social VARCHAR(150) UNIQUE NOT NULL,
    ruc VARCHAR(11) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Unidades de Medida (Tabla Maestra — administrable)
CREATE TABLE unidades_medida (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(20) UNIQUE NOT NULL,
    descripcion VARCHAR(100) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Responsables de Despacho (Tabla Maestra)
CREATE TABLE responsables_despacho (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    dni VARCHAR(8) NOT NULL,
    activo BOOLEAN DEFAULT TRUE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Viajes
CREATE TABLE viajes (
    id SERIAL PRIMARY KEY,
    codigo_viaje VARCHAR(100) UNIQUE NOT NULL,
    cultivo VARCHAR(100) NOT NULL,
    variedades TEXT NOT NULL,              -- Variedades separadas por coma: "Biloxi,Ventura"
    origen_fruta VARCHAR(100) NOT NULL,
    cliente_id INTEGER REFERENCES clientes(id),
    peso DECIMAL(12, 3) NOT NULL,          -- Peso planificado total
    fecha_hora_despacho TIMESTAMP NOT NULL,
    origen_despacho VARCHAR(100) NOT NULL,

    -- Estado del flujo
    estado VARCHAR(50) DEFAULT 'Planificado'
        CHECK (estado IN ('Planificado', 'Preparado', 'Cargado', 'Finalizado')),
    estado_frio VARCHAR(50) DEFAULT 'En proceso'
        CHECK (estado_frio IN ('En proceso', 'Confirmado')),

    -- Datos finales de despacho
    guia_remision VARCHAR(50),
    conductor_nombre VARCHAR(150),
    conductor_licencia VARCHAR(50),
    conductor_placa VARCHAR(20),
    observaciones TEXT,
    responsable_despacho_id INTEGER REFERENCES responsables_despacho(id),
    area_responsable VARCHAR(200) DEFAULT 'CÁMARAS Y DESPACHOS FRESCOS',

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Pallets (Registros de Cadena de Frío)
CREATE TABLE pallets (
    id SERIAL PRIMARY KEY,
    viaje_id INTEGER REFERENCES viajes(id) ON DELETE CASCADE,
    variedad VARCHAR(100) NOT NULL,         -- Variedad asignada al momento de subir

    -- Columnas según orden del Excel (cadena de frío)
    numero_pallet INTEGER NOT NULL,         -- Col 1: Pallet
    codigo_pallet VARCHAR(100) NOT NULL,    -- Col 2: Código pallet
    fecha_cosecha DATE,                     -- Col 3: Fecha de cosecha
    procedencia VARCHAR(150),               -- Col 4: Procedencia
    cantidad DECIMAL(12, 3) NOT NULL,       -- Col 5: Cantidad
    unidad_medida VARCHAR(20) NOT NULL,     -- Col 6: Unidad de medida (validada contra tabla maestra)
    peso_produccion DECIMAL(12, 3),         -- Col 7: Peso producción
    precinto VARCHAR(100),                  -- Col 8: Precinto (no obligatorio)

    -- Datos registrados por Despacho (se guardan por grupo de pallet)
    peso_bruto DECIMAL(12, 3),
    peso_tara DECIMAL(12, 3),
    peso_despacho DECIMAL(12, 3),           -- peso_bruto - peso_tara
    desviacion DECIMAL(5, 2),               -- Diferencia porcentual vs peso_produccion

    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA
-- ─────────────────────────────────────────────────────────────────────────────

-- Clientes
INSERT INTO clientes (razon_social, ruc, direccion) VALUES
('Supermercados Peruanos S.A.', '20100018612', 'Av. Larco 1230, Miraflores, Lima'),
('Cencosud Retail Peru S.A.', '20509088721', 'Av. Raul Ferrero 120, La Molina, Lima'),
('Hipermercados Tottus S.A.', '20508565934', 'Av. Tacna 650, Cercado de Lima, Lima'),
('Camposol Trading S.A.C.', '20536471822', 'Av. El Derby 254, Santiago de Surco, Lima');

-- Unidades de Medida (administrable — se pueden agregar más desde la aplicación)
INSERT INTO unidades_medida (codigo, descripcion) VALUES
('JABAS', 'Jabas'),
('BINES', 'Bines'),
('KG', 'Kilogramos');

-- Responsables de Despacho (datos de prueba)
INSERT INTO responsables_despacho (nombre, dni) VALUES
('Samuel Pacheco', '45231876'),
('María González', '38291043'),
('Carlos Rodríguez', '52109834');

-- Usuario Administrador Inicial
INSERT INTO usuarios (email, password_hash, nombre, role) VALUES
('yespinoza@camposol.com', '$2a$10$V.Tdwe4YP2MJtMsZIuo4SObBdN7BjU3UHSOPJCd54.btOjbprlb6C', 'Yasser Espinoza', 'Administrador');
