'use strict';

// ===== Configuración =====
const CONFIG = {
  rangoT: [-6, 12],          // horas respecto al hallazgo
  rangoTemp: [0, 45],        // °C
  campo: { columnas: 25, filas: 18, largo: 13 },
  pasoRK4: 0.01,             // h; error ~1e-10, suficiente para la tabla < 0.001 %
  duracionAnimacion: 600,    // ms
  margen: { izq: 54, der: 14, sup: 14, inf: 56 },
  ejercicio: { Ta: 20, hallazgo: 22 * 60, T0: 30, t1: 1, T1: 28, Tvida: 37 },
  colores: {
    // Guías (campo, rejilla, isoclinas) en tonos apagados; la curva y la muerte son lo que resalta
    fondo: '#150e12', rejilla: 'rgba(255,255,255,0.035)', ejes: 'rgba(255,255,255,0.14)', texto: '#a8949d', textoTenue: '#7a6870',
    textoClaro: '#f2e9ed', campo: '168,148,157', isoclina: 'rgba(196,161,217,0.7)', equilibrio: '#d9c7ce', vida: 'rgba(244,63,94,0.75)',
    caso: '#f472b6', muerte: '#f43f5e', marcador: '#ffffff', hallazgo: 'rgba(255,255,255,0.18)',
    cruz: 'rgba(255,255,255,0.18)', etiquetaFondo: 'rgba(21,14,18,0.85)', tooltipFondo: 'rgba(26,18,23,0.96)', tooltipBorde: 'rgba(255,255,255,0.12)',
  },
  paleta: ['#7dd3fc', '#c4b5fd', '#fcd34d', '#86efac', '#fda4af', '#f9a8d4', '#a5b4fc', '#fdba74'],
};

// ===== Modelo: funciones puras =====
const Modelo = {
  pendiente: (T, p) => -p.k * (T - p.Ta),
  solucionExacta: (t, t0, T0, p) => p.Ta + (T0 - p.Ta) * Math.exp(-p.k * (t - t0)),
  // k > 0 solo si T1 está entre Ta y T0 (el cuerpo se acerca al ambiente)
  calcularK(T0, T1, t1, Ta) {
    const r = (T1 - Ta) / (T0 - Ta);
    return r > 0 && r < 1 && t1 > 0 ? -Math.log(r) / t1 : NaN;
  },
  tiempoMuerte(Tvida, T0, Ta, k) {
    const r = (Tvida - Ta) / (T0 - Ta);
    return r > 0 && k > 0 ? -Math.log(r) / k : NaN;
  },
  isoclina: (c, p) => p.Ta - c / p.k,
};

// ===== Solver numérico =====
const Solver = {
  // h negativo (o tFin < t0) integra hacia atrás; el paso se ajusta para caer exacto en tFin
  rk4(f, t0, y0, tFin, h) {
    const n = Math.max(1, Math.ceil(Math.abs(tFin - t0) / Math.abs(h)));
    const paso = (tFin - t0) / n;
    const puntos = [[t0, y0]];
    let y = y0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * paso;
      const k1 = f(t, y);
      const k2 = f(t + paso / 2, y + paso * k1 / 2);
      const k3 = f(t + paso / 2, y + paso * k2 / 2);
      const k4 = f(t + paso, y + paso * k3);
      y += paso * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      puntos.push([t0 + (i + 1) * paso, y]);
    }
    return puntos;
  },
  curvaCompleta(t0, y0, p) {
    const f = (t, T) => Modelo.pendiente(T, p);
    const [tMin, tMax] = CONFIG.rangoT;
    const atras = this.rk4(f, t0, y0, tMin, -CONFIG.pasoRK4).reverse();
    const adelante = this.rk4(f, t0, y0, tMax, CONFIG.pasoRK4);
    return { puntos: atras.concat(adelante.slice(1)), indiceInicio: atras.length - 1 };
  },
};

// ===== Escala mundo ↔ pantalla =====
const Escala = {
  ancho: 0, alto: 0,
  actualizar(ancho, alto) { this.ancho = ancho; this.alto = alto; },
  get area() {
    const m = CONFIG.margen;
    return { x: m.izq, y: m.sup, w: this.ancho - m.izq - m.der, h: this.alto - m.sup - m.inf };
  },
  pxPorHora() { const [a, b] = CONFIG.rangoT; return this.area.w / (b - a); },
  pxPorGrado() { const [a, b] = CONFIG.rangoTemp; return this.area.h / (b - a); },
  x(t) { return this.area.x + (t - CONFIG.rangoT[0]) * this.pxPorHora(); },
  y(T) { const a = this.area; return a.y + a.h - (T - CONFIG.rangoTemp[0]) * this.pxPorGrado(); },
  t(px) { return CONFIG.rangoT[0] + (px - this.area.x) / this.pxPorHora(); },
  T(py) { const a = this.area; return CONFIG.rangoTemp[0] + (a.y + a.h - py) / this.pxPorGrado(); },
  dentro(px, py) { const a = this.area; return px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h; },
  // Primer paso cuyo espaciado en pantalla no amontona etiquetas
  pasoTicks: (pxPorUnidad, candidatos, minPx) => candidatos.find(p => p * pxPorUnidad >= minPx) ?? candidatos.at(-1),
  ticks(min, max, paso) { const r = []; for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) r.push(v); return r; },
};

