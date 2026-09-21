"use strict";

/* Bitácora BEE - Control de apiario (versión web) */
const COLUMNAS = [
  { clave: "numero",         etiqueta: "N°",                     ancho: 58,  tipo: "numero" },
  { clave: "estado_reina",   etiqueta: "Estado de la Reina",                  tipo: "select", opciones: ["Buena", "Regular", "Mala"] },
  { clave: "postura",        etiqueta: "Postura / Huevos",                    tipo: "select", opciones: ["Sí", "No"] },
  { clave: "cria",           etiqueta: "Cría Operculada",                     tipo: "select", opciones: ["Alta", "Media", "Baja"] },
  { clave: "poblacion",      etiqueta: "Población de Abejas",                 tipo: "select", opciones: ["Alta", "Media", "Baja"] },
  { clave: "miel",           etiqueta: "Reservas de Miel",                    tipo: "select", opciones: ["Alta", "Media", "Baja"] },
  { clave: "polen",          etiqueta: "Reservas de Polen",                   tipo: "select", opciones: ["Alta", "Media", "Baja"] },
  { clave: "varroa",         etiqueta: "Plagas / Varroa",                     tipo: "select", opciones: ["Sí", "No"] },
  { clave: "alimentacion",   etiqueta: "Alimentación Aplicada",               tipo: "select", opciones: ["Sí", "No"] },
  { clave: "tratamiento",    etiqueta: "Tratamiento Aplicado",                tipo: "select", opciones: ["Sí", "No"] },
  { clave: "estado_general", etiqueta: "Estado General",                      tipo: "select", opciones: ["Excelente", "Buena", "Regular", "Mala"] },
  { clave: "observaciones",  etiqueta: "Observaciones",        ancho: 220,    tipo: "text" },
];

const ACTIVIDADES = [
  ["cambio_reina", "Cambio de reina"],
  ["alimentacion_suplementaria", "Alimentación suplementaria"],
  ["control_plagas", "Control de plagas / enfermedades"],
  ["alzas", "Colocación o retiro de alzas"],
  ["division", "División de colmenas"],
  ["cosecha", "Cosecha de miel"],
];

const CLAVES_BASE = ["apiario", "ubicacion", "fecha", "hora", "clima", "responsable"];
const CLAVES_PROX = ["fecha", "actividades_pendientes", "notas"];

const ESTADO_JSON = "/api/datos"; /* ruta de la API donde se guarda */
const GH_API = "https://api.github.com"; /* solo se usa para comprobar actualizaciones (sin cuenta) */
const GH_REPO_ORIGEN = "JMBermejias/bitacorabee";
const CLAVE_USUARIOS = "bitacorabee_usuarios";
const APP_VERSION =
  typeof window.BITACORA_VERSION !== "undefined" && window.BITACORA_VERSION
    ? window.BITACORA_VERSION : "";

const $ = (id) => document.getElementById(id);

let doc = null;               /* documento completo {visitas, actual} */
let timerAutoguardado = null;
let clavesAct = new Set();
let localMode = false;        /* true si no hay servidor (p. ej. en Android) */
let usuarios = [];            /* operadores locales */
let usuarioActivo = null;     /* operador activo (se usa como responsable) */
let editandoUsuario = null;   /* id del operador que se está editando */
let servidorSync = "";        /* dirección (IP:puerto) del servidor con el que sincronizar */
let infoActualizacion = null; /* última información de actualización consultada */
let sucioDoc = false;         /* hay cambios locales sin guardar */
let sincronizando = false;    /* evita solaparse las sincronizaciones */
let timerAutoSync = null;     /* intervalo de sincronización automática */
let ultimoSync = null;        /* {ok, cuando, detalle} de la última sincronización */

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

function hoy() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ahoraHM() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nuevaVisita() {
  const id = `${hoy().replace(/-/g, "")}${ahoraHM().replace(":", "")}${Math.floor(Math.random() * 1000)}`;
  const v = {
    id,
    creada: new Date().toISOString(),
    actualizada: new Date().toISOString(),
    datos: { apiario: "", ubicacion: "", fecha: hoy(), hora: ahoraHM(), clima: "Soleado", responsable: "" },
    colmenas: [colmenaVacia(1)],
    actividades: {
      cambio_reina: false, alimentacion_suplementaria: false, control_plagas: false,
      alzas: false, division: false, cosecha: false,
    },
    otras: "",
    proxima_revision: { fecha: "", actividades_pendientes: "", notas: "" },
  };
  return v;
}

function colmenaVacia(n) {
  return {
    numero: n, estado_reina: "Buena", postura: "Sí", cria: "Alta", poblacion: "Alta",
    miel: "Alta", polen: "Alta", varroa: "No", alimentacion: "No", tratamiento: "No",
    estado_general: "Buena", observaciones: "",
  };
}

function visitaActual() {
  if (!doc || !doc.visitas) return null;
  return doc.visitas.find((v) => v.id === doc.actual) || null;
}

function estado(texto) {
  $("estado-guardado").textContent = texto;
}

/* ------------------------------------------------------------------ */
/* tabla de colmenas                                                   */
/* ------------------------------------------------------------------ */

function construirCabecera() {
  const thead = $("thead-colmenas");
  thead.innerHTML = "";
  const fila = document.createElement("tr");
  COLUMNAS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.etiqueta;
    if (col.ancho) th.style.minWidth = col.ancho + "px";
    if (col.clave === "observaciones") th.style.textAlign = "left";
    fila.appendChild(th);
  });
  thead.appendChild(fila);
}

