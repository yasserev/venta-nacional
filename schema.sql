-- Schema for Venta Nacional Camposol
-- Neon.tech Postgres Database

-- Drop tables if exist
DROP TABLE IF EXISTS pallets;
DROP TABLE IF EXISTS viajes;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS usuarios;

-- 1. Table: usuarios
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Planificador', 'Cadena de frío', 'Despacho', 'Administrador')),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table: clientes (Maestro de clientes)
CREATE TABLE clientes (
    id SERIAL PRIMARY KEY,
    razon_social VARCHAR(150) UNIQUE NOT NULL,
    ruc VARCHAR(11) NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Table: viajes
CREATE TABLE viajes (
    id SERIAL PRIMARY KEY,
    codigo_viaje VARCHAR(100) UNIQUE NOT NULL,
    cultivo VARCHAR(100) NOT NULL,
    variedad VARCHAR(100) NOT NULL,
    origen_fruta VARCHAR(100) NOT NULL, -- Proceso / Origen de Fruta
    cliente_id INTEGER REFERENCES clientes(id),
    peso DECIMAL(12, 3) NOT NULL, -- Peso planificado
    fecha_hora_despacho TIMESTAMP NOT NULL,
    fecha_cosecha DATE NOT NULL,
    origen_despacho VARCHAR(100) NOT NULL,
    estado VARCHAR(50) DEFAULT 'Planificado' CHECK (estado IN ('Planificado', 'Preparado', 'Cargado', 'Finalizado')),
    
    -- Datos finales de despacho (para todo el viaje)
    guia_remision VARCHAR(50),
    conductor_nombre VARCHAR(150),
    conductor_licencia VARCHAR(50),
    conductor_placa VARCHAR(20),
    
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Table: pallets
CREATE TABLE pallets (
    id SERIAL PRIMARY KEY,
    viaje_id INTEGER REFERENCES viajes(id) ON DELETE CASCADE,
    fecha_produccion DATE NOT NULL,
    codigo_pallet VARCHAR(100) UNIQUE NOT NULL,
    cultivo VARCHAR(100) NOT NULL,
    variedad VARCHAR(100) NOT NULL,
    jabas_cf INTEGER NOT NULL,
    peso_cf DECIMAL(12, 3) NOT NULL,
    precinto VARCHAR(100),
    
    -- Campos rellenados por Despacho
    peso_bruto DECIMAL(12, 3),
    peso_tara DECIMAL(12, 3),
    peso_despacho DECIMAL(12, 3), -- Peso bruto - Peso tara
    desviacion DECIMAL(5, 2), -- Diferencia porcentual
    jabas_despacho INTEGER,
    
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seeding Default Master Data

-- Clientes
INSERT INTO clientes (razon_social, ruc, direccion) VALUES
('Supermercados Peruanos S.A.', '20100018612', 'Av. Larco 1230, Miraflores, Lima'),
('Cencosud Retail Peru S.A.', '20509088721', 'Av. Raul Ferrero 120, La Molina, Lima'),
('Hipermercados Tottus S.A.', '20508565934', 'Av. Tacna 650, Cercado de Lima, Lima'),
('Camposol Trading S.A.C.', '20536471822', 'Av. El Derby 254, Santiago de Surco, Lima');

-- Usuarios por defecto (Contraseña encriptada para 'camposol123')
-- Hash generado usando bcrypt (10 rondas): $2a$10$tu9eWVeP/UZcWaEnefWTBePxu9oi3F6x3ZtqVG.BAVkxbwvYoVoXq
INSERT INTO usuarios (email, password_hash, nombre, role) VALUES
('planificador@camposol.com', '$2a$10$tu9eWVeP/UZcWaEnefWTBePxu9oi3F6x3ZtqVG.BAVkxbwvYoVoXq', 'Planificador Venta Nacional', 'Planificador'),
('frio@camposol.com', '$2a$10$tu9eWVeP/UZcWaEnefWTBePxu9oi3F6x3ZtqVG.BAVkxbwvYoVoXq', 'Responsable Cadena Frio', 'Cadena de frío'),
('despacho@camposol.com', '$2a$10$tu9eWVeP/UZcWaEnefWTBePxu9oi3F6x3ZtqVG.BAVkxbwvYoVoXq', 'Responsable Despacho', 'Despacho'),
('admin@camposol.com', '$2a$10$tu9eWVeP/UZcWaEnefWTBePxu9oi3F6x3ZtqVG.BAVkxbwvYoVoXq', 'Administrador Camposol', 'Administrador');
