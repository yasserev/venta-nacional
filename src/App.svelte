<script lang="ts">
  import { onMount } from 'svelte';
  import * as XLSX from 'xlsx';

  // ── State Management ────────────────────────────────────────────────────────
  let token = localStorage.getItem('token') || '';
  let currentUser = null;
  let view = 'calendar';

  // Auth
  let email = '';
  let password = '';
  let showPassword = false;
  let authError = '';

  // Master Data
  let cultivosList = [];
  $: cultivosData = (cultivosList || []).reduce((acc, c) => {
    if (c.activo) {
      acc[c.nombre] = (c.variedades || []).filter(v => v.activo).map(v => v.nombre);
    }
    return acc;
  }, {});
  const orígenesFruta = ['Fresco', 'Congelado', 'Proceso industrial'];
  const orígenesDespacho = ['Planta Chao', 'Planta Virú', 'Fundo Gloria', 'Fundo San José'];

  let clientes = [];
  let viajes = [];
  let unidadesMedida = [];
  let responsablesDespacho = [];
  let currentWeekStart = getStartOfWeek(new Date());

  // ── Planificador State ──────────────────────────────────────────────────────
  let showVoyageModal = false;
  let isEditing = false;
  let editingId = null;
  let voyageForm = {
    codigo_viaje: '',
    cultivo: 'Arándano',
    variedades: ['Biloxi'],
    origen_fruta: 'Fresco',
    cliente_id: '',
    peso: '',
    fecha_hora_despacho: '',
    origen_despacho: 'Planta Chao'
  };

  let showClientModal = false;
  let clientError = '';
  let clientForm = { razon_social: '', ruc: '', direccion: '' };

  // ── Cadena de Frío State ────────────────────────────────────────────────────
  let selectedViajeFrio = null;
  let frioRegistros = [];
  let frioSelectedVariedad = null;
  let showFrioUpload = false;
  let excelPasteData = '';
  let parsedPallets = [];
  let pastePreview = false;
  let frioError = '';
  let frioConfirming = false;
  let frioEditingId = null;
  let frioEditForm: any = {};
  let frioLoading = false;
  const excelPlaceholder = 'Pega aquí desde Excel:\n1\tPALLET-001\t22/06/2026\tChao\t120\tJABAS\t1250.50\tPREC-001\n2\tPALLET-002\t22/06/2026\tChao\t115\tJABAS\t1235.00\t';

  // ── Despacho State ──────────────────────────────────────────────────────────
  let selectedViajeDespacho = null;
  let despachoPalletsGrupos = [];
  let despachoError = '';
  let despachoStep = 1;
  let voyageDispatchForm = {
    guia_remision: '',
    conductor_nombre: '',
    conductor_licencia: '',
    conductor_placa: '',
    observaciones: '',
    responsable_despacho_id: '',
    area_responsable: 'CÁMARAS Y DESPACHOS FRESCOS'
  };
  let finalizingLoading = false;
  let despachoSavingPallet = null;

  // ── Maestros State (Administrador / Despacho) ─────────────────────────────
  let maestroView = 'usuarios';
  $: if (currentUser?.role === 'Despacho' && maestroView !== 'responsables') {
    maestroView = 'responsables';
  }
  let usuariosList = [];
  let showUserModal = false;
  let userForm = { email: '', password: '', nombre: '', role: 'Planificador' };
  let userError = '';
  let showUMModal = false;
  let umForm = { codigo: '', descripcion: '' };
  let umError = '';
  let showRespModal = false;
  let editingRespId = null;
  let respForm = { nombre: '', dni: '' };
  let respError = '';
  let showCultivoModal = false;
  let cultivoForm = { nombre: '' };
  let cultivoError = '';
  let showVariedadModal = false;
  let selectedCultivoForVar = null;
  let variedadForm = { nombre: '' };
  let variedadError = '';

  // ── Reportes State ──────────────────────────────────────────────────────────
  let reportFilter = { fecha_inicio: '', fecha_fin: '', cliente_id: '', codigo_viaje: '' };
  let reportTab = 'resumen';
  let reportResumenData = [];
  let reportDetalleData = [];
  let reportLoading = false;
  let reportHasQueried = false;

  // ── Forced Password Change State ─────────────────────────────────────────────
  let newPasswordForm = { nueva_clave: '', confirmar_clave: '' };
  let newPasswordError = '';
  let isChangingPassword = false;

  // ── Notifications ──────────────────────────────────────────────────────────
  let notification = { show: false, message: '', type: 'success' };
  function showNotification(message, type = 'success') {
    notification = { show: true, message, type };
    setTimeout(() => { notification.show = false; }, 4000);
  }

  // ── Helper Functions ────────────────────────────────────────────────────────
  function getStartOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function formatDateReadable(dateStr) {
    if (!dateStr) return '-';
    const clean = String(dateStr).split('T')[0].split(' ')[0].trim();
    const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
    const matchDMY = clean.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
    if (matchDMY) {
      return `${matchDMY[1].padStart(2, '0')}/${matchDMY[2].padStart(2, '0')}/${matchDMY[3]}`;
    }
    return dateStr;
  }

  function formatTimeReadable(datetimeStr) {
    if (!datetimeStr) return '-';
    const timePart = String(datetimeStr).replace(' ', 'T').split('T')[1];
    if (timePart) {
      const parts = timePart.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return datetimeStr;
  }

  function formatDateTimeReadable(datetimeStr) {
    if (!datetimeStr) return '-';
    const dateStr = formatDateReadable(datetimeStr);
    const timeStr = formatTimeReadable(datetimeStr);
    return `${dateStr} ${timeStr}`;
  }

  function changeWeek(offset) {
    const next = new Date(currentWeekStart);
    next.setDate(next.getDate() + offset * 7);
    currentWeekStart = next;
  }

  function getWeekLabel(weekStart) {
    if (!weekStart) return '';
    const start = new Date(weekStart);
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    const d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const sStr = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
    const eStr = `${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}`;
    return `Semana ${weekNo} (${sStr} al ${eStr})`;
  }

  function getVoyagesForDay(dayIndex, voyagesList, weekStart) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const targetDate = `${yyyy}-${mm}-${dd}`;
    return voyagesList.filter(v => {
      if (!v.fecha_hora_despacho) return false;
      const vDate = String(v.fecha_hora_despacho).split('T')[0].split(' ')[0];
      return vDate === targetDate;
    });
  }

  // Parse variedades string to array
  function parseVariedades(varStr) {
    if (!varStr) return [];
    return varStr.split(',').map(v => v.trim()).filter(Boolean);
  }

  // Parse date: DD/MM/YYYY, DD.MM.YYYY, or YYYY-MM-DD → YYYY-MM-DD
  function parseDateToISO(str) {
    if (!str) return '';
    str = str.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const dmy = str.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    try {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    } catch {}
    return str;
  }

  function formatDecimal(val, decimals = 3) {
    const n = parseFloat(val);
    return isNaN(n) ? '-' : n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  }

  // ── API Calls ───────────────────────────────────────────────────────────────
  async function loadMe() {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) currentUser = (await res.json()).user;
      else logout();
    } catch {}
  }

  async function fetchClientes() {
    try {
      const res = await fetch('/api/clientes', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) clientes = await res.json();
    } catch {}
  }

  async function fetchViajes() {
    try {
      const res = await fetch('/api/viajes', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) viajes = await res.json();
    } catch {}
  }

  async function fetchUnidadesMedida() {
    try {
      const res = await fetch('/api/unidades-medida', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) unidadesMedida = await res.json();
    } catch {}
  }

  async function fetchResponsablesDespacho(includeInactive = false) {
    try {
      const url = includeInactive ? '/api/responsables-despacho?includeInactive=true' : '/api/responsables-despacho';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) responsablesDespacho = await res.json();
    } catch {}
  }

  async function fetchUsuarios() {
    if (currentUser?.role !== 'Administrador') return;
    try {
      const res = await fetch('/api/usuarios', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) usuariosList = await res.json();
    } catch {}
  }

  async function fetchCultivos() {
    try {
      const res = await fetch('/api/cultivos', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) cultivosList = await res.json();
    } catch {}
  }

  async function submitCultivo() {
    cultivoError = '';
    if (!cultivoForm.nombre.trim()) {
      cultivoError = 'El nombre del cultivo es obligatorio'; return;
    }
    try {
      const res = await fetch('/api/cultivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cultivoForm)
      });
      const data = await res.json();
      if (res.ok) {
        showCultivoModal = false;
        cultivoForm = { nombre: '' };
        await fetchCultivos();
        showNotification('Cultivo agregado exitosamente');
      } else {
        cultivoError = data.message || 'Error al agregar cultivo';
      }
    } catch {
      cultivoError = 'Error de conexión';
    }
  }

  async function toggleCultivo(c) {
    try {
      const res = await fetch(`/api/cultivos/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ activo: !c.activo })
      });
      if (res.ok) {
        await fetchCultivos();
        showNotification(`Cultivo ${!c.activo ? 'activado' : 'desactivado'}`);
      }
    } catch {
      showNotification('Error al actualizar cultivo', 'danger');
    }
  }

  async function submitVariedad() {
    variedadError = '';
    if (!variedadForm.nombre.trim() || !selectedCultivoForVar) {
      variedadError = 'El nombre de la variedad es obligatorio'; return;
    }
    try {
      const res = await fetch(`/api/cultivos/${selectedCultivoForVar.id}/variedades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(variedadForm)
      });
      const data = await res.json();
      if (res.ok) {
        showVariedadModal = false;
        variedadForm = { nombre: '' };
        await fetchCultivos();
        showNotification('Variedad agregada exitosamente');
      } else {
        variedadError = data.message || 'Error al agregar variedad';
      }
    } catch {
      variedadError = 'Error de conexión';
    }
  }

  async function toggleVariedad(v) {
    try {
      const res = await fetch(`/api/variedades/${v.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ activo: !v.activo })
      });
      if (res.ok) {
        await fetchCultivos();
        showNotification(`Variedad ${!v.activo ? 'activada' : 'desactivada'}`);
      }
    } catch {
      showNotification('Error al actualizar variedad', 'danger');
    }
  }

  $: if (view === 'maestros' && token) {
    if (currentUser?.role === 'Administrador') {
      fetchUsuarios();
      fetchUnidadesMedida();
      fetchResponsablesDespacho(true);
      fetchCultivos();
    } else if (currentUser?.role === 'Despacho') {
      maestroView = 'responsables';
      fetchResponsablesDespacho(true);
    }
  }

  onMount(async () => {
    if (token) {
      await loadMe();
      await fetchClientes();
      await fetchViajes();
      await fetchUnidadesMedida();
      await fetchResponsablesDespacho();
      if (currentUser?.role === 'Administrador') await fetchUsuarios();
      await fetchCultivos();
    }
  });

  // ── Auth ────────────────────────────────────────────────────────────────────
  async function handleLogin() {
    authError = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('token', token);
        await fetchClientes();
        await fetchViajes();
        await fetchUnidadesMedida();
        await fetchResponsablesDespacho();
        await fetchCultivos();
        if (currentUser?.role === 'Administrador') await fetchUsuarios();
        showNotification(`Bienvenido, ${currentUser.nombre}`);
      } else {
        authError = data.message || 'Error al iniciar sesión';
      }
    } catch {
      authError = 'Error de conexión con el servidor';
    }
  }

  function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    view = 'calendar';
  }

  async function submitUser() {
    userError = '';
    if (!userForm.email.trim() || !userForm.nombre.trim() || !userForm.password.trim() || !userForm.role) {
      userError = 'Todos los campos son obligatorios'; return;
    }
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(userForm)
      });
      const data = await res.json();
      if (res.ok) {
        showUserModal = false;
        userForm = { email: '', password: '', nombre: '', role: 'Planificador' };
        await fetchUsuarios();
        showNotification('Usuario creado exitosamente');
      } else {
        userError = data.message || 'Error al crear usuario';
      }
    } catch {
      userError = 'Error de conexión';
    }
  }

  async function deleteUser(u) {
    if (u.id === currentUser?.id) {
      showNotification('No puedes eliminar tu propia cuenta', 'danger'); return;
    }
    if (!confirm(`¿Eliminar al usuario ${u.nombre} (${u.email})?`)) return;
    try {
      const res = await fetch(`/api/usuarios/${u.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        await fetchUsuarios();
        showNotification('Usuario eliminado');
      } else {
        showNotification(data.message || 'Error al eliminar', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
  }

  async function submitCambioClave() {
    newPasswordError = '';
    const { nueva_clave, confirmar_clave } = newPasswordForm;
    if (!nueva_clave || !confirmar_clave) {
      newPasswordError = 'Ambos campos son obligatorios'; return;
    }
    if (nueva_clave.length < 6) {
      newPasswordError = 'La contraseña debe tener al menos 6 caracteres'; return;
    }
    if (nueva_clave !== confirmar_clave) {
      newPasswordError = 'Las contraseñas no coinciden'; return;
    }

    isChangingPassword = true;
    try {
      const res = await fetch('/api/auth/cambiar-clave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password_nueva: nueva_clave })
      });
      const data = await res.json();
      if (res.ok) {
        currentUser = { ...currentUser, requiere_cambio_clave: false };
        showNotification('Contraseña actualizada con éxito');
        newPasswordForm = { nueva_clave: '', confirmar_clave: '' };
      } else {
        newPasswordError = data.message || 'Error al actualizar contraseña';
      }
    } catch {
      newPasswordError = 'Error de conexión';
    }
    isChangingPassword = false;
  }

  // ── Planificador ────────────────────────────────────────────────────────────
  function openNewVoyageModal() {
    isEditing = false;
    editingId = null;
    voyageForm = {
      codigo_viaje: '',
      cultivo: 'Arándano',
      variedades: ['Biloxi'],
      origen_fruta: 'Fresco',
      cliente_id: clientes[0]?.id?.toString() || '',
      peso: '',
      fecha_hora_despacho: '',
      origen_despacho: 'Planta Chao'
    };
    showVoyageModal = true;
  }

  function openEditVoyageModal(viaje) {
    isEditing = true;
    editingId = viaje.id;
    const date = new Date(viaje.fecha_hora_despacho);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    voyageForm = {
      codigo_viaje: viaje.codigo_viaje,
      cultivo: viaje.cultivo,
      variedades: parseVariedades(viaje.variedades),
      origen_fruta: viaje.origen_fruta,
      cliente_id: viaje.cliente_id.toString(),
      peso: viaje.peso.toString(),
      fecha_hora_despacho: date.toISOString().slice(0, 16),
      origen_despacho: viaje.origen_despacho
    };
    showVoyageModal = true;
  }

  async function submitVoyage() {
    if (voyageForm.variedades.length === 0) {
      showNotification('Selecciona al menos una variedad', 'danger');
      return;
    }
    try {
      const method = isEditing ? 'PUT' : 'POST';
      const url = isEditing ? `/api/viajes/${editingId}` : '/api/viajes';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(voyageForm)
      });
      const data = await res.json();
      if (res.ok) {
        showVoyageModal = false;
        await fetchViajes();
        showNotification(isEditing ? 'Viaje actualizado exitosamente' : 'Viaje programado exitosamente');
      } else {
        showNotification(data.message || 'Error al guardar viaje', 'danger');
      }
    } catch {
      showNotification('Error al conectar con el servidor', 'danger');
    }
  }

  // Clientes
  function openNewClientModal() {
    clientForm = { razon_social: '', ruc: '', direccion: '' };
    clientError = '';
    showClientModal = true;
  }

  async function submitClient() {
    clientError = '';
    if (!clientForm.razon_social.trim()) { clientError = 'La razón social es obligatoria'; return; }
    if (!clientForm.ruc.trim() || clientForm.ruc.trim().length !== 11 || !/^\d+$/.test(clientForm.ruc.trim())) {
      clientError = 'El RUC debe tener exactamente 11 dígitos numéricos'; return;
    }
    if (!clientForm.direccion.trim()) { clientError = 'La dirección es obligatoria'; return; }

    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ razon_social: clientForm.razon_social.trim(), ruc: clientForm.ruc.trim(), direccion: clientForm.direccion.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        showClientModal = false;
        await fetchClientes();
        if (showVoyageModal) voyageForm.cliente_id = data.id.toString();
        showNotification('Cliente creado exitosamente');
        clientForm = { razon_social: '', ruc: '', direccion: '' };
      } else {
        clientError = data.message || 'Error al guardar el cliente';
      }
    } catch {
      clientError = 'Error de conexión con el servidor';
    }
  }

  // Reactivo: cuando cambia el cultivo en planificador, resetear variedades
  $: if (voyageForm.cultivo && showVoyageModal) {
    const available = cultivosData[voyageForm.cultivo] || [];
    voyageForm.variedades = voyageForm.variedades.filter(v => available.includes(v));
    if (voyageForm.variedades.length === 0 && available.length > 0) {
      voyageForm.variedades = [available[0]];
    }
  }

  // ── Cadena de Frío ──────────────────────────────────────────────────────────
  async function loadFrioRegistros(viajeId) {
    frioLoading = true;
    try {
      const res = await fetch(`/api/viajes/${viajeId}/pallets`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        frioRegistros = data.pallets || [];
      }
    } catch {}
    frioLoading = false;
  }

  function selectViajeFrio(viaje) {
    selectedViajeFrio = viaje;
    frioRegistros = [];
    frioSelectedVariedad = null;
    showFrioUpload = false;
    excelPasteData = '';
    parsedPallets = [];
    pastePreview = false;
    frioError = '';
    frioEditingId = null;
    if (viaje) loadFrioRegistros(viaje.id);
  }

  function selectVariedadFrio(variedad) {
    frioSelectedVariedad = variedad;
    showFrioUpload = false;
    excelPasteData = '';
    parsedPallets = [];
    pastePreview = false;
    frioError = '';
    frioEditingId = null;
  }

  // Get records for a specific variedad
  function getRegistrosForVariedad(variedad) {
    return frioRegistros.filter(r => r.variedad === variedad);
  }

  // Process Excel paste
  function processExcelPaste() {
    frioError = '';
    const text = excelPasteData.trim();
    if (!text) { frioError = 'Por favor pega contenido desde Excel'; return; }

    const lines = text.split(/\r?\n/);
    const parsed = [];
    let startIdx = 0;

    // Detect header row
    const firstCols = lines[0].split('\t');
    const hasHeader = firstCols.some(col => /pallet|código|fecha|procedencia|cantidad|unidad|peso|precinto/i.test(col));
    if (hasHeader) startIdx = 1;

    const validCodigos = unidadesMedida.map(u => u.codigo.toUpperCase());

    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 6) continue;

      const numPallet = cols[0] ? parseInt(cols[0].trim()) : NaN;
      const codPallet = cols[1] ? cols[1].trim() : '';
      const fechaCos = cols[2] ? parseDateToISO(cols[2].trim()) : '';
      const procedencia = cols[3] ? cols[3].trim() : '';
      const cantidad = cols[4] ? parseFloat(cols[4].trim().replace(',', '.')) : NaN;
      const unidad = cols[5] ? cols[5].trim().toUpperCase() : '';
      const pesoProd = cols[6] ? parseFloat(cols[6].trim().replace(',', '.')) : null;
      const precinto = cols[7] ? cols[7].trim() : '';

      if (isNaN(numPallet) || !codPallet || isNaN(cantidad)) {
        frioError = `Error en fila ${i + 1}: Pallet (col 1), Código Pallet (col 2) y Cantidad (col 5) son obligatorios`;
        return;
      }

      if (!validCodigos.includes(unidad)) {
        frioError = `Error en fila ${i + 1}: Unidad de medida "${unidad}" no válida. Opciones: ${validCodigos.join(', ')}`;
        return;
      }

      parsed.push({
        numero_pallet: numPallet,
        codigo_pallet: codPallet,
        fecha_cosecha: fechaCos || null,
        procedencia,
        cantidad,
        unidad_medida: unidad,
        peso_produccion: pesoProd,
        precinto
      });
    }

    if (parsed.length === 0) {
      frioError = 'No se pudieron extraer registros válidos. Verifica el formato.';
      return;
    }

    parsedPallets = parsed;
    pastePreview = true;
  }

  async function submitPalletsFrio() {
    if (!selectedViajeFrio || !frioSelectedVariedad) return;
    frioError = '';
    try {
      const res = await fetch(`/api/viajes/${selectedViajeFrio.id}/pallets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ variedad: frioSelectedVariedad, pallets: parsedPallets })
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(`${parsedPallets.length} registros añadidos para ${frioSelectedVariedad}`);
        excelPasteData = '';
        parsedPallets = [];
        pastePreview = false;
        showFrioUpload = false;
        await loadFrioRegistros(selectedViajeFrio.id);
      } else {
        frioError = data.message || 'Error al guardar los registros';
      }
    } catch {
      frioError = 'Error de conexión con el servidor';
    }
  }

  function startEditFrio(registro) {
    frioEditingId = registro.id;
    frioEditForm = {
      numero_pallet: registro.numero_pallet,
      codigo_pallet: registro.codigo_pallet,
      fecha_cosecha: registro.fecha_cosecha ? registro.fecha_cosecha.split('T')[0] : '',
      procedencia: registro.procedencia || '',
      cantidad: registro.cantidad,
      unidad_medida: registro.unidad_medida,
      peso_produccion: registro.peso_produccion || '',
      precinto: registro.precinto || ''
    };
  }

  function cancelEditFrio() {
    frioEditingId = null;
    frioEditForm = {};
  }

  async function saveEditFrio(registroId) {
    frioError = '';
    try {
      const res = await fetch(`/api/pallets/${registroId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(frioEditForm)
      });
      const data = await res.json();
      if (res.ok) {
        frioEditingId = null;
        frioEditForm = {};
        await loadFrioRegistros(selectedViajeFrio.id);
        showNotification('Registro actualizado');
      } else {
        frioError = data.message || 'Error al actualizar';
      }
    } catch {
      frioError = 'Error de conexión';
    }
  }

  async function deleteFrioRegistro(registroId) {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      const res = await fetch(`/api/pallets/${registroId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        await loadFrioRegistros(selectedViajeFrio.id);
        showNotification('Registro eliminado');
      } else {
        const data = await res.json();
        showNotification(data.message || 'Error al eliminar', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
  }

  async function deleteFrioVariedad(variedad) {
    if (!confirm(`¿Eliminar TODOS los registros de la variedad "${variedad}"?\nEsta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/viajes/${selectedViajeFrio.id}/pallets/variedad/${encodeURIComponent(variedad)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        showNotification(data.message);
        await loadFrioRegistros(selectedViajeFrio.id);
      } else {
        showNotification(data.message || 'Error al eliminar', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
  }

  async function confirmarCargaFrio() {
    if (!confirm('¿Confirmar la carga? Una vez confirmada, ya no podrás editar los registros hasta que Despacho te devuelva el viaje.')) return;
    frioConfirming = true;
    try {
      const res = await fetch(`/api/viajes/${selectedViajeFrio.id}/confirmar-frio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('Carga confirmada. El viaje pasó a estado Preparado.');
        selectedViajeFrio = null;
        frioRegistros = [];
        frioSelectedVariedad = null;
        await fetchViajes();
      } else {
        showNotification(data.message || 'Error al confirmar', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
    frioConfirming = false;
  }

  // ── Despacho ────────────────────────────────────────────────────────────────
  async function selectDespachoVoyage(viaje) {
    // Bug fix: clear pallets BEFORE loading new ones
    selectedViajeDespacho = null;
    despachoPalletsGrupos = [];
    despachoStep = 1;
    despachoError = '';

    if (!viaje) return;

    selectedViajeDespacho = viaje;
    // Pre-fill dispatch form if viaje already has data
    voyageDispatchForm = {
      guia_remision: viaje.guia_remision || '',
      conductor_nombre: viaje.conductor_nombre || '',
      conductor_licencia: viaje.conductor_licencia || '',
      conductor_placa: viaje.conductor_placa || '',
      observaciones: viaje.observaciones || '',
      responsable_despacho_id: viaje.responsable_despacho_id?.toString() || '',
      area_responsable: viaje.area_responsable || 'CÁMARAS Y DESPACHOS FRESCOS'
    };

    try {
      const res = await fetch(`/api/viajes/${viaje.id}/pallets-grupos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        despachoPalletsGrupos = (data.grupos || []).map(g => ({
          ...g,
          peso_bruto: g.peso_bruto || '',
          peso_tara: g.peso_tara || '',
          peso_despacho: g.peso_despacho || 0,
          desviacion: g.desviacion || 0,
          isLocked: g.peso_bruto !== null && g.peso_bruto !== ''
        }));
      } else {
        despachoError = 'Error al cargar los pallets del viaje';
      }
    } catch {
      despachoError = 'Error al cargar pallets';
    }
  }

  function calculateGrupoMetrics(idx) {
    const g = despachoPalletsGrupos[idx];
    const bruto = parseFloat(g.peso_bruto);
    const tara = parseFloat(g.peso_tara);
    if (!isNaN(bruto) && !isNaN(tara) && bruto >= tara) {
      g.peso_despacho = parseFloat((bruto - tara).toFixed(3));
      const refPeso = parseFloat(g.peso_produccion_total) || 0;
      if (refPeso > 0) {
        const diff = g.peso_despacho - refPeso;
        g.desviacion = parseFloat((diff / refPeso * 100).toFixed(1));
      } else {
        g.desviacion = 0;
      }
    } else {
      g.peso_despacho = 0;
      g.desviacion = 0;
    }
    despachoPalletsGrupos = [...despachoPalletsGrupos];
  }

  async function saveGrupoDespacho(idx) {
    const g = despachoPalletsGrupos[idx];
    if (g.peso_bruto === '' || g.peso_tara === '' || g.peso_bruto === null || g.peso_tara === null) {
      showNotification('Peso bruto y tara son requeridos', 'danger'); return;
    }
    if (parseFloat(g.peso_bruto) < parseFloat(g.peso_tara)) {
      showNotification('El peso bruto no puede ser menor que la tara', 'danger'); return;
    }
    if (!confirm(`¿Guardar pesos del pallet ${g.numero_pallet}?`)) return;

    despachoSavingPallet = g.numero_pallet;
    try {
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/pallets-grupo/${g.numero_pallet}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ peso_bruto: g.peso_bruto, peso_tara: g.peso_tara })
      });
      if (res.ok) {
        despachoPalletsGrupos[idx].isLocked = true;
        despachoPalletsGrupos = [...despachoPalletsGrupos];
        showNotification(`Pallet ${g.numero_pallet} guardado`);
      } else {
        const data = await res.json();
        showNotification(data.message || 'Error al guardar', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
    despachoSavingPallet = null;
  }

  async function finalizarCarga() {
    despachoError = '';
    const invalid = despachoPalletsGrupos.some(g => g.peso_bruto === '' || g.peso_tara === '' || g.peso_bruto === null || g.peso_tara === null);
    if (invalid) { despachoError = 'Debe registrar peso bruto y tara para todos los pallets antes de finalizar la carga.'; return; }

    finalizingLoading = true;
    try {
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/finalizar-carga`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        showNotification('Carga finalizada. El viaje pasó a estado Cargado.');
        despachoStep = 2;
        await fetchViajes();
        selectedViajeDespacho = { ...selectedViajeDespacho, estado: 'Cargado' };
      } else {
        const data = await res.json();
        despachoError = data.message || 'Error al finalizar carga';
      }
    } catch {
      despachoError = 'Error al finalizar carga';
    }
    finalizingLoading = false;
  }

  async function finalizarDespacho() {
    despachoError = '';
    try {
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/finalizar-despacho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(voyageDispatchForm)
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('Despacho finalizado con éxito. El viaje está Finalizado.');
        selectedViajeDespacho = null;
        despachoPalletsGrupos = [];
        await fetchViajes();
      } else {
        despachoError = data.message || 'Error al finalizar despacho';
      }
    } catch {
      despachoError = 'Error de conexión con el servidor';
    }
  }

  async function devolverAFrio() {
    if (!confirm('¿Devolver este viaje a Cadena de Frío? Los pesos registrados se perderán.')) return;
    try {
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/devolver-frio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('Viaje devuelto a Cadena de Frío para revisión');
        selectedViajeDespacho = null;
        despachoPalletsGrupos = [];
        await fetchViajes();
      } else {
        showNotification(data.message || 'Error al devolver', 'danger');
      }
    } catch {
      showNotification('Error de conexión', 'danger');
    }
  }

  // ── Vale de Salida ──────────────────────────────────────────────────────────
  async function imprimirVale(viaje) {
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/vale`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { showNotification('Error al cargar datos del vale', 'danger'); return; }
      const data = await res.json();
      generatePrintWindow(data.viaje, data.detalles);
    } catch {
      showNotification('Error de conexión', 'danger');
    }
  }

  function generatePrintWindow(valeViaje, detalles) {
    const totalPeso = detalles.reduce((s, d) => s + (parseFloat(d.peso_total) || 0), 0);
    const totalCantidad = detalles.reduce((s, d) => s + (parseFloat(d.cantidad) || 0), 0);
    const respName = valeViaje.responsable_despacho?.nombre || '';
    const respDni = valeViaje.responsable_despacho?.dni || '';

    const detailRows = detalles.map(d => `
      <tr>
        <td>${valeViaje.cultivo}</td>
        <td>${d.variedad}</td>
        <td style="text-align:right;">${parseFloat(d.cantidad).toFixed(3)}</td>
        <td style="text-align:center;">${d.unidad_medida || ''}</td>
        <td style="text-align:right;">${parseFloat(d.peso_total).toFixed(3)}</td>
      </tr>
    `).join('');

    const emptyCount = Math.max(0, 7 - detalles.length);
    const emptyRows = Array(emptyCount).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('');

    const fechaDespacho = formatDateReadable(valeViaje.fecha_hora_despacho);
    const numeroVale = 'N° ' + String(valeViaje.id).padStart(8, '0');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Vale de Salida - ${valeViaje.codigo_viaje}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #000; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    table { border-collapse: collapse; width: 100%; }
    .border-table td, .border-table th { border: 1px solid #000; padding: 5px 8px; }
    .no-border td { border: none; padding: 3px 0; }
    .detail-head th { background: #1a1a1a !important; color: white !important; text-align: center; font-weight: bold; padding: 6px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .total-row td { font-weight: bold; background: #f0f0f0 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .field-row { display: flex; align-items: baseline; margin-bottom: 6px; }
    .field-label { font-weight: bold; min-width: 200px; font-size: 8.5pt; }
    .field-value { border-bottom: 1px solid #000; flex: 1; min-height: 14px; padding: 0 4px; }
    .section-gap { margin-top: 10px; }
    h2 { font-size: 16pt; text-align: center; font-weight: bold; }
    .sub-header { font-size: 8pt; text-align: center; text-transform: uppercase; }
    .doc-num { font-size: 14pt; font-weight: bold; text-align: right; }
    .viaje-num { font-size: 14pt; font-weight: bold; }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .detail-head th { background: #1a1a1a !important; color: white !important; }
      .total-row td { background: #f0f0f0 !important; }
    }
  </style>
</head>
<body>
  <!-- HEADER -->
  <table class="border-table" style="margin-bottom:8px;">
    <tr>
      <td style="width:25%; text-align:center; vertical-align:middle; font-size:14pt; font-weight:bold; padding:10px;">
        CAMPOSOL
      </td>
      <td style="width:50%; text-align:center; vertical-align:middle; padding:8px;">
        <div class="sub-header">SISTEMAS INTEGRADOS DE GESTIÓN</div>
        <h2>VALE DE SALIDA</h2>
      </td>
      <td style="width:25%; text-align:center; vertical-align:middle; font-weight:bold; font-size:11pt; padding:10px;">
        PE-OP60-010-01
      </td>
    </tr>
  </table>

  <!-- COMPANY INFO + DOC NUMBER -->
  <table style="margin-bottom:12px; border:none;">
    <tr>
      <td style="border:none; width:55%; vertical-align:top;">
        <div><strong>RUC: 20340584237</strong></div>
        <div><strong>CAMPOSOL S.A.</strong></div>
        <div style="font-size:7.5pt; margin-top:2px;">Av. El Derby N° 250 Int. 401 - Urb. El Derby</div>
        <div style="font-size:7.5pt;">Santiago de Surco - Lima - Lima</div>
      </td>
      <td style="border:none; width:45%; text-align:right; vertical-align:top;">
        <div class="doc-num">${numeroVale}</div>
      </td>
    </tr>
  </table>

  <!-- FIELDS -->
  <div style="margin-bottom:10px;">
    <div class="field-row"><span class="field-label">FECHA DE DESPACHO</span><span style="margin: 0 6px;">:</span><span class="field-value">${fechaDespacho}</span></div>
    <div class="field-row"><span class="field-label">ÁREA RESPONSABLE</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.area_responsable || 'CÁMARAS Y DESPACHOS FRESCOS'}</span></div>
    <div class="field-row"><span class="field-label">RESPONSABLE DE DESPACHO</span><span style="margin: 0 6px;">:</span><span class="field-value">${respName}</span></div>
    <div class="field-row"><span class="field-label">CLIENTE</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.cliente?.razon_social || ''}</span></div>
    <div class="field-row"><span class="field-label">RUC</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.cliente?.ruc || ''}</span></div>
    <div class="field-row"><span class="field-label">NOMBRE DE CHOFER</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.conductor_nombre || ''}</span></div>
    <div class="field-row"><span class="field-label">PLACA DEL VEHICULO</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.conductor_placa || ''}</span></div>
    <div class="field-row"><span class="field-label">N° LICENCIA</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.conductor_licencia || ''}</span></div>
    <div class="field-row"><span class="field-label">GUÍA DE REMISIÓN</span><span style="margin: 0 6px;">:</span><span class="field-value">${valeViaje.guia_remision || ''}</span></div>
  </div>

  <!-- VIAJE NUMBER -->
  <div style="margin-bottom:10px;">
    <strong>N° DE VIAJE</strong> &nbsp;:&nbsp; <span class="viaje-num">${valeViaje.codigo_viaje}</span>
  </div>

  <!-- DETAIL TABLE -->
  <table class="border-table" style="margin-bottom:10px;">
    <thead>
      <tr class="detail-head">
        <th style="width:22%;">CULTIVO</th>
        <th style="width:25%;">VARIEDAD</th>
        <th style="width:18%;">CANTIDAD</th>
        <th style="width:15%;">UNID. MEDIDA</th>
        <th style="width:20%;">PESO TOTAL</th>
      </tr>
    </thead>
    <tbody>
      ${detailRows}
      ${emptyRows}
      <tr class="total-row">
        <td colspan="4" style="text-align:center; font-weight:bold; font-size:10pt;">PESO TOTAL</td>
        <td style="text-align:right; font-weight:bold;">${totalPeso.toFixed(3)}</td>
      </tr>
    </tbody>
  </table>

  <!-- OBSERVACIONES -->
  <div style="margin-bottom:15px;">
    <strong>Observaciones:</strong>
    <div style="border:1px solid #000; min-height:45px; padding:6px; margin-top:4px; font-size:8.5pt;">${valeViaje.observaciones || ''}</div>
  </div>

  <!-- FIRMA CONSTATACION -->
  <div style="font-size:8pt; margin-bottom:8px; font-style:italic;">
    Firma como constancia que los bienes recibidos están en buen estado:
  </div>

  <!-- REPRESENTANTES -->
  <table style="border:none; margin-bottom:10px;">
    <tr>
      <td style="border:none; width:45%; vertical-align:top;">
        <strong style="font-size:9pt;">REPRESENTANTE DEL CLIENTE</strong>
        <div style="margin-top:45px; border-top:1px solid #000; padding-top:6px; font-size:8.5pt;">
          <div>Nombre y Apellido: _________________________________</div>
          <div style="margin-top:4px;">DNI: _________________________________</div>
        </div>
      </td>
      <td style="border:none; width:10%;"></td>
      <td style="border:none; width:45%; vertical-align:top;">
        <strong style="font-size:9pt;">REPRESENTANTE DE CAMPOSOL</strong>
        <div style="margin-top:45px; padding-top:6px; font-size:8.5pt;"></div>
      </td>
    </tr>
  </table>

  <!-- FIRMAS -->
  <table style="border:none; margin-top:20px;">
    <tr>
      <td style="border:none; border-top:1px solid #000; width:40%; text-align:center; font-weight:bold; font-size:8.5pt; padding-top:5px;">
        FIRMA REPRESENTANTE CLIENTE
      </td>
      <td style="border:none; width:20%;"></td>
      <td style="border:none; border-top:1px solid #000; width:40%; text-align:center; font-weight:bold; font-size:8.5pt; padding-top:5px;">
        FIRMA REPRESENTANTE CAMPOSOL
      </td>
    </tr>
  </table>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=850,height=1000');
    if (!win) { showNotification('Permite ventanas emergentes para imprimir', 'danger'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 600);
  }

  // ── Maestros (Administrador) ────────────────────────────────────────────────
  async function submitUM() {
    umError = '';
    if (!umForm.codigo.trim() || !umForm.descripcion.trim()) {
      umError = 'Código y descripción son obligatorios'; return;
    }
    try {
      const res = await fetch('/api/unidades-medida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(umForm)
      });
      const data = await res.json();
      if (res.ok) {
        showUMModal = false;
        umForm = { codigo: '', descripcion: '' };
        await fetchUnidadesMedida();
        showNotification('Unidad de medida creada');
      } else {
        umError = data.message || 'Error al crear';
      }
    } catch {
      umError = 'Error de conexión';
    }
  }

  async function toggleUMActivo(um) {
    try {
      const res = await fetch(`/api/unidades-medida/${um.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...um, activo: !um.activo })
      });
      if (res.ok) {
        await fetchUnidadesMedida();
        showNotification(`Unidad ${um.activo ? 'desactivada' : 'activada'}`);
      }
    } catch {}
  }

  function openNewRespModal() {
    editingRespId = null;
    respForm = { nombre: '', dni: '', activo: true };
    respError = '';
    showRespModal = true;
  }

  function openEditRespModal(resp) {
    editingRespId = resp.id;
    respForm = { nombre: resp.nombre, dni: resp.dni, activo: resp.activo };
    respError = '';
    showRespModal = true;
  }

  async function submitResp() {
    respError = '';
    if (!respForm.nombre.trim() || !respForm.dni.trim()) {
      respError = 'Nombre y DNI son obligatorios'; return;
    }
    if (respForm.dni.trim().length !== 8 || !/^\d+$/.test(respForm.dni.trim())) {
      respError = 'El DNI debe tener 8 dígitos numéricos'; return;
    }
    try {
      const url = editingRespId ? `/api/responsables-despacho/${editingRespId}` : '/api/responsables-despacho';
      const method = editingRespId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(respForm)
      });
      const data = await res.json();
      if (res.ok) {
        showRespModal = false;
        respForm = { nombre: '', dni: '' };
        editingRespId = null;
        await fetchResponsablesDespacho(true);
        showNotification(editingRespId ? 'Responsable actualizado' : 'Responsable creado');
      } else {
        respError = data.message || (editingRespId ? 'Error al actualizar' : 'Error al crear');
      }
    } catch {
      respError = 'Error de conexión';
    }
  }

  async function toggleRespActivo(resp) {
    try {
      const res = await fetch(`/api/responsables-despacho/${resp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...resp, activo: !resp.activo })
      });
      if (res.ok) {
        await fetchResponsablesDespacho(true);
        showNotification(`Responsable ${resp.activo ? 'desactivado' : 'activado'}`);
      }
    } catch {}
  }

  async function fetchReporte() {
    reportLoading = true;
    reportHasQueried = true;
    try {
      const params = new URLSearchParams();
      if (reportFilter.fecha_inicio) params.append('fecha_inicio', reportFilter.fecha_inicio);
      if (reportFilter.fecha_fin) params.append('fecha_fin', reportFilter.fecha_fin);
      if (reportFilter.cliente_id) params.append('cliente_id', reportFilter.cliente_id);
      if (reportFilter.codigo_viaje) params.append('codigo_viaje', reportFilter.codigo_viaje.trim());

      console.log('🔍 [REPORTES CLIENT] Petición enviada con params:', params.toString());

      const [resResumen, resDetalle] = await Promise.all([
        fetch(`/api/reportes/resumen-pallets?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/reportes/detalle-pallets?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      console.log('📡 [REPORTES CLIENT] Estado HTTP Resumen:', resResumen.status, resResumen.statusText);
      console.log('📡 [REPORTES CLIENT] Estado HTTP Detalle:', resDetalle.status, resDetalle.statusText);

      const textResumen = await resResumen.text();
      const textDetalle = await resDetalle.text();

      let jsonResumen = null;
      let jsonDetalle = null;

      try { jsonResumen = JSON.parse(textResumen); } catch (e) { console.error('❌ [REPORTES CLIENT] Error parseando JSON Resumen:', textResumen); }
      try { jsonDetalle = JSON.parse(textDetalle); } catch (e) { console.error('❌ [REPORTES CLIENT] Error parseando JSON Detalle:', textDetalle); }

      if (resResumen.ok && resDetalle.ok && Array.isArray(jsonResumen) && Array.isArray(jsonDetalle)) {
        reportResumenData = jsonResumen;
        reportDetalleData = jsonDetalle;
        console.log('✅ [REPORTES CLIENT] Datos recibidos correctamente:', { resumenCount: reportResumenData.length, detalleCount: reportDetalleData.length });
      } else {
        const msg = (jsonResumen && (jsonResumen.message || jsonResumen.error)) || (jsonDetalle && (jsonDetalle.message || jsonDetalle.error)) || `HTTP ${resResumen.status}/${resDetalle.status}`;
        console.error('❌ [REPORTES CLIENT] Error devuelto por servidor:', msg);
        showNotification(`Error del servidor: ${msg}`, 'danger');
      }
    } catch (err) {
      console.error('💥 [REPORTES CLIENT EXCEPTION]', err);
      showNotification(`Error de conexión: ${err?.message || err}`, 'danger');
    } finally {
      reportLoading = false;
    }
  }

  function exportarReporteXLSX() {
    const isResumen = reportTab === 'resumen';
    const data = isResumen ? reportResumenData : reportDetalleData;
    if (!data || data.length === 0) {
      showNotification('No hay datos para exportar', 'danger'); return;
    }

    let exportRows = [];

    if (isResumen) {
      exportRows = data.map(r => ({
        'Viaje': r.codigo_viaje || '',
        'Fecha Despacho': formatDateTimeReadable(r.fecha_hora_despacho),
        'Cliente': r.cliente_nombre || '',
        'Cultivo': r.cultivo || '',
        'N° Pallet': `Pallet ${r.numero_pallet}`,
        'Variedades': Array.isArray(r.variedades) ? r.variedades.join(', ') : (r.variedades || ''),
        'Cantidad Total': parseFloat(r.cantidad_total || 0),
        'Unidad Medida': r.unidad_medida || '',
        'Peso Producción (kg)': parseFloat(r.peso_produccion_total || 0),
        'Peso Bruto (kg)': r.peso_bruto !== null && r.peso_bruto !== undefined ? parseFloat(r.peso_bruto) : '',
        'Tara (kg)': r.peso_tara !== null && r.peso_tara !== undefined ? parseFloat(r.peso_tara) : '',
        'Peso Despacho (kg)': r.peso_despacho !== null && r.peso_despacho !== undefined ? parseFloat(r.peso_despacho) : '',
        'Desviación (%)': r.desviacion !== null && r.desviacion !== undefined ? parseFloat(parseFloat(r.desviacion).toFixed(1)) : '',
        'Estado Viaje': r.estado || ''
      }));
    } else {
      exportRows = data.map(r => ({
        'Viaje': r.codigo_viaje || '',
        'Fecha Despacho': formatDateTimeReadable(r.fecha_hora_despacho),
        'Cliente': r.cliente_nombre || '',
        'Cultivo': r.cultivo || '',
        'N° Pallet': `Pallet ${r.numero_pallet}`,
        'Código Pallet': r.codigo_pallet || '',
        'Fecha Cosecha': r.fecha_cosecha ? formatDateReadable(r.fecha_cosecha) : '',
        'Procedencia': r.procedencia || '',
        'Variedad': r.variedad || '',
        'Cantidad': parseFloat(r.cantidad || 0),
        'Unidad Medida': r.unidad_medida || '',
        'Peso Prod. (kg)': parseFloat(r.peso_produccion || 0),
        'Precinto': r.precinto || ''
      }));
    }

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, isResumen ? 'Resumen Pallets' : 'Detalle Cosecha');
    XLSX.writeFile(workbook, `Reporte_${isResumen ? 'Resumen' : 'Detalle'}_Pallets_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function exportarReporteCSV() {
    const isResumen = reportTab === 'resumen';
    const data = isResumen ? reportResumenData : reportDetalleData;
    if (!data || data.length === 0) {
      showNotification('No hay datos para exportar', 'danger'); return;
    }

    let headers = [];
    let rows = [];

    if (isResumen) {
      headers = ['Viaje', 'Fecha Despacho', 'Cliente', 'Cultivo', 'N° Pallet', 'Código Pallet', 'Variedades', 'Cantidad Total', 'Unidad Medida', 'Peso Producción (kg)', 'Peso Bruto (kg)', 'Tara (kg)', 'Peso Despacho (kg)', 'Desviación (%)', 'Estado Viaje'];
      rows = data.map(r => [
        r.codigo_viaje || '',
        formatDateTimeReadable(r.fecha_hora_despacho),
        `"${(r.cliente_nombre || '').replace(/"/g, '""')}"`,
        r.cultivo || '',
        r.numero_pallet,
        r.codigo_pallet || '',
        `"${(Array.isArray(r.variedades) ? r.variedades.join(', ') : (r.variedades || '')).replace(/"/g, '""')}"`,
        parseFloat(r.cantidad_total || 0).toFixed(3),
        r.unidad_medida || '',
        parseFloat(r.peso_produccion_total || 0).toFixed(3),
        r.peso_bruto !== null && r.peso_bruto !== undefined ? parseFloat(r.peso_bruto).toFixed(3) : '-',
        r.peso_tara !== null && r.peso_tara !== undefined ? parseFloat(r.peso_tara).toFixed(3) : '-',
        r.peso_despacho !== null && r.peso_despacho !== undefined ? parseFloat(r.peso_despacho).toFixed(3) : '-',
        r.desviacion !== null && r.desviacion !== undefined ? `${parseFloat(r.desviacion).toFixed(2)}%` : '-',
        r.estado || ''
      ]);
    } else {
      headers = ['Viaje', 'Fecha Despacho', 'Cliente', 'Cultivo', 'N° Pallet', 'Código Pallet', 'Fecha Cosecha', 'Procedencia', 'Variedad', 'Cantidad', 'Unidad Medida', 'Peso Prod. (kg)', 'Precinto', 'Peso Bruto (kg)', 'Tara (kg)', 'Peso Despacho (kg)', 'Desviación (%)'];
      rows = data.map(r => [
        r.codigo_viaje || '',
        formatDateTimeReadable(r.fecha_hora_despacho),
        `"${(r.cliente_nombre || '').replace(/"/g, '""')}"`,
        r.cultivo || '',
        r.numero_pallet,
        r.codigo_pallet || '',
        r.fecha_cosecha ? formatDateReadable(r.fecha_cosecha) : '-',
        `"${(r.procedencia || '').replace(/"/g, '""')}"`,
        r.variedad || '',
        parseFloat(r.cantidad || 0).toFixed(3),
        r.unidad_medida || '',
        parseFloat(r.peso_produccion || 0).toFixed(3),
        r.precinto || '-',
        r.peso_bruto !== null && r.peso_bruto !== undefined ? parseFloat(r.peso_bruto).toFixed(3) : '-',
        r.peso_tara !== null && r.peso_tara !== undefined ? parseFloat(r.peso_tara).toFixed(3) : '-',
        r.peso_despacho !== null && r.peso_despacho !== undefined ? parseFloat(r.peso_despacho).toFixed(3) : '-',
        r.desviacion !== null && r.desviacion !== undefined ? `${parseFloat(r.desviacion).toFixed(2)}%` : '-'
      ]);
    }

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Reporte_${isResumen ? 'Resumen' : 'Detalle'}_Pallets_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
</script>

<style>
  .app-header {
    background-color: var(--dark);
    color: white;
    padding: 16px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: var(--shadow-md);
  }
  .logo-area { display: flex; align-items: center; gap: 12px; }
  .logo-badge {
    background-color: var(--secondary); color: white; font-weight: 800;
    padding: 6px 12px; border-radius: var(--radius-sm); letter-spacing: 1px; font-size: 1.1rem;
  }
  .logo-text { font-size: 1.3rem; font-weight: 700; letter-spacing: -0.5px; }
  .nav-tabs {
    display: flex; background: white;
    border-bottom: 1px solid var(--gray-200); padding: 0 32px; gap: 16px;
  }
  .nav-tab {
    padding: 16px 8px; font-weight: 600; font-size: 0.95rem;
    color: var(--gray-600); cursor: pointer; border-bottom: 3px solid transparent; transition: var(--transition);
  }
  .nav-tab:hover { color: var(--primary); }
  .nav-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
  .main-content { flex: 1; padding: 32px; max-width: 1500px; width: 100%; margin: 0 auto; }
  .login-screen {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--dark) 0%, var(--primary) 100%); padding: 20px;
  }
  .login-card {
    background: white; border-radius: var(--radius-lg); box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
    width: 100%; max-width: 420px; padding: 40px; border: 1px solid rgba(255,255,255,0.1);
  }
  .login-header { text-align: center; margin-bottom: 32px; }
  .login-header h1 { font-size: 1.8rem; font-weight: 800; color: var(--primary); }
  .custom-table-container {
    overflow-x: auto; border-radius: var(--radius-md); border: 1px solid var(--gray-200);
    margin-top: 16px; background: white;
  }
  .custom-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
  .custom-table th {
    background-color: var(--gray-100); padding: 12px 14px;
    font-weight: 600; color: var(--gray-600); border-bottom: 1px solid var(--gray-200);
    white-space: nowrap;
  }
  .custom-table td { padding: 10px 14px; border-bottom: 1px solid var(--gray-200); vertical-align: middle; }
  .custom-table tr:hover { background-color: var(--light); }
  .row-locked { background-color: rgba(16, 185, 129, 0.06) !important; }
  .row-alert { background-color: rgba(239, 68, 68, 0.07) !important; }
  .toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 14px 24px; border-radius: var(--radius-sm); color: white;
    font-weight: 600; box-shadow: var(--shadow-lg); display: flex;
    align-items: center; gap: 8px; animation: fadeIn 0.3s ease-out;
  }
  .toast-success { background-color: var(--success); }
  .toast-danger { background-color: var(--danger); }
  .modal-overlay {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center; z-index: 999; padding: 20px;
  }
  .modal-content {
    background: white; border-radius: var(--radius-md); padding: 32px;
    width: 100%; max-width: 620px; box-shadow: var(--shadow-lg); max-height: 92vh; overflow-y: auto;
  }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
  .modal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 640px) { .modal-grid { grid-template-columns: 1fr; } }
  .info-tag {
    font-size: 0.78rem; color: var(--gray-600);
    background: var(--gray-100); padding: 2px 8px; border-radius: 4px; white-space: nowrap;
  }
  .variedad-chips {
    display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;
  }
  .variedad-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #DBEAFE; color: #1E40AF;
    padding: 4px 10px; border-radius: 9999px; font-size: 0.8rem; font-weight: 600;
  }
  .variedad-chip.selected { background: var(--primary); color: white; }
  .variedad-tab-btn {
    padding: 8px 18px; border-radius: 20px; font-weight: 600; font-size: 0.85rem;
    cursor: pointer; border: 2px solid var(--gray-300); background: white;
    color: var(--gray-600); transition: var(--transition);
  }
  .variedad-tab-btn:hover { border-color: var(--primary); color: var(--primary); }
  .variedad-tab-btn.active { border-color: var(--primary); background: var(--primary); color: white; }
  .frio-card {
    background: var(--gray-100); border-radius: var(--radius-md); padding: 16px;
    border: 1px solid var(--gray-200); margin-bottom: 16px;
  }
  .confirm-banner {
    background: linear-gradient(135deg, #065F46, #059669);
    color: white; padding: 20px 24px; border-radius: var(--radius-md); margin-top: 16px;
  }
  .input-sm {
    width: 100%; padding: 5px 8px; border: 1px solid var(--gray-300);
    border-radius: 4px; font-size: 0.85rem; background: white;
  }
  .input-sm:focus { outline: none; border-color: var(--primary); }
</style>

<!-- Toast -->
{#if notification.show}
  <div class="toast toast-{notification.type}"><span>{notification.message}</span></div>
{/if}

{#if currentUser?.requiere_cambio_clave}
  <!-- MODAL FORCED CHANGE PASSWORD -->
  <div class="modal-overlay" style="z-index:9999;">
    <div class="modal-content animate-fade-in" style="max-width:440px;">
      <div style="text-align:center;margin-bottom:20px;">
        <div style="font-size:2.5rem;margin-bottom:8px;">🔒</div>
        <h3 style="font-weight:800;font-size:1.3rem;color:var(--primary);">Actualización Obligatoria de Contraseña</h3>
        <p style="color:var(--gray-600);font-size:0.85rem;margin-top:6px;">
          Hola, <strong>{currentUser.nombre}</strong>. Por motivos de seguridad, debes ingresar una nueva contraseña personal antes de continuar.
        </p>
      </div>

      {#if newPasswordError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{newPasswordError}</div>
      {/if}

      <form on:submit|preventDefault={submitCambioClave}>
        <div class="form-group">
          <label class="form-label" for="new-pass">Nueva Contraseña (mínimo 6 caracteres) *</label>
          <input type="password" id="new-pass" class="form-control" bind:value={newPasswordForm.nueva_clave} required placeholder="••••••••" minlength="6" />
        </div>
        <div class="form-group">
          <label class="form-label" for="confirm-pass">Confirmar Nueva Contraseña *</label>
          <input type="password" id="confirm-pass" class="form-control" bind:value={newPasswordForm.confirmar_clave} required placeholder="••••••••" minlength="6" />
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:16px;padding:12px;" disabled={isChangingPassword}>
          {isChangingPassword ? 'Guardando...' : '✓ Guardar Nueva Contraseña'}
        </button>
      </form>
    </div>
  </div>
{/if}

{#if !token}
  <!-- LOGIN SCREEN -->
  <div class="login-screen">
    <div class="login-card">
      <div class="login-header">
        <div style="display:flex;justify-content:center;margin-bottom:12px;"><span class="logo-badge">CAMPOSOL</span></div>
        <h1>Venta Nacional</h1>
        <p style="color:var(--gray-600);font-size:0.9rem;margin-top:4px;">Ingresa tus credenciales para acceder</p>
      </div>
      <form on:submit|preventDefault={handleLogin}>
        {#if authError}
          <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{authError}</div>
        {/if}
        <div class="form-group">
          <label class="form-label" for="email">Correo Electrónico</label>
          <input type="email" id="email" class="form-control" bind:value={email} required placeholder="ejemplo@camposol.com" />
        </div>
        <div class="form-group">
          <label class="form-label" for="password">Contraseña</label>
          <div style="position:relative;display:flex;align-items:center;">
            {#if showPassword}
              <input type="text" id="password" class="form-control" bind:value={password} required placeholder="••••••••" style="padding-right:42px;" />
            {:else}
              <input type="password" id="password" class="form-control" bind:value={password} required placeholder="••••••••" style="padding-right:42px;" />
            {/if}
            <button
              type="button"
              on:click={() => showPassword = !showPassword}
              style="position:absolute;right:10px;background:none;border:none;cursor:pointer;color:var(--gray-600);padding:4px;display:flex;align-items:center;justify-content:center;user-select:none;"
              title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {#if showPassword}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              {/if}
            </button>
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:16px;padding:12px;">Iniciar Sesión</button>
      </form>
    </div>
  </div>

{:else}
  <!-- APP CONTAINER -->
  <div class="app-container">
    <header class="app-header">
      <div class="logo-area">
        <span class="logo-badge">CAMPOSOL</span>
        <span class="logo-text">Venta Nacional</span>
      </div>
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="text-align:right;">
          <div style="font-weight:600;font-size:0.9rem;">{currentUser?.nombre}</div>
          <div style="font-size:0.75rem;color:var(--secondary-light);font-weight:600;text-transform:uppercase;">Rol: {currentUser?.role}</div>
        </div>
        <button class="btn btn-ghost" on:click={logout} style="padding:6px 12px;font-size:0.85rem;">Cerrar Sesión</button>
      </div>
    </header>

    <nav class="nav-tabs">
      <div class="nav-tab {view === 'calendar' ? 'active' : ''}" on:click={() => view = 'calendar'}>Calendario Semanal</div>
      {#if currentUser?.role === 'Planificador' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'planificador' ? 'active' : ''}" on:click={() => view = 'planificador'}>Planificador</div>
      {/if}
      {#if currentUser?.role === 'Cadena de frío' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'frio' ? 'active' : ''}" on:click={() => view = 'frio'}>Cadena de Frío</div>
      {/if}
      {#if currentUser?.role === 'Despacho' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'despacho' ? 'active' : ''}" on:click={() => view = 'despacho'}>Despacho</div>
        <div class="nav-tab {view === 'vales' ? 'active' : ''}" on:click={() => view = 'vales'}>Vales de Salida</div>
      {/if}
      {#if currentUser?.role === 'Administrador' || currentUser?.role === 'Despacho'}
        <div class="nav-tab {view === 'maestros' ? 'active' : ''}" on:click={() => { view = 'maestros'; if (currentUser?.role === 'Despacho') maestroView = 'responsables'; fetchResponsablesDespacho(true); }}>Maestros</div>
      {/if}
      <div class="nav-tab {view === 'reportes' ? 'active' : ''}" on:click={() => view = 'reportes'}>Reportes</div>
    </nav>

    <main class="main-content">

      <!-- ══ CALENDAR ══════════════════════════════════════════════════════════ -->
      {#if view === 'calendar'}
        <div class="card animate-fade-in">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;margin-bottom:24px;">
            <div>
              <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);">Programa de Ventas Semanal</h2>
              <p style="color:var(--gray-600);font-size:0.9rem;">Visualiza los despachos agendados para la semana</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px;background:var(--gray-100);padding:6px;border-radius:var(--radius-sm);">
              <button class="btn btn-ghost" on:click={() => changeWeek(-1)} style="padding:6px 12px;font-size:0.85rem;">◀ Ant</button>
              <span style="font-weight:700;font-size:0.9rem;padding:0 12px;min-width:220px;text-align:center;">{getWeekLabel(currentWeekStart)}</span>
              <button class="btn btn-ghost" on:click={() => changeWeek(1)} style="padding:6px 12px;font-size:0.85rem;">Sig ▶</button>
            </div>
          </div>
          <div class="calendar-grid">
            {#each Array(7) as _, i}
              {@const dateForIndex = new Date(currentWeekStart)}
              {@const _v = dateForIndex.setDate(dateForIndex.getDate() + i)}
              {@const isToday = new Date().toDateString() === dateForIndex.toDateString()}
              {@const dayVoyages = getVoyagesForDay(i, viajes, currentWeekStart)}
              <div class="calendar-day-card">
                <div class="calendar-day-header {isToday ? 'today' : ''}">
                  <div style="text-transform:capitalize;">{dateForIndex.toLocaleDateString('es-ES', { weekday: 'long' })}</div>
                  <div style="font-size:0.8rem;font-weight:normal;margin-top:2px;">{dateForIndex.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' })}</div>
                </div>
                <div class="calendar-day-body">
                  {#if dayVoyages.length === 0}
                    <div style="color:var(--gray-300);font-size:0.75rem;text-align:center;margin-top:16px;">Sin viajes</div>
                  {:else}
                    {#each dayVoyages as voyage}
                      <div class="calendar-voyage-item" on:click={() => {
                        if ((currentUser?.role === 'Cadena de frío' || currentUser?.role === 'Administrador') && voyage.estado === 'Planificado') {
                          selectViajeFrio(voyage); view = 'frio';
                        } else if ((currentUser?.role === 'Despacho' || currentUser?.role === 'Administrador') && (voyage.estado === 'Preparado' || voyage.estado === 'Cargado')) {
                          selectDespachoVoyage(voyage); view = 'despacho';
                        } else {
                          showNotification(`${voyage.codigo_viaje} — Estado: ${voyage.estado}`);
                        }
                      }}>
                        <div style="font-weight:700;color:var(--primary);display:flex;justify-content:space-between;align-items:center;">
                          <span>{voyage.codigo_viaje}</span>
                          <span class="badge badge-{voyage.estado.toLowerCase()}" style="font-size:0.6rem;padding:1px 4px;">{voyage.estado}</span>
                        </div>
                        <div style="margin-top:4px;font-weight:600;font-size:0.8rem;">{voyage.cultivo}</div>
                        <div style="font-size:0.75rem;color:var(--gray-600);">{parseVariedades(voyage.variedades).join(', ')}</div>
                        <div style="font-size:0.75rem;color:var(--gray-600);">Cli: {voyage.cliente?.razon_social || 'Desconocido'}</div>
                        <div style="font-size:0.75rem;color:var(--gray-600);">Hora: {formatTimeReadable(voyage.fecha_hora_despacho)}</div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>

      <!-- ══ PLANIFICADOR ══════════════════════════════════════════════════════ -->
      {:else if view === 'planificador'}
        <div class="card animate-fade-in">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px;">
            <div>
              <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);">Programación de Viajes</h2>
              <p style="color:var(--gray-600);font-size:0.9rem;">Crea, modifica y gestiona las planificaciones de carga nacional</p>
            </div>
            <div style="display:flex;gap:12px;">
              <button class="btn btn-ghost" on:click={openNewClientModal}>+ Crear Cliente</button>
              <button class="btn btn-primary" on:click={openNewVoyageModal}>+ Programar Nuevo Viaje</button>
            </div>
          </div>

          <div class="custom-table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Viaje</th>
                  <th>Despacho (Fecha/Hora)</th>
                  <th>Cultivo</th>
                  <th>Variedades</th>
                  <th>Origen Fruta</th>
                  <th>Cliente</th>
                  <th>Peso Plan. (kg)</th>
                  <th>Estado</th>
                  <th style="text-align:right;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {#if viajes.length === 0}
                  <tr><td colspan="9" style="text-align:center;color:var(--gray-600);padding:32px;">No hay viajes programados.</td></tr>
                {:else}
                  {#each viajes as viaje}
                    <tr>
                      <td style="font-weight:700;color:var(--primary);">{viaje.codigo_viaje}</td>
                      <td>{formatDateTimeReadable(viaje.fecha_hora_despacho)}</td>
                      <td><strong>{viaje.cultivo}</strong></td>
                      <td>
                        <div class="variedad-chips">
                          {#each parseVariedades(viaje.variedades) as var_}
                            <span class="variedad-chip">{var_}</span>
                          {/each}
                        </div>
                      </td>
                      <td><span class="info-tag">{viaje.origen_fruta}</span></td>
                      <td>
                        <div style="font-weight:600;font-size:0.85rem;">{viaje.cliente?.razon_social}</div>
                        <div style="font-size:0.75rem;color:var(--gray-600);">RUC: {viaje.cliente?.ruc}</div>
                      </td>
                      <td>{parseFloat(viaje.peso).toLocaleString('es-PE')}</td>
                      <td><span class="badge badge-{viaje.estado.toLowerCase()}">{viaje.estado}</span></td>
                      <td style="text-align:right;">
                        {#if viaje.estado === 'Planificado'}
                          <button class="btn btn-ghost" on:click={() => openEditVoyageModal(viaje)} style="padding:6px 10px;font-size:0.8rem;">Editar</button>
                        {:else}
                          <span style="font-size:0.75rem;color:var(--gray-600);font-style:italic;">Bloqueado</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>

      <!-- ══ CADENA DE FRÍO ════════════════════════════════════════════════════ -->
      {:else if view === 'frio'}
        <div class="card animate-fade-in">
          <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);margin-bottom:6px;">Asignación de Carga — Cadena de Frío</h2>
          <p style="color:var(--gray-600);font-size:0.9rem;margin-bottom:24px;">Selecciona un viaje para registrar la carga por variedad desde Excel.</p>

          <!-- Select Viaje -->
          <div class="form-group" style="max-width:480px;margin-bottom:24px;">
            <label class="form-label" for="viaje-frio-sel">Seleccionar Viaje</label>
            <select id="viaje-frio-sel" class="form-control" on:change={(e) => {
              const val = e.target.value;
              if (!val) { selectViajeFrio(null); return; }
              const v = viajes.find(x => x.id === parseInt(val));
              if (v) selectViajeFrio(v);
            }} value={selectedViajeFrio?.id || ''}>
              <option value="">-- Selecciona un viaje --</option>
              {#each viajes.filter(v => v.estado === 'Planificado' || (v.estado === 'Preparado' && v.estado_frio === 'Confirmado')) as v}
                <option value={v.id}>{v.codigo_viaje} [{v.estado}] — {v.cultivo} — {v.cliente?.razon_social}</option>
              {/each}
            </select>
          </div>

          {#if selectedViajeFrio}
            <!-- Viaje Info Banner -->
            <div class="frio-card" style="margin-bottom:20px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <h4 style="font-weight:700;color:var(--primary);">{selectedViajeFrio.codigo_viaje}</h4>
                <div style="display:flex;gap:8px;">
                  <span class="badge badge-{selectedViajeFrio.estado.toLowerCase()}">{selectedViajeFrio.estado}</span>
                  {#if selectedViajeFrio.estado_frio === 'Confirmado'}
                    <span class="badge" style="background:#D1FAE5;color:#065F46;">✓ Confirmado</span>
                  {/if}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;font-size:0.88rem;">
                <div><strong>Cultivo:</strong> {selectedViajeFrio.cultivo}</div>
                <div><strong>Cliente:</strong> {selectedViajeFrio.cliente?.razon_social}</div>
                <div><strong>Peso Plan.:</strong> {parseFloat(selectedViajeFrio.peso).toLocaleString('es-PE')} kg</div>
                <div><strong>Despacho:</strong> {new Date(selectedViajeFrio.fecha_hora_despacho).toLocaleString('es-PE', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
              </div>
            </div>

            {#if selectedViajeFrio.estado_frio === 'Confirmado'}
              <!-- Carga confirmada — solo lectura -->
              <div class="confirm-banner">
                <div style="font-size:1.1rem;font-weight:700;margin-bottom:6px;">✅ Carga Confirmada</div>
                <p style="font-size:0.9rem;opacity:0.9;">La carga de este viaje fue confirmada y está siendo procesada por Despacho. Si Despacho devuelve el viaje, podrás volver a editar.</p>
              </div>
              <!-- Mostrar registros como lectura -->
              {#if frioRegistros.length > 0}
                <div style="margin-top:20px;">
                  <h4 style="font-weight:700;margin-bottom:12px;color:var(--primary);">Registros confirmados ({frioRegistros.length} registros)</h4>
                  <div class="custom-table-container">
                    <table class="custom-table">
                      <thead>
                        <tr>
                          <th>Variedad</th><th>Pallet</th><th>Cód. Pallet</th>
                          <th>F. Cosecha</th><th>Procedencia</th>
                          <th>Cantidad</th><th>UM</th><th>Peso Prod.</th><th>Precinto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each frioRegistros as r}
                          <tr>
                            <td><span class="badge" style="background:#DBEAFE;color:#1E40AF;">{r.variedad}</span></td>
                            <td>{r.numero_pallet}</td>
                            <td style="font-weight:600;">{r.codigo_pallet}</td>
                            <td>{formatDateReadable(r.fecha_cosecha)}</td>
                            <td>{r.procedencia || '-'}</td>
                            <td>{formatDecimal(r.cantidad)}</td>
                            <td><span class="info-tag">{r.unidad_medida}</span></td>
                            <td>{r.peso_produccion ? formatDecimal(r.peso_produccion) : '-'}</td>
                            <td>{r.precinto || '-'}</td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
            {:else}
              <!-- Edición activa — tabs por variedad -->
              <div style="margin-bottom:16px;">
                <p style="font-size:0.85rem;color:var(--gray-600);margin-bottom:10px;">Selecciona una variedad para ver o agregar registros:</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  {#each parseVariedades(selectedViajeFrio.variedades) as var_}
                    {@const count = getRegistrosForVariedad(var_).length}
                    <button
                      class="variedad-tab-btn {frioSelectedVariedad === var_ ? 'active' : ''}"
                      on:click={() => selectVariedadFrio(var_)}
                    >
                      {var_}
                      {#if count > 0}
                        <span style="background:{frioSelectedVariedad === var_ ? 'rgba(255,255,255,0.3)' : 'var(--primary)'};color:white;border-radius:9999px;padding:1px 7px;font-size:0.7rem;margin-left:4px;">{count}</span>
                      {/if}
                    </button>
                  {/each}
                </div>
              </div>

              {#if frioSelectedVariedad}
                {@const registrosVar = getRegistrosForVariedad(frioSelectedVariedad)}
                <div style="border:1px solid var(--gray-200);border-radius:var(--radius-md);padding:20px;background:white;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                    <h4 style="font-weight:700;color:var(--primary);font-size:1rem;">
                      Variedad: <span style="color:var(--dark);">{frioSelectedVariedad}</span>
                      {#if registrosVar.length > 0}
                        <span style="font-weight:400;font-size:0.85rem;color:var(--gray-600);margin-left:8px;">({registrosVar.length} registros)</span>
                      {/if}
                    </h4>
                    <div style="display:flex;gap:8px;">
                      <button class="btn btn-primary" style="padding:7px 16px;font-size:0.85rem;" on:click={() => { showFrioUpload = true; pastePreview = false; excelPasteData = ''; frioError = ''; }}>
                        + Subir datos desde Excel
                      </button>
                      {#if registrosVar.length > 0}
                        <button class="btn btn-danger" style="padding:7px 16px;font-size:0.85rem;" on:click={() => deleteFrioVariedad(frioSelectedVariedad)}>
                          🗑 Eliminar todos
                        </button>
                      {/if}
                    </div>
                  </div>

                  {#if frioError}
                    <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:12px;font-size:0.85rem;">{frioError}</div>
                  {/if}

                  <!-- Upload Panel -->
                  {#if showFrioUpload}
                    <div style="background:var(--gray-100);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;border:1px solid var(--gray-200);">
                      {#if !pastePreview}
                        <h5 style="font-weight:700;margin-bottom:8px;">Subir datos para: {frioSelectedVariedad}</h5>
                        <p style="font-size:0.82rem;color:var(--gray-600);margin-bottom:8px;">
                          Columnas esperadas (en orden): <strong>Pallet | Código Pallet | Fecha Cosecha | Procedencia | Cantidad | Unidad Medida | Peso Producción | Precinto</strong>
                        </p>
                        <p style="font-size:0.8rem;color:var(--gray-600);margin-bottom:8px;">
                          Unidades de medida válidas: <strong>{unidadesMedida.map(u => u.codigo).join(', ')}</strong>
                        </p>
                        <div class="form-group">
                          <textarea class="form-control" rows="7" bind:value={excelPasteData} placeholder={excelPlaceholder} style="font-family:monospace;font-size:0.83rem;"></textarea>
                        </div>
                        <div style="display:flex;gap:8px;">
                          <button class="btn btn-primary" on:click={processExcelPaste}>Procesar y Vista Previa</button>
                          <button class="btn btn-ghost" on:click={() => showFrioUpload = false}>Cancelar</button>
                        </div>
                      {:else}
                        <!-- Preview -->
                        <h5 style="font-weight:700;margin-bottom:12px;color:var(--primary);">Vista Previa — {parsedPallets.length} registros para {frioSelectedVariedad}</h5>
                        <div class="custom-table-container" style="max-height:280px;overflow-y:auto;">
                          <table class="custom-table">
                            <thead>
                              <tr>
                                <th>Pallet</th><th>Cód. Pallet</th><th>F. Cosecha</th>
                                <th>Procedencia</th><th>Cantidad</th><th>UM</th>
                                <th>Peso Prod.</th><th>Precinto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {#each parsedPallets as p}
                                <tr>
                                  <td>{p.numero_pallet}</td>
                                  <td style="font-weight:600;">{p.codigo_pallet}</td>
                                  <td>{formatDateReadable(p.fecha_cosecha)}</td>
                                  <td>{p.procedencia || '-'}</td>
                                  <td>{formatDecimal(p.cantidad)}</td>
                                  <td><span class="info-tag">{p.unidad_medida}</span></td>
                                  <td>{p.peso_produccion ? formatDecimal(p.peso_produccion) : '-'}</td>
                                  <td>{p.precinto || '-'}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:12px;">
                          <button class="btn btn-secondary" on:click={submitPalletsFrio}>✓ Confirmar y Agregar</button>
                          <button class="btn btn-ghost" on:click={() => pastePreview = false}>Volver a Pegar</button>
                          <button class="btn btn-ghost" on:click={() => { showFrioUpload = false; pastePreview = false; }}>Cancelar</button>
                        </div>
                      {/if}
                    </div>
                  {/if}

                  <!-- Records Table -->
                  {#if registrosVar.length === 0 && !showFrioUpload}
                    <div style="text-align:center;padding:32px;color:var(--gray-600);">
                      <div style="font-size:2rem;margin-bottom:8px;">📋</div>
                      <p>No hay registros para <strong>{frioSelectedVariedad}</strong>.</p>
                      <p style="font-size:0.85rem;margin-top:4px;">Haz clic en "Subir datos desde Excel" para agregar registros.</p>
                    </div>
                  {:else if registrosVar.length > 0}
                    {#if frioLoading}
                      <div style="text-align:center;padding:24px;color:var(--gray-600);">Cargando...</div>
                    {:else}
                      <div class="custom-table-container">
                        <table class="custom-table">
                          <thead>
                            <tr>
                              <th>Pallet</th><th>Cód. Pallet</th><th>F. Cosecha</th>
                              <th>Procedencia</th><th>Cantidad</th><th>UM</th>
                              <th>Peso Prod.</th><th>Precinto</th><th style="text-align:right;">Acciones</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each registrosVar as r}
                              {#if frioEditingId === r.id}
                                <!-- EDIT ROW -->
                                <tr style="background:#FEF3C7;">
                                  <td><input type="number" class="input-sm" bind:value={frioEditForm.numero_pallet} style="width:60px;" /></td>
                                  <td><input type="text" class="input-sm" bind:value={frioEditForm.codigo_pallet} /></td>
                                  <td><input type="date" class="input-sm" bind:value={frioEditForm.fecha_cosecha} /></td>
                                  <td><input type="text" class="input-sm" bind:value={frioEditForm.procedencia} /></td>
                                  <td><input type="number" step="0.001" class="input-sm" bind:value={frioEditForm.cantidad} style="width:80px;" /></td>
                                  <td>
                                    <select class="input-sm" bind:value={frioEditForm.unidad_medida}>
                                      {#each unidadesMedida as um}
                                        <option value={um.codigo}>{um.codigo}</option>
                                      {/each}
                                    </select>
                                  </td>
                                  <td><input type="number" step="0.001" class="input-sm" bind:value={frioEditForm.peso_produccion} style="width:90px;" /></td>
                                  <td><input type="text" class="input-sm" bind:value={frioEditForm.precinto} /></td>
                                  <td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.75rem;" on:click={() => saveEditFrio(r.id)}>✓ Guardar</button>
                                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem;margin-left:4px;" on:click={cancelEditFrio}>✕</button>
                                  </td>
                                </tr>
                              {:else}
                                <!-- READ ROW -->
                                <tr>
                                  <td style="font-weight:600;">{r.numero_pallet}</td>
                                  <td>{r.codigo_pallet}</td>
                                  <td>{formatDateReadable(r.fecha_cosecha)}</td>
                                  <td>{r.procedencia || '-'}</td>
                                  <td>{formatDecimal(r.cantidad)}</td>
                                  <td><span class="info-tag">{r.unidad_medida}</span></td>
                                  <td>{r.peso_produccion ? formatDecimal(r.peso_produccion) : '-'}</td>
                                  <td>{r.precinto || '-'}</td>
                                  <td style="text-align:right;white-space:nowrap;">
                                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem;" on:click={() => startEditFrio(r)}>Editar</button>
                                    <button class="btn btn-danger" style="padding:4px 8px;font-size:0.75rem;margin-left:4px;" on:click={() => deleteFrioRegistro(r.id)}>🗑</button>
                                  </td>
                                </tr>
                              {/if}
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  {/if}
                </div>
              {:else}
                <div style="text-align:center;padding:24px;color:var(--gray-600);background:var(--gray-100);border-radius:var(--radius-sm);">
                  Selecciona una variedad de las pestañas para ver o agregar registros.
                </div>
              {/if}

              <!-- Total Summary -->
              {#if frioRegistros.length > 0}
                <div style="background:var(--gray-100);border-radius:var(--radius-sm);padding:14px 20px;margin-top:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                  <div style="font-size:0.9rem;">
                    <strong>Total registros:</strong> {frioRegistros.length} registros en {[...new Set(frioRegistros.map(r => r.variedad))].length} variedad(es)
                  </div>
                  <button
                    class="btn btn-secondary"
                    style="padding:10px 24px;"
                    on:click={confirmarCargaFrio}
                    disabled={frioConfirming || frioRegistros.length === 0}
                  >
                    {frioConfirming ? 'Confirmando...' : '✓ Confirmar Carga y Pasar a Despacho'}
                  </button>
                </div>
              {:else}
                <div style="background:var(--danger-light);border-radius:var(--radius-sm);padding:12px 16px;margin-top:16px;font-size:0.85rem;color:var(--danger);">
                  ⚠️ Debes registrar al menos un pallet antes de confirmar la carga.
                </div>
              {/if}
            {/if}
          {/if}
        </div>

      <!-- ══ DESPACHO ══════════════════════════════════════════════════════════ -->
      {:else if view === 'despacho'}
        <div class="card animate-fade-in">
          <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);margin-bottom:6px;">Proceso de Despacho</h2>
          <p style="color:var(--gray-600);font-size:0.9rem;margin-bottom:24px;">Registra pesos de pallets y finaliza el despacho del viaje.</p>

          <!-- Select Voyage -->
          <div class="form-group" style="max-width:480px;margin-bottom:24px;">
            <label class="form-label" for="viaje-desp-sel">Seleccionar Viaje Preparado / Cargado</label>
            <select id="viaje-desp-sel" class="form-control"
              value={selectedViajeDespacho?.id || ''}
              on:change={(e) => {
                const val = e.target.value;
                if (!val) { selectDespachoVoyage(null); return; }
                const v = viajes.find(x => x.id === parseInt(val));
                selectDespachoVoyage(v || null);
              }}>
              <option value="">-- Selecciona un Viaje --</option>
              {#each viajes.filter(v => v.estado === 'Preparado' || v.estado === 'Cargado') as v}
                <option value={v.id}>{v.codigo_viaje} [{v.estado}] — {v.cultivo} — {v.cliente?.razon_social}</option>
              {/each}
            </select>
          </div>

          {#if selectedViajeDespacho}
            <!-- Info Banner -->
            <div style="background:var(--gray-100);padding:16px;border-radius:var(--radius-sm);margin-bottom:24px;font-size:0.9rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <h4 style="font-weight:700;color:var(--primary);">{selectedViajeDespacho.codigo_viaje}</h4>
                <div style="display:flex;gap:6px;align-items:center;">
                  <span class="badge badge-{selectedViajeDespacho.estado.toLowerCase()}">{selectedViajeDespacho.estado}</span>
                  {#if selectedViajeDespacho.estado === 'Preparado'}
                    <button class="btn btn-ghost" style="padding:4px 12px;font-size:0.78rem;color:var(--danger);border-color:var(--danger);" on:click={devolverAFrio}>
                      ↩ Devolver a Cadena de Frío
                    </button>
                  {/if}
                </div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
                <div><strong>Cliente:</strong> {selectedViajeDespacho.cliente?.razon_social}</div>
                <div><strong>RUC:</strong> {selectedViajeDespacho.cliente?.ruc}</div>
                <div><strong>Cultivo:</strong> {selectedViajeDespacho.cultivo}</div>
                <div><strong>Variedades:</strong> {parseVariedades(selectedViajeDespacho.variedades).join(', ')}</div>
                <div><strong>Origen:</strong> {selectedViajeDespacho.origen_despacho}</div>
              </div>
            </div>

            <!-- STEP 1: PALLET WEIGHTS -->
            {#if selectedViajeDespacho.estado === 'Preparado' && despachoStep === 1}
              <h3 style="font-weight:700;font-size:1.05rem;margin-bottom:16px;color:var(--primary);">Paso 1: Control de Pesos por Pallet</h3>
              <p style="font-size:0.85rem;color:var(--gray-600);margin-bottom:16px;">
                Los registros de cadena de frío están agrupados por número de pallet. Ingresa el peso bruto y la tara para cada pallet físico.
              </p>

              {#if despachoPalletsGrupos.length === 0}
                <div style="text-align:center;padding:32px;color:var(--gray-600);">Cargando pallets...</div>
              {:else}
                <div class="custom-table-container">
                  <table class="custom-table">
                    <thead>
                      <tr>
                        <th>Pallet</th>
                        <th>Variedades</th>
                        <th>Cantidad Total</th>
                        <th>UM</th>
                        <th>Peso Prod. Total</th>
                        <th style="width:130px;">Peso Bruto (kg)</th>
                        <th style="width:110px;">Tara (kg)</th>
                        <th>Peso Desp. (kg)</th>
                        <th>% Desviación</th>
                        <th style="text-align:right;">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each despachoPalletsGrupos as g, idx}
                        {@const isAlert = parseFloat(g.desviacion) > 3.0}
                        <tr class="{g.isLocked ? 'row-locked' : ''} {isAlert && g.peso_despacho > 0 && !g.isLocked ? 'row-alert' : ''}">
                          <td style="font-weight:700;font-size:1rem;">{g.numero_pallet}</td>
                          <td>
                            <div class="variedad-chips">
                              {#each (g.variedades || []) as var_}
                                <span class="variedad-chip">{var_}</span>
                              {/each}
                            </div>
                          </td>
                          <td style="font-weight:600;">{formatDecimal(g.cantidad_total)}</td>
                          <td><span class="info-tag">{g.unidad_medida}</span></td>
                          <td>{formatDecimal(g.peso_produccion_total)}</td>
                          <td>
                            <input type="number" step="0.01" class="form-control" style="padding:6px;"
                              bind:value={g.peso_bruto}
                              on:input={() => calculateGrupoMetrics(idx)}
                              disabled={g.isLocked || despachoSavingPallet === g.numero_pallet} />
                          </td>
                          <td>
                            <input type="number" step="0.01" class="form-control" style="padding:6px;"
                              bind:value={g.peso_tara}
                              on:input={() => calculateGrupoMetrics(idx)}
                              disabled={g.isLocked || despachoSavingPallet === g.numero_pallet} />
                          </td>
                          <td style="font-weight:600;">{g.peso_despacho > 0 ? formatDecimal(g.peso_despacho) : '-'}</td>
                          <td>
                            {#if g.peso_despacho > 0}
                              {@const dVal = parseFloat(g.desviacion)}
                              {@const absDev = Math.abs(dVal)}
                              {@const isAlert = absDev > 3.0}
                              <span class="badge {isAlert ? 'alert-pulse' : ''}" style="background:{isAlert ? (dVal > 0 ? '#FEF3C7' : '#FEE2E2') : '#D1FAE5'};color:{isAlert ? (dVal > 0 ? '#D97706' : '#991B1B') : '#065F46'};font-weight:700;">
                                {#if dVal > 0}
                                  ⬆ +{dVal.toFixed(1)}%
                                {:else if dVal < 0}
                                  ⬇ {dVal.toFixed(1)}%
                                {:else}
                                  ✓ 0.0%
                                {/if}
                              </span>
                            {:else}
                              -
                            {/if}
                          </td>
                          <td style="text-align:right;">
                            {#if g.isLocked}
                              <button class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;"
                                on:click={() => { despachoPalletsGrupos[idx].isLocked = false; despachoPalletsGrupos = [...despachoPalletsGrupos]; }}>
                                Editar
                              </button>
                            {:else}
                              <button class="btn btn-secondary" style="padding:5px 10px;font-size:0.75rem;"
                                disabled={despachoSavingPallet === g.numero_pallet}
                                on:click={() => saveGrupoDespacho(idx)}>
                                {despachoSavingPallet === g.numero_pallet ? '...' : 'Guardar'}
                              </button>
                            {/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>

                {#if despachoError}
                  <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-top:16px;font-size:0.85rem;">{despachoError}</div>
                {/if}

                <div style="margin-top:24px;display:flex;justify-content:flex-end;">
                  <button class="btn btn-primary" on:click={finalizarCarga} disabled={finalizingLoading}>
                    {finalizingLoading ? 'Finalizando...' : 'Finalizar Carga (Marcar como Cargado)'}
                  </button>
                </div>
              {/if}

            <!-- STEP 2: DISPATCH DETAILS -->
            {:else if selectedViajeDespacho.estado === 'Cargado' || despachoStep === 2}
              <h3 style="font-weight:700;font-size:1.05rem;margin-bottom:16px;color:var(--primary);">Paso 2: Registro Final de Guía y Conductor</h3>

              <div style="max-width:700px;">
                <div class="modal-grid">
                  <div class="form-group">
                    <label class="form-label" for="guia">Guía de Remisión *</label>
                    <input type="text" id="guia" class="form-control" bind:value={voyageDispatchForm.guia_remision} placeholder="EG01-00045612" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="conductor">Nombre del Conductor *</label>
                    <input type="text" id="conductor" class="form-control" bind:value={voyageDispatchForm.conductor_nombre} placeholder="Juan Pérez Quispe" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="licencia">Licencia de Conducir *</label>
                    <input type="text" id="licencia" class="form-control" bind:value={voyageDispatchForm.conductor_licencia} placeholder="Q12345678" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="placa">Placa del Vehículo *</label>
                    <input type="text" id="placa" class="form-control" bind:value={voyageDispatchForm.conductor_placa} placeholder="T5D-890" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="resp-desp">Responsable de Despacho</label>
                    <select id="resp-desp" class="form-control" bind:value={voyageDispatchForm.responsable_despacho_id}>
                      <option value="">-- Sin asignar --</option>
                      {#each responsablesDespacho as r}
                        <option value={r.id.toString()}>{r.nombre} (DNI: {r.dni})</option>
                      {/each}
                    </select>
                  </div>
                  <div class="form-group">
                    <label class="form-label" for="area-resp">Área Responsable</label>
                    <input type="text" id="area-resp" class="form-control" bind:value={voyageDispatchForm.area_responsable} placeholder="CÁMARAS Y DESPACHOS FRESCOS" />
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="observaciones">Observaciones</label>
                  <textarea id="observaciones" class="form-control" rows="3" bind:value={voyageDispatchForm.observaciones} placeholder="Observaciones del despacho..."></textarea>
                </div>
              </div>

              {#if despachoError}
                <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{despachoError}</div>
              {/if}

              <div style="display:flex;gap:12px;align-items:center;">
                <button class="btn btn-secondary" on:click={finalizarDespacho}>✓ Finalizar Despacho (Cerrar Viaje)</button>
                {#if despachoStep === 2 && selectedViajeDespacho.estado !== 'Cargado'}
                  <button class="btn btn-ghost" on:click={() => despachoStep = 1}>← Atrás a Pallets</button>
                {/if}
              </div>

              <!-- Summary of pallets -->
              {#if despachoPalletsGrupos.length > 0}
                <hr style="margin:28px 0 20px 0;border:0;border-top:1px dashed var(--gray-300);" />
                <h4 style="font-weight:700;margin-bottom:12px;color:var(--primary);">Resumen de Pallets Cargados</h4>
                <div class="custom-table-container">
                  <table class="custom-table">
                    <thead>
                      <tr>
                        <th>Pallet</th><th>Variedades</th><th>Cantidad Total</th><th>UM</th>
                        <th>Peso Prod. (kg)</th><th>Peso Bruto (kg)</th><th>Tara (kg)</th>
                        <th>Peso Desp. (kg)</th><th>% Desviación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each despachoPalletsGrupos as g}
                        {@const isAlert = parseFloat(g.desviacion) > 3.0}
                        <tr class="row-locked" style={isAlert ? 'background:rgba(239,68,68,0.05)!important;' : ''}>
                          <td style="font-weight:700;">{g.numero_pallet}</td>
                          <td><div class="variedad-chips">{#each (g.variedades || []) as v_}<span class="variedad-chip">{v_}</span>{/each}</div></td>
                          <td>{formatDecimal(g.cantidad_total)}</td>
                          <td><span class="info-tag">{g.unidad_medida}</span></td>
                          <td>{formatDecimal(g.peso_produccion_total)}</td>
                          <td>{formatDecimal(g.peso_bruto)}</td>
                          <td>{formatDecimal(g.peso_tara)}</td>
                          <td style="font-weight:600;">{formatDecimal(g.peso_despacho)}</td>
                          <td>
                            {#if g.peso_despacho > 0}
                              <span class="badge" style="background:{isAlert ? 'var(--danger)' : 'var(--success)'};color:white;">
                                {g.desviacion}% {isAlert ? '⚠️' : ''}
                              </span>
                            {:else}-{/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {/if}
          {/if}
        </div>

      <!-- ══ VALES DE SALIDA ════════════════════════════════════════════════════ -->
      {:else if view === 'vales'}
        <div class="card animate-fade-in">
          <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);margin-bottom:8px;">Vales de Salida</h2>
          <p style="color:var(--gray-600);font-size:0.9rem;margin-bottom:24px;">Genera e imprime vales de salida en formato A4 para viajes finalizados.</p>

          <div class="custom-table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Viaje</th><th>Cultivo / Variedades</th><th>Cliente</th>
                  <th>Fecha Despacho</th><th>Guía de Remisión</th><th>Conductor</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {#if viajes.filter(v => v.estado === 'Finalizado').length === 0}
                  <tr><td colspan="7" style="text-align:center;color:var(--gray-600);padding:32px;">No hay viajes finalizados aún.</td></tr>
                {:else}
                  {#each viajes.filter(v => v.estado === 'Finalizado') as viaje}
                    <tr>
                      <td style="font-weight:700;color:var(--primary);">{viaje.codigo_viaje}</td>
                      <td>
                        <div style="font-weight:600;">{viaje.cultivo}</div>
                        <div class="variedad-chips" style="margin-top:4px;">
                          {#each parseVariedades(viaje.variedades) as v_}
                            <span class="variedad-chip">{v_}</span>
                          {/each}
                        </div>
                      </td>
                      <td>{viaje.cliente?.razon_social}</td>
                      <td>{formatDateReadable(viaje.fecha_hora_despacho)}</td>
                      <td>{viaje.guia_remision || '-'}</td>
                      <td>{viaje.conductor_nombre || '-'}</td>
                      <td>
                        <button class="btn btn-primary" style="padding:7px 16px;font-size:0.85rem;" on:click={() => imprimirVale(viaje)}>
                          🖨 Imprimir Vale
                        </button>
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>

      <!-- ══ MAESTROS (ADMIN) ══════════════════════════════════════════════════ -->
      {:else if view === 'maestros'}
        <div class="card animate-fade-in">
          <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);margin-bottom:20px;">Tablas Maestras</h2>
          <div style="display:flex;gap:8px;margin-bottom:24px;">
            {#if currentUser?.role === 'Administrador'}
              <button class="variedad-tab-btn {maestroView === 'cultivos' ? 'active' : ''}" on:click={() => maestroView = 'cultivos'}>Cultivos y Variedades</button>
              <button class="variedad-tab-btn {maestroView === 'usuarios' ? 'active' : ''}" on:click={() => maestroView = 'usuarios'}>Usuarios del Sistema</button>
              <button class="variedad-tab-btn {maestroView === 'unidades' ? 'active' : ''}" on:click={() => maestroView = 'unidades'}>Unidades de Medida</button>
            {/if}
            {#if currentUser?.role === 'Administrador' || currentUser?.role === 'Despacho'}
              <button class="variedad-tab-btn {maestroView === 'responsables' ? 'active' : ''}" on:click={() => { maestroView = 'responsables'; fetchResponsablesDespacho(true); }}>Responsables de Despacho</button>
            {/if}
          </div>

          {#if maestroView === 'cultivos'}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h3 style="font-weight:700;font-size:1.1rem;">Gestión de Cultivos y Variedades</h3>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.85rem;" on:click={fetchCultivos}>🔄 Actualizar</button>
                <button class="btn btn-primary" on:click={() => { cultivoForm = { nombre:'' }; cultivoError=''; showCultivoModal=true; }}>+ Crear Cultivo</button>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:20px;margin-top:16px;">
              {#each cultivosList as c}
                <div class="card" style="margin:0;background:var(--light);border:1px solid var(--gray-200);padding:20px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <h4 style="font-weight:700;font-size:1.1rem;color:var(--primary);">{c.nombre}</h4>
                      <span class="badge" style="background:{c.activo ? '#D1FAE5' : '#FEE2E2'};color:{c.activo ? '#065F46' : '#991B1B'};">
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </div>
                    <button class="btn btn-ghost" style="padding:4px 8px;font-size:0.75rem;" on:click={() => toggleCultivo(c)}>
                      {c.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>

                  <div style="margin-bottom:12px;">
                    <span style="font-size:0.8rem;font-weight:600;color:var(--gray-600);">Variedades ({c.variedades?.length || 0}):</span>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
                      {#if !c.variedades || c.variedades.length === 0}
                        <span style="font-size:0.8rem;color:var(--gray-600);font-style:italic;">Sin variedades asociadas</span>
                      {:else}
                        {#each c.variedades as v}
                          <span
                            class="variedad-chip"
                            style="background:{v.activo ? '#DBEAFE' : '#F3F4F6'};color:{v.activo ? '#1E40AF' : '#9CA3AF'};cursor:pointer;"
                            on:click={() => toggleVariedad(v)}
                            title="Haz clic para activar/desactivar"
                          >
                            {v.nombre} {v.activo ? '✓' : '✕'}
                          </span>
                        {/each}
                      {/if}
                    </div>
                  </div>

                  <button
                    class="btn btn-ghost"
                    style="width:100%;font-size:0.8rem;padding:6px;margin-top:8px;border:1px dashed var(--gray-300);"
                    on:click={() => { selectedCultivoForVar = c; variedadForm = { nombre: '' }; variedadError = ''; showVariedadModal = true; }}
                  >
                    + Agregar Variedad
                  </button>
                </div>
              {/each}
            </div>

          {:else if maestroView === 'usuarios'}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h3 style="font-weight:700;font-size:1.1rem;">Usuarios del Sistema</h3>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.85rem;" on:click={fetchUsuarios}>🔄 Actualizar</button>
                <button class="btn btn-primary" on:click={() => { userForm = { email:'', password:'', nombre:'', role:'Planificador' }; userError=''; showUserModal=true; }}>+ Crear Usuario</button>
              </div>
            </div>
            <div class="custom-table-container">
              <table class="custom-table">
                <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado Clave</th><th style="text-align:right;">Acciones</th></tr></thead>
                <tbody>
                  {#if usuariosList.length === 0}
                    <tr><td colspan="5" style="text-align:center;color:var(--gray-600);padding:32px;">Cargando usuarios...</td></tr>
                  {:else}
                    {#each usuariosList as u}
                    <tr>
                      <td style="font-weight:600;">{u.nombre}</td>
                      <td>{u.email}</td>
                      <td><span class="badge" style="background:#DBEAFE;color:#1E40AF;">{u.role}</span></td>
                      <td>
                        <span class="badge" style="background:{u.requiere_cambio_clave ? '#FEF3C7' : '#D1FAE5'};color:{u.requiere_cambio_clave ? '#D97706' : '#065F46'};">
                          {u.requiere_cambio_clave ? 'Pendiente 🔒' : 'Activo ✓'}
                        </span>
                      </td>
                      <td style="text-align:right;">
                        {#if u.id !== currentUser?.id}
                          <button class="btn btn-danger" style="padding:5px 12px;font-size:0.8rem;" on:click={() => deleteUser(u)}>
                            Eliminar
                          </button>
                        {:else}
                          <span style="font-size:0.75rem;color:var(--gray-600);font-style:italic;">Tu cuenta</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {/if}
                </tbody>
              </table>
            </div>

          {:else if maestroView === 'unidades'}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h3 style="font-weight:700;font-size:1.1rem;">Unidades de Medida</h3>
              <button class="btn btn-primary" on:click={() => { umForm = { codigo:'', descripcion:'' }; umError=''; showUMModal=true; }}>+ Nueva Unidad</button>
            </div>
            <div class="custom-table-container">
              <table class="custom-table">
                <thead><tr><th>Código</th><th>Descripción</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
                <tbody>
                  {#each unidadesMedida as um}
                    <tr>
                      <td style="font-weight:700;">{um.codigo}</td>
                      <td>{um.descripcion}</td>
                      <td>
                        <span class="badge" style="background:{um.activo ? '#D1FAE5' : '#F3F4F6'};color:{um.activo ? '#065F46' : '#6B7280'};">
                          {um.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td style="text-align:right;">
                        <button class="btn btn-ghost" style="padding:5px 12px;font-size:0.8rem;" on:click={() => toggleUMActivo(um)}>
                          {um.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

          {:else if maestroView === 'responsables'}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
              <h3 style="font-weight:700;font-size:1.1rem;">Responsables de Despacho</h3>
              <button class="btn btn-primary" on:click={openNewRespModal}>+ Nuevo Responsable</button>
            </div>
            <div class="custom-table-container">
              <table class="custom-table">
                <thead><tr><th>Nombre</th><th>DNI</th><th>Estado</th><th style="text-align:right;">Acciones</th></tr></thead>
                <tbody>
                  {#each responsablesDespacho as r}
                    <tr>
                      <td style="font-weight:600;">{r.nombre}</td>
                      <td>{r.dni}</td>
                      <td>
                        <span class="badge" style="background:{r.activo ? '#D1FAE5' : '#F3F4F6'};color:{r.activo ? '#065F46' : '#6B7280'};">
                          {r.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td style="text-align:right;">
                        <button class="btn btn-ghost" style="padding:5px 12px;font-size:0.8rem;margin-right:4px;" on:click={() => openEditRespModal(r)}>
                          Editar
                        </button>
                        <button class="btn btn-ghost" style="padding:5px 12px;font-size:0.8rem;" on:click={() => toggleRespActivo(r)}>
                          {r.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

      <!-- ══ REPORTES ══════════════════════════════════════════════════════════ -->
      {:else if view === 'reportes'}
        <div class="card animate-fade-in">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:16px;">
            <div>
              <h2 style="font-weight:800;font-size:1.5rem;color:var(--primary);">Módulo de Reportes de Carga y Despacho</h2>
              <p style="color:var(--gray-600);font-size:0.9rem;">Consulta de pallets, datos de Cadena de Frío y registro final de pesaje por Despacho</p>
            </div>
            {#if reportHasQueried && ((reportTab === 'resumen' && reportResumenData.length > 0) || (reportTab === 'detalle' && reportDetalleData.length > 0))}
              <button class="btn btn-primary" style="background:#059669;border-color:#059669;" on:click={exportarReporteXLSX}>
                📥 Exportar a Excel (.xlsx)
              </button>
            {/if}
          </div>

          <!-- Filtros bajo demanda -->
          <div class="card" style="background:var(--light);border:1px solid var(--gray-200);padding:20px;margin-bottom:24px;">
            <div style="font-weight:700;font-size:0.95rem;margin-bottom:12px;color:var(--primary);">🔍 Filtros de Consulta</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:16px;align-items:end;">
              <div class="form-group" style="margin:0;">
                <label class="form-label" for="rep-f-inicio">Fecha Inicio</label>
                <input type="date" id="rep-f-inicio" class="form-control" bind:value={reportFilter.fecha_inicio} />
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label" for="rep-f-fin">Fecha Fin</label>
                <input type="date" id="rep-f-fin" class="form-control" bind:value={reportFilter.fecha_fin} />
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label" for="rep-cli">Cliente</label>
                <select id="rep-cli" class="form-control" bind:value={reportFilter.cliente_id}>
                  <option value="">-- Todos los Clientes --</option>
                  {#each clientes as c}
                    <option value={c.id}>{c.razon_social}</option>
                  {/each}
                </select>
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label" for="rep-cod">Código de Viaje</label>
                <input type="text" id="rep-cod" class="form-control" bind:value={reportFilter.codigo_viaje} placeholder="ej. A26-025" />
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary" style="width:100%;height:40px;" on:click={fetchReporte} disabled={reportLoading}>
                  {reportLoading ? '⏳ Cargando...' : '🔍 Consultar Reporte'}
                </button>
              </div>
            </div>
          </div>

          <!-- Selector de Vista del Reporte -->
          <div style="display:flex;gap:8px;margin-bottom:20px;border-bottom:1px solid var(--gray-200);padding-bottom:12px;">
            <button class="variedad-tab-btn {reportTab === 'resumen' ? 'active' : ''}" on:click={() => reportTab = 'resumen'}>
              📊 Resumen por pallet
            </button>
            <button class="variedad-tab-btn {reportTab === 'detalle' ? 'active' : ''}" on:click={() => reportTab = 'detalle'}>
              📋 Detalle de pallets
            </button>
          </div>

          {#if !reportHasQueried}
            <div style="text-align:center;padding:48px 16px;color:var(--gray-600);background:var(--light);border-radius:var(--radius-md);border:1px dashed var(--gray-300);">
              <div style="font-size:2rem;margin-bottom:8px;">🔎</div>
              <div style="font-weight:700;font-size:1.1rem;margin-bottom:4px;color:var(--primary);">Consulta Bajo Demanda</div>
              <p style="font-size:0.9rem;">Ingresa los filtros requeridos en la sección superior y presiona <strong>Consultar Reporte</strong> para visualizar la información.</p>
            </div>
          {:else if reportLoading}
            <div style="text-align:center;padding:48px;color:var(--primary);font-weight:700;">
              ⏳ Obteniendo registros desde el servidor...
            </div>
          {:else}
            <!-- RESUMEN POR PALLET -->
            {#if reportTab === 'resumen'}
              {#if reportResumenData.length === 0}
                <div style="text-align:center;color:var(--gray-600);padding:32px;">No se encontraron registros de pallets para los filtros seleccionados.</div>
              {:else}
                <div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-600);">
                  Mostrando <strong>{reportResumenData.length}</strong> pallets agrupados.
                </div>
                <div class="custom-table-container">
                  <table class="custom-table">
                    <thead>
                      <tr>
                        <th>Viaje</th>
                        <th>Fecha Despacho</th>
                        <th>Cliente</th>
                        <th>N° Pallet</th>
                        <th>Variedades</th>
                        <th>Cantidad Total</th>
                        <th>Peso Prod. (kg)</th>
                        <th>Bruto (kg)</th>
                        <th>Tara (kg)</th>
                        <th>Peso Despacho (kg)</th>
                        <th>Desviación</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each reportResumenData as r}
                        <tr>
                          <td style="font-weight:700;color:var(--primary);">{r.codigo_viaje}</td>
                          <td>{formatDateTimeReadable(r.fecha_hora_despacho)}</td>
                          <td style="font-size:0.85rem;font-weight:600;">{r.cliente_nombre || '-'}</td>
                          <td style="font-weight:700;text-align:center;">Pallet {r.numero_pallet}</td>
                          <td>
                            <div class="variedad-chips">
                              {#each (Array.isArray(r.variedades) ? r.variedades : [r.variedades]) as v_}
                                <span class="variedad-chip">{v_}</span>
                              {/each}
                            </div>
                          </td>
                          <td style="font-weight:600;">{parseFloat(r.cantidad_total || 0).toLocaleString('es-PE')} {r.unidad_medida || ''}</td>
                          <td style="font-weight:600;">{parseFloat(r.peso_produccion_total || 0).toLocaleString('es-PE', {minimumFractionDigits:3})} kg</td>
                          <td>{r.peso_bruto !== null && r.peso_bruto !== undefined ? parseFloat(r.peso_bruto).toFixed(3) : '-'}</td>
                          <td>{r.peso_tara !== null && r.peso_tara !== undefined ? parseFloat(r.peso_tara).toFixed(3) : '-'}</td>
                          <td style="font-weight:700;color:var(--primary);">{r.peso_despacho !== null && r.peso_despacho !== undefined ? parseFloat(r.peso_despacho).toFixed(3) : '-'}</td>
                          <td>
                            {#if r.desviacion !== null && r.desviacion !== undefined}
                              {@const dVal = parseFloat(r.desviacion)}
                              {@const absDev = Math.abs(dVal)}
                              {@const isAlert = absDev > 5.0}
                              <span class="badge" style="background:{isAlert ? (dVal > 0 ? '#FEF3C7' : '#FEE2E2') : '#D1FAE5'};color:{isAlert ? (dVal > 0 ? '#D97706' : '#991B1B') : '#065F46'};font-weight:700;">
                                {#if dVal > 0}
                                  ⬆ +{dVal.toFixed(1)}%
                                {:else if dVal < 0}
                                  ⬇ {dVal.toFixed(1)}%
                                {:else}
                                  ✓ 0.0%
                                {/if}
                              </span>
                            {:else}
                              -
                            {/if}
                          </td>
                          <td><span class="badge badge-{String(r.estado).toLowerCase()}">{r.estado}</span></td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}

            <!-- DETALLE COMPLETO -->
            {:else if reportTab === 'detalle'}
              {#if reportDetalleData.length === 0}
                <div style="text-align:center;color:var(--gray-600);padding:32px;">No se encontraron detalles de pallets para los filtros seleccionados.</div>
              {:else}
                <div style="margin-bottom:12px;font-size:0.85rem;color:var(--gray-600);">
                  Mostrando <strong>{reportDetalleData.length}</strong> líneas detalladas de Cadena de Frío.
                </div>
                <div class="custom-table-container">
                  <table class="custom-table">
                    <thead>
                      <tr>
                        <th>Viaje</th>
                        <th>Fecha Despacho</th>
                        <th>Cliente</th>
                        <th>N° Pallet</th>
                        <th>Código Pallet</th>
                        <th>Variedad</th>
                        <th>Fecha Cosecha</th>
                        <th>Procedencia</th>
                        <th>Cantidad</th>
                        <th>Peso Prod. (kg)</th>
                        <th>Precinto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each reportDetalleData as r}
                        <tr>
                          <td style="font-weight:700;color:var(--primary);">{r.codigo_viaje}</td>
                          <td>{formatDateTimeReadable(r.fecha_hora_despacho)}</td>
                          <td style="font-size:0.85rem;font-weight:600;">{r.cliente_nombre || '-'}</td>
                          <td style="font-weight:700;text-align:center;">Pallet {r.numero_pallet}</td>
                          <td><span class="info-tag">{r.codigo_pallet || '-'}</span></td>
                          <td><strong>{r.variedad}</strong></td>
                          <td>{r.fecha_cosecha ? formatDateReadable(r.fecha_cosecha) : '-'}</td>
                          <td>{r.procedencia || '-'}</td>
                          <td style="font-weight:600;">{parseFloat(r.cantidad || 0).toLocaleString('es-PE')} {r.unidad_medida || ''}</td>
                          <td style="font-weight:600;">{parseFloat(r.peso_produccion || 0).toLocaleString('es-PE', {minimumFractionDigits:3})} kg</td>
                          <td>{r.precinto || '-'}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}

    </main>
  </div>
{/if}

<!-- ══ MODAL: Nuevo Viaje (Planificador) ════════════════════════════════════ -->
{#if showVoyageModal}
  <div class="modal-overlay">
    <div class="modal-content animate-fade-in" style="max-width:680px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.3rem;color:var(--primary);">{isEditing ? 'Editar Viaje Programado' : 'Programar Nuevo Viaje'}</h3>
        <button class="btn btn-ghost" on:click={() => showVoyageModal = false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      <form on:submit|preventDefault={submitVoyage}>
        <div class="modal-grid">
          <div class="form-group">
            <label class="form-label" for="cod-viaje">Código de Viaje</label>
            <input type="text" id="cod-viaje" class="form-control" bind:value={voyageForm.codigo_viaje} required placeholder="ej. A26-025" />
          </div>
          <div class="form-group">
            <label class="form-label" for="origen-fruta">Origen de Fruta</label>
            <select id="origen-fruta" class="form-control" bind:value={voyageForm.origen_fruta}>
              {#each orígenesFruta as o}<option value={o}>{o}</option>{/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="cultivo-sel">Cultivo</label>
            <select id="cultivo-sel" class="form-control" bind:value={voyageForm.cultivo}>
              {#each Object.keys(cultivosData) as c}<option value={c}>{c}</option>{/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Variedades (selección múltiple) *</label>
            <div style="border:1px solid var(--gray-300);border-radius:var(--radius-sm);padding:10px;background:white;display:flex;flex-wrap:wrap;gap:8px;">
              {#each cultivosData[voyageForm.cultivo] || [] as var_}
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:4px 10px;border-radius:9999px;border:1.5px solid {voyageForm.variedades.includes(var_) ? 'var(--primary)' : 'var(--gray-300)'};background:{voyageForm.variedades.includes(var_) ? 'var(--primary)' : 'white'};color:{voyageForm.variedades.includes(var_) ? 'white' : 'var(--dark)'};font-size:0.85rem;font-weight:600;transition:var(--transition);">
                  <input type="checkbox" bind:group={voyageForm.variedades} value={var_} style="display:none;" />
                  {var_}
                </label>
              {/each}
            </div>
            {#if voyageForm.variedades.length === 0}
              <p style="color:var(--danger);font-size:0.78rem;margin-top:4px;">Selecciona al menos una variedad</p>
            {:else}
              <p style="color:var(--gray-600);font-size:0.78rem;margin-top:4px;">Seleccionadas: {voyageForm.variedades.join(', ')}</p>
            {/if}
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <label class="form-label" for="cliente-sel" style="margin-bottom:0;">Cliente</label>
              <!-- svelte-ignore a11y-invalid-attribute -->
              <a href="javascript:void(0)" on:click|preventDefault={openNewClientModal} style="font-size:0.8rem;font-weight:600;color:var(--primary);text-decoration:none;">+ Nuevo Cliente</a>
            </div>
            <select id="cliente-sel" class="form-control" bind:value={voyageForm.cliente_id} required>
              {#each clientes as c}<option value={c.id.toString()}>{c.razon_social}</option>{/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="peso-plan">Peso Planificado (kg)</label>
            <input type="number" step="0.01" id="peso-plan" class="form-control" bind:value={voyageForm.peso} required placeholder="ej. 15000" />
          </div>
          <div class="form-group">
            <label class="form-label" for="fecha-desp">Fecha y Hora de Despacho</label>
            <input type="datetime-local" id="fecha-desp" class="form-control" bind:value={voyageForm.fecha_hora_despacho} required />
          </div>
          <div class="form-group">
            <label class="form-label" for="origen-despacho">Origen Despacho</label>
            <select id="origen-despacho" class="form-control" bind:value={voyageForm.origen_despacho}>
              {#each orígenesDespacho as od}<option value={od}>{od}</option>{/each}
            </select>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px;">
          <button type="button" class="btn btn-ghost" on:click={() => showVoyageModal = false}>Cancelar</button>
          <button type="submit" class="btn btn-primary" disabled={voyageForm.variedades.length === 0}>
            {isEditing ? 'Guardar Cambios' : 'Programar Viaje'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Nuevo Cliente ══════════════════════════════════════════════════ -->
{#if showClientModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:480px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.3rem;color:var(--primary);">Registrar Nuevo Cliente</h3>
        <button class="btn btn-ghost" on:click={() => showClientModal = false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      <form on:submit|preventDefault={submitClient}>
        {#if clientError}
          <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{clientError}</div>
        {/if}
        <div class="form-group">
          <label class="form-label" for="cli-razon">Razón Social</label>
          <input type="text" id="cli-razon" class="form-control" bind:value={clientForm.razon_social} required />
        </div>
        <div class="form-group">
          <label class="form-label" for="cli-ruc">RUC (11 dígitos)</label>
          <input type="text" id="cli-ruc" class="form-control" bind:value={clientForm.ruc} required maxlength="11" placeholder="20100018612" />
        </div>
        <div class="form-group">
          <label class="form-label" for="cli-dir">Dirección Fiscal</label>
          <input type="text" id="cli-dir" class="form-control" bind:value={clientForm.direccion} required />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:24px;">
          <button type="button" class="btn btn-ghost" on:click={() => showClientModal = false}>Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear Cliente</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Nueva Unidad de Medida ════════════════════════════════════════ -->
{#if showUMModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:400px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.2rem;color:var(--primary);">Nueva Unidad de Medida</h3>
        <button class="btn btn-ghost" on:click={() => showUMModal=false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      {#if umError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{umError}</div>
      {/if}
      <div class="form-group">
        <label class="form-label">Código (ej. TM, CAJA)</label>
        <input type="text" class="form-control" bind:value={umForm.codigo} placeholder="KG" style="text-transform:uppercase;" />
      </div>
      <div class="form-group">
        <label class="form-label">Descripción</label>
        <input type="text" class="form-control" bind:value={umForm.descripcion} placeholder="Kilogramos" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;">
        <button class="btn btn-ghost" on:click={() => showUMModal=false}>Cancelar</button>
        <button class="btn btn-primary" on:click={submitUM}>Crear</button>
      </div>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Responsable de Despacho ═════════════════════════════════════ -->
{#if showRespModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:440px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.2rem;color:var(--primary);">{editingRespId ? 'Editar Responsable de Despacho' : 'Nuevo Responsable de Despacho'}</h3>
        <button class="btn btn-ghost" on:click={() => showRespModal=false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      {#if respError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{respError}</div>
      {/if}
      <form on:submit|preventDefault={submitResp}>
        <div class="form-group">
          <label class="form-label" for="resp-nombre">Nombre y Apellidos *</label>
          <input type="text" id="resp-nombre" class="form-control" bind:value={respForm.nombre} required placeholder="Samuel Pacheco" />
        </div>
        <div class="form-group">
          <label class="form-label" for="resp-dni">DNI (8 dígitos) *</label>
          <input type="text" id="resp-dni" class="form-control" bind:value={respForm.dni} required placeholder="45231876" maxlength="8" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;">
          <button type="button" class="btn btn-ghost" on:click={() => showRespModal=false}>Cancelar</button>
          <button type="submit" class="btn btn-primary">{editingRespId ? 'Guardar Cambios' : 'Crear'}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Nuevo Usuario ═════════════════════════════════════════════════ -->
{#if showUserModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:440px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.2rem;color:var(--primary);">Nuevo Usuario del Sistema</h3>
        <button class="btn btn-ghost" on:click={() => showUserModal=false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      {#if userError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{userError}</div>
      {/if}
      <form on:submit|preventDefault={submitUser}>
        <div class="form-group">
          <label class="form-label" for="usr-nombre">Nombre y Apellidos *</label>
          <input type="text" id="usr-nombre" class="form-control" bind:value={userForm.nombre} required placeholder="Juan Pérez" />
        </div>
        <div class="form-group">
          <label class="form-label" for="usr-email">Correo Electrónico *</label>
          <input type="email" id="usr-email" class="form-control" bind:value={userForm.email} required placeholder="jperez@camposol.com" />
        </div>
        <div class="form-group">
          <label class="form-label" for="usr-role">Rol *</label>
          <select id="usr-role" class="form-control" bind:value={userForm.role} required>
            <option value="Planificador">Planificador</option>
            <option value="Cadena de frío">Cadena de frío</option>
            <option value="Despacho">Despacho</option>
            <option value="Administrador">Administrador</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="usr-pass">Contraseña *</label>
          <input type="password" id="usr-pass" class="form-control" bind:value={userForm.password} required placeholder="••••••••" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;">
          <button type="button" class="btn btn-ghost" on:click={() => showUserModal=false}>Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear Usuario</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Nuevo Cultivo ═════════════════════════════════════════════════ -->
{#if showCultivoModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:400px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.2rem;color:var(--primary);">Nuevo Cultivo</h3>
        <button class="btn btn-ghost" on:click={() => showCultivoModal=false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      {#if cultivoError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{cultivoError}</div>
      {/if}
      <form on:submit|preventDefault={submitCultivo}>
        <div class="form-group">
          <label class="form-label" for="cultivo-nombre">Nombre del Cultivo *</label>
          <input type="text" id="cultivo-nombre" class="form-control" bind:value={cultivoForm.nombre} required placeholder="ej. Cítricos" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;">
          <button type="button" class="btn btn-ghost" on:click={() => showCultivoModal=false}>Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear Cultivo</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ══ MODAL: Nueva Variedad ════════════════════════════════════════════════ -->
{#if showVariedadModal}
  <div class="modal-overlay" style="z-index:1050;">
    <div class="modal-content animate-fade-in" style="max-width:400px;">
      <div class="modal-header">
        <h3 style="font-weight:800;font-size:1.2rem;color:var(--primary);">Nueva Variedad para {selectedCultivoForVar?.nombre}</h3>
        <button class="btn btn-ghost" on:click={() => showVariedadModal=false} style="padding:4px 8px;font-size:0.8rem;">✕</button>
      </div>
      {#if variedadError}
        <div style="background:var(--danger-light);color:var(--danger);padding:10px 14px;border-radius:var(--radius-sm);margin-bottom:16px;font-size:0.85rem;">{variedadError}</div>
      {/if}
      <form on:submit|preventDefault={submitVariedad}>
        <div class="form-group">
          <label class="form-label" for="variedad-nombre">Nombre de la Variedad *</label>
          <input type="text" id="variedad-nombre" class="form-control" bind:value={variedadForm.nombre} required placeholder="ej. W. Murcott" />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px;">
          <button type="button" class="btn btn-ghost" on:click={() => showVariedadModal=false}>Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear Variedad</button>
        </div>
      </form>
    </div>
  </div>
{/if}