function crearFila(colmena) {
  const tr = document.createElement("tr");
  tr.dataset.numero = colmena.numero;

  COLUMNAS.forEach((col) => {
    const td = document.createElement("td");
    if (col.tipo === "select") {
      const sel = document.createElement("select");
      col.opciones.forEach((op) => {
        const opt = document.createElement("option");
        opt.value = op;
        opt.textContent = op;
        sel.appendChild(opt);
      });
      sel.value = colmena[col.clave] !== undefined ? colmena[col.clave] : col.opciones[0];
      sel.addEventListener("input", marcarAutoguardado);
      sel.addEventListener("change", marcarAutoguardado);
      td.appendChild(sel);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.value = colmena[col.clave] !== undefined ? colmena[col.clave] : "";
      input.dataset.col = col.clave;
      td.appendChild(input);
      if (col.tipo === "numero") input.classList.add("input-num");
      if (col.clave === "observaciones") {
        td.classList.add("td-observaciones");
        input.placeholder = "…";
      }
      if (col.clave === "numero") td.classList.add("td-num");
      input.addEventListener("input", () => {
        if (col.clave === "numero") tr.dataset.numero = input.value;
        marcarAutoguardado();
      });
    }
    tr.appendChild(td);
  });
  return tr;
}

function dibujarTabla() {
  const v = visitaActual();
  const tbody = $("tbody-colmenas");
  tbody.innerHTML = "";
  (v ? v.colmenas : []).forEach((c) => tbody.appendChild(crearFila(c)));
}

function leerColmenas() {
  const tbody = $("tbody-colmenas");
  const res = [];
  tbody.querySelectorAll("tr").forEach((tr) => {
    const fila = {};
    COLUMNAS.forEach((col) => {
      const nodo = tr.querySelector(
        col.tipo === "select" ? "select" : `input[data-col="${col.clave}"]`
      );
      let val = nodo ? nodo.value : "";
      if (col.clave === "numero") {
        const n = parseInt(String(val).replace(/\D/g, "") || "0", 10);
        val = n ? String(n) : "";
      }
      fila[col.clave] = val;
    });
    res.push(fila);
  });
  return res;
}

/* ------------------------------------------------------------------ */
/* formulario                                                          */
/* ------------------------------------------------------------------ */

function rellenarFormulario() {
  const v = visitaActual();
  if (!v) return;

  CLAVES_BASE.forEach((clave) => {
    const nodo = $("d-" + clave);
    if (!nodo) return;
    nodo.value = (v.datos && v.datos[clave]) !== undefined ? v.datos[clave] : "";
    if (clave === "fecha" && !nodo.value) nodo.value = hoy();
    if (clave === "hora" && !nodo.value) nodo.value = ahoraHM();
  });

  CLAVES_PROX.forEach((clave) => {
    const nodo = $("p-" + clave);
    if (!nodo) return;
    nodo.value = (v.proxima_revision && v.proxima_revision[clave]) !== undefined
      ? v.proxima_revision[clave] : "";
  });

  $("d-otras").value = v.otras || "";

  clavesAct.forEach((clave) => {
    const chk = $("act-" + clave);
    if (chk) chk.checked = !!(v.actividades && v.actividades[clave]);
  });

  dibujarTabla();
}

function leerFormulario() {
  const v = visitaActual();
  if (!v) return v;

  v.datos = {};
  CLAVES_BASE.forEach((clave) => {
    const nodo = $("d-" + clave);
    v.datos[clave] = nodo ? nodo.value : "";
  });

  v.colmenas = leerColmenas();

  v.actividades = {};
  clavesAct.forEach((clave) => {
    const chk = $("act-" + clave);
    v.actividades[clave] = chk ? chk.checked : false;
  });

  v.otras = $("d-otras").value;

  v.proxima_revision = {};
  CLAVES_PROX.forEach((clave) => {
    const nodo = $("p-" + clave);
    v.proxima_revision[clave] = nodo ? nodo.value : "";
  });

  if (sucioDoc) v.actualizada = new Date().toISOString();
  return v;
}

/* ------------------------------------------------------------------ */
/* selector de revisiones                                              */
/* ------------------------------------------------------------------ */

function tituloVisita(v) {
  const f = (v.datos && v.datos.fecha) || "sin fecha";
  const h = (v.datos && v.datos.hora) || "";
  const a = (v.datos && v.datos.apiario) || "Apiario sin nombre";
  return `${f}${h ? " " + h : ""} · ${a}`;
}