// ===== Formato =====
const Formato = {
  num: (x, d = 2) => Number.isFinite(x) ? x.toFixed(d).replace('-', '−') : '—',
  grados: (x, d = 1) => `${Formato.num(x, d)} °C`,
  conSigno: (x, d = 2) => x < 0 ? `(${Formato.num(x, d)})` : Formato.num(x, d),
  hora(t, hallazgo = Estado.hallazgo) {
    if (!Number.isFinite(t)) return '—';
    const m = ((Math.round(hallazgo + t * 60) % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
  },
  duracion(horas) {
    if (!Number.isFinite(horas)) return '—';
    const m = Math.round(Math.abs(horas) * 60);
    if (m >= 2 * 1440) return `${Math.floor(m / 1440)} días ${Math.floor(m % 1440 / 60)} h`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  },
  horaInput: min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
};

// ===== Estado: única fuente de verdad =====
const Estado = {
  restablecer() {
    const e = CONFIG.ejercicio;
    Object.assign(this, {
      Ta: e.Ta, hallazgo: e.hallazgo, T0: e.T0, t1: e.t1, T1: e.T1, Tvida: e.Tvida,
      k: Modelo.calcularK(e.T0, e.T1, e.t1, e.Ta),
      ver: { campo: true, isoclinas: false, equilibrio: true, vida: true },
      soluciones: [], caso: null, hover: null,
    });
  },
  agregarSolucion(t0, T0) {
    this.soluciones.push({ t0, T0, color: CONFIG.paleta[this.soluciones.length % CONFIG.paleta.length], inicio: performance.now() });
  },
  resolverCaso() { this.caso = { inicio: performance.now() }; },
  analizar() {
    const kMedido = Modelo.calcularK(this.T0, this.T1, this.t1, this.Ta);
    const tm = Modelo.tiempoMuerte(this.Tvida, this.T0, this.Ta, this.k);
    return { kMedido, tm, valido: Number.isFinite(tm) && tm <= 0 };
  },
};

// ===== Render del lienzo =====
const Render = {
  ctx: null, pendiente: false,

  iniciar(lienzo, caja) {
    this.ctx = lienzo.getContext('2d');
    new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect, dpr = window.devicePixelRatio || 1;
      lienzo.width = Math.round(width * dpr);
      lienzo.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // dibujamos en px CSS, nítido en alta densidad
      Escala.actualizar(width, height);
      this.dibujar();
    }).observe(caja);
  },

  programar() {
    if (this.pendiente) return;
    this.pendiente = true;
    requestAnimationFrame(() => { this.pendiente = false; this.dibujar(); });
  },

  dibujar() {
    if (Escala.ancho === 0) return;
    const c = this.ctx, a = Escala.area, ahora = performance.now();
    c.clearRect(0, 0, Escala.ancho, Escala.alto);
    this.dibujarEjes();
    c.save();
    c.beginPath(); c.rect(a.x, a.y, a.w, a.h); c.clip();
    if (Estado.ver.campo) this.dibujarCampo();
    if (Estado.ver.isoclinas) this.dibujarIsoclinas();
    if (Estado.ver.equilibrio) this.dibujarEquilibrio();
    if (Estado.ver.vida) this.lineaHorizontal(Estado.Tvida, CONFIG.colores.vida, [10, 4], `Temperatura en vida (${Formato.num(Estado.Tvida, 1)} °C)`, 'der');
    const animando = this.dibujarCurvas(ahora);
    this.dibujarMarcadores();
    c.restore();
    this.dibujarGuia();
    if (Estado.hover) this.dibujarTooltip(Estado.hover);
    if (animando) this.programar();
  },

  // --- utilidades de dibujo ---
  etiqueta(texto, x, y, color, alinear = 'left', fuente = '500 11px system-ui, sans-serif') {
    const c = this.ctx;
    c.font = fuente;
    const w = c.measureText(texto).width, x0 = alinear === 'right' ? x - w : alinear === 'center' ? x - w / 2 : x;
    c.fillStyle = CONFIG.colores.etiquetaFondo;
    c.fillRect(x0 - 4, y - 12, w + 8, 17);
    c.fillStyle = color;
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText(texto, x0, y);
  },
  lineaHorizontal(T, color, guiones, texto, lado, grosor = 1.5) {
    const c = this.ctx, a = Escala.area, y = Escala.y(T);
    if (y < a.y || y > a.y + a.h) return;
    c.save();
    c.strokeStyle = color; c.lineWidth = grosor; c.setLineDash(guiones);
    c.beginPath(); c.moveTo(a.x, y); c.lineTo(a.x + a.w, y); c.stroke();
    c.restore();
    if (texto) this.etiqueta(texto, lado === 'izq' ? a.x + 8 : a.x + a.w - 8, y - 6, color, lado === 'izq' ? 'left' : 'right');
  },
  punto(t, T, color, radio = 5) {
    const c = this.ctx;
    c.beginPath(); c.arc(Escala.x(t), Escala.y(T), radio, 0, Math.PI * 2);
    c.fillStyle = color; c.fill();
    c.lineWidth = 2; c.strokeStyle = CONFIG.colores.fondo; c.stroke();
  },
  progreso: (inicio, ahora) => Math.min(1, (ahora - inicio) / CONFIG.duracionAnimacion),
  // Traza desde la condición inicial hacia ambos lados según el progreso de la animación
  trazo({ puntos, indiceInicio }, prog, color, grosor) {
    const c = this.ctx, ultimo = puntos.length - 1;
    const desde = Math.round(indiceInicio * (1 - prog));
    const hasta = Math.round(indiceInicio + (ultimo - indiceInicio) * prog);
    c.beginPath();
    for (let i = desde; i <= hasta; i++) {
      const [t, T] = puntos[i];
      const y = Math.max(-1e4, Math.min(1e4, Escala.y(T)));   // la solución hacia atrás crece exponencialmente
      i === desde ? c.moveTo(Escala.x(t), y) : c.lineTo(Escala.x(t), y);
    }
    c.strokeStyle = color; c.lineWidth = grosor; c.lineJoin = 'round'; c.stroke();
  },

  // --- capas ---
  dibujarEjes() {
    const c = this.ctx, a = Escala.area, col = CONFIG.colores;
    const [t0, t1] = CONFIG.rangoT, [T0, T1] = CONFIG.rangoTemp;
    const pasoX = Escala.pasoTicks(Escala.pxPorHora(), [1, 2, 3, 6], 30);
    const pasoReloj = Escala.pasoTicks(Escala.pxPorHora(), [1, 2, 3, 4, 6, 12], 72);
    const pasoY = Escala.pasoTicks(Escala.pxPorGrado(), [5, 10, 15], 22);

    c.fillStyle = col.fondo; c.fillRect(a.x, a.y, a.w, a.h);
    c.lineWidth = 1; c.strokeStyle = col.rejilla;
    c.beginPath();
    Escala.ticks(t0, t1, pasoX).forEach(t => { const x = Escala.x(t) + .5; c.moveTo(x, a.y); c.lineTo(x, a.y + a.h); });
    Escala.ticks(T0, T1, pasoY).forEach(T => { const y = Escala.y(T) + .5; c.moveTo(a.x, y); c.lineTo(a.x + a.w, y); });
    c.stroke();

    // t = 0: momento del hallazgo
    c.strokeStyle = col.hallazgo; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(Escala.x(0) + .5, a.y); c.lineTo(Escala.x(0) + .5, a.y + a.h); c.stroke();
    c.setLineDash([]);

    c.strokeStyle = col.ejes; c.strokeRect(a.x + .5, a.y + .5, a.w, a.h);

    c.fillStyle = col.texto; c.font = '12px system-ui, sans-serif'; c.textBaseline = 'middle';
    c.textAlign = 'center';
    Escala.ticks(t0, t1, pasoX).forEach(t => c.fillText(Formato.num(t, 0), Escala.x(t), a.y + a.h + 12));
    c.font = '11px system-ui, sans-serif'; c.fillStyle = col.textoTenue;
    Escala.ticks(t0, t1, pasoReloj).forEach(t => c.fillText(Formato.hora(t), Escala.x(t), a.y + a.h + 27));
    c.textAlign = 'right'; c.font = '12px system-ui, sans-serif'; c.fillStyle = col.texto;
    Escala.ticks(T0, T1, pasoY).forEach(T => c.fillText(T, a.x - 7, Escala.y(T)));

    c.font = '600 12px system-ui, sans-serif'; c.fillStyle = col.textoClaro; c.textAlign = 'center';
    c.fillText('Tiempo (h)  ·  hora de reloj', a.x + a.w / 2, a.y + a.h + 45);
    c.save();
    c.translate(14, a.y + a.h / 2); c.rotate(-Math.PI / 2);
    c.fillText('Temperatura (°C)', 0, 0);
    c.restore();
    c.textBaseline = 'alphabetic';
  },

  dibujarCampo() {
    const c = this.ctx, a = Escala.area, cfg = CONFIG.campo;
    const cols = Math.max(6, Math.min(cfg.columnas, Math.floor(a.w / 24)));
    const filas = Math.max(6, Math.min(cfg.filas, Math.floor(a.h / 20)));
    const largo = Math.min(cfg.largo, a.w / cols * 0.75, a.h / filas * 0.75);
    const [Tmin, Tmax] = CONFIG.rangoTemp;
    const mMax = Estado.k * Math.max(Math.abs(Tmax - Estado.Ta), Math.abs(Tmin - Estado.Ta)) || 1;
    c.lineWidth = 1.1; c.lineCap = 'round';
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < filas; j++) {
        const px = a.x + (i + .5) * a.w / cols, py = a.y + (j + .5) * a.h / filas;
        const m = Modelo.pendiente(Escala.T(py), Estado);
        // Pendiente en pantalla: 1 h horizontal frente a m °C vertical
        const dx = Escala.pxPorHora(), dy = -m * Escala.pxPorGrado(), L = Math.hypot(dx, dy);
        const ux = dx / L * largo / 2, uy = dy / L * largo / 2, ang = Math.atan2(uy, ux);
        c.strokeStyle = `rgba(${CONFIG.colores.campo},${0.14 + 0.3 * Math.abs(m) / mMax})`;
        c.beginPath();
        c.moveTo(px - ux, py - uy); c.lineTo(px + ux, py + uy);
        c.moveTo(px + ux, py + uy); c.lineTo(px + ux - 3 * Math.cos(ang - .5), py + uy - 3 * Math.sin(ang - .5));
        c.moveTo(px + ux, py + uy); c.lineTo(px + ux - 3 * Math.cos(ang + .5), py + uy - 3 * Math.sin(ang + .5));
        c.stroke();
      }
    }
    c.lineCap = 'butt';
  },

  dibujarIsoclinas() {
    const [Tmin, Tmax] = CONFIG.rangoTemp, { k, Ta } = Estado;
    const cMin = -k * (Tmax - Ta), cMax = -k * (Tmin - Ta);
    const paso = pasoBonito((cMax - cMin) / 4);
    for (const c of Escala.ticks(cMin, cMax, paso)) {
      if (Math.abs(c) < paso / 2) continue;   // c = 0 es el equilibrio
      this.lineaHorizontal(Modelo.isoclina(c, Estado), CONFIG.colores.isoclina, [2, 5], `dT/dt = ${Formato.num(c, 2)}`, 'der', 1.2);
    }
  },

  dibujarEquilibrio() {
    this.lineaHorizontal(Estado.Ta, CONFIG.colores.equilibrio, [8, 6],
      `EQUILIBRIO: Ta = ${Formato.num(Estado.Ta, 1)} °C (estable)`, 'izq', 2);
  },

  dibujarCurvas(ahora) {
    let animando = false;
    for (const s of Estado.soluciones) {
      const prog = this.progreso(s.inicio, ahora);
      animando ||= prog < 1;
      this.trazo(Solver.curvaCompleta(s.t0, s.T0, Estado), prog, s.color, 2.2);
      this.punto(s.t0, s.T0, s.color);
      this.etiqueta(`T0: ${s.T0.toFixed(1)}°`, Escala.x(s.t0) + 9, Escala.y(s.T0) - 9, s.color);
    }
    if (Estado.caso) {
      const prog = this.progreso(Estado.caso.inicio, ahora);
      animando ||= prog < 1;
      this.trazo(Solver.curvaCompleta(0, Estado.T0, Estado), prog, CONFIG.colores.caso, 3.2);
      Estado.caso.listo = prog >= 1;
    }
    return animando;
  },

  dibujarMarcadores() {
    if (!Estado.caso) return;
    const { T0, t1, T1, Tvida } = Estado, col = CONFIG.colores;
    this.punto(0, T0, col.marcador, 6);
    this.etiqueta(`Hallazgo (0, ${Formato.num(T0, 1)})`, Escala.x(0) - 10, Escala.y(T0) - 10, col.marcador, 'right');
    this.punto(t1, T1, col.marcador, 6);
    this.etiqueta(`(${Formato.num(t1, 1)}, ${Formato.num(T1, 1)})`, Escala.x(t1) + 10, Escala.y(T1) + 20, col.marcador);
    const { tm, valido } = Estado.analizar();
    if (!valido || !Estado.caso.listo) return;
    const c = this.ctx, a = Escala.area, x = Escala.x(tm);
    c.save();
    c.strokeStyle = col.muerte; c.lineWidth = 1.5; c.setLineDash([6, 4]);
    c.beginPath(); c.moveTo(x, a.y); c.lineTo(x, a.y + a.h); c.stroke();
    c.restore();
    this.punto(tm, Tvida, col.muerte, 8);
    const alinear = x > a.x + a.w - 160 ? 'right' : x < a.x + 160 ? 'left' : 'center';
    this.etiqueta(`Muerte ≈ ${Formato.hora(tm)}`, x, Escala.y(Tvida) + 30, col.muerte, alinear, '700 15px system-ui, sans-serif');
  },

  dibujarGuia() {
    if (Estado.soluciones.length || Estado.caso) return;
    const a = Escala.area;
    this.etiqueta('Haz clic en el plano para trazar una solución', a.x + a.w / 2, a.y + 30, CONFIG.colores.textoClaro, 'center', '500 13px system-ui, sans-serif');
  },

  dibujarTooltip({ x, y }) {
    const c = this.ctx, a = Escala.area;
    const t = Escala.t(x), T = Escala.T(y), m = Modelo.pendiente(T, Estado);
    c.strokeStyle = CONFIG.colores.cruz; c.lineWidth = 1;
    c.beginPath(); c.moveTo(a.x, y); c.lineTo(a.x + a.w, y); c.moveTo(x, a.y); c.lineTo(x, a.y + a.h); c.stroke();
    const lineas = [
      `t = ${Formato.num(t, 2)} h  (${Formato.hora(t)})`,
      `T = ${Formato.grados(T, 1)}`,
      `dT/dt = ${Formato.num(m, 3)} °C/h`,
    ];
    c.font = '12px ui-monospace, Consolas, monospace';
    const w = Math.max(...lineas.map(l => c.measureText(l).width)) + 18, h = lineas.length * 17 + 12;
    let bx = x + 14, by = y + 14;
    if (bx + w > a.x + a.w) bx = x - w - 14;
    if (by + h > a.y + a.h) by = y - h - 14;
    c.fillStyle = CONFIG.colores.tooltipFondo; c.strokeStyle = CONFIG.colores.tooltipBorde;
    c.fillRect(bx, by, w, h); c.strokeRect(bx + .5, by + .5, w, h);
    c.fillStyle = CONFIG.colores.textoClaro; c.textAlign = 'left';
    lineas.forEach((l, i) => c.fillText(l, bx + 9, by + 20 + i * 17));
  },
};

