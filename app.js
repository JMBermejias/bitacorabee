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

const $ = (id) => document.getElementById(id);

let doc = null;               /* documento completo {visitas, actual} */
let timerAutoguardado = null;
let clavesAct = new Set();
let localMode = false;        /* true si no hay servidor (p. ej. en Android) */

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

  v.actualizada = new Date().toISOString();
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
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("modal-hojas").hidden) cerrarModalHojas();
  });
}

async function arrancar() {
  $("version-app").textContent = "";
  try {
    const r = await fetch("/api/version", { cache: "no-store" });
    const j = await r.json();
    if (j && j.version) $("version-app").textContent = (j.nombre || "Bitácora BEE") + " v" + j.version;
  } catch (e) { /* sin servidor (Android, modo local) */ }
  construirCabecera();
  construirActividades();
  enlazarFormulario();
  await cargarDatos();
  renderizarSelector();
  rellenarFormulario();
  estado("Listo. Los cambios se guardan automáticamente.");
}

document.addEventListener("DOMContentLoaded", arrancar);