function renderizarSelector() {
  const sel = $("selector-visita");
  sel.innerHTML = "";
  doc.visitas.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = tituloVisita(v);
    if (v.id === doc.actual) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ------------------------------------------------------------------ */
/* guardar / cargar                                                    */
/* ------------------------------------------------------------------ */

function clavesLocales() {
  return JSON.stringify(doc);
}

function guardarLocalCopia() {
  try { localStorage.setItem("bitacorabee_doc", clavesLocales()); } catch (e) { /* sin almacen */ }
}

async function guardar(mensajeDeExito, abrirHojas) {
  leerFormulario();
  doc.actualizada_doc = new Date().toISOString();
  guardarLocalCopia();
  sucioDoc = false;
  if (localMode) {
    renderizarSelector();
    estado(mensajeDeExito || "Guardado en este dispositivo.");
    if (abrirHojas) abrirModalHojas();
    return;
  }
  try {
    const resp = await fetch(ESTADO_JSON, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: clavesLocales(),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    renderizarSelector();
    estado(mensajeDeExito || "Guardado correctamente.");
  } catch (e) {
    localMode = true;
    estado("Servidor no disponible: los datos se guardan solo en este dispositivo.");
  }
  if (abrirHojas) abrirModalHojas();
}

function marcarAutoguardado() {
  sucioDoc = true;
  if (timerAutoguardado) clearTimeout(timerAutoguardado);
  timerAutoguardado = setTimeout(() => {
    estado("Guardando…");
    guardar("Guardado automáticamente.");
  }, 900);
}

async function cargarDatos() {
  try {
    const resp = await fetch(ESTADO_JSON, { cache: "no-store" });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const j = await resp.json();
    if (j && Array.isArray(j.visitas)) {
      doc = j;
      if (!doc.actual && j.visitas.length) doc.actual = j.visitas[0].id;
      localMode = false;
      return;
    }
  } catch (e) {
    /* no hay servidor o archivo */
  }
  /* sin servidor: se usa solo el almacenamiento del dispositivo */
  localMode = true;
  try {
    const local = localStorage.getItem("bitacorabee_doc");
    if (local) {
      const j = JSON.parse(local);
      if (j && Array.isArray(j.visitas)) {
        doc = j;
        estado("Modo sin servidor: cargada la copia de este dispositivo.");
        return;
      }
    }
  } catch (e) { /* ignorar */ }
  doc = { visitas: [nuevaVisita()], actual: null, origen: "nuevo" };
  doc.actual = doc.visitas[0].id;
  estado("Modo sin servidor: los cambios se guardan en este dispositivo.");
}

/* ------------------------------------------------------------------ */
/* acciones de botones                                                 */
/* ------------------------------------------------------------------ */

function anadirColmena() {
  const v = visitaActual();
  if (!v) return;
  const n = v.colmenas.length ? v.colmenas.length + 1 : 1;
  $("tbody-colmenas").appendChild(crearFila(colmenaVacia(n)));
  marcarAutoguardado();
}

function eliminarUltima() {
  const tbody = $("tbody-colmenas");
  if (tbody.rows.length === 0) return;
  tbody.deleteRow(-1);
  marcarAutoguardado();
  const v = visitaActual();
  if (v) { v.colmenas = leerColmenas(); }
}

/* ------------------------------------------------------------------ */
/* construir actividades                                               */
/* ------------------------------------------------------------------ */

function construirActividades() {
  const caja = $("lista-actividades");
  ACTIVIDADES.forEach(([clave, etiqueta]) => {
    clavesAct.add(clave);
    const label = document.createElement("label");
    label.className = "item-actividad";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = "act-" + clave;
    chk.addEventListener("input", marcarAutoguardado);
    const span = document.createElement("span");
    span.textContent = etiqueta;
    label.appendChild(chk);
    label.appendChild(span);
    caja.appendChild(label);
  });
}

/* ------------------------------------------------------------------ */
/* impresión (hoja como la del PDF)                                    */
/* ------------------------------------------------------------------ */

function celdaPrintEsc(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function construirHojaImpresion(v) {
  const hoja = $("hoja-impresion");
  const d = v.datos || {};

  const cab = `<div class="cab">
    <h1>BITÁCORA DE REVISIÓN DE COLMENAS</h1>
    <p>MIEL 100% NATURAL</p>
  </div>`;

  const datos = `
    <h2>DATOS GENERALES</h2>
    <div class="datos">
      <div class="dato"><b>Apiario:</b> <span></span></div>
      <div class="dato"><b>Hora:</b> <span></span></div>
      <div class="dato"><b>Ubicación:</b> <span></span></div>
      <div class="dato"><b>Clima:</b> <span></span></div>
      <div class="dato"><b>Fecha:</b> <span></span></div>
      <div class="dato"><b>Responsable:</b> <span></span></div>
    </div>`;

  /* rellenar los datos tras insertar usa las filas del grid */
  const tabla = `
    <h2>REGISTRO DE REVISIÓN POR COLMENA</h2>
    <table>
      <thead><tr>
        <th style="width:34px">N°</th>
        <th>ESTADO DE LA REINA</th>
        <th>POSTURA / HUEVOS</th>
        <th>CRÍA OPERCULADA</th>
        <th>POBLACIÓN</th>
        <th>RESERVAS DE MIEL</th>
        <th>RESERVAS DE POLEN</th>
        <th>PLAGAS / VARROA</th>
        <th>ALIMENTACIÓN APLICADA</th>
        <th>TRATAMIENTO APLICADO</th>
        <th>ESTADO GENERAL</th>
        <th>OBSERVACIONES</th>
      </tr></thead>
      <tbody>${v.colmenas.map((c) => `
        <tr>
          <td>${celdaPrintEsc(c.numero)}</td>
          <td>${celdaPrintEsc(c.estado_reina)}</td>
          <td>${celdaPrintEsc(c.postura)}</td>
          <td>${celdaPrintEsc(c.cria)}</td>
          <td>${celdaPrintEsc(c.poblacion)}</td>
          <td>${celdaPrintEsc(c.miel)}</td>
          <td>${celdaPrintEsc(c.polen)}</td>
          <td>${celdaPrintEsc(c.varroa)}</td>
          <td>${celdaPrintEsc(c.alimentacion)}</td>
          <td>${celdaPrintEsc(c.tratamiento)}</td>
          <td>${celdaPrintEsc(c.estado_general)}</td>
          <td>${celdaPrintEsc(c.observaciones)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  const hechas = ACTIVIDADES.filter(([clave]) => v.actividades[clave]).map(([, e]) => e);
  const noHechas = ACTIVIDADES.filter(([clave]) => !v.actividades[clave]).map(([, e]) => e);
  const actividades = `
    <h2>ACTIVIDADES REALIZADAS</h2>
    <div class="actividades">
      <ul>
        ${[...hechas.map((e) => `<li style="list-style:none">☑ ${celdaPrintEsc(e)}</li>`),
           ...noHechas.map((e) => `<li style="list-style:none">☐ ${celdaPrintEsc(e)}</li>`)].join("")}
        ${v.otras ? `<li style="list-style:none">☑ Otras: ${celdaPrintEsc(v.otras)}</li>` : ""}
      </ul>
    </div>
    <p style="margin:4px 0;border:1px solid #000;border-radius:6px;padding:6px 10px;">
      <b>Otras actividades / observaciones generales:</b>&nbsp;
      <span>${celdaPrintEsc(v.otras)}</span>
    </p>`;

  const pr = v.proxima_revision || {};
  const proxima = `
    <h2>PRÓXIMA REVISIÓN</h2>
    <div class="proxima">
      <div class="bloque"><h3>FECHA PROGRAMADA</h3>${celdaPrintEsc(pr.fecha)}</div>
      <div class="bloque"><h3>ACTIVIDADES PENDIENTES</h3>${celdaPrintEsc(pr.actividades_pendientes)}</div>
      <div class="bloque" style="grid-column:1 / -1"><h3>NOTAS ADICIONALES</h3>${celdaPrintEsc(pr.notas)}</div>
    </div>`;

  hoja.innerHTML = cab + datos + tabla + actividades + proxima;

  /* volcar los valores en los huecos de la hoja */
  const huecos = hoja.querySelectorAll(".datos .dato span");
  const orden = ["apiario", "hora", "ubicacion", "clima", "fecha", "responsable"];
  orden.forEach((clave, i) => { if (huecos[i]) huecos[i].textContent = d[clave] || ""; });
}

function imprimir() {
  construirHojaImpresion(leerFormulario());
  window.print();
}

function imprimirVisita(id) {
  const v = doc.visitas.find((x) => x.id === id);
  if (v) { construirHojaImpresion(v); window.print(); }
}

/* ------------------------------------------------------------------ */
/* ventana de hojas guardadas                                          */
/* ------------------------------------------------------------------ */

function abrirModalHojas() {
  renderizarTablaHojas();
  $("modal-hojas").hidden = false;
}

function cerrarModalHojas() {
  $("modal-hojas").hidden = true;
}

function fechaLegible(iso) {
  if (!iso) return "—";
  let s = String(iso).replace("T", " ").replace("Z", "").slice(0, 16);
  return s || "—";
}

function renderizarTablaHojas() {
  const tbody = $("tbody-hojas");
  const vacio = $("sin-hojas");
  if (!tbody) return;
  tbody.innerHTML = "";
  const lista = doc.visitas || [];
  vacio.style.display = lista.length ? "none" : "";
  lista.slice().reverse().forEach((v) => {
    const d = v.datos || {};
    const tr = document.createElement("tr");

    const tdRev = document.createElement("td");
    let rev = (d.fecha || "—");
    if (d.hora) rev += " " + d.hora;
    if (v.id === doc.actual) rev += "  (actual)";
    tdRev.innerHTML = celdaPrintEsc(rev);
    const tdApi = document.createElement("td");
    tdApi.innerHTML = celdaPrintEsc(d.apiario || "");
    if (!d.apiario) tdApi.textContent = "—";
    const tdResp = document.createElement("td");
    tdResp.innerHTML = celdaPrintEsc(d.responsable || "—");
    if (!d.responsable) tdResp.textContent = "—";
    const tdColm = document.createElement("td");
    tdColm.textContent = String((v.colmenas || []).length || 0);
    const tdMod = document.createElement("td");
    tdMod.textContent = fechaLegible(v.actualizada || v.creada);
    const tdAcc = document.createElement("td");
    tdAcc.className = "acciones-hoja";

    const btnAbrir = document.createElement("button");
    btnAbrir.className = "btn btn-mini editar";
    btnAbrir.textContent = "Editar";
    btnAbrir.title = "Abrir esta hoja para editarla";
    btnAbrir.addEventListener("click", () => abrirVisita(v.id));

    const btnDup = document.createElement("button");
    btnDup.className = "btn btn-mini duplicar";
    btnDup.textContent = "Duplicar";
    btnDup.title = "Crear una copia de esta hoja";
    btnDup.addEventListener("click", () => duplicarVisita(v.id));

    const btnImp = document.createElement("button");
    btnImp.className = "btn btn-mini";
    btnImp.textContent = "Imprimir";
    btnImp.title = "Imprimir esta hoja";
    btnImp.addEventListener("click", () => imprimirVisita(v.id));

    const btnBorrar = document.createElement("button");
    btnBorrar.className = "btn btn-mini borrar";
    btnBorrar.textContent = "Borrar";
    btnBorrar.title = "Eliminar esta hoja definitivamente";
    btnBorrar.addEventListener("click", () => borrarVisita(v.id, rev));

    tdAcc.appendChild(btnAbrir);
    tdAcc.appendChild(btnDup);
    tdAcc.appendChild(btnImp);
    tdAcc.appendChild(btnBorrar);

    tr.appendChild(tdRev);
    tr.appendChild(tdApi);
    tr.appendChild(tdResp);
    tr.appendChild(tdColm);
    tr.appendChild(tdMod);
    tr.appendChild(tdAcc);
    tbody.appendChild(tr);
  });
}

function abrirVisita(id) {
  if (!doc.visitas.some((v) => v.id === id)) return;
  doc.actual = id;
  renderizarSelector();
  rellenarFormulario();
  cerrarModalHojas();
  estado("Hoja abierta. Rellena lo que necesites y pulsa Guardar.");
}

function nuevaRevision() {
  const v = nuevaVisita();
  doc.visitas.push(v);
  doc.actual = v.id;
  renderizarSelector();
  rellenarFormulario();
  renderizarTablaHojas();
  cerrarModalHojas();
  estado("Nueva revisión creada. Rellena la hoja y pulsa Guardar.");
}

function duplicarVisita(id) {
  const origen = doc.visitas.find((v) => v.id === id);
  if (!origen) return;
  const copia = JSON.parse(JSON.stringify(origen));
  copia.id = `${hoy().replace(/-/g, "")}${ahoraHM().replace(":", "")}${Math.floor(Math.random() * 100000)}`;
  copia.creada = new Date().toISOString();
  copia.actualizada = copia.creada;
  doc.visitas.push(copia);
  renderizarSelector();
  renderizarTablaHojas();
  estado("Hoja duplicada.");
  marcarAutoguardado();
}

function borrarVisita(id, etiqueta) {
  if (!confirm(`¿Borrar la hoja "${etiqueta}"?\nEsta acción no se puede deshacer.`)) return;
  doc.visitas = doc.visitas.filter((v) => v.id !== id);
  if (!doc.visitas.length) {
    doc.visitas.push(nuevaVisita());
  }
  if (!doc.visitas.some((v) => v.id === doc.actual)) {
    doc.actual = doc.visitas[0].id;
  }
  renderizarSelector();
  rellenarFormulario();
  renderizarTablaHojas();
  estado("Hoja borrada.");
  marcarAutoguardado();
}

/* ------------------------------------------------------------------ */
/* exportar / importar JSON                                            */
/* ------------------------------------------------------------------ */

function exportarJSON() {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bitacorabee-${hoy()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
  estado("Datos exportados a JSON.");
}

function manejarImportar(ev) {
  const archivo = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const j = JSON.parse(lector.result);
      if (!j || !Array.isArray(j.visitas) || !j.visitas.length) {
        throw new Error("formato");
      }
      if (!confirm(`Se importarán ${j.visitas.length} hojas.\n¿Sustituir las hojas actuales?`)) return;
      doc = { visitas: j.visitas };
      doc.actual = (j.actual && j.visitas.some((v) => v.id === j.actual))
        ? j.actual : j.visitas[0].id;
      guardarLocalCopia();
      renderizarSelector();
      rellenarFormulario();
      renderizarTablaHojas();
      cerrarModalHojas();
      estado("Hojas importadas desde el archivo.");
    } catch (e) {
      alert("El archivo no es un JSON válido de Bitácora BEE.");
    }
  };
  lector.readAsText(archivo);
}

/* ------------------------------------------------------------------ */
/* operadores y sincronización local                                   */
/* ------------------------------------------------------------------ */

function armarioUsuarios() {
  return {
    usuarios,
    activo: usuarioActivo ? usuarioActivo.id : null,
    servidor_sync: servidorSync,
  };
}

async function guardarUsuarios() {
  try { localStorage.setItem(CLAVE_USUARIOS, JSON.stringify(armarioUsuarios())); } catch (e) { /* sin almacén */ }
  if (localMode) return;
  try {
    await fetch("/api/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(armarioUsuarios()),
    });
  } catch (e) { /* el servidor no acepta: se guarda en el dispositivo */ }
}

async function cargarUsuarios() {
  if (!localMode) {
    try {
      const r = await fetch("/api/usuarios", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.usuarios)) {
          usuarios = j.usuarios;
          servidorSync = j.servidor_sync || "";
          usuarioActivo = j.activo ? usuarios.find((u) => u.id === j.activo) || null : null;
          return;
        }
      }
    } catch (e) { /* seguir con local */ }
  }
  try {
    const s = localStorage.getItem(CLAVE_USUARIOS);
    if (s) {
      const j = JSON.parse(s);
      if (j && Array.isArray(j.usuarios)) {
        usuarios = j.usuarios;
        servidorSync = j.servidor_sync || "";
        usuarioActivo = j.activo ? usuarios.find((u) => u.id === j.activo) || null : null;
        return;
      }
    }
  } catch (e) { /* ignorar */ }
  usuarios = [];
  usuarioActivo = null;
  servidorSync = "";
}