// Paso "redondo" más cercano a x entre 1, 1.5, 2, 2.5, 3, 4, 5 ×10ⁿ
function pasoBonito(x) {
  const e = 10 ** Math.floor(Math.log10(x));
  const base = [1, 1.5, 2, 2.5, 3, 4, 5, 10].reduce((m, b) => Math.abs(b - x / e) < Math.abs(m - x / e) ? b : m);
  return base * e;
}

// ===== Pestaña: solución paso a paso =====
const EXPLICACION_SIMPLE = {
  1: 'Mientras más caliente esté el cuerpo respecto al cuarto, más rápido pierde calor. El signo «−» indica que baja.',
  2: 'Ponemos todo lo que tiene T de un lado y el tiempo del otro, para poder integrar cada lado por separado.',
  3: 'Integrar es «sumar» todos los cambios pequeños; al hacerlo aparece un logaritmo.',
  4: 'Despejamos T: la diferencia con el cuarto se va reduciendo como una exponencial.',
  5: 'Usamos la medición del hallazgo (t = 0) para saber cuánto vale A.',
  6: 'La segunda medición nos dice cuánto bajó en t1 horas; de ahí sale la rapidez de enfriamiento k.',
  7: 'Buscamos en qué instante el cuerpo tenía la temperatura de una persona viva.',
  8: 'El resultado sale en horas negativas (antes del hallazgo); lo restamos a la hora del hallazgo.',
};

