(() => {
  'use strict';

  const flower = document.getElementById('flower');
  const head = document.getElementById('head');
  const startBtn = document.getElementById('startBtn');
  const calibrateBtn = document.getElementById('calibrateBtn');
  const hint = document.getElementById('hint');
  const rx = document.getElementById('rx');
  const ry = document.getElementById('ry');
  const rz = document.getElementById('rz');

  // Amplifica el giro del teléfono para que la flor rote más que el dispositivo
  const GAIN = 1.6;
  // Suavizado (0 = sin movimiento, 1 = sin suavizado)
  const SMOOTH = 0.15;
  const DEG = Math.PI / 180;

  /* ---------- Construcción de la flor ---------- */

  function buildFlower() {
    const s = Math.min(window.innerWidth * 0.66, window.innerHeight * 0.36);
    head.innerHTML = '';

    const layers = [
      { count: 14, w: 0.26, h: 0.52, tilt: -12, z: 0, offset: 0, cls: '' },
      { count: 12, w: 0.24, h: 0.42, tilt: -38, z: 2, offset: 15, cls: 'inner' },
      { count: 9, w: 0.18, h: 0.22, tilt: -55, z: 4, offset: 7, cls: 'inner' },
    ];

    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const p = document.createElement('div');
        p.className = 'petal ' + layer.cls;
        const jitter = (Math.random() - 0.5) * 6;
        p.style.setProperty('--a', (i * 360) / layer.count + layer.offset + jitter + 'deg');
        p.style.setProperty('--tilt', layer.tilt + (Math.random() - 0.5) * 6 + 'deg');
        p.style.setProperty('--w', s * layer.w + 'px');
        p.style.setProperty('--h', s * layer.h * (0.95 + Math.random() * 0.1) + 'px');
        p.style.setProperty('--z', layer.z + 'px');
        head.appendChild(p);
      }
    }

    // Centro en forma de cúpula
    const discs = 7;
    const base = s * 0.34;
    const height = s * 0.16;
    for (let i = 0; i < discs; i++) {
      const t = i / (discs - 1);
      const c = document.createElement('div');
      c.className = 'core' + (i === discs - 1 ? ' top' : '');
      c.style.setProperty('--d', base * Math.sqrt(1 - t * t * 0.75) + 'px');
      c.style.setProperty('--z', 6 + t * height + 'px');
      head.appendChild(c);
    }
  }

  buildFlower();
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildFlower, 200);
  });

  /* ---------- Cuaterniones ---------- */

  const qIdentity = () => [1, 0, 0, 0];

  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
  }

  const qConj = (q) => [q[0], -q[1], -q[2], -q[3]];

  function qNormalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  }

  function qAxis(x, y, z, angle) {
    const s = Math.sin(angle / 2);
    return [Math.cos(angle / 2), x * s, y * s, z * s];
  }

  // Orientación del dispositivo (alpha, beta, gamma) -> cuaternión (orden Z-X'-Y'')
  function qFromEuler(alpha, beta, gamma) {
    const x = beta * DEG, y = gamma * DEG, z = alpha * DEG;
    const cX = Math.cos(x / 2), cY = Math.cos(y / 2), cZ = Math.cos(z / 2);
    const sX = Math.sin(x / 2), sY = Math.sin(y / 2), sZ = Math.sin(z / 2);
    return [
      cX * cY * cZ - sX * sY * sZ,
      sX * cY * cZ - cX * sY * sZ,
      cX * sY * cZ + sX * cY * sZ,
      cX * cY * sZ + sX * sY * cZ,
    ];
  }

  // Multiplica el ángulo de rotación de q por k
  function qScale(q, k) {
    q = q[0] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
    const angle = 2 * Math.acos(Math.min(1, q[0]));
    const s = Math.sqrt(1 - q[0] * q[0]);
    if (s < 1e-6) return qIdentity();
    return qAxis(q[1] / s, q[2] / s, q[3] / s, angle * k);
  }

  function qSlerp(a, b, t) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (dot < 0) {
      b = [-b[0], -b[1], -b[2], -b[3]];
      dot = -dot;
    }
    if (dot > 0.9995) {
      return qNormalize(a.map((v, i) => v + (b[i] - v) * t));
    }
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / sin;
    const wb = Math.sin(t * theta) / sin;
    return a.map((v, i) => v * wa + b[i] * wb);
  }

  // Cuaternión (ejes del dispositivo: y hacia arriba) -> matrix3d de CSS (y hacia abajo)
  function toCssMatrix(q) {
    const [w, x, y, z] = q;
    const m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - w * z), m02 = 2 * (x * z + w * y);
    const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - w * x);
    const m20 = 2 * (x * z - w * y), m21 = 2 * (y * z + w * x), m22 = 1 - 2 * (x * x + y * y);
    // Cambio de base C·M·C con C = diag(1, -1, 1); matrix3d va por columnas
    return `matrix3d(${m00},${-m10},${m20},0,${-m01},${m11},${-m21},0,${m02},${-m12},${m22},0,0,0,0,1)`;
  }

  function toEulerDeg(q) {
    const [w, x, y, z] = q;
    const ex = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const ey = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
    const ez = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return [ex / DEG, ey / DEG, ez / DEG];
  }

  /* ---------- Estado ---------- */

  let sensorQ = null;     // orientación actual del teléfono
  let baseQ = null;       // orientación de referencia (calibración)
  let manualQ = qIdentity(); // rotación por arrastre con el dedo
  let currentQ = qIdentity();
  let sensorsOn = false;

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  function onOrientation(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    let q = qFromEuler(e.alpha || 0, e.beta || 0, e.gamma || 0);
    // Compensa si la pantalla está en horizontal
    q = qMul(q, qAxis(0, 0, 1, -screenAngle() * DEG));
    sensorQ = q;
    if (!baseQ) baseQ = q;
    if (!sensorsOn) {
      sensorsOn = true;
      hint.textContent = 'Mueve tu teléfono para girar la flor';
      startBtn.hidden = true;
      calibrateBtn.hidden = false;
    }
  }

  function targetQ() {
    let q = qIdentity();
    if (sensorQ && baseQ) {
      // Rotación relativa desde la calibración; la invertimos para que la flor
      // parezca fija en el espacio mientras el teléfono gira a su alrededor
      const rel = qMul(qConj(baseQ), sensorQ);
      q = qScale(qConj(rel), GAIN);
    }
    return qNormalize(qMul(manualQ, q));
  }

  function frame() {
    currentQ = qNormalize(qSlerp(currentQ, targetQ(), SMOOTH));
    flower.style.transform = toCssMatrix(currentQ);

    const [ex, ey, ez] = toEulerDeg(currentQ);
    rx.textContent = Math.round(ex) + '°';
    ry.textContent = Math.round(ey) + '°';
    rz.textContent = Math.round(ez) + '°';

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- Permisos (iOS necesita un toque del usuario) ---------- */

  async function enableSensors() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') {
          hint.textContent = 'Permiso denegado. Puedes girar la flor con el dedo.';
          return;
        }
      }
      if (!DOE) {
        hint.textContent = 'Tu dispositivo no tiene sensores. Gira la flor con el dedo.';
        return;
      }
      window.addEventListener('deviceorientation', onOrientation);
      hint.textContent = 'Esperando datos del sensor…';
      setTimeout(() => {
        if (!sensorsOn) hint.textContent = 'No llegan datos del sensor. Gira la flor con el dedo.';
      }, 2000);
    } catch (err) {
      hint.textContent = 'No se pudo activar el sensor: ' + err.message;
    }
  }

  startBtn.addEventListener('click', enableSensors);

  calibrateBtn.addEventListener('click', () => {
    baseQ = sensorQ;
    manualQ = qIdentity();
  });

  // En Android no hace falta permiso: se activa directamente
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    enableSensors();
  }

  /* ---------- Arrastre con el dedo (respaldo) ---------- */

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const scene = document.getElementById('scene');

  scene.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    scene.setPointerCapture(e.pointerId);
  });

  scene.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const k = 0.5 * DEG;
    manualQ = qNormalize(qMul(qMul(qAxis(0, 1, 0, dx * k), qAxis(1, 0, 0, dy * k)), manualQ));
  });

  const stopDrag = () => { dragging = false; };
  scene.addEventListener('pointerup', stopDrag);
  scene.addEventListener('pointercancel', stopDrag);
})();