function usuarioActual() {
  return usuarioActivo || null;
}

function actualizarChipUsuarios() {
  const chip = $("chip-usuario");
  if (!chip) return;
  const u = usuarioActual();
  chip.title = u
    ? `Operador activo: ${u.nombre}. Úsalo como responsable en la hoja.`
    : "Sin operador: crea o selecciona uno en «Operadores»";
  chip.textContent = u ? u.nombre : "";
}

function abrirModalUsuarios() {
  editandoUsuario = null;
  renderizarListaUsuarios();
  limpiarFormUsuario();
  $("sync-direccion").value = servidorSync;
  mostrarPistaServidor();
  $("modal-usuarios").hidden = false;
}

function cerrarModalUsuarios() {
  $("modal-usuarios").hidden = true;
}

function renderizarListaUsuarios() {
  const caja = $("lista-usuarios");
  const vacio = $("sin-usuarios");
  caja.innerHTML = "";
  vacio.hidden = usuarios.length > 0;
  usuarios.forEach((u) => {
    const activo = u.id === (usuarioActivo && usuarioActivo.id);
    const ficha = document.createElement("div");
    ficha.className = "usuario-ficha" + (activo ? " activo" : "");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "usuario-radio";
    radio.className = "radio";
    radio.checked = activo;
    radio.title = "Elegir este operador como responsable";
    radio.addEventListener("change", () => seleccionarUsuario(u.id));

    const datos = document.createElement("div");
    datos.className = "datos-u";
    const b = document.createElement("b");
    b.textContent = u.nombre || "Sin nombre";
    if (activo) {
      const mar = document.createElement("span");
      mar.className = "mar";
      mar.textContent = "  ACTIVO";
      b.appendChild(mar);
    }
    const sub = document.createElement("span");
    sub.textContent = "Operador";
    datos.appendChild(b);
    datos.appendChild(sub);

    const btnEd = document.createElement("button");
    btnEd.className = "btn btn-mini editar";
    btnEd.textContent = "Editar";
    btnEd.addEventListener("click", () => editarUsuario(u.id));

    const btnDel = document.createElement("button");
    btnDel.className = "btn btn-mini borrar";
    btnDel.textContent = "Eliminar";
    btnDel.addEventListener("click", () => eliminarUsuario(u.id));

    ficha.appendChild(radio);
    ficha.appendChild(datos);
    ficha.appendChild(btnEd);
    ficha.appendChild(btnDel);
    caja.appendChild(ficha);
  });
}