// Calculadora: el público elige un valor y ve la fórmula con los números sustituidos
const Calculadora = {
  iniciar() {
    ['calcHora', 'calcTemp'].forEach(id => UI.$(id).addEventListener('input', () => this.actualizar()));
  },
  actualizar() {
    const $ = UI.$, n = Formato.num, { k, Ta, T0 } = Estado, A = T0 - Ta;
    const [h, m] = $('calcHora').value.split(':').map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      // Diferencia con el hallazgo dentro de ±12 h, para que «8:00 p.m.» sea antes de las 10:00 p.m.
      let dif = h * 60 + m - Estado.hallazgo;
      dif = ((dif + 720) % 1440 + 1440) % 1440 - 720;
      const t = dif / 60, e = Math.exp(-k * t), T = Ta + A * e;
      $('calcHoraRes').innerHTML =
        `t = ${n(t, 2)} h (respecto al hallazgo)<br>` +
        `T = ${n(Ta, 1)} + ${Formato.conSigno(A, 1)}·e<sup>−${n(k, 4)}·${Formato.conSigno(t, 2)}</sup> = ${n(Ta, 1)} + ${Formato.conSigno(A, 1)}·${n(e, 4)}<br>` +
        `<b>T ≈ ${Formato.grados(T, 2)}</b>`;
    }
    const Tq = parseFloat($('calcTemp').value), r = (Tq - Ta) / A;
    $('calcTempRes').innerHTML = !(r > 0)
      ? `El cuerpo nunca marca ${n(Tq, 1)} °C: la curva solo se acerca a ${Formato.grados(Ta)} sin cruzarla.`
      : `t = −ln(${frac(`${n(Tq, 1)} − ${n(Ta, 1)}`, n(A, 1))}) ÷ ${n(k, 4)} = ${n(-Math.log(r) / k, 3)} h<br>` +
        `<b>Hora ≈ ${Formato.hora(-Math.log(r) / k)}</b>`;
  },
};
const frac = (a, b) => `<span class="frac"><span>${a}</span><span>${b}</span></span>`;
function generarPasos() {
  const { k, Ta, T0, t1, T1, Tvida } = Estado, n = Formato.num, A = T0 - Ta;
  const { kMedido, tm, valido } = Estado.analizar();

  const paso = (i, titulo, cuerpo) => `<article class="paso"><h3><span class="num">${i}</span>${titulo}</h3><p class="simple">💡 ${EXPLICACION_SIMPLE[i]}</p>${cuerpo}</article>`;
  const eq = s => `<div class="eq">${s}</div>`;

  const p6 = Number.isFinite(kMedido)
    ? eq(`${n(T1, 1)} = ${n(Ta, 1)} + ${Formato.conSigno(A, 1)}·e<sup>−k·${n(t1, 1)}</sup>`) +
      eq(`e<sup>−k·${n(t1, 1)}</sup> = ${frac(`${n(T1, 1)} − ${n(Ta, 1)}`, n(A, 1))} = ${n((T1 - Ta) / A, 4)}`) +
      eq(`k = −${frac(`ln(${n((T1 - Ta) / A, 4)})`, n(t1, 1))} = <b>${n(kMedido, 4)} h⁻¹</b>`) +
      (Math.abs(kMedido - k) > 5e-5 ? `<p class="nota">En el simulador se está usando k = ${n(k, 4)} (deslizador). Pulsa «Calcular k con la 2.ª medición» para usar este valor.</p>` : '')
    : `<p class="nota">Con estos datos no hay un k positivo: T1 debe estar entre Ta y T0.</p>`;

  const p7 = Number.isFinite(tm)
    ? eq(`${n(Tvida, 1)} = ${n(Ta, 1)} + ${Formato.conSigno(A, 1)}·e<sup>−${n(k, 4)}·t</sup>`) +
      eq(`e<sup>−${n(k, 4)}·t</sup> = ${frac(`${n(Tvida, 1)} − ${n(Ta, 1)}`, n(A, 1))} = ${n((Tvida - Ta) / A, 4)}`) +
      eq(`t = −${frac(`ln(${n((Tvida - Ta) / A, 4)})`, n(k, 4))} = <b>${n(tm, 4)} h</b>`) +
      `<p>El signo negativo indica que ocurrió <b>antes</b> del hallazgo.</p>`
    : `<p class="nota">Con estos datos la curva nunca pasa por ${n(Tvida, 1)} °C.</p>`;

  const p8 = valido
    ? eq(`${n(tm, 3)} h = −${Formato.duracion(tm)}`) +
      eq(`${Formato.hora(0)} − ${Formato.duracion(tm)} = <b>${Formato.hora(tm)}</b>`)
    : `<p class="nota">No se puede convertir: el modelo no da una hora de muerte anterior al hallazgo.</p>`;

  const respuesta = valido
    ? `<div class="respuesta">Respuesta: la persona murió aproximadamente a las <strong>${Formato.hora(tm)}</strong>, unas ${Formato.duracion(tm)} antes del hallazgo (${Formato.hora(0)}).</div>`
    : `<div class="respuesta">Con los datos actuales el modelo no da una hora de muerte válida.</div>`;

  // Verificación analítica vs RK4, ambas desde T(0) = T0
  const f = (t, T) => Modelo.pendiente(T, Estado);
  let difMax = 0;
  const filas = [-3, -2, -1, 0, 1, 2, 5, 10].map(t => {
    const exacta = Modelo.solucionExacta(t, 0, T0, Estado);
    const numerica = Solver.rk4(f, 0, T0, t, CONFIG.pasoRK4).at(-1)[1];
    const dif = Math.abs(exacta - numerica) / Math.abs(exacta) * 100;
    difMax = Math.max(difMax, dif);
    return `<tr><td>${n(t, 0)}</td><td>${Formato.hora(t)}</td><td>${n(exacta, 6)}</td><td>${n(numerica, 6)}</td><td class="${dif < 1e-3 ? 'ok' : ''}">${dif.toExponential(2)} %</td></tr>`;
  }).join('');

  return [
    `<article class="paso resumen"><h3>En palabras sencillas</h3><ol>
      <li><b>Un cuerpo caliente se enfría más rápido</b> cuanto más caliente está respecto al cuarto, y más despacio al acercarse a ${Formato.grados(Ta)}.</li>
      <li>Con <b>dos mediciones</b> (${Formato.grados(T0)} y ${Formato.grados(T1)}) averiguamos <b>qué tan rápido</b> se enfría: ese número es k.</li>
      <li>Después <b>«rebobinamos» la curva</b> hacia atrás hasta que marque ${Formato.grados(Tvida)}: ese es el momento de la muerte.</li>
    </ol></article>`,
    paso(1, 'Planteamiento de la EDO', eq(`${frac('dT', 'dt')} = −k (T − ${n(Ta, 1)})`)),
    paso(2, 'Separación de variables', eq(`${frac('dT', `T − ${n(Ta, 1)}`)} = −k dt`)),
    paso(3, 'Integración', eq(`∫ ${frac('dT', `T − ${n(Ta, 1)}`)} = ∫ −k dt &nbsp;⟹&nbsp; ln|T − ${n(Ta, 1)}| = −k t + C`)),
    paso(4, 'Solución general', eq(`T(t) = ${n(Ta, 1)} + A·e<sup>−k t</sup>, &nbsp;&nbsp; A = ±e<sup>C</sup>`)),
    paso(5, `Condición inicial T(0) = ${n(T0, 1)}`,
      eq(`${n(T0, 1)} = ${n(Ta, 1)} + A·e<sup>0</sup> &nbsp;⟹&nbsp; A = ${n(A, 1)}`) +
      eq(`T(t) = ${n(Ta, 1)} + ${Formato.conSigno(A, 1)}·e<sup>−k t</sup>`)),
    paso(6, `Cálculo de k con T(${n(t1, 1)}) = ${n(T1, 1)}`, p6),
    paso(7, `Tiempo en que T = ${n(Tvida, 1)} °C`, p7),
    paso(8, 'Conversión a hora de reloj', p8),
    respuesta,
    `<article class="paso"><h3><span class="num">✓</span>Verificación: analítica vs. numérica (RK4, h = ${CONFIG.pasoRK4})</h3>
      <div class="tabla-caja"><table>
        <thead><tr><th>t (h)</th><th>Hora</th><th>Analítica (°C)</th><th>Numérica RK4 (°C)</th><th>Diferencia %</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>
      <p>Diferencia máxima: <b>${difMax.toExponential(2)} %</b> ${difMax < 1e-3 ? '(menor a 0.001 % ✔)' : ''}</p>
    </article>`,
  ].join('');
}

