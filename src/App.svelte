<script lang="ts">
  import { onMount } from 'svelte';

  // State Management
  let token = localStorage.getItem('token') || '';
  let currentUser = null;
  let view = 'calendar'; // 'calendar', 'planificador', 'frio', 'despacho'
  
  // Auth Form
  let email = '';
  let password = '';
  let authError = '';

  // Master Data Mock Lists
  const cultivosData = {
    'Arándano': ['Biloxi', 'Ventura', 'Emerald'],
    'Palta': ['Hass', 'Fuerte'],
    'Uva': ['Red Globe', 'Autumn Crisp', 'Sweet Globe'],
    'Mango': ['Kent', 'Edward']
  };
  const orígenesFruta = ['Fresco', 'Congelado', 'Proceso industrial'];
  const orígenesDespacho = ['Planta Chao', 'Planta Virú', 'Fundo Gloria', 'Fundo San José'];

  // Application Data
  let clientes = [];
  let viajes = [];
  let currentWeekStart = getStartOfWeek(new Date());

  // Planificador State
  let showVoyageModal = false;
  let isEditing = false;
  let editingId = null;
  let voyageForm = {
    codigo_viaje: '',
    cultivo: 'Arándano',
    variedad: 'Biloxi',
    origen_fruta: 'Fresco',
    cliente_id: '',
    peso: '',
    fecha_hora_despacho: '',
    fecha_cosecha: '',
    origen_despacho: 'Planta Chao'
  };

  // Master Clientes Creation State
  let showClientModal = false;
  let clientError = '';
  let clientForm = {
    razon_social: '',
    ruc: '',
    direccion: ''
  };

  // Cadena de Frío State
  let selectedViajeFrio = null;
  let excelPasteData = '';
  let parsedPallets = [];
  let pastePreview = false;
  let frioError = '';

  // Despacho State
  let selectedViajeDespacho = null;
  let despachoPallets = [];
  let despachoError = '';
  let despachoStep = 1; // 1 = Pallet weights, 2 = Voyage details
  let voyageDispatchForm = {
    guia_remision: '',
    conductor_nombre: '',
    conductor_licencia: '',
    conductor_placa: ''
  };

  // Notification helper
  let notification = { show: false, message: '', type: 'success' };
  function showNotification(message, type = 'success') {
    notification = { show: true, message, type };
    setTimeout(() => {
      notification.show = false;
    }, 4000);
  }

  // Get start of week (Monday)
  function getStartOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    const monday = new Date(date.setDate(diff));
    monday.setHours(0,0,0,0);
    return monday;
  }

  // Format date to readable string
  function formatDateReadable(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  // Navigation: Next / Prev Week
  function changeWeek(weeksOffset) {
    const nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + (weeksOffset * 7));
    currentWeekStart = nextWeek;
  }

  // Get week label (e.g. "Semana 26: 22/06 al 28/06")
  function getWeekLabel() {
    const start = new Date(currentWeekStart);
    const end = new Date(currentWeekStart);
    end.setDate(end.getDate() + 6);
    
    // Simple ISO week number calculation
    const d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);

    return `Semana ${weekNo} (${start.toLocaleDateString('es-ES', {day: '2-digit', month: '2-digit'})} al ${end.toLocaleDateString('es-ES', {day: '2-digit', month: '2-digit'})})`;
  }

  // Load User from token
  async function loadMe() {
    if (!token) return;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
      } else {
        logout();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Fetch Master Clientes
  async function fetchClientes() {
    try {
      const res = await fetch('/api/clientes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        clientes = await res.json();
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Fetch Viajes
  async function fetchViajes() {
    try {
      const res = await fetch('/api/viajes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        viajes = await res.json();
      }
    } catch (err) {
      console.error(err);
    }
  }

  onMount(async () => {
    if (token) {
      await loadMe();
      await fetchClientes();
      await fetchViajes();
    }
  });

  // Authentication: Login
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
        showNotification(`Bienvenido, ${currentUser.nombre}`);
      } else {
        authError = data.message || 'Error al iniciar sesión';
      }
    } catch (err) {
      authError = 'Error de conexión con el servidor';
    }
  }

  function logout() {
    token = '';
    currentUser = null;
    localStorage.removeItem('token');
    view = 'calendar';
  }

  // Planificador: Add / Edit Voyage submit
  async function submitVoyage() {
    try {
      const method = isEditing ? 'PUT' : 'POST';
      const url = isEditing ? `/api/viajes/${editingId}` : '/api/viajes';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(voyageForm)
      });
      
      const data = await res.json();
      if (res.ok) {
        showVoyageModal = false;
        fetchViajes();
        showNotification(isEditing ? 'Viaje actualizado exitosamente' : 'Viaje programado exitosamente');
      } else {
        showNotification(data.message || 'Error al guardar viaje', 'danger');
      }
    } catch (err) {
      showNotification('Error al conectar con el servidor', 'danger');
    }
  }

  // Master Clientes: Submit client creation
  async function submitClient() {
    clientError = '';
    
    // Validaciones básicas del lado del cliente
    if (!clientForm.razon_social.trim()) {
      clientError = 'La razón social es obligatoria';
      return;
    }
    if (!clientForm.ruc.trim() || clientForm.ruc.trim().length !== 11 || !/^\d+$/.test(clientForm.ruc.trim())) {
      clientError = 'El RUC debe tener exactamente 11 dígitos numéricos';
      return;
    }
    if (!clientForm.direccion.trim()) {
      clientError = 'La dirección es obligatoria';
      return;
    }

    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          razon_social: clientForm.razon_social.trim(),
          ruc: clientForm.ruc.trim(),
          direccion: clientForm.direccion.trim()
        })
      });

      const data = await res.json();
      if (res.ok) {
        showClientModal = false;
        await fetchClientes(); // Refresh list of clients
        showNotification('Cliente creado exitosamente');
        
        // Auto-select in voyage form if opened from within the Voyage form
        if (showVoyageModal) {
          voyageForm.cliente_id = data.id.toString();
        }
        
        // Reset form
        clientForm = { razon_social: '', ruc: '', direccion: '' };
      } else {
        clientError = data.message || 'Error al guardar el cliente';
      }
    } catch (err) {
      clientError = 'Error de conexión con el servidor';
    }
  }

  function openNewClientModal() {
    clientForm = {
      razon_social: '',
      ruc: '',
      direccion: ''
    };
    clientError = '';
    showClientModal = true;
  }

  function openNewVoyageModal() {
    isEditing = false;
    voyageForm = {
      codigo_viaje: '',
      cultivo: 'Arándano',
      variedad: 'Biloxi',
      origen_fruta: 'Fresco',
      cliente_id: clientes[0]?.id || '',
      peso: '',
      fecha_hora_despacho: '',
      fecha_cosecha: '',
      origen_despacho: 'Planta Chao'
    };
    showVoyageModal = true;
  }

  function openEditVoyageModal(viaje) {
    isEditing = true;
    editingId = viaje.id;
    
    // format datetime-local input string
    const date = new Date(viaje.fecha_hora_despacho);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    const datetimeStr = date.toISOString().slice(0, 16);

    voyageForm = {
      codigo_viaje: viaje.codigo_viaje,
      cultivo: viaje.cultivo,
      variedad: viaje.variedad,
      origen_fruta: viaje.origen_fruta,
      cliente_id: viaje.cliente_id.toString(),
      peso: viaje.peso.toString(),
      fecha_hora_despacho: datetimeStr,
      fecha_cosecha: viaje.fecha_cosecha.split('T')[0],
      origen_despacho: viaje.origen_despacho
    };
    showVoyageModal = true;
  }

  // Helper to parse DD/MM/YYYY, DD.MM.YYYY, or YYYY-MM-DD to YYYY-MM-DD
  function parseDateStringToISO(str) {
    if (!str) return '';
    str = str.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str;
    }
    const dmyMatch = str.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }
    try {
      const parsed = new Date(str);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    } catch (e) {}
    return str;
  }

  // Cadena de Frío: Parse Excel paste
  function processExcelPaste() {
    frioError = '';
    const text = excelPasteData.trim();
    if (!text) {
      frioError = 'Por favor pega contenido válido desde Excel';
      return;
    }

    const lines = text.split(/\r?\n/);
    const parsed = [];
    let startIdx = 0;
    
    // Check header
    const firstCols = lines[0].split('\t');
    const hasHeader = firstCols.some(col => 
      /fecha|producci|código|pallet|cultivo|variedad|jabas|peso|precinto/i.test(col)
    );
    if (hasHeader) startIdx = 1;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 6) continue;

      const fechaRaw = cols[0] ? cols[0].trim() : '';
      const fecha = parseDateStringToISO(fechaRaw);
      const code = cols[1] ? cols[1].trim() : '';
      const crop = cols[2] ? cols[2].trim() : '';
      const varName = cols[3] ? cols[3].trim() : '';
      const jabasVal = parseInt(cols[4] ? cols[4].trim() : '0');
      const pesoVal = parseFloat(cols[5] ? cols[5].trim().replace(',', '') : '0');
      const precintoVal = cols[6] ? cols[6].trim() : '';

      if (!fecha || !code || !crop || !varName || isNaN(jabasVal) || isNaN(pesoVal)) {
        frioError = `Error en fila ${i + 1}: Faltan campos obligatorios o formato inválido`;
        return;
      }

      parsed.push({
        fecha_produccion: fecha,
        codigo_pallet: code,
        cultivo: crop,
        variedad: varName,
        jabas: jabasVal,
        peso: pesoVal,
        precinto: precintoVal
      });
    }

    if (parsed.length === 0) {
      frioError = 'No se pudieron extraer registros válidos. Verifica el formato.';
      return;
    }

    parsedPallets = parsed;
    pastePreview = true;
  }

  // Cadena de Frío: Submit Pallets
  async function submitPalletsFrio() {
    try {
      const res = await fetch(`/api/viajes/${selectedViajeFrio.id}/pallets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ pallets: parsedPallets })
      });

      const data = await res.json();
      if (res.ok) {
        showNotification('Pallets registrados exitosamente. El viaje ahora está Preparado.');
        excelPasteData = '';
        parsedPallets = [];
        pastePreview = false;
        selectedViajeFrio = null;
        fetchViajes();
      } else {
        frioError = data.message || 'Error al guardar los pallets';
      }
    } catch (err) {
      frioError = 'Error de conexión con el servidor';
    }
  }

  // Despacho: Select Voyage and load pallets
  async function selectDespachoVoyage(viaje) {
    selectedViajeDespacho = viaje;
    despachoStep = 1;
    despachoError = '';
    try {
      const res = await fetch(`/api/viajes/${viaje.id}/pallets`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        despachoPallets = data.pallets.map(p => ({
          ...p,
          // Set default values if not already entered
          peso_bruto: p.peso_bruto || '',
          peso_tara: p.peso_tara || '',
          jabas_despacho: p.jabas_despacho !== null ? p.jabas_despacho : p.jabas_cf,
          peso_despacho: p.peso_despacho || 0,
          desviacion: p.desviacion || 0
        }));
      }
    } catch (err) {
      despachoError = 'Error al cargar pallets del viaje';
    }
  }

  // Despacho: Auto calculation on inputs
  function calculatePalletMetrics(index) {
    const p = despachoPallets[index];
    const bruto = parseFloat(p.peso_bruto);
    const tara = parseFloat(p.peso_tara);
    
    if (!isNaN(bruto) && !isNaN(tara)) {
      p.peso_despacho = parseFloat((bruto -    tara).toFixed(3));
      
      // Calculate deviation % against Cadena de Frío weight
      const diffAbs = Math.abs(p.peso_despacho - p.peso_cf);
      p.desviacion = parseFloat(((diffAbs / p.peso_cf) * 100).toFixed(2));
    } else {
      p.peso_despacho = 0;
      p.desviacion = 0;
    }
    
    despachoPallets = [...despachoPallets];
  }

  // Despacho: Save individual pallet weights
  async function savePalletDespacho(index) {
    const p = despachoPallets[index];
    if (!p.peso_bruto || !p.peso_tara) {
      showNotification('Peso bruto y tara son requeridos', 'danger');
      return;
    }
    try {
      const res = await fetch(`/api/pallets/${p.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          peso_bruto: p.peso_bruto,
          peso_tara: p.peso_tara,
          jabas_despacho: p.jabas_despacho
        })
      });
      if (res.ok) {
        showNotification(`Pallet ${p.codigo_pallet} guardado.`);
      } else {
        const data = await res.json();
        showNotification(data.message || 'Error al guardar pallet', 'danger');
      }
    } catch (err) {
      showNotification('Error de red al guardar pallet', 'danger');
    }
  }

  // Despacho: Finalize Loading
  async function finalizeLoading() {
    despachoError = '';
    // Validate all pallets are saved
    const invalid = despachoPallets.some(p => !p.peso_bruto || !p.peso_tara);
    if (invalid) {
      despachoError = 'Debe registrar peso bruto y tara para todos los pallets antes de finalizar la carga.';
      return;
    }

    try {
      // First save all pallets to be safe
      for (let i = 0; i < despachoPallets.length; i++) {
        await fetch(`/api/pallets/${despachoPallets[i].id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            peso_bruto: despachoPallets[i].peso_bruto,
            peso_tara: despachoPallets[i].peso_tara,
            jabas_despacho: despachoPallets[i].jabas_despacho
          })
        });
      }

      // Transition Voyage to 'Cargado'
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/finalizar-carga`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        showNotification('Carga finalizada. El viaje pasó a estado Cargado.');
        despachoStep = 2; // Proceed to step 2: driver details
        await fetchViajes();
        // Update selected voyage state in memory
        selectedViajeDespacho.estado = 'Cargado';
      } else {
        const data = await res.json();
        despachoError = data.message || 'Error al finalizar carga';
      }
    } catch (err) {
      despachoError = 'Error al finalizar carga';
    }
  }

  // Despacho: Finalize Voyage Dispatch
  async function finalizeDispatch() {
    despachoError = '';
    try {
      const res = await fetch(`/api/viajes/${selectedViajeDespacho.id}/finalizar-despacho`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(voyageDispatchForm)
      });
      const data = await res.json();
      if (res.ok) {
        showNotification('Despacho finalizado con éxito. El viaje está Finalizado.');
        selectedViajeDespacho = null;
        despachoPallets = [];
        voyageDispatchForm = { guia_remision: '', conductor_nombre: '', conductor_licencia: '', conductor_placa: '' };
        await fetchViajes();
      } else {
        despachoError = data.message || 'Error al finalizar despacho';
      }
    } catch (err) {
      despachoError = 'Error de conexión con el servidor';
    }
  }

  // Get voyages belonging to a specific day of current week
  function getVoyagesForDay(dayIndex, voyagesList, weekStart) {
    const dateOfIndex = new Date(weekStart);
    dateOfIndex.setDate(dateOfIndex.getDate() + dayIndex);
    const dateStr = dateOfIndex.toISOString().split('T')[0];
    
    return voyagesList.filter(v => v.fecha_hora_despacho.split('T')[0] === dateStr);
  }

  // Watch for crop change in Planificador to adjust varieties list
  $: if (voyageForm.cultivo) {
    const list = cultivosData[voyageForm.cultivo] || [];
    if (!list.includes(voyageForm.variedad)) {
      voyageForm.variedad = list[0] || '';
    }
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

  .logo-area {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-badge {
    background-color: var(--secondary);
    color: white;
    font-weight: 800;
    padding: 6px 12px;
    border-radius: var(--radius-sm);
    letter-spacing: 1px;
    font-size: 1.1rem;
  }

  .logo-text {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.5px;
  }

  .nav-tabs {
    display: flex;
    background: white;
    border-bottom: 1px solid var(--gray-200);
    padding: 0 32px;
    gap: 16px;
  }

  .nav-tab {
    padding: 16px 8px;
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--gray-600);
    cursor: pointer;
    border-bottom: 3px solid transparent;
    transition: var(--transition);
  }

  .nav-tab:hover {
    color: var(--primary);
  }

  .nav-tab.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }

  .main-content {
    flex: 1;
    padding: 32px;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
  }

  /* Login page styling */
  .login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--dark) 0%, var(--primary) 100%);
    padding: 20px;
  }

  .login-card {
    background: white;
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
    width: 100%;
    max-width: 420px;
    padding: 40px;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .login-header {
    text-align: center;
    margin-bottom: 32px;
  }

  .login-header h1 {
    font-size: 1.8rem;
    font-weight: 800;
    color: var(--primary);
  }

  /* Table styling */
  .custom-table-container {
    overflow-x: auto;
    border-radius: var(--radius-md);
    border: 1px solid var(--gray-200);
    margin-top: 16px;
    background: white;
  }

  .custom-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.9rem;
  }

  .custom-table th {
    background-color: var(--gray-100);
    padding: 14px 16px;
    font-weight: 600;
    color: var(--gray-600);
    border-bottom: 1px solid var(--gray-200);
  }

  .custom-table td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--gray-200);
  }

  .custom-table tr:hover {
    background-color: var(--light);
  }

  /* Toast Notification */
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 1000;
    padding: 14px 24px;
    border-radius: var(--radius-sm);
    color: white;
    font-weight: 600;
    box-shadow: var(--shadow-lg);
    display: flex;
    align-items: center;
    gap: 8px;
    animation: fadeIn 0.3s ease-out;
  }

  .toast-success { background-color: var(--success); }
  .toast-danger { background-color: var(--danger); }

  /* Modal structure */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
    padding: 20px;
  }

  .modal-content {
    background: white;
    border-radius: var(--radius-md);
    padding: 32px;
    width: 100%;
    max-width: 600px;
    box-shadow: var(--shadow-lg);
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

  .modal-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 640px) {
    .modal-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Helper tags */
  .info-tag {
    font-size: 0.8rem;
    color: var(--gray-600);
    background: var(--gray-100);
    padding: 2px 6px;
    border-radius: 4px;
  }
</style>

<!-- Toast Notification -->
{#if notification.show}
  <div class="toast toast-{notification.type}">
    <span>{notification.message}</span>
  </div>
{/if}

{#if !token}
  <!-- LOGIN SCREEN -->
  <div class="login-screen">
    <div class="login-card">
      <div class="login-header">
        <div style="display: flex; justify-content: center; margin-bottom: 12px;">
          <span class="logo-badge">CAMPOSOL</span>
        </div>
        <h1>Venta Nacional</h1>
        <p style="color: var(--gray-600); font-size: 0.9rem; margin-top: 4px;">Ingresa tus credenciales para acceder</p>
      </div>

      <form on:submit|preventDefault={handleLogin}>
        {#if authError}
          <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; font-weight: 500;">
            {authError}
          </div>
        {/if}

        <div class="form-group">
          <label class="form-label" for="email">Correo Electrónico</label>
          <input type="email" id="email" class="form-control" bind:value={email} required placeholder="ejemplo@camposol.com" />
        </div>

        <div class="form-group">
          <label class="form-label" for="password">Contraseña</label>
          <input type="password" id="password" class="form-control" bind:value={password} required placeholder="••••••••" />
        </div>

        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 16px; padding: 12px;">
          Iniciar Sesión
        </button>
      </form>

      <div style="margin-top: 24px; border-top: 1px solid var(--gray-200); padding-top: 16px; font-size: 0.75rem; color: var(--gray-600); text-align: center;">
        <p>Usuarios de prueba (Contraseña: <strong>camposol123</strong>):</p>
        <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; text-align: left; background: var(--gray-100); padding: 8px; border-radius: 4px;">
          <div>• Planificador: <code>planificador@camposol.com</code></div>
          <div>• Cadena de Frío: <code>frio@camposol.com</code></div>
          <div>• Despacho: <code>despacho@camposol.com</code></div>
        </div>
      </div>
    </div>
  </div>
{:else}
  <!-- APP CONTAINER -->
  <div class="app-container">
    <!-- Header -->
    <header class="app-header">
      <div class="logo-area">
        <span class="logo-badge">CAMPOSOL</span>
        <span class="logo-text">Venta Nacional</span>
      </div>

      <div style="display: flex; align-items: center; gap: 16px;">
        <div style="text-align: right; display: block;">
          <div style="font-weight: 600; font-size: 0.9rem;">{currentUser?.nombre}</div>
          <div style="font-size: 0.75rem; color: var(--secondary-light); font-weight: 600; text-transform: uppercase;">Rol: {currentUser?.role}</div>
        </div>
        <button class="btn btn-ghost" on:click={logout} style="padding: 6px 12px; font-size: 0.85rem;">
          Cerrar Sesión
        </button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="nav-tabs">
      <div class="nav-tab {view === 'calendar' ? 'active' : ''}" on:click={() => view = 'calendar'}>
        Calendario Semanal
      </div>
      {#if currentUser?.role === 'Planificador' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'planificador' ? 'active' : ''}" on:click={() => view = 'planificador'}>
          Planificador
        </div>
      {/if}
      {#if currentUser?.role === 'Cadena de frío' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'frio' ? 'active' : ''}" on:click={() => view = 'frio'}>
          Cadena de Frío
        </div>
      {/if}
      {#if currentUser?.role === 'Despacho' || currentUser?.role === 'Administrador'}
        <div class="nav-tab {view === 'despacho' ? 'active' : ''}" on:click={() => view = 'despacho'}>
          Despacho
        </div>
      {/if}
    </nav>

    <!-- Main Workspace -->
    <main class="main-content">
      
      <!-- VIEW: CALENDAR -->
      {#if view === 'calendar'}
        <div class="card animate-fade-in">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
            <div>
              <h2 style="font-weight: 800; font-size: 1.5rem; color: var(--primary);">Programa de Ventas Semanal</h2>
              <p style="color: var(--gray-600); font-size: 0.9rem;">Visualiza los despachos agendados para la semana</p>
            </div>
            
            <div style="display: flex; align-items: center; gap: 8px; background: var(--gray-100); padding: 6px; border-radius: var(--radius-sm);">
              <button class="btn btn-ghost" on:click={() => changeWeek(-1)} style="padding: 6px 12px; font-size: 0.85rem;">◀ Ant</button>
              <span style="font-weight: 700; font-size: 0.95rem; padding: 0 12px; min-width: 200px; text-align: center;">{getWeekLabel()}</span>
              <button class="btn btn-ghost" on:click={() => changeWeek(1)} style="padding: 6px 12px; font-size: 0.85rem;">Sig ▶</button>
            </div>
          </div>

          <!-- 7-Day Calendar Grid -->
          <div class="calendar-grid">
            {#each Array(7) as _, i}
              {@const dateForIndex = new Date(currentWeekStart)}
              {@const _void = dateForIndex.setDate(dateForIndex.getDate() + i)}
              {@const isToday = new Date().toDateString() === dateForIndex.toDateString()}
              {@const dayVoyages = getVoyagesForDay(i, viajes, currentWeekStart)}
              
              <div class="calendar-day-card">
                <div class="calendar-day-header {isToday ? 'today' : ''}">
                  <div>{dateForIndex.toLocaleDateString('es-ES', { weekday: 'long' })}</div>
                  <div style="font-size: 0.8rem; font-weight: normal; margin-top: 2px;">{dateForIndex.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</div>
                </div>
                
                <div class="calendar-day-body">
                  {#if dayVoyages.length === 0}
                    <div style="color: var(--gray-300); font-size: 0.75rem; text-align: center; margin-top: 16px;">Sin viajes</div>
                  {:else}
                    {#each dayVoyages as voyage}
                      <div class="calendar-voyage-item" on:click={() => {
                        if (currentUser?.role === 'Cadena de frío' && voyage.estado === 'Planificado') {
                          selectedViajeFrio = voyage;
                          view = 'frio';
                        } else if (currentUser?.role === 'Despacho' && (voyage.estado === 'Preparado' || voyage.estado === 'Cargado')) {
                          selectDespachoVoyage(voyage);
                          view = 'despacho';
                        } else {
                          showNotification(`Detalles: ${voyage.codigo_viaje} (${voyage.cultivo}) - Estado: ${voyage.estado}`);
                        }
                      }}>
                        <div style="font-weight: 700; color: var(--primary); display: flex; justify-content: space-between; align-items: center;">
                          <span>{voyage.codigo_viaje}</span>
                          <span class="badge badge-{voyage.estado.toLowerCase()}" style="font-size: 0.6rem; padding: 1px 4px;">{voyage.estado}</span>
                        </div>
                        <div style="margin-top: 4px; font-weight: 600;">{voyage.cultivo} ({voyage.variedad})</div>
                        <div style="font-size: 0.75rem; color: var(--gray-600); margin-top: 2px;">Cli: {voyage.cliente?.razon_social || 'Desconocido'}</div>
                        <div style="font-size: 0.75rem; color: var(--gray-600);">Peso: {voyage.peso} kg</div>
                        <div style="font-size: 0.75rem; color: var(--gray-600);">Hora: {new Date(voyage.fecha_hora_despacho).toLocaleTimeString('es-ES', {hour: '2-digit', minute:'2-digit'})}</div>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>

      <!-- VIEW: PLANIFICADOR -->
      {:else if view === 'planificador'}
        <div class="card animate-fade-in">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
            <div>
              <h2 style="font-weight: 800; font-size: 1.5rem; color: var(--primary);">Programación de Viajes</h2>
              <p style="color: var(--gray-600); font-size: 0.9rem;">Crea, modifica y gestiona las planificaciones de carga nacional</p>
            </div>
            
            <div style="display: flex; gap: 12px;">
              <button class="btn btn-secondary" on:click={openNewClientModal}>
                + Crear Cliente
              </button>
              <button class="btn btn-primary" on:click={openNewVoyageModal}>
                + Programar Nuevo Viaje
              </button>
            </div>
          </div>

          <!-- Voyages Table -->
          <div class="custom-table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Viaje</th>
                  <th>Cosecha</th>
                  <th>Despacho (Fecha/Hora)</th>
                  <th>Cultivo / Variedad</th>
                  <th>Origen Fruta</th>
                  <th>Cliente</th>
                  <th>Peso Plan.</th>
                  <th>Estado</th>
                  <th style="text-align: right;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {#if viajes.length === 0}
                  <tr>
                    <td colspan="9" style="text-align: center; color: var(--gray-600); padding: 32px;">No hay viajes programados registrados.</td>
                  </tr>
                {:else}
                  {#each viajes as viaje}
                    <tr>
                      <td style="font-weight: 700; color: var(--primary);">{viaje.codigo_viaje}</td>
                      <td>{formatDateReadable(viaje.fecha_cosecha)}</td>
                      <td>{new Date(viaje.fecha_hora_despacho).toLocaleString('es-ES', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</td>
                      <td>
                        <strong>{viaje.cultivo}</strong>
                        <div style="font-size: 0.75rem; color: var(--gray-600);">{viaje.variedad}</div>
                      </td>
                      <td><span class="info-tag">{viaje.origen_fruta}</span></td>
                      <td>
                        <div style="font-weight: 600;">{viaje.cliente?.razon_social}</div>
                        <div style="font-size: 0.75rem; color: var(--gray-600);">RUC: {viaje.cliente?.ruc}</div>
                      </td>
                      <td>{parseFloat(viaje.peso).toLocaleString()} kg</td>
                      <td>
                        <span class="badge badge-{viaje.estado.toLowerCase()}">{viaje.estado}</span>
                      </td>
                      <td style="text-align: right;">
                        {#if viaje.estado === 'Planificado'}
                          <button class="btn btn-ghost" on:click={() => openEditVoyageModal(viaje)} style="padding: 6px 10px; font-size: 0.8rem;">
                            Editar
                          </button>
                        {:else}
                          <span style="font-size: 0.75rem; color: var(--gray-600); font-style: italic;">Modificación bloqueada</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>

      <!-- VIEW: CADENA DE FRÍO -->
      {:else if view === 'frio'}
        <div class="card animate-fade-in">
          <h2 style="font-weight: 800; font-size: 1.5rem; color: var(--primary); margin-bottom: 8px;">Asignación de Pallets (Cadena de Frío)</h2>
          <p style="color: var(--gray-600); font-size: 0.9rem; margin-bottom: 24px;">Selecciona un viaje programado para cargar la asignación de pallets desde Excel.</p>

          <!-- Select Voyage -->
          <div class="form-group" style="max-width: 400px; margin-bottom: 24px;">
            <label class="form-label" for="viaje-frio-select">Seleccionar Viaje Planificado</label>
            <select id="viaje-frio-select" class="form-control" bind:value={selectedViajeFrio} on:change={() => { pastePreview = false; parsedPallets = []; excelPasteData = ''; }}>
              <option value={null}>-- Selecciona un Viaje Planificado --</option>
              {#each viajes.filter(v => v.estado === 'Planificado') as v}
                <option value={v}>{v.codigo_viaje} - {v.cultivo} ({v.variedad}) - {v.cliente?.razon_social}</option>
              {/each}
            </select>
          </div>

          {#if selectedViajeFrio}
            <div style="background-color: var(--gray-100); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 24px; font-size: 0.9rem;">
              <h4 style="font-weight: 700; color: var(--primary); margin-bottom: 8px;">Detalles del viaje seleccionado:</h4>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div><strong>Cultivo/Variedad:</strong> {selectedViajeFrio.cultivo} / {selectedViajeFrio.variedad}</div>
                <div><strong>Cliente:</strong> {selectedViajeFrio.cliente?.razon_social}</div>
                <div><strong>Peso Planificado:</strong> {parseFloat(selectedViajeFrio.peso).toLocaleString()} kg</div>
                <div><strong>Fecha Despacho:</strong> {new Date(selectedViajeFrio.fecha_hora_despacho).toLocaleString()}</div>
              </div>
            </div>

            {#if !pastePreview}
              <!-- Input copy-paste excel -->
              <div class="form-group">
                <label class="form-label" for="excel-paste">Pega aquí la tabla de Excel (Columnas en orden: Fecha prod., Cód. pallet, Cultivo, Variedad, Jabas, Peso, Precinto)</label>
                <textarea id="excel-paste" class="form-control" rows="8" bind:value={excelPasteData} placeholder="Ejemplo:
2026-06-22	PALLET-001	Arándano	Biloxi	120	1250.50	PREC-8899
2026-06-22	PALLET-002	Arándano	Biloxi	120	1248.80	PREC-8900" style="font-family: monospace; font-size: 0.85rem;"></textarea>
              </div>

              {#if frioError}
                <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem;">
                  {frioError}
                </div>
              {/if}

              <button class="btn btn-primary" on:click={processExcelPaste}>
                Procesar y Ver Vista Previa
              </button>
            {:else}
              <!-- Preview parsed tables -->
              <h3 style="font-weight: 700; font-size: 1.1rem; margin-bottom: 12px; color: var(--primary);">Vista Previa de Pallets Leídos ({parsedPallets.length})</h3>
              
              <div class="custom-table-container" style="max-height: 400px; overflow-y: auto;">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>Fecha Prod.</th>
                      <th>Código Pallet</th>
                      <th>Cultivo</th>
                      <th>Variedad</th>
                      <th>Jabas</th>
                      <th>Peso (kg)</th>
                      <th>Precinto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each parsedPallets as p}
                      <tr>
                        <td>{p.fecha_produccion}</td>
                        <td style="font-weight: 700;">{p.codigo_pallet}</td>
                        <td>{p.cultivo}</td>
                        <td>{p.variedad}</td>
                        <td>{p.jabas}</td>
                        <td>{p.peso.toLocaleString()}</td>
                        <td>{p.precinto || '-'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              {#if frioError}
                <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-top: 16px; font-size: 0.85rem;">
                  {frioError}
                </div>
              {/if}

              <div style="display: flex; gap: 12px; margin-top: 24px;">
                <button class="btn btn-secondary" on:click={submitPalletsFrio}>
                  Finalizar Asignación (Bloquear Edición)
                </button>
                <button class="btn btn-ghost" on:click={() => pastePreview = false}>
                  Volver a Pegar
                </button>
              </div>
            {/if}
          {/if}
        </div>

      <!-- VIEW: DESPACHO -->
      {:else if view === 'despacho'}
        <div class="card animate-fade-in">
          <h2 style="font-weight: 800; font-size: 1.5rem; color: var(--primary); margin-bottom: 8px;">Proceso de Despacho y Despacho de Pallets</h2>
          <p style="color: var(--gray-600); font-size: 0.9rem; margin-bottom: 24px;">Registra los pesos brutos y tara para validar los pallets asignados, y finaliza el despacho del viaje.</p>

          <!-- Select Voyage -->
          <div class="form-group" style="max-width: 400px; margin-bottom: 24px;">
            <label class="form-label" for="viaje-despacho-select">Seleccionar Viaje Preparado / Cargado</label>
            <select id="viaje-despacho-select" class="form-control" value={selectedViajeDespacho} on:change={(e) => {
              const selected = viajes.find(v => v.id === parseInt(e.target.value));
              if (selected) selectDespachoVoyage(selected);
            }}>
              <option value="">-- Selecciona un Viaje --</option>
              {#each viajes.filter(v => v.estado === 'Preparado' || v.estado === 'Cargado') as v}
                <option value={v.id}>{v.codigo_viaje} [{v.estado}] - {v.cultivo} ({v.variedad})</option>
              {/each}
            </select>
          </div>

          {#if selectedViajeDespacho}
            <!-- Voyage Info Banner -->
            <div style="background-color: var(--gray-100); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 24px; font-size: 0.9rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="font-weight: 700; color: var(--primary);">Detalles: {selectedViajeDespacho.codigo_viaje}</h4>
                <span class="badge badge-{selectedViajeDespacho.estado.toLowerCase()}">{selectedViajeDespacho.estado}</span>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div><strong>Cliente:</strong> {selectedViajeDespacho.cliente?.razon_social}</div>
                <div><strong>RUC / Dirección:</strong> {selectedViajeDespacho.cliente?.ruc} / {selectedViajeDespacho.cliente?.direccion}</div>
                <div><strong>Origen Despacho:</strong> {selectedViajeDespacho.origen_despacho}</div>
              </div>
            </div>

            <!-- STEP 1: PALLET WEIGHTS -->
            {#if selectedViajeDespacho.estado === 'Preparado' && despachoStep === 1}
              <h3 style="font-weight: 700; font-size: 1.1rem; margin-bottom: 12px; color: var(--primary);">Paso 1: Control de Pesos por Pallet</h3>
              
              <div class="custom-table-container">
                <table class="custom-table">
                  <thead>
                    <tr>
                      <th>Código Pallet</th>
                      <th>Cultivo / Var.</th>
                      <th>Jabas Orig.</th>
                      <th>Peso Orig. (kg)</th>
                      <th style="width: 110px;">Jabas Desp.</th>
                      <th style="width: 120px;">Peso Bruto (kg)</th>
                      <th style="width: 120px;">Tara (kg)</th>
                      <th>Peso Desp. (kg)</th>
                      <th>% Desviación</th>
                      <th style="text-align: right;">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each despachoPallets as p, idx}
                      {@const isAlert = p.desviacion > 5.0}
                      <tr style={isAlert ? 'background-color: var(--danger-light);' : ''}>
                        <td style="font-weight: 700;">{p.codigo_pallet}</td>
                        <td>{p.cultivo} ({p.variedad})</td>
                        <td>{p.jabas_cf}</td>
                        <td>{p.peso_cf}</td>
                        
                        <td>
                          <input type="number" class="form-control" style="padding: 6px;" bind:value={p.jabas_despacho} />
                        </td>
                        <td>
                          <input type="number" step="0.01" class="form-control" style="padding: 6px;" bind:value={p.peso_bruto} on:input={() => calculatePalletMetrics(idx)} />
                        </td>
                        <td>
                          <input type="number" step="0.01" class="form-control" style="padding: 6px;" bind:value={p.peso_tara} on:input={() => calculatePalletMetrics(idx)} />
                        </td>
                        
                        <td style="font-weight: 600;">{p.peso_despacho ? p.peso_despacho.toFixed(2) : '-'}</td>
                        <td>
                          {#if p.peso_despacho > 0}
                            <span class="badge" style="background-color: {isAlert ? 'var(--danger)' : 'var(--success)'}; color: white;">
                              {p.desviacion}% {isAlert ? '⚠️ ALERTA' : ''}
                            </span>
                          {:else}
                            -
                          {/if}
                        </td>
                        <td style="text-align: right;">
                          <button class="btn btn-secondary" on:click={() => savePalletDespacho(idx)} style="padding: 6px 10px; font-size: 0.75rem;">
                            Guardar
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              {#if despachoError}
                <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-top: 16px; font-size: 0.85rem;">
                  {despachoError}
                </div>
              {/if}

              <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                <button class="btn btn-primary" on:click={finalizeLoading}>
                  Finalizar Carga (Marcar como Cargado)
                </button>
              </div>

            <!-- STEP 2: TRAVEL DISPATCH DETAILS -->
            {:else if selectedViajeDespacho.estado === 'Cargado' || despachoStep === 2}
              <h3 style="font-weight: 700; font-size: 1.1rem; margin-bottom: 12px; color: var(--primary);">Paso 2: Registro final de Guía y Conductor</h3>

              <div class="modal-grid" style="max-width: 600px; margin-bottom: 24px;">
                <div class="form-group">
                  <label class="form-label" for="guia">Guía de Remisión</label>
                  <input type="text" id="guia" class="form-control" bind:value={voyageDispatchForm.guia_remision} placeholder="EG01-00045612" required />
                </div>

                <div class="form-group">
                  <label class="form-label" for="conductor">Nombre Conductor</label>
                  <input type="text" id="conductor" class="form-control" bind:value={voyageDispatchForm.conductor_nombre} placeholder="Juan Pérez Quispe" required />
                </div>

                <div class="form-group">
                  <label class="form-label" for="licencia">Licencia de Conducir</label>
                  <input type="text" id="licencia" class="form-control" bind:value={voyageDispatchForm.conductor_licencia} placeholder="Q12345678" required />
                </div>

                <div class="form-group">
                  <label class="form-label" for="placa">Placa de Vehículo</label>
                  <input type="text" id="placa" class="form-control" bind:value={voyageDispatchForm.conductor_placa} placeholder="T5D-890" required />
                </div>
              </div>

              {#if despachoError}
                <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem;">
                  {despachoError}
                </div>
              {/if}

              <div style="display: flex; gap: 12px;">
                <button class="btn btn-secondary" on:click={finalizeDispatch}>
                  Finalizar Despacho (Cerrar Viaje)
                </button>
                {#if selectedViajeDespacho.estado === 'Preparado'}
                  <button class="btn btn-ghost" on:click={() => despachoStep = 1}>
                    Atrás a Pallets
                  </button>
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/if}

    </main>
  </div>
{/if}

<!-- MODAL: ADD / EDIT VOYAGE (PLANIFICADOR) -->
{#if showVoyageModal}
  <div class="modal-overlay">
    <div class="modal-content animate-fade-in">
      <div class="modal-header">
        <h3 style="font-weight: 800; font-size: 1.3rem; color: var(--primary);">{isEditing ? 'Editar Viaje Programado' : 'Programar Nuevo Viaje'}</h3>
        <button class="btn btn-ghost" on:click={() => showVoyageModal = false} style="padding: 4px 8px; font-size: 0.8rem;">✕</button>
      </div>

      <form on:submit|preventDefault={submitVoyage}>
        <div class="modal-grid">
          <div class="form-group">
            <label class="form-label" for="codigo_viaje">Código de Viaje</label>
            <input type="text" id="codigo_viaje" class="form-control" bind:value={voyageForm.codigo_viaje} required placeholder="ej. VIAJE-104" />
          </div>

          <div class="form-group">
            <label class="form-label" for="origen_fruta">Origen de Fruta</label>
            <select id="origen_fruta" class="form-control" bind:value={voyageForm.origen_fruta}>
              {#each orígenesFruta as o}
                <option value={o}>{o}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="cultivo-sel">Cultivo</label>
            <select id="cultivo-sel" class="form-control" bind:value={voyageForm.cultivo}>
              {#each Object.keys(cultivosData) as c}
                <option value={c}>{c}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="variedad-sel">Variedad</label>
            <select id="variedad-sel" class="form-control" bind:value={voyageForm.variedad}>
              {#each cultivosData[voyageForm.cultivo] || [] as v}
                <option value={v}>{v}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label class="form-label" for="cliente-sel" style="margin-bottom: 0;">Cliente</label>
              <!-- svelte-ignore a11y-invalid-attribute -->
              <a href="javascript:void(0)" on:click|preventDefault={openNewClientModal} style="font-size: 0.8rem; font-weight: 600; color: var(--primary); text-decoration: none;">+ Nuevo Cliente</a>
            </div>
            <select id="cliente-sel" class="form-control" bind:value={voyageForm.cliente_id} required>
              {#each clientes as c}
                <option value={c.id.toString()}>{c.razon_social} (RUC: {c.ruc})</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="peso-plan">Peso Planificado (kg)</label>
            <input type="number" step="0.01" id="peso-plan" class="form-control" bind:value={voyageForm.peso} required placeholder="ej. 15000" />
          </div>

          <div class="form-group">
            <label class="form-label" for="fecha-cosecha">Fecha de Cosecha</label>
            <input type="date" id="fecha-cosecha" class="form-control" bind:value={voyageForm.fecha_cosecha} required />
          </div>

          <div class="form-group">
            <label class="form-label" for="fecha-despacho">Fecha y Hora de Despacho</label>
            <input type="datetime-local" id="fecha-despacho" class="form-control" bind:value={voyageForm.fecha_hora_despacho} required />
          </div>

          <div class="form-group">
            <label class="form-label" for="origen-despacho">Origen Despacho</label>
            <select id="origen-despacho" class="form-control" bind:value={voyageForm.origen_despacho}>
              {#each orígenesDespacho as od}
                <option value={od}>{od}</option>
              {/each}
            </select>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button type="button" class="btn btn-ghost" on:click={() => showVoyageModal = false}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary">
            {isEditing ? 'Guardar Cambios' : 'Programar Viaje'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- MODAL: ADD NEW CLIENT (PLANIFICADOR) -->
{#if showClientModal}
  <div class="modal-overlay" style="z-index: 1050;">
    <div class="modal-content animate-fade-in" style="max-width: 480px;">
      <div class="modal-header">
        <h3 style="font-weight: 800; font-size: 1.3rem; color: var(--primary);">Registrar Nuevo Cliente</h3>
        <button class="btn btn-ghost" on:click={() => showClientModal = false} style="padding: 4px 8px; font-size: 0.8rem;">✕</button>
      </div>

      <form on:submit|preventDefault={submitClient}>
        {#if clientError}
          <div style="background-color: var(--danger-light); color: var(--danger); padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 16px; font-size: 0.85rem; font-weight: 500;">
            {clientError}
          </div>
        {/if}

        <div class="form-group">
          <label class="form-label" for="client-razon">Razón Social</label>
          <input type="text" id="client-razon" class="form-control" bind:value={clientForm.razon_social} required placeholder="ej. Supermercados Peruanos S.A." />
        </div>

        <div class="form-group">
          <label class="form-label" for="client-ruc">RUC</label>
          <input type="text" id="client-ruc" class="form-control" bind:value={clientForm.ruc} required maxlength="11" placeholder="ej. 20100018612" />
        </div>

        <div class="form-group">
          <label class="form-label" for="client-dir">Dirección Fiscal</label>
          <input type="text" id="client-dir" class="form-control" bind:value={clientForm.direccion} required placeholder="ej. Av. Larco 1230, Miraflores, Lima" />
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px;">
          <button type="button" class="btn btn-ghost" on:click={() => showClientModal = false}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-primary">
            Crear Cliente
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