function seleccionarUsuario(id) {
  usuarioActivo = usuarios.find((u) => u.id === id) || null;
  guardarUsuarios();
  renderizarListaUsuarios();
  actualizarChipUsuarios();
  const v = visitaActual();
  if (v && usuarioActivo) {
    v.datos.responsable = usuarioActivo.nombre;
    rellenarFormulario();
    persistirDoc();
  }
  estado(`Operador activo: ${usuarioActivo ? usuarioActivo.nombre : "ninguno"}.`);
}

function limpiarFormUsuario() {
  $("us-nombre").value = "";
  editandoUsuario = null;
  $("btn-eliminar-usuario").hidden = true;
  $("btn-cancelar-usuario").hidden = true;
  $("btn-guardar-usuario").textContent = "Guardar operador";
  renderizarListaUsuarios();
}

function editarUsuario(id) {
  const u = usuarios.find((x) => x.id === id);
  if (!u) return;
  editandoUsuario = id;
  $("us-nombre").value = u.nombre || "";
  $("btn-eliminar-usuario").hidden = false;
  $("btn-cancelar-usuario").hidden = false;
  $("btn-guardar-usuario").textContent = "Guardar cambios";
}

function guardarUsuarioForm() {
  const nombre = $("us-nombre").value.trim();
  if (!nombre) {
    alert("Escribe el nombre del operador.");
    return;
  }
  const datos = { id: editandoUsuario || ("u" + Date.now().toString(36)), nombre };
  if (editandoUsuario) {
    const i = usuarios.findIndex((x) => x.id === editandoUsuario);
    if (i > -1) usuarios[i] = datos;
    if (usuarioActivo && usuarioActivo.id === editandoUsuario) {
      usuarioActivo = datos;
      const v = visitaActual();
      if (v) {
        v.datos.responsable = datos.nombre;
        rellenarFormulario();
        persistirDoc();
      }
    }
  } else {
    usuarios.push(datos);
    if (!usuarioActivo) usuarioActivo = datos;
  }
  guardarUsuarios();
  renderizarListaUsuarios();
  actualizarChipUsuarios();
  estado("Operador guardado.");
  limpiarFormUsuario();
}