// ===== Decoración: ilustración del cuerpo según horas desde la muerte =====
const Cadaver = {
  // Etapas forenses simplificadas (tiempos orientativos a ~20 °C)
  ETAPAS: [
    { desde: -Infinity, nombre: 'Con vida', desc: 'Antes de la hora estimada de muerte: temperatura normal.' },
    { desde: 0, nombre: 'Etapa fresca: palidez', desc: 'La sangre deja de circular y la piel palidece (pallor mortis). El cuerpo empieza a enfriarse.' },
    { desde: 2, nombre: 'Etapa fresca: livideces', desc: 'La sangre baja a las zonas inferiores y forma manchas moradas (livor mortis). La rigidez empieza por la mandíbula.' },
    { desde: 8, nombre: 'Etapa fresca: rigidez máxima', desc: 'Rigor mortis en todo el cuerpo y livideces fijas. Por fuera todavía no hay descomposición visible.' },
    { desde: 24, nombre: 'Putrefacción temprana', desc: 'Cede la rigidez y aparece la mancha verde en el abdomen: primera señal visible de descomposición.' },
    { desde: 72, nombre: 'Hinchazón', desc: 'Los gases de las bacterias hinchan el cuerpo y las venas se marcan (marmoleado).' },
    { desde: 168, nombre: 'Decaimiento activo', desc: 'Los gases escapan, la piel se oscurece y los tejidos se pierden rápido; llegan los insectos.' },
    { desde: 480, nombre: 'Decadencia avanzada', desc: 'Quedan pocos tejidos blandos y los huesos empiezan a verse.' },
    { desde: 1200, nombre: 'Esqueletización', desc: 'Solo queda el esqueleto, que se blanquea con el tiempo.' },
  ],
  // Fotogramas clave del aspecto; entre ellos se interpola para que el cambio sea continuo
  CLAVES: [
    { h: -1, piel: '#e8b796', hueso: '#d9cba4', livor: 0, verde: 0, hinchazon: 0, marmol: 0, carne: 1, moscas: 0 },
    { h: 0, piel: '#ebc8b5', hueso: '#d9cba4', livor: 0, verde: 0, hinchazon: 0, marmol: 0, carne: 1, moscas: 0 },
    { h: 2, piel: '#efdacd', hueso: '#d9cba4', livor: 0.3, verde: 0, hinchazon: 0, marmol: 0, carne: 1, moscas: 0 },
    { h: 12, piel: '#ecdcd2', hueso: '#d9cba4', livor: 0.9, verde: 0, hinchazon: 0, marmol: 0, carne: 1, moscas: 0 },
    { h: 24, piel: '#e3d6c6', hueso: '#d9cba4', livor: 0.9, verde: 0.25, hinchazon: 0, marmol: 0, carne: 1, moscas: 0 },
    { h: 48, piel: '#cfcfae', hueso: '#d9cba4', livor: 0.8, verde: 0.7, hinchazon: 0.25, marmol: 0.3, carne: 1, moscas: 0.1 },
    { h: 120, piel: '#9fa877', hueso: '#d9cba4', livor: 0.5, verde: 1, hinchazon: 1, marmol: 0.9, carne: 1, moscas: 0.5 },
    { h: 240, piel: '#5e4630', hueso: '#d4c49a', livor: 0.2, verde: 0.4, hinchazon: 0.15, marmol: 0.5, carne: 0.85, moscas: 1 },
    { h: 600, piel: '#4a3524', hueso: '#d9cba4', livor: 0, verde: 0, hinchazon: 0, marmol: 0.2, carne: 0.35, moscas: 0.4 },
    { h: 1200, piel: '#3d2d20', hueso: '#e4dcc4', livor: 0, verde: 0, hinchazon: 0, marmol: 0, carne: 0, moscas: 0 },
    { h: 1500, piel: '#3d2d20', hueso: '#f0ebdd', livor: 0, verde: 0, hinchazon: 0, marmol: 0, carne: 0, moscas: 0 },
  ],
  HORAS_MAX: 1500,   // ~62 días: llega a la esqueletización

  iniciar() {
    const $ = UI.$;
    // Escala cúbica: las primeras horas (lo que mide el modelo) ocupan casi todo el recorrido
    $('explorar').addEventListener('input', e => this.mostrarHoras(this.HORAS_MAX * (e.target.value / 100) ** 3, 'deslizador'));
    $('explorarDias').addEventListener('input', e => {
      const d = parseFloat(e.target.value);
      if (Number.isFinite(d)) this.mostrarHoras(Math.min(this.HORAS_MAX, Math.max(0, d * 24)), 'dias');
    });
  },

  // t en horas respecto al hallazgo (curva del caso)
  mostrar(t) {
    const { tm, valido } = Estado.analizar();
    this.mostrarHoras(valido ? t - tm : NaN, 'curva');
  },

  aspecto(horas) {
    const c = this.CLAVES, h = Number.isFinite(horas) ? horas : c[0].h;
    const i = c.findIndex(k => k.h > h);
    if (i === 0) return c[0];
    if (i === -1) return c.at(-1);
    const a = c[i - 1], b = c[i], p = (h - a.h) / (b.h - a.h);
    const r = {};
    for (const clave in a) r[clave] = typeof a[clave] === 'string' ? mezclarColor(a[clave], b[clave], p) : a[clave] + (b[clave] - a[clave]) * p;
    return r;
  },

  // La rigidez sube de 2 a 12 h, se mantiene hasta las 24 h y desaparece hacia las 40 h
  rigidez: h => !(h >= 2) ? 0 : h < 12 ? (h - 2) / 10 : h < 24 ? 1 : Math.max(0, 1 - (h - 24) / 16),

  pintar(horas) {
    const $ = UI.$, a = this.aspecto(horas), muerto = horas >= 0;
    $('silueta').setAttribute('color', a.piel);
    $('esqueleto').setAttribute('color', a.hueso);
    $('carne').setAttribute('opacity', a.carne);
    $('esqueleto').setAttribute('opacity', Math.min(1, (1 - a.carne) * 2));
    // La hinchazón ensancha el cuerpo alrededor del eje central (x = 60)
    $('carne').setAttribute('transform', `translate(60 0) scale(${1 + 0.35 * a.hinchazon} 1) translate(-60 0)`);
    $('livor').setAttribute('opacity', a.livor);
    $('mancha').setAttribute('opacity', a.verde);
    $('mancha').setAttribute('rx', 6 + 26 * a.verde);
    $('mancha').setAttribute('ry', 6 + 30 * a.verde);
    $('marmoleado').setAttribute('opacity', a.marmol);
    $('moscas').setAttribute('opacity', a.moscas);
    $('pelo').setAttribute('opacity', Math.min(1, a.carne * 1.5));
    $('ojosAbiertos').style.display = muerto ? 'none' : '';
    $('ojosCerrados').style.display = muerto ? '' : 'none';

    $('senLivor').style.width = `${100 * (muerto ? a.livor : 0)}%`;
    $('senRigidez').style.width = `${100 * this.rigidez(horas)}%`;
    $('senPutre').style.width = `${100 * Math.min(1, Math.max(0, (horas - 24) / 216))}%`;   // de 24 h a 10 días
  },

  mostrarHoras(horas, origen) {
    const $ = UI.$, { tm, valido } = Estado.analizar();
    const T = Modelo.solucionExacta(horas + tm, 0, Estado.T0, Estado);
    const etapa = Number.isFinite(horas) ? this.ETAPAS.findLast(e => horas >= e.desde) : null;

    this.pintar(horas);
    const h = Number.isFinite(horas) ? Math.max(0, horas) : 0;
    if (origen !== 'deslizador') $('explorar').value = 100 * Math.cbrt(h / this.HORAS_MAX);
    if (origen !== 'dias') $('explorarDias').value = (h / 24).toFixed(1);

    $('termoNivel').style.height = `${100 * Math.min(1, Math.max(0, (Number.isFinite(T) ? T : 0) / CONFIG.rangoTemp[1]))}%`;
    $('termoTexto').textContent = Formato.grados(T);
    $('etiquetaPie').textContent = valido ? `† ${Formato.hora(tm)}` : '—';
    $('cuerpoEtapa').textContent = etapa ? etapa.nombre : 'Sin estimación';
    $('cuerpoTiempo').textContent = !etapa ? '' :
      `${Formato.duracion(horas)} ${horas < 0 ? 'antes' : 'después'} de la muerte`;
    $('cuerpoDesc').textContent = etapa ? etapa.desc : 'Los datos actuales no dan una hora de muerte válida.';
  },
};