function eliminarUsuario(id) {
  const u = usuarios.find((x) => x.id === id);
  if (!u) return;
  if (!confirm(`¿Eliminar el operador "${u.nombre}"?\nLas hojas de la bitácora no se borran.`)) return;
  usuarios = usuarios.filter((x) => x.id !== id);
  if (usuarioActivo && usuarioActivo.id === id) {
    usuarioActivo = usuarios.length ? usuarios[0] : null;
  }
  guardarUsuarios();
  if (editandoUsuario === id) limpiarFormUsuario();
  renderizarListaUsuarios();
  actualizarChipUsuarios();
  estado("Operador eliminado.");
}

function normalizarDireccion(dir) {
  if (!dir) return "";
  let s = String(dir).trim();
  s = s.replace(/^https?:\/\//i, "");
  s = s.replace(/\/+$/, "");
  return s;
}

async function mostrarPistaServidor() {
  const pista = $("pista-servidor");
  if (!pista) return;
  if (localMode) {
    pista.textContent =
      "En el ordenador de casa, abre Bitácora BEE y mira la dirección que muestra al arrancar (ej. 192.168.1.10:8000). Escribe aquí esa dirección y pulsa «Guardar dirección».";
    return;
  }
  try {
    const r = await fetch("/api/red", { cache: "no-store" });
    const j = await r.json();
    const ip = (j.ips && j.ips[0]) || "127.0.0.1";
    const puerto = j.puerto || $.puerto || "8000";
    pista.textContent =
      `Este ordenador sirve la bitácora en la red local: http://${ip}:${puerto}. ` +
      "En el móvil escribe ese valor y pulsa «Guardar dirección».";
    if (!$("sync-direccion").value) $("sync-direccion").value = ip + ":" + puerto;
  } catch (e) {
    pista.textContent = "Este ordenador sirve la bitácora en la red local. En el móvil escribe tu dirección IP y el puerto (ej. 192.168.1.10:8000).";
  }
}

async function usarEsteAparatoComoServidor() {
  if (localMode) {
    alert("En el móvil no eres el servidor.\n\nEscribe la dirección del ordenador donde está abierta Bitácora BEE (IP:puerto).");
    return;
  }
  try {
    const r = await fetch("/api/red", { cache: "no-store" });
    const j = await r.json();
    const ip = (j.ips && j.ips[0]) || "127.0.0.1";
    const puerto = j.puerto || "8000";
    servidorSync = `${ip}:${puerto}`;
    $("sync-direccion").value = servidorSync;
    guardarUsuarios();
    arrancarAutoSync();
    estado(`Servidor de sincronización: ${servidorSync}.`);
  } catch (e) {
    alert("No se pudo averiguar la dirección de este ordenador.");
  }
}

function guardarDireccionSync() {
  const dir = normalizarDireccion($("sync-direccion").value);
  if (!dir) {
    servidorSync = "";
    guardarUsuarios();
    arrancarAutoSync();
    estado("Dirección de sincronización borrada.");
    return;
  }
  servidorSync = dir;
  guardarUsuarios();
  arrancarAutoSync();
  estado(`Dirección de sincronización guardada: ${dir}.`);
  sincronizar(false);
}

/* ------------------------------------------------------------------ */
/* sincronización por red local                                        */
/* ------------------------------------------------------------------ */

function fusionarDocs(local, remoto) {
  const clonar = (o) => JSON.parse(JSON.stringify(o));
  const mapa = new Map();
  (local.visitas || []).forEach((v) => mapa.set(v.id, clonar(v)));
  (remoto.visitas || []).forEach((v) => {
    const lv = mapa.get(v.id);
    if (!lv) mapa.set(v.id, clonar(v));
    else if ((v.actualizada || "") > (lv.actualizada || "")) mapa.set(v.id, clonar(v));
  });
  const visitas = Array.from(mapa.values());
  let actual = (local.actual && visitas.some((v) => v.id === local.actual))
    ? local.actual
    : (remoto.actual && visitas.some((v) => v.id === remoto.actual))
      ? remoto.actual
      : (visitas[0] && visitas[0].id) || null;
  return { visitas, actual, sincronizado: new Date().toISOString() };
}

async function persistirDoc() {
  guardarLocalCopia();
  sucioDoc = false;
  if (localMode) return;
  try {
    await fetch(ESTADO_JSON, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: clavesLocales(),
    });
  } catch (e) {
    localMode = true;
  }
}

function detalleSync(ok, detalle) {
  ultimoSync = { ok: !!ok, cuando: new Date(), detalle: String(detalle || "").slice(0, 120) };
  const chip = $("sync-estado");
  if (chip) {
    chip.hidden = false;
    chip.classList.toggle("sync-ok", ultimoSync.ok);
    chip.classList.toggle("sync-ko", !ultimoSync.ok);
    const h = ultimoSync.cuando.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    chip.textContent = ultimoSync.ok ? `✓ ${h}` : `✗ ${h}`;
    chip.title = ultimoSync.detalle;
  }
  const parr = $("estado-sync");
  if (parr) {
    if (ultimoSync.ok) {
      parr.hidden = true;
    } else {
      parr.hidden = false;
      parr.textContent = `Última sincronización fallida (${hora_sync()}): ${ultimoSync.detalle}`;
    }
  }
}
function hora_sync() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function sincronizar(silencio) {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const u = usuarioActual();
    leerFormulario();
    const dir = normalizarDireccion(servidorSync);
    if (!dir) {
      if (!silencio) {
        estado("Indica la dirección del servidor con el que sincronizar.");
        abrirModalUsuarios();
        setTimeout(() => { try { $("sync-direccion").focus(); } catch (e) { /* ignorar */ } }, 50);
      }
      return;
    }
    const base = "http://" + dir;
    if (!silencio) estado(`Sincronizando con ${dir}…`);
    try {
      const control = new AbortController();
      const timeoutId = setTimeout(() => control.abort(), 8000);
      const resp = await fetch(base + "/api/datos", { cache: "no-store", signal: control.signal });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const remoto = await resp.json();
      if (!remoto || !Array.isArray(remoto.visitas)) {
        clearTimeout(timeoutId);
        throw new Error("El servidor no devolvió una bitácora válida");
      }
      const fusionado = fusionarDocs(doc, remoto);
      const hayLocal = JSON.stringify(fusionado) !== JSON.stringify(doc);
      const hayRemoto = JSON.stringify(fusionado) !== JSON.stringify(remoto);
      if (!hayLocal && !hayRemoto) {
        clearTimeout(timeoutId);
        detalleSync(true, `Sin cambios en ${dir}.`);
        if (!silencio) estado(`Sincronizado con ${dir}, sin cambios (${hora_sync()}).`);
        return;
      }
      if (hayLocal) {
        doc = fusionado;
        await persistirDoc();
        renderizarSelector();
        rellenarFormulario();
      }
      const put = await fetch(base + "/api/datos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fusionado),
      });
      clearTimeout(timeoutId);
      if (!put.ok) throw new Error("HTTP " + put.status);
      detalleSync(true, `Sincronizado con ${dir}.`);
      estado(`Sincronizado con ${dir} (${hora_sync()}).`);
    } catch (e) {
      const mensaje = (e && e.name === "AbortError")
        ? "El servidor no responde (¿en la misma WiFi y encendido?)."
        : (e && e.message) || String(e);
      detalleSync(false, mensaje);
      if (!silencio) {
        estado("Error de sincronización.");
        alert(
          `No se pudo sincronizar con ${dir}.\n\n${mensaje}\n\n` +
          "Comprueba que el servidor esté abierto, que ambos equipos estén en la misma red " +
          "y que la dirección (IP:puerto) sea correcta."
        );
      }
    }
  } finally {
    sincronizando = false;
  }
}

/* Sincronización automática: al arrancar y después cada 30 s si hay
   dirección de servidor configurada. Calla mientras no haya cambios. */
async function sincronizarAutomatica() {
  if (sincronizando || !normalizarDireccion(servidorSync)) return;
  try { await sincronizar(true); } catch (e) { /* sin conexión */ }
}

function arrancarAutoSync() {
  if (timerAutoSync) clearInterval(timerAutoSync);
  timerAutoSync = null;
  if (!normalizarDireccion(servidorSync)) return;
  setTimeout(sincronizarAutomatica, 3000);
  timerAutoSync = setInterval(sincronizarAutomatica, 30000);
}

/* ------------------------------------------------------------------ */
/* actualizaciones                                                     */
/* ------------------------------------------------------------------ */

function versionMayor(a, b) {
  const p = (s) => String(s || "").trim().replace(/^v/i, "").split(".").map((x) => parseInt(x, 10) || 0);
  const A = p(a);
  const B = p(b);
  for (let i = 0; i < 3; i++) {
    if ((B[i] || 0) > (A[i] || 0)) return true;
    if ((B[i] || 0) < (A[i] || 0)) return false;
  }
  return false;
}

/* Consulta la última versión publicada. Con servidor usa /api/actualizacion;
   sin servidor (Android) consulta directamente la API pública de GitHub. */