// Mezcla lineal de dos colores #rrggbb (p = 0 → a, p = 1 → b)
function mezclarColor(a, b, p) {
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, '0')).join('');
}

// ===== Escenarios de la pestaña Discusión =====
const Escenarios = {
  condiciones: () => [44, 37, 30, 20, 12, 6, 1].forEach(T => Estado.agregarSolucion(-6, T)),
  frio: () => { [2, 8, 14].forEach(T => Estado.agregarSolucion(-6, T)); Estado.agregarSolucion(-6, 40); },
  aire: () => { Estado.k = 0.45; Estado.resolverCaso(); },
  abrigado: () => { Estado.k = 0.10; Estado.resolverCaso(); },
  invierno: () => { Estado.Ta = 5; Estado.resolverCaso(); },
  verano: () => { Estado.Ta = 26; Estado.resolverCaso(); },
  limitaciones: () => Estado.resolverCaso(),
};

// ===== UI: controles → estado → render =====
const UI = {
  $: id => document.getElementById(id),

  iniciar() {
    this.vincularPar('kRango', 'kNum', 'k', 4);
    this.vincularPar('TaRango', 'TaNum', 'Ta', 1);
    ['T0', 't1', 'T1', 'Tvida'].forEach(id => this.$(id).addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) { Estado[id] = v; actualizar(); }
    }));
    this.$('hallazgo').addEventListener('input', e => {
      const [h, m] = e.target.value.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) { Estado.hallazgo = h * 60 + m; actualizar(); }
    });
    document.querySelectorAll('[data-ver]').forEach(c => c.addEventListener('change', () => {
      Estado.ver[c.dataset.ver] = c.checked; actualizar();
    }));

    this.$('btnK').addEventListener('click', () => this.calcularK());
    this.$('btnResolver').addEventListener('click', () => { Estado.resolverCaso(); actualizar(); });
    this.$('btnLimpiar').addEventListener('click', () => { Estado.soluciones = []; Estado.caso = null; actualizar(); });
    this.$('btnReset').addEventListener('click', () => { Estado.restablecer(); this.sincronizarEntradas(); actualizar(); });

    document.querySelectorAll('[data-pestana]').forEach(b => b.addEventListener('click', () => this.mostrarPestana(b.dataset.pestana)));
    document.querySelectorAll('[data-escenario]').forEach(b => b.addEventListener('click', () => {
      Estado.restablecer();
      Escenarios[b.dataset.escenario]();
      this.sincronizarEntradas();
      this.mostrarPestana('simulador');
      actualizar();
    }));

    const lienzo = this.$('lienzo');
    const posicion = e => { const r = lienzo.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    lienzo.addEventListener('click', e => {
      const { x, y } = posicion(e);
      if (!Escala.dentro(x, y)) return;
      Estado.agregarSolucion(Escala.t(x), Escala.T(y));
      actualizar();
    });
    lienzo.addEventListener('pointermove', e => {
      const p = posicion(e);
      Estado.hover = Escala.dentro(p.x, p.y) ? p : null;
      Cadaver.mostrar(Estado.hover ? Escala.t(p.x) : 0);
      Render.programar();
    });
    lienzo.addEventListener('pointerleave', () => { Estado.hover = null; Cadaver.mostrar(0); Render.programar(); });
  },

  // Deslizador y caja numérica comparten un mismo valor del estado
  vincularPar(idRango, idNum, clave, decimales) {
    const rango = this.$(idRango), num = this.$(idNum);
    const aplicar = (valor, origen) => {
      if (!Number.isFinite(valor)) return;
      const v = Math.min(+rango.max, Math.max(+rango.min, valor));
      Estado[clave] = v;
      if (origen !== rango) rango.value = v;
      if (origen !== num) num.value = v.toFixed(decimales);
      actualizar();
    };
    rango.addEventListener('input', () => aplicar(parseFloat(rango.value), rango));
    num.addEventListener('input', () => aplicar(parseFloat(num.value), num));
    num.addEventListener('change', () => { num.value = Estado[clave].toFixed(decimales); });
  },

  calcularK() {
    const k = Modelo.calcularK(Estado.T0, Estado.T1, Estado.t1, Estado.Ta);
    if (!Number.isFinite(k)) {
      this.$('rMensaje').textContent = 'No se puede calcular k: T1 debe estar entre Ta y T0, y t1 > 0.';
      return;
    }
    Estado.k = Math.min(1, Math.max(0.01, k));
    this.sincronizarEntradas();
    actualizar();
  },

  sincronizarEntradas() {
    const $ = this.$;
    $('kRango').value = Estado.k; $('kNum').value = Estado.k.toFixed(4);
    $('TaRango').value = Estado.Ta; $('TaNum').value = Estado.Ta.toFixed(1);
    ['T0', 't1', 'T1', 'Tvida'].forEach(id => { $(id).value = Estado[id]; });
    $('hallazgo').value = Formato.horaInput(Estado.hallazgo);
    document.querySelectorAll('[data-ver]').forEach(c => { c.checked = Estado.ver[c.dataset.ver]; });
  },

  mostrarPestana(id) {
    document.querySelectorAll('[data-pestana]').forEach(b => b.setAttribute('aria-selected', b.dataset.pestana === id));
    document.querySelectorAll('.panel-pestana').forEach(p => { p.hidden = p.id !== id; });
    if (id === 'pasos') this.$('pasosContenido').innerHTML = generarPasos();
  },

  actualizarPaneles() {
    const $ = this.$, { k, Ta, T0, Tvida } = Estado, { kMedido, tm, valido } = Estado.analizar();
    const A = T0 - Ta;
    $('iK').textContent = `${Formato.num(k, 4)} h⁻¹`;
    $('iTa').textContent = Formato.grados(Ta);
    $('iSol').textContent = Estado.soluciones.length + (Estado.caso ? 1 : 0);
    $('iMuerte').textContent = valido ? `≈ ${Formato.hora(tm)}` : '—';
    $('rK').textContent = `${Formato.num(k, 4)} h⁻¹`;
    $('rFormula').innerHTML = `T(t) = ${Formato.num(Ta, 1)} ${A < 0 ? '−' : '+'} ${Formato.num(Math.abs(A), 1)}·e<sup>−${Formato.num(k, 4)}·t</sup>`;
    $('rMuerte').textContent = valido ? Formato.hora(tm) : '—';
    $('rTranscurrido').textContent = valido ? Formato.duracion(tm) : '—';
    $('rThallazgo').textContent = `${Formato.grados(T0)} a las ${Formato.hora(0)}`;

    let mensaje = '';
    if (!Number.isFinite(tm)) mensaje = `Con estos datos el cuerpo nunca estuvo a ${Formato.grados(Tvida)}: revisa Ta y T0.`;
    else if (tm > 0) mensaje = 'T0 es mayor que la temperatura en vida: el modelo no da una muerte anterior al hallazgo.';
    else if (Number.isFinite(kMedido) && Math.abs(kMedido - k) > 5e-5) mensaje = `Nota: la 2.ª medición da k = ${Formato.num(kMedido, 4)}; el deslizador usa otro valor.`;
    $('rMensaje').textContent = mensaje;

    Cadaver.mostrar(Estado.hover ? Escala.t(Estado.hover.x) : 0);
    Calculadora.actualizar();
    if (!$('pasos').hidden) $('pasosContenido').innerHTML = generarPasos();
  },
};

function actualizar() {
  UI.actualizarPaneles();
  Render.programar();
}

// Comprueba el ejercicio de referencia; solo escribe en consola si algo falla
function autoverificar() {
  const p = { k: Modelo.calcularK(30, 28, 1, 20), Ta: 20 };
  const tm = Modelo.tiempoMuerte(37, 30, 20, p.k);
  const cerca = (a, b, tol) => Math.abs(a - b) < tol;
  const rk = Solver.rk4((t, T) => Modelo.pendiente(T, p), 0, 30, 10, CONFIG.pasoRK4).at(-1)[1];
  console.assert(cerca(p.k, Math.log(1.25), 1e-12), 'k ≠ ln(1.25)');
  console.assert(cerca(tm, -2.378, 1e-3), 't_m ≠ −2.378');
  console.assert(cerca(Modelo.solucionExacta(2, 0, 30, p), 26.40, 5e-3), 'T(2) ≠ 26.40');
  console.assert(cerca(Modelo.solucionExacta(10, 0, 30, p), 21.07, 5e-3), 'T(10) ≠ 21.07');
  console.assert(cerca(rk, Modelo.solucionExacta(10, 0, 30, p), 1e-7), 'RK4 no coincide con la analítica');
  console.assert(Formato.hora(tm, 22 * 60) === '7:37 p.m.', 'hora de muerte ≠ 7:37 p.m.');
}

Estado.restablecer();
UI.iniciar();
Calculadora.iniciar();
Cadaver.iniciar();
UI.sincronizarEntradas();
Render.iniciar(UI.$('lienzo'), UI.$('lienzoCaja'));
actualizar();
autoverificar();