async function consultarActualizacion() {
  if (!localMode) {
    const r = await fetch("/api/actualizacion", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  const r = await fetch(`${GH_API}/repos/${GH_REPO_ORIGEN}/releases/latest`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  return {
    actual: APP_VERSION,
    nueva: String(j.tag_name || "").replace(/^[vV]/, ""),
    notas: j.body || "",
    pagina: j.html_url || "",
  };
}

function hayNovedad(info) {
  return !!info && !!info.nueva &&
    (info.hay !== undefined ? !!info.hay : versionMayor(info.actual, info.nueva));
}

function mostrarBannerActualizacion(info) {
  $("banner-act-texto").textContent =
    `Estás en la v${info.actual || "?"} y la última publicada es la v${info.nueva}.`;
  $("banner-act").hidden = false;
}

async function comprobarActualizacionAlArrancar() {
  try {
    const info = await consultarActualizacion();
    infoActualizacion = info;
    if (hayNovedad(info)) mostrarBannerActualizacion(info);
  } catch (e) {
    /* sin conexión en el arranque: se intenta otra vez con el botón Actualizar */
  }
}

async function comprobarActualizacionManual() {
  estado("Comprobando actualizaciones…");
  try {
    const info = await consultarActualizacion();
    infoActualizacion = info;
    if (hayNovedad(info)) {
      mostrarBannerActualizacion(info);
      estado(`Hay una versión nueva: v${info.nueva}.`);
    } else {
      $("banner-act").hidden = true;
      const actual = info.actual || APP_VERSION || "desconocida";
      estado(`Estás al día: v${actual}.`);
    }
  } catch (e) {
    estado("No se pudo comprobar las actualizaciones.");
    alert("No se pudo comprobar las actualizaciones.\n\n" + (e.message || e) +
      "\n\nComprueba la conexión a internet.");
  }
}

async function aplicarActualizacion() {
  const info = infoActualizacion;
  if (!info || !info.nueva) return;
  if (localMode) {
    /* en el móvil la app no se puede auto-instalar: se abre la descarga del .apk */
    const ok = confirm(
      `La versión v${info.nueva} está disponible.\n\n` +
      `En el teléfono hay que descargar e instalar el nuevo .apk manualmente.\n` +
      `¿Abrir la página de descarga?`
    );
    if (ok) window.open(info.pagina || `${GH_REPO_ORIGEN}/releases/latest`, "_blank");
    return;
  }
  estado("Descargando la actualización…");
  try {
    const resp = await fetch("/api/actualizar", { method: "POST" });
    const j = await resp.json();
    if (j.aplicada) {
      $("banner-act").hidden = true;
      estado(`¡Actualizado a v${j.nueva_version || j.tag}! Reiniciando…`);
      setTimeout(() => {
        fetch("/api/reiniciar", { method: "POST" }).catch(() => {});
        setTimeout(() => {
          try { location.reload(); } catch (e) { /* el servidor estaba reiniciándose */ }
        }, 1800);
      }, 500);
    } else if (j.razon === "instalado") {
      $("banner-act").hidden = true;
      alert(
        `Hay una versión nueva (v${j.tag}).\n\n` +
        `La copia instalada no puede actualizarse sola.\n` +
        `Descarga el nuevo paquete e instálalo con:\n\n` +
        `  sudo apt install ./bitacorabee_${j.tag}_amd64.deb\n\n` +
        `El paquete se descargará en tu carpeta de Descargas.`
      );
      if (j.deb_url) window.open(j.deb_url, "_blank");
    } else if (j.razon === "sin-release") {
      estado("Ya estás en la última versión.");
    } else {
      estado("No se pudo actualizar.");
      alert("No se pudo actualizar: " + (j.detalle || j.razon || "error desconocido"));
    }
  } catch (e) {
    estado("No se pudo actualizar.");
    alert("No se pudo actualizar.\n\n" + (e.message || e));
  }
}

/* ------------------------------------------------------------------ */
/* eventos y arranque                                                  */
/* ------------------------------------------------------------------ */

function enlazarFormulario() {
  CLAVES_BASE.forEach((clave) => {
    const nodo = $("d-" + clave);
    if (nodo) nodo.addEventListener("input", marcarAutoguardado);
  });
  CLAVES_PROX.forEach((clave) => {
    const nodo = $("p-" + clave);
    if (nodo) nodo.addEventListener("input", marcarAutoguardado);
  });
  const otras = $("d-otras");
  if (otras) otras.addEventListener("input", marcarAutoguardado);

  $("selector-visita").addEventListener("change", (ev) => {
    doc.actual = ev.target.value;
    rellenarFormulario();
    estado("Revisión cargada.");
  });
  $("btn-nueva").addEventListener("click", nuevaRevision);
  $("btn-guardar").addEventListener("click", () => guardar("Guardado correctamente.", true));
  $("btn-imprimir").addEventListener("click", imprimir);
  $("btn-anadir").addEventListener("click", anadirColmena);
  $("btn-eliminar").addEventListener("click", eliminarUltima);

  $("btn-hojas").addEventListener("click", abrirModalHojas);
  $("btn-cerrar-hojas").addEventListener("click", cerrarModalHojas);
  $("btn-nueva-hoja").addEventListener("click", nuevaRevision);
  $("btn-exportar").addEventListener("click", exportarJSON);
  $("btn-importar").addEventListener("click", () => $("file-importar").click());
  $("file-importar").addEventListener("change", manejarImportar);
  $("modal-hojas").addEventListener("click", (ev) => {
    if (ev.target === $("modal-hojas")) cerrarModalHojas();
  });

  $("btn-sincronizar").addEventListener("click", sincronizar);
  $("btn-usuarios").addEventListener("click", abrirModalUsuarios);
  $("btn-cerrar-usuarios").addEventListener("click", cerrarModalUsuarios);
  $("btn-guardar-usuario").addEventListener("click", guardarUsuarioForm);
  $("btn-eliminar-usuario").addEventListener("click", () => {
    if (editandoUsuario) eliminarUsuario(editandoUsuario);
  });
  $("btn-cancelar-usuario").addEventListener("click", limpiarFormUsuario);
  $("btn-guardar-sync").addEventListener("click", guardarDireccionSync);
  $("btn-usar-este-aparato").addEventListener("click", usarEsteAparatoComoServidor);
  $("modal-usuarios").addEventListener("click", (ev) => {
    if (ev.target === $("modal-usuarios")) cerrarModalUsuarios();
  });

  $("btn-actualizar").addEventListener("click", comprobarActualizacionManual);
  $("btn-banner-actualizar").addEventListener("click", aplicarActualizacion);
  $("btn-banner-cerrar").addEventListener("click", () => {
    $("banner-act").hidden = true;
  });

  $("btn-credenciales").addEventListener("click", () => { $("modal-credenciales").hidden = false; });
  $("btn-cerrar-credenciales").addEventListener("click", () => { $("modal-credenciales").hidden = true; });
  $("modal-credenciales").addEventListener("click", (ev) => {
    if (ev.target === $("modal-credenciales")) $("modal-credenciales").hidden = true;
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!$("modal-hojas").hidden) cerrarModalHojas();
      else if (!$("modal-usuarios").hidden) cerrarModalUsuarios();
      else if (!$("modal-credenciales").hidden) $("modal-credenciales").hidden = true;
    }
  });
}

async function arrancar() {
  const ano = $("ano-copy");
  if (ano) ano.textContent = String(new Date().getFullYear());
  construirCabecera();
  construirActividades();
  enlazarFormulario();
  await cargarDatos();
  await cargarUsuarios();
  actualizarChipUsuarios();
  renderizarSelector();
  rellenarFormulario();
  arrancarAutoSync();
  $("version-app").textContent = "";
  if (localMode) {
    if (APP_VERSION) $("version-app").textContent = "Bitácora BEE v" + APP_VERSION;
    estado("Modo sin servidor: los cambios se guardan en este dispositivo.");
  } else {
    try {
      const r = await fetch("/api/version", { cache: "no-store" });
      const j = await r.json();
      if (j && j.version) $("version-app").textContent = (j.nombre || "Bitácora BEE") + " v" + j.version;
    } catch (e) { /* sin servidor */ }
    estado("Listo. Los cambios se guardan automáticamente.");
  }
  comprobarActualizacionAlArrancar();
}

document.addEventListener("DOMContentLoaded", arrancar